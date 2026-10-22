import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { getDb } from '@/lib/db';
import { decodeVideoSlug } from '@/lib/videoUtils';

export const dynamic = 'force-dynamic';

// In-memory buffer cache for resized OG images (lightning fast sub-5ms response)
const ogCache = globalThis.__tubelock_og_cache || (globalThis.__tubelock_og_cache = new Map());

export async function GET(request, context) {
  try {
    const { id: rawParam } = await context.params;
    const cleanId = (rawParam || '').replace(/\.(jpg|jpeg|png|webp)$/i, '');
    const numericId = decodeVideoSlug(cleanId) || parseInt(cleanId, 10);

    if (!numericId || isNaN(numericId)) {
      return await fallbackImage();
    }

    const cacheKey = `og_vid_${numericId}`;
    const cached = ogCache.get(cacheKey);
    if (cached && (Date.now() - cached.time < 3600000)) { // 1 hr memory cache
      return new Response(cached.buffer, {
        headers: {
          'Content-Type': 'image/jpeg',
          'Content-Length': String(cached.buffer.byteLength),
          'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
        },
      });
    }

    const sql = getDb();
    const rows = await sql`
      SELECT id, title, thumbnail_url
      FROM videos
      WHERE id = ${numericId}
      LIMIT 1;
    `;

    if (!rows || rows.length === 0) {
      return await fallbackImage();
    }

    const video = rows[0];
    let posterUrl = video.thumbnail_url || `/streams/stream_vid_${video.id}/poster.jpg`;

    // Fetch or decode poster image buffer
    let inputBuffer = null;
    if (posterUrl.startsWith('data:')) {
      const base64Data = posterUrl.split(',')[1];
      if (base64Data) {
        inputBuffer = Buffer.from(base64Data, 'base64');
      }
    } else {
      if (posterUrl.startsWith('/')) {
        const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://tubelock.vercel.app';
        posterUrl = `${siteUrl}${posterUrl}`;
      }

      try {
        const res = await fetch(posterUrl, { next: { revalidate: 86400 } });
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          inputBuffer = Buffer.from(arrayBuf);
        }
      } catch (fetchErr) {
        console.warn('[OG Image Fetch Warning]:', fetchErr.message);
      }
    }

    if (!inputBuffer) {
      return await fallbackImage();
    }

    // Resize to exact 1200x630 with high quality and < 150 KB size
    const optimizedBuffer = await sharp(inputBuffer)
      .resize(1200, 630, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({
        quality: 82,
        mozjpeg: true,
      })
      .toBuffer();

    // Cache in memory
    if (ogCache.size > 200) {
      const firstKey = ogCache.keys().next().value;
      ogCache.delete(firstKey);
    }
    ogCache.set(cacheKey, { buffer: optimizedBuffer, time: Date.now() });

    return new Response(optimizedBuffer, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(optimizedBuffer.byteLength),
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400',
      },
    });
  } catch (err) {
    console.error('[OG Image Error]:', err);
    return await fallbackImage();
  }
}

async function fallbackImage() {
  try {
    const defaultImagePath = path.join(process.cwd(), 'public', 'images', 'TubeLock.png');
    const defaultBuf = await fs.readFile(defaultImagePath);
    const resized = await sharp(defaultBuf)
      .resize(1200, 630, {
        fit: 'contain',
        background: { r: 15, g: 15, b: 15, alpha: 1 },
      })
      .jpeg({ quality: 85 })
      .toBuffer();

    return new Response(resized, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(resized.byteLength),
        'Cache-Control': 'public, max-age=86400, s-maxage=604800',
      },
    });
  } catch {
    return new Response('Image not found', { status: 404 });
  }
}

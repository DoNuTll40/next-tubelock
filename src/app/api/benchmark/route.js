import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const testType = searchParams.get('test') || 'all';

  const results = {
    timestamp: new Date().toISOString(),
    tests: {},
  };

  const sql = getDb();

  // 1. Database Benchmark (Latency & Payload comparison)
  if (testType === 'all' || testType === 'db') {
    try {
      // Warm Ping
      const t0 = performance.now();
      await sql`SELECT 1 as ping;`;
      const t1 = performance.now();

      // Slim Projection (Current optimized)
      const tSlim0 = performance.now();
      const slimRows = await sql`
        SELECT 
          id, title, duration, file_size_bytes, resolution, fps, codec, 
          thumbnail_url, tags, category, views_count, created_at, status, source_type
        FROM videos 
        WHERE status = 'READY' OR status IS NULL 
        ORDER BY created_at DESC;
      `;
      const tSlim1 = performance.now();
      const slimJson = JSON.stringify(slimRows);
      const slimBytes = Buffer.byteLength(slimJson);

      // Full Projection with source_cache (Legacy unoptimized)
      const tFull0 = performance.now();
      const fullRows = await sql`
        SELECT * FROM videos 
        WHERE status = 'READY' OR status IS NULL 
        ORDER BY created_at DESC;
      `;
      const tFull1 = performance.now();
      const fullJson = JSON.stringify(fullRows);
      const fullBytes = Buffer.byteLength(fullJson);

      results.tests.db = {
        pingMs: Math.round((t1 - t0) * 100) / 100,
        slimQuery: {
          timeMs: Math.round((tSlim1 - tSlim0) * 100) / 100,
          payloadBytes: slimBytes,
          payloadKb: Math.round((slimBytes / 1024) * 100) / 100,
          itemsCount: slimRows.length,
        },
        fullQuery: {
          timeMs: Math.round((tFull1 - tFull0) * 100) / 100,
          payloadBytes: fullBytes,
          payloadKb: Math.round((fullBytes / 1024) * 100) / 100,
          itemsCount: fullRows.length,
        },
        savings: {
          byteReductionPct: Math.round((1 - slimBytes / (fullBytes || 1)) * 1000) / 10,
          speedupMultiplier: Math.round(((tFull1 - tFull0) / (tSlim1 - tSlim0 || 1)) * 10) / 10,
        },
        status: 'SUCCESS',
      };
    } catch (err) {
      results.tests.db = { status: 'FAILED', error: err.message };
    }
  }

  // 2. Storage & Auth Benchmark (Microsoft Graph & Token Status)
  if (testType === 'all' || testType === 'storage') {
    try {
      const tToken0 = performance.now();
      const token = await getGraphToken();
      const tToken1 = performance.now();

      const tDrive0 = performance.now();
      const driveId = await getUserDriveId(token);
      const tDrive1 = performance.now();

      // Test a sample item download URL from video 829 or latest video
      const sampleVid = await sql`
        SELECT id, title, onedrive_folder_id, source_cache 
        FROM videos 
        WHERE source_cache IS NOT NULL 
        ORDER BY id DESC 
        LIMIT 1;
      `;

      let sampleChunk = null;
      if (sampleVid?.[0]?.source_cache) {
        const cache = typeof sampleVid[0].source_cache === 'string'
          ? JSON.parse(sampleVid[0].source_cache)
          : sampleVid[0].source_cache;
        
        // Find an actual TS chunk or m3u8
        const chunk = cache.items?.find((i) => i.name?.endsWith('.ts')) || cache.items?.[0];
        if (chunk) {
          sampleChunk = {
            videoId: sampleVid[0].id,
            videoTitle: sampleVid[0].title,
            fileName: chunk.name,
            downloadUrl: chunk.downloadUrl,
          };
        }
      }

      results.tests.storage = {
        graphTokenMs: Math.round((tToken1 - tToken0) * 100) / 100,
        driveResolutionMs: Math.round((tDrive1 - tDrive0) * 100) / 100,
        driveIdAvailable: !!driveId,
        sampleChunk,
        status: 'SUCCESS',
      };
    } catch (err) {
      results.tests.storage = { status: 'FAILED', error: err.message };
    }
  }

  // 3. System & Quota Stats
  if (testType === 'all' || testType === 'system') {
    try {
      const [{ total_videos }] = await sql`SELECT count(*) as total_videos FROM videos;`;
      const [{ ready_videos }] = await sql`SELECT count(*) as ready_videos FROM videos WHERE status = 'READY' OR status IS NULL;`;

      // Estimate total chunks managed
      const rowsWithCache = await sql`SELECT source_cache FROM videos WHERE source_cache IS NOT NULL;`;
      let totalChunks = 0;
      for (const r of rowsWithCache) {
        try {
          const c = typeof r.source_cache === 'string' ? JSON.parse(r.source_cache) : r.source_cache;
          totalChunks += c.items?.length || 0;
        } catch (_) {}
      }

      results.tests.system = {
        totalVideos: parseInt(total_videos, 10),
        readyVideos: parseInt(ready_videos, 10),
        totalManagedFiles: totalChunks,
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'production',
        status: 'SUCCESS',
      };
    } catch (err) {
      results.tests.system = { status: 'FAILED', error: err.message };
    }
  }

  return NextResponse.json(results, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

import { NextResponse } from 'next/server';
import { accessError, getSessionUserId, isAdmin } from '@/lib/access';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';
import { decompressSourceCache } from '@/lib/videoSourceService';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request) {
  let sql;
  try {
    sql = getDb();
    if (!isAdmin(await getSessionUserId(sql))) return accessError(403);
  } catch (err) {
    console.error('[benchmark] Session validation failed:', err);
    return NextResponse.json({ error: 'Session validation unavailable' }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const testType = searchParams.get('test') || 'all';

  const results = {
    timestamp: new Date().toISOString(),
    tests: {},
  };

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

      // Estimate the legacy JSON payload in Postgres without sending the rows.
      const [full] = await sql`
        SELECT count(*) AS items_count,
          COALESCE(sum(octet_length(row_to_json(v)::text)), 0)
            + GREATEST(count(*) - 1, 0) + 2 AS payload_bytes
        FROM videos v
        WHERE status = 'READY' OR status IS NULL;
      `;
      const fullBytes = Number(full.payload_bytes);

      results.tests.db = {
        pingMs: Math.round((t1 - t0) * 100) / 100,
        slimQuery: {
          timeMs: Math.round((tSlim1 - tSlim0) * 100) / 100,
          payloadBytes: slimBytes,
          payloadKb: Math.round((slimBytes / 1024) * 100) / 100,
          itemsCount: slimRows.length,
        },
        fullQuery: {
          timeMs: null,
          payloadBytes: fullBytes,
          payloadKb: Math.round((fullBytes / 1024) * 100) / 100,
          itemsCount: Number(full.items_count),
        },
        savings: {
          byteReductionPct: Math.round((1 - slimBytes / (fullBytes || 1)) * 1000) / 10,
        },
        status: 'SUCCESS',
      };
    } catch (err) {
      console.error('[benchmark] Database test failed:', err);
      results.tests.db = { status: 'FAILED', error: 'Database benchmark failed' };
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

      // Report the name of a sample item from the latest cached video.
      const sampleVid = await sql`
        SELECT id, title,
          (to_jsonb(v)->>'source_cache_br') AS source_cache_br,
          (
            SELECT item->>'name'
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(source_cache->'items') = 'array'
                THEN source_cache->'items' ELSE '[]'::jsonb END
            ) AS items(item)
            WHERE lower(item->>'name') LIKE '%.ts' OR lower(item->>'name') LIKE '%.m3u8'
            LIMIT 1
          ) AS chunk_name
        FROM videos v
        WHERE (to_jsonb(v)->>'source_cache_br') IS NOT NULL OR source_cache IS NOT NULL
        ORDER BY id DESC
        LIMIT 1;
      `;

      let sampleChunk = null;
      const [sample] = sampleVid;
      let fileName = sample?.chunk_name;
      if (!fileName && sample?.source_cache_br) {
        const parsed = decompressSourceCache(sample.source_cache_br);
        fileName = parsed?.items?.find((i) => {
          const n = String(i?.name || '').toLowerCase();
          return n.endsWith('.ts') || n.endsWith('.m3u8');
        })?.name;
      }
      if (fileName) {
        sampleChunk = {
          videoId: sample.id,
          videoTitle: sample.title,
          fileName,
        };
      }

      results.tests.storage = {
        graphTokenMs: Math.round((tToken1 - tToken0) * 100) / 100,
        driveResolutionMs: Math.round((tDrive1 - tDrive0) * 100) / 100,
        driveIdAvailable: !!driveId,
        sampleChunk,
        status: 'SUCCESS',
      };
    } catch (err) {
      console.error('[benchmark] Storage test failed:', err);
      results.tests.storage = { status: 'FAILED', error: 'Storage benchmark failed' };
    }
  }

  // 3. System & Quota Stats
  if (testType === 'all' || testType === 'system') {
    try {
      const [{ total_videos, ready_videos, total_files }] = await sql`
        SELECT count(*) AS total_videos,
          count(*) FILTER (WHERE status = 'READY' OR status IS NULL) AS ready_videos,
          COALESCE(sum(
            COALESCE(
              NULLIF((to_jsonb(v)->>'source_cache_items_count')::int, 0),
              CASE WHEN jsonb_typeof(source_cache->'items') = 'array'
                THEN jsonb_array_length(source_cache->'items') ELSE 0 END
            )
          ), 0) AS total_files
        FROM videos v;
      `;

      results.tests.system = {
        totalVideos: parseInt(total_videos, 10),
        readyVideos: parseInt(ready_videos, 10),
        totalManagedFiles: Number(total_files),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'production',
        status: 'SUCCESS',
      };
    } catch (err) {
      console.error('[benchmark] System test failed:', err);
      results.tests.system = { status: 'FAILED', error: 'System benchmark failed' };
    }
  }

  return NextResponse.json(results, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

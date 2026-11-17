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
        SELECT id, title, (
          SELECT jsonb_build_object('name', item->>'name', 'downloadUrl', item->>'downloadUrl')
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(source_cache->'items') = 'array'
              THEN source_cache->'items' ELSE '[]'::jsonb END
          ) AS items(item)
          WHERE lower(item->>'name') LIKE '%.ts' OR lower(item->>'name') LIKE '%.m3u8'
          LIMIT 1
        ) AS chunk
        FROM videos 
        WHERE source_cache IS NOT NULL 
        ORDER BY id DESC 
        LIMIT 1;
      `;

      let sampleChunk = null;
      const chunk = sampleVid[0]?.chunk;
      if (chunk) {
        sampleChunk = {
          videoId: sampleVid[0].id,
          videoTitle: sampleVid[0].title,
          fileName: chunk.name,
          downloadUrl: chunk.downloadUrl,
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
      results.tests.storage = { status: 'FAILED', error: err.message };
    }
  }

  // 3. System & Quota Stats
  if (testType === 'all' || testType === 'system') {
    try {
      const [{ total_videos, ready_videos, total_files }] = await sql`
        SELECT count(*) AS total_videos,
          count(*) FILTER (WHERE status = 'READY' OR status IS NULL) AS ready_videos,
          COALESCE(sum(CASE WHEN jsonb_typeof(source_cache->'items') = 'array'
            THEN jsonb_array_length(source_cache->'items') ELSE 0 END), 0) AS total_files
        FROM videos;
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
      results.tests.system = { status: 'FAILED', error: err.message };
    }
  }

  return NextResponse.json(results, {
    headers: {
      'Cache-Control': 'no-store, max-age=0',
    },
  });
}

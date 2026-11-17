import zlib from 'node:zlib';
import { isMatureVideo, isPreviewImage, protectVideoPoster } from './videoUtils';
import { after } from 'next/server';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';

// URL ของ Cloudflare Worker (อ่านจาก env ก่อน ถ้าไม่มีใช้ค่าเดิมเป็น fallback)
const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://tubelock-cache.iinter731.workers.dev';

export function wrapWithWorkerCache(name, downloadUrl) {
  if (name && name.toLowerCase().endsWith('.ts')) {
    return `${CF_WORKER_URL}/?url=${encodeURIComponent(downloadUrl)}`;
  }
  return downloadUrl;
}

// High-speed In-Memory Cache (Global across server restarts/HMR in dev)
export const sourceCache =
  globalThis.__tubelock_source_cache || (globalThis.__tubelock_source_cache = new Map());
export const inFlightRequests =
  globalThis.__tubelock_inflight || (globalThis.__tubelock_inflight = new Map());
export const assetCache =
  globalThis.__tubelock_asset_cache || (globalThis.__tubelock_asset_cache = new Map());

/**
 * Invalidate in-memory playback and asset caches for a video ID
 */
export function invalidateVideoCaches(videoId) {
  if (!videoId) return;
  const idStr = String(videoId);
  sourceCache.delete(idStr);
  const prefix = `stream_vid_${idStr}/`;
  for (const key of assetCache.keys()) {
    if (key.startsWith(prefix)) {
      assetCache.delete(key);
    }
  }
}

export function compressSourceCache(payload) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return zlib
    .brotliCompressSync(Buffer.from(raw, 'utf8'), {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
    })
    .toString('base64');
}

export function decompressSourceCache(encoded) {
  if (!encoded || typeof encoded !== 'string') return null;
  try {
    const jsonText = zlib
      .brotliDecompressSync(Buffer.from(encoded, 'base64'))
      .toString('utf8');
    return JSON.parse(jsonText);
  } catch (_) {
    return null;
  }
}

export function isTempauthValid(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const urlObj = new URL(url);
    const tempauth = urlObj.searchParams.get('tempauth');
    if (!tempauth) return true;
    const parts = tempauth.split('.');
    if (parts.length < 2) return true;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
    const expSeconds = Number(payload.exp);
    if (!expSeconds) return true;
    // Require at least 5 minutes remaining before token expiry
    return expSeconds * 1000 > Date.now() + 5 * 60 * 1000;
  } catch (_) {
    return true;
  }
}

function stripHeavyVideoFields(video) {
  if (!video || typeof video !== 'object') return video;
  const {
    source_cache,
    source_cache_br,
    source_cache_items_count,
    source_cache_expires_at,
    ...cleanVideo
  } = video;
  return cleanVideo;
}

// ดึงเนื้อหาไฟล์ .m3u8 ขนานกัน (ใช้เวลา ~400ms หรือ 0ms ถ้ามีใน cache เดิมแล้ว)
// ช่วยให้ฝั่ง Browser สร้าง Blob URL ได้ทันทีใน <2ms โดยไม่ต้องยิง fetch ไปหา OneDrive อีก 6 รอบ
async function hydrateM3u8Contents(items, existingContentMap = {}) {
  const m3u8Items = items.filter((i) => i.name && i.name.toLowerCase().endsWith('.m3u8'));
  await Promise.all(
    m3u8Items.map(async (item) => {
      if (item.content) return;
      if (existingContentMap[item.name]) {
        item.content = existingContentMap[item.name];
        return;
      }
      if (!item.downloadUrl) return;
      try {
        const res = await fetch(item.downloadUrl);
        if (res.ok) {
          const txt = await res.text();
          if (txt && txt.includes('#EXTM3U')) {
            item.content = txt;
          }
        }
      } catch (_) {}
    })
  );
  return items;
}

// ลิสต์ไฟล์ในโฟลเดอร์ HLS:
// ใช้ select=id,name,@microsoft.graph.downloadUrl (ไม่มี $) เพื่อให้ Graph คืน downloadUrl มาพร้อม payload ขนาดเล็กในรอบเดียว
// และเริ่มดึงเนื้อหา .m3u8 ขนานไปทันทีตั้งแต่ได้หน้าแรก (Page 1) ขณะรอหน้าถัดไป
async function listHlsFolderItems(token, driveId, folderId, existingM3u8Map = {}, slim = true) {
  const select = slim ? '&select=id,name,@microsoft.graph.downloadUrl' : '';
  let nextUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children?$top=1000${select}`;
  const allItems = [];
  const earlyM3u8Promises = [];
  const startedM3u8 = new Set();

  while (nextUrl) {
    const res = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) {
      throw new Error(`Failed to read HLS folder from OneDrive (${res.status})`);
    }
    const data = await res.json();
    if (Array.isArray(data.value)) {
      allItems.push(...data.value);
      for (const rawItem of data.value) {
        const name = rawItem?.name;
        const dlUrl = rawItem?.['@microsoft.graph.downloadUrl'];
        if (name && dlUrl && name.toLowerCase().endsWith('.m3u8') && !startedM3u8.has(name)) {
          startedM3u8.add(name);
          if (!existingM3u8Map[name]) {
            earlyM3u8Promises.push(
              fetch(dlUrl)
                .then((r) => (r.ok ? r.text() : null))
                .then((txt) => {
                  if (txt && txt.includes('#EXTM3U')) {
                    existingM3u8Map[name] = txt;
                  }
                })
                .catch(() => {})
            );
          }
        }
      }
    }
    nextUrl = data['@odata.nextLink'] || null;
  }

  if (slim && !allItems.some((i) => i.name && i['@microsoft.graph.downloadUrl'])) {
    return listHlsFolderItems(token, driveId, folderId, existingM3u8Map, false);
  }

  if (earlyM3u8Promises.length > 0) {
    await Promise.all(earlyM3u8Promises);
  }
  return allItems;
}

let columnsChecked = false;
export async function ensureSourceCacheColumns(sql) {
  if (columnsChecked) return;
  try {
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_cache JSONB;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_cache_br TEXT;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_cache_items_count INTEGER DEFAULT 0;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_cache_expires_at BIGINT DEFAULT 0;`;
    columnsChecked = true;
  } catch (_) {}
}

async function saveSourceCacheToDb(sql, id, payloadObj, expiresAt = null) {
  const compressed = compressSourceCache(payloadObj);
  const itemsCount = Array.isArray(payloadObj?.items) ? payloadObj.items.length : 0;

  const runUpdate = () =>
    expiresAt == null
      ? sql`
          UPDATE videos
          SET source_cache_br = ${compressed},
              source_cache_items_count = ${itemsCount},
              source_cache = NULL
          WHERE id = ${id};
        `
      : sql`
          UPDATE videos
          SET source_cache_br = ${compressed},
              source_cache_items_count = ${itemsCount},
              source_cache = NULL,
              source_cache_expires_at = ${expiresAt}
          WHERE id = ${id};
        `;

  try {
    await runUpdate();
  } catch (dbErr) {
    try {
      await ensureSourceCacheColumns(sql);
      await runUpdate();
    } catch (retryErr) {
      console.warn('[DB source_cache_br save warning]:', retryErr.message);
    }
  }
}

const swrRecentRuns =
  globalThis.__tubelock_swr_runs || (globalThis.__tubelock_swr_runs = new Map());

function scheduleAfterOrBackground(fn) {
  try {
    after(fn);
  } catch (_) {
    Promise.resolve().then(fn).catch(() => {});
  }
}

export function protectSourcePreviews(data, rating = data?.video) {
  if (!data || !isMatureVideo(rating)) return data;
  return {
    ...data,
    video: protectVideoPoster(data.video && { ...data.video, ...rating }),
    ...(Array.isArray(data.items) && {
      items: data.items.filter(({ name }) => !isPreviewImage(name) && !/^thumbnails.*\.vtt$/i.test(name)),
    }),
  };
}

export function formatSourceForClient(data, showAdultPreviews = false) {
  if (!showAdultPreviews) data = protectSourcePreviews(data);
  if (!data || !Array.isArray(data.items)) return data;
  return {
    ...data,
    items: data.items.map((i) => ({
      ...i,
      downloadUrl: wrapWithWorkerCache(i.name, i.downloadUrl),
    })),
  };
}

/**
 * Resolve video playback source with 3-tier caching:
 * 1. Global In-Memory Cache (< 1ms)
 * 2. In-Flight Request Coalescing (shares active promise across SSR & API calls)
 * 3. Compressed Persistent Neon DB Cache (< 50ms) with OneDrive Graph fallback
 */
export async function resolveVideoSourceServer(numericId, { forceFresh = false, showAdultPreviews = false } = {}) {
  const id = Number(numericId);
  if (!id || isNaN(id)) {
    throw new Error('Video ID is required');
  }

  const cacheKey = String(id);

  if (forceFresh) {
    sourceCache.delete(cacheKey);
  } else {
    // ⚡ 1. Ultra-fast Cache Hit (<1ms) with Token Expiry Validation
    const cached = sourceCache.get(cacheKey);
    if (
      cached &&
      cached.expiresAt > Date.now() &&
      cached.data?.video &&
      (cached.data?.items?.length > 0 || cached.data?.url)
    ) {
      const sampleUrl = cached.data.items?.[0]?.downloadUrl || cached.data.url;
      if (isTempauthValid(sampleUrl)) {
        return { data: formatSourceForClient(cached.data, showAdultPreviews), path: 'memory-hit' };
      } else {
        sourceCache.delete(cacheKey);
      }
    }
  }

  // ⚡ 2. In-Flight Request Deduplication
  if (!forceFresh && inFlightRequests.has(cacheKey)) {
    const data = await inFlightRequests.get(cacheKey);
    if (data?.status && data.status !== 'READY' && !data.success) {
      return { data, path: 'inflight', notReady: true };
    }
    return { data: formatSourceForClient(data, showAdultPreviews), path: 'inflight' };
  }

  // ⚡ 3. Cold Fetch with Promise Coalescing & Compressed Database Persistent Cache
  let hitPath = 'cold-onedrive';
  const fetchPromise = (async () => {
    const sql = getDb();

    // ⚡ อุ่น Graph token + driveId ขนานกับการ query DB
    const warmGraph = getGraphToken()
      .then((tk) => getUserDriveId(tk))
      .catch(() => {});

    const queryVideoRow = () => sql`
      SELECT
        v.id, v.title, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec, v.bitrate,
        v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at, v.status,
        v.transcode_progress, v.stage_detail, v.error_message, v.source_type,
        v.onedrive_item_id, v.onedrive_folder_id, v.raw_file_name, v.master_playlist_path,
        v.content_rating, v.user_id, v.source_cache_expires_at,
        CASE WHEN (v.status = 'READY' OR v.status IS NULL) AND COALESCE(v.source_cache_expires_at, 0) > 0
          THEN v.source_cache_br ELSE NULL END AS source_cache_br,
        CASE WHEN (v.status = 'READY' OR v.status IS NULL) AND COALESCE(v.source_cache_expires_at, 0) > 0 AND v.source_cache_br IS NULL
          THEN v.source_cache ELSE NULL END AS source_cache,
        u.name AS author_name,
        u.picture AS author_picture
      FROM videos v
      LEFT JOIN users u ON v.user_id = u.id
      WHERE v.id = ${id}
      LIMIT 1;
    `;

    let rows;
    try {
      rows = await queryVideoRow();
    } catch (err) {
      if (err?.code === '42703' || /source_cache_br/i.test(err?.message || '')) {
        await ensureSourceCacheColumns(sql);
        rows = await queryVideoRow();
      } else {
        throw err;
      }
    }

    if (!rows || rows.length === 0) {
      throw new Error('Video not found');
    }

    const rawVideo = rows[0];
    const video = stripHeavyVideoFields(rawVideo);

    // Check if video is still being processed
    if (rawVideo.status && rawVideo.status !== 'READY') {
      return {
        success: false,
        status: rawVideo.status,
        progress: rawVideo.transcode_progress || 0,
        stageDetail: rawVideo.stage_detail || '',
        errorMessage: rawVideo.error_message || '',
        video,
        error:
          rawVideo.status === 'FAILED'
            ? `การแปลงวิดีโอล้มเหลว: ${rawVideo.error_message || 'ไม่ทราบสาเหตุ'}`
            : `วิดีโอนี้อยู่ในสถานะ "${rawVideo.status}" (${rawVideo.stage_detail || 'กำลังประมวลผล'}) กรุณารอสักครู่`,
      };
    }

    // เก็บเนื้อหา .m3u8 เดิมจาก DB cache (ถ้ามี) เพื่อไม่ต้องเสียเวลาโหลด .m3u8 ใหม่แม้ tempauth หมดอายุ
    const existingM3u8Map = {};
    let parsedCache = null;
    const isMigratingFromLegacy = Boolean(!rawVideo.source_cache_br && rawVideo.source_cache);
    if (Number(rawVideo.source_cache_expires_at || 0) > 0) {
      if (rawVideo.source_cache_br) {
        parsedCache = decompressSourceCache(rawVideo.source_cache_br);
      } else if (rawVideo.source_cache) {
        try {
          parsedCache =
            typeof rawVideo.source_cache === 'string'
              ? JSON.parse(rawVideo.source_cache)
              : rawVideo.source_cache;
        } catch (_) {}
      }
      if (Array.isArray(parsedCache?.items)) {
        for (const item of parsedCache.items) {
          if (item?.name && item?.content && item.name.toLowerCase().endsWith('.m3u8')) {
            existingM3u8Map[item.name] = item.content;
          }
        }
      }
    }

    // ⚡⚡⚡ PERSISTENT DB CACHE HIT (<50ms) ⚡⚡⚡
    const now = Date.now();
    if (!forceFresh && parsedCache) {
      const sampleUrl = parsedCache?.items?.[0]?.downloadUrl || parsedCache?.url;
      const isTokenValid = isTempauthValid(sampleUrl);

      const cachedM3u8Count =
        parsedCache?.items?.filter((i) => i.name?.endsWith('.m3u8')).length || 0;
      const isStaleEarlySnapshot =
        (rawVideo.transcode_progress === 100 || rawVideo.status === 'READY') &&
        cachedM3u8Count <= 2 &&
        (parsedCache?.items?.length || 0) < 150;

      if (
        isTokenValid &&
        !isStaleEarlySnapshot &&
        (parsedCache.items?.length > 0 || parsedCache.url)
      ) {
        hitPath = 'db-hit';
        const missingM3u8Content =
          Array.isArray(parsedCache.items) &&
          parsedCache.items.some((i) => i.name?.toLowerCase().endsWith('.m3u8') && !i.content);

        const resultData = {
          ...parsedCache,
          video,
        };
        const expTime = Number(rawVideo.source_cache_expires_at || 0);
        sourceCache.set(cacheKey, {
          data: resultData,
          expiresAt: expTime > now ? expTime : now + 5 * 60 * 1000,
        });

        const needsSwrRefresh = expTime <= now + 10 * 60 * 1000;

        if (missingM3u8Content && expTime > now) {
          scheduleAfterOrBackground(async () => {
            try {
              await hydrateM3u8Contents(parsedCache.items, existingM3u8Map);
              await saveSourceCacheToDb(sql, id, {
                success: true,
                type: 'hls',
                items: parsedCache.items,
              });
            } catch (_) {}
          });
        } else if (isMigratingFromLegacy && !needsSwrRefresh) {
          scheduleAfterOrBackground(async () => {
            await saveSourceCacheToDb(sql, id, parsedCache, expTime);
          });
        }

        // ⚡ Background SWR: Revalidate quietly if expiring within 10 minutes or expired
        if (needsSwrRefresh) {
          const lastSwrAt = swrRecentRuns.get(cacheKey) || 0;
          if (now - lastSwrAt > 120 * 1000) {
            swrRecentRuns.set(cacheKey, now);
            scheduleAfterOrBackground(async () => {
              try {
                const token = await getGraphToken();
                const driveId = await getUserDriveId(token);
                if (rawVideo.source_type === 'hls' || rawVideo.onedrive_folder_id) {
                  const folderId = rawVideo.onedrive_folder_id || rawVideo.onedrive_item_id;
                  const allItems = await listHlsFolderItems(
                    token,
                    driveId,
                    folderId,
                    existingM3u8Map
                  );
                  const freshValid = allItems
                    .filter((i) => i.name && i['@microsoft.graph.downloadUrl'])
                    .map((i) => {
                      const entry = {
                        name: i.name,
                        downloadUrl: i['@microsoft.graph.downloadUrl'],
                      };
                      if (existingM3u8Map[i.name]) entry.content = existingM3u8Map[i.name];
                      return entry;
                    });
                  if (freshValid.length > 0) {
                    const newExp = Date.now() + 45 * 60 * 1000;
                    sourceCache.set(cacheKey, {
                      data: { success: true, type: 'hls', video, items: freshValid },
                      expiresAt: newExp,
                    });
                    await saveSourceCacheToDb(
                      sql,
                      id,
                      { success: true, type: 'hls', items: freshValid },
                      newExp
                    );
                  }
                }
              } catch (bgErr) {
                console.warn('[SWR Background Warning]:', bgErr.message);
              }
            });
          }
        }

        return resultData;
      }
    }

    // If not in DB cache or expired, fetch fresh download URLs from OneDrive
    await warmGraph;
    const token = await getGraphToken();
    const driveId = await getUserDriveId(token);

    // Case 1: HLS Stream Folder
    if (rawVideo.source_type === 'hls' || rawVideo.onedrive_folder_id) {
      const folderId = rawVideo.onedrive_folder_id || rawVideo.onedrive_item_id;
      const allItems = await listHlsFolderItems(token, driveId, folderId, existingM3u8Map);

      const validItems = allItems
        .filter((i) => i.name && i['@microsoft.graph.downloadUrl'])
        .map((i) => {
          const entry = {
            name: i.name,
            downloadUrl: i['@microsoft.graph.downloadUrl'],
          };
          if (existingM3u8Map[i.name]) {
            entry.content = existingM3u8Map[i.name];
          }
          return entry;
        });

      if (validItems.length === 0) {
        throw new Error('ไม่พบไฟล์ที่พร้อมเล่นในโฟลเดอร์ HLS จาก OneDrive');
      }

      const resultData = {
        success: true,
        type: 'hls',
        video,
        items: validItems,
      };

      const isCompleted = Number(rawVideo.transcode_progress || 0) >= 100;
      const expiresAt = Date.now() + (isCompleted ? 45 * 60 * 1000 : 15 * 1000);

      sourceCache.set(cacheKey, {
        data: resultData,
        expiresAt,
      });

      scheduleAfterOrBackground(async () => {
        await saveSourceCacheToDb(
          sql,
          id,
          { success: true, type: 'hls', items: validItems },
          expiresAt
        );
      });

      return resultData;
    }

    // Case 2: Standalone Video File (MP4, MKV, etc.)
    const itemId = rawVideo.onedrive_item_id;
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}?select=id,@microsoft.graph.downloadUrl`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch video download link from OneDrive (${res.status})`);
    }

    const data = await res.json();
    const downloadUrl = data['@microsoft.graph.downloadUrl'];

    const resultData = {
      success: true,
      type: 'mp4',
      url: downloadUrl,
      video,
    };

    const expiresAt = Date.now() + 90 * 60 * 1000;

    sourceCache.set(cacheKey, {
      data: resultData,
      expiresAt,
    });

    scheduleAfterOrBackground(async () => {
      await saveSourceCacheToDb(
        sql,
        id,
        { success: true, type: 'mp4', url: downloadUrl },
        expiresAt
      );
    });

    return resultData;
  })();

  inFlightRequests.set(cacheKey, fetchPromise);

  try {
    const data = await fetchPromise;
    if (data?.status && data.status !== 'READY' && !data.success) {
      return { data, path: hitPath, notReady: true };
    }
    return { data: formatSourceForClient(data, showAdultPreviews), path: hitPath };
  } finally {
    inFlightRequests.delete(cacheKey);
  }
}

/**
 * Non-blocking server-side pre-warm for a video ID (used during SSR in /watch/[id] and feed load)
 */
export function prewarmVideoSourceServer(numericId) {
  const id = Number(numericId);
  if (!id || isNaN(id)) return;
  const cacheKey = String(id);
  const cached = sourceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 10 * 60 * 1000) {
    const sampleUrl = cached.data?.items?.[0]?.downloadUrl || cached.data?.url;
    if (isTempauthValid(sampleUrl)) return;
  }
  if (inFlightRequests.has(cacheKey)) return;

  resolveVideoSourceServer(id).catch(() => {});
}

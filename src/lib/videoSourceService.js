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
  const { source_cache, source_cache_expires_at, ...cleanVideo } = video;
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
async function ensureSourceCacheColumns(sql) {
  if (columnsChecked) return;
  try {
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_cache JSONB;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_cache_expires_at BIGINT DEFAULT 0;`;
    columnsChecked = true;
  } catch (_) {}
}

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
 * 3. Persistent Neon DB Cache (< 50ms) with OneDrive Graph fallback (~2.5s)
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
      cached.data?.items?.length > 0 &&
      cached.data?.video?.author_picture
    ) {
      const sampleUrl = cached.data.items[0]?.downloadUrl || cached.data.url;
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

  // ⚡ 3. Cold Fetch with Promise Coalescing & Database Persistent Cache
  let hitPath = 'cold-onedrive';
  const fetchPromise = (async () => {
    const sql = getDb();

    // ⚡ อุ่น Graph token + driveId ขนานกับการ query DB
    const warmGraph = getGraphToken()
      .then((tk) => getUserDriveId(tk))
      .catch(() => {});

    const rows = await sql`
      SELECT 
        v.*,
        u.name AS author_name,
        u.picture AS author_picture
      FROM videos v
      LEFT JOIN users u ON v.user_id = u.id
      WHERE v.id = ${id} 
      LIMIT 1;
    `;
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
    if (rawVideo.source_cache) {
      try {
        parsedCache =
          typeof rawVideo.source_cache === 'string'
            ? JSON.parse(rawVideo.source_cache)
            : rawVideo.source_cache;
        if (Array.isArray(parsedCache?.items)) {
          for (const item of parsedCache.items) {
            if (item?.name && item?.content && item.name.toLowerCase().endsWith('.m3u8')) {
              existingM3u8Map[item.name] = item.content;
            }
          }
        }
      } catch (_) {}
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

        if (missingM3u8Content && expTime > now) {
          scheduleAfterOrBackground(async () => {
            try {
              await hydrateM3u8Contents(parsedCache.items, existingM3u8Map);
              await sql`
                UPDATE videos 
                SET source_cache = ${JSON.stringify({ success: true, type: 'hls', items: parsedCache.items })}::jsonb
                WHERE id = ${id};
              `;
            } catch (_) {}
          });
        }

        // ⚡ Background SWR: Revalidate quietly if expiring within 10 minutes or expired
        if (expTime <= now + 10 * 60 * 1000) {
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
                  await sql`
                    UPDATE videos 
                    SET source_cache = ${JSON.stringify({ success: true, type: 'hls', items: freshValid })}::jsonb,
                        source_cache_expires_at = ${newExp}
                    WHERE id = ${id};
                  `;
                }
              }
            } catch (bgErr) {
              console.warn('[SWR Background Warning]:', bgErr.message);
            }
          });
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

      const cachePayload = JSON.stringify({
        success: true,
        type: 'hls',
        items: validItems,
      });
      scheduleAfterOrBackground(async () => {
        try {
          await sql`
            UPDATE videos 
            SET source_cache = ${cachePayload}::jsonb,
                source_cache_expires_at = ${expiresAt}
            WHERE id = ${id};
          `;
        } catch (dbErr) {
          try {
            await ensureSourceCacheColumns(sql);
            await sql`
              UPDATE videos 
              SET source_cache = ${cachePayload}::jsonb,
                  source_cache_expires_at = ${expiresAt}
              WHERE id = ${id};
            `;
          } catch (retryErr) {
            console.warn('[DB source_cache save warning]:', retryErr.message);
          }
        }
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

    const cachePayload = JSON.stringify({
      success: true,
      type: 'mp4',
      url: downloadUrl,
    });
    scheduleAfterOrBackground(async () => {
      try {
        await sql`
          UPDATE videos 
          SET source_cache = ${cachePayload}::jsonb,
              source_cache_expires_at = ${expiresAt}
          WHERE id = ${id};
        `;
      } catch (dbErr) {
        console.warn('[DB source_cache save warning]:', dbErr.message);
      }
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

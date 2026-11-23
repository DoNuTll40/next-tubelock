import zlib from 'node:zlib';
import { isMatureVideo, isPreviewImage, protectVideoPoster } from './videoUtils';
import { after } from 'next/server';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';

// URL ของ Cloudflare Worker (อ่านจาก env ก่อน ถ้าไม่มีใช้ค่าเดิมเป็น fallback)
const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://tubelock-cache.iinter731.workers.dev';

export function isHlsSegmentFile(name) {
  if (!name) return false;
  const lower = String(name).toLowerCase();
  const baseName = lower.includes('/') ? lower.slice(lower.lastIndexOf('/') + 1) : lower;
  return (
    baseName.endsWith('.ts') ||
    baseName.endsWith('.m4s') ||
    (baseName.startsWith('init_') && baseName.endsWith('.mp4')) ||
    baseName.endsWith('-init.mp4')
  );
}

export function wrapWithWorkerCache(name, downloadUrl) {
  if (isHlsSegmentFile(name)) {
    return `${CF_WORKER_URL}/?url=${encodeURIComponent(downloadUrl)}`;
  }
  return downloadUrl;
}

// High-speed In-Memory Cache (Global across server restarts/HMR in dev)
export const sourceCache =
  globalThis.__tubelock_source_cache || (globalThis.__tubelock_source_cache = new Map());
export const partialCache =
  globalThis.__tubelock_partial_cache || (globalThis.__tubelock_partial_cache = new Map());
export const inFlightRequests =
  globalThis.__tubelock_inflight || (globalThis.__tubelock_inflight = new Map());
const inFlightFullRefresh =
  globalThis.__tubelock_inflight_full || (globalThis.__tubelock_inflight_full = new Map());
export const assetCache =
  globalThis.__tubelock_asset_cache || (globalThis.__tubelock_asset_cache = new Map());

/**
 * Invalidate in-memory playback and asset caches for a video ID (or specific version ID)
 */
export function invalidateVideoCaches(videoId, versionId = null) {
  if (!videoId) return;
  const idStr = String(videoId);
  if (versionId != null) {
    const verStr = String(versionId);
    for (const map of [sourceCache, partialCache]) {
      for (const key of map.keys()) {
        if (key === idStr || key === `${idStr}:v:default` || key === `${idStr}:vid:${verStr}` || key.startsWith(`${idStr}:v:${verStr}`)) {
          map.delete(key);
        }
        const cached = map.get(key);
        if (cached?.data?.video?.active_version?.id === Number(versionId)) {
          map.delete(key);
        }
      }
    }
    const verPrefix = `stream_vid_${idStr}_v${verStr}/`;
    for (const key of assetCache.keys()) {
      if (key.startsWith(verPrefix)) {
        assetCache.delete(key);
      }
    }
    return;
  }

  for (const map of [sourceCache, partialCache]) {
    map.delete(idStr);
    for (const key of map.keys()) {
      if (key.startsWith(`${idStr}:`)) {
        map.delete(key);
      }
    }
  }
  const prefix = `stream_vid_${idStr}/`;
  const verPrefixBase = `stream_vid_${idStr}_v`;
  for (const key of assetCache.keys()) {
    if (key.startsWith(prefix) || key.startsWith(verPrefixBase)) {
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
    m3u8_cache_br,
    source_cache_items_count,
    source_cache_expires_at,
    ...cleanVideo
  } = video;
  return cleanVideo;
}

function extractM3u8Map(items) {
  const map = {};
  if (!Array.isArray(items)) return map;
  for (const item of items) {
    if (item?.name && item?.content && item.name.toLowerCase().endsWith('.m3u8')) {
      map[item.name] = item.content;
    }
  }
  return map;
}

function isMasterPlaylistConsistent(source) {
  const isArr = Array.isArray(source);
  const map = isArr ? extractM3u8Map(source) : source || {};
  const hasMasterItem = isArr
    ? source.some((i) => i?.name?.toLowerCase() === 'master.m3u8')
    : Object.keys(map).some((k) => k.toLowerCase() === 'master.m3u8');
  if (!hasMasterItem) return true;

  const masterEntry = Object.entries(map).find(([k]) => k.toLowerCase() === 'master.m3u8');
  const masterText = masterEntry?.[1];
  const subNames = isArr
    ? source
        .filter((i) => i?.name && i.name.toLowerCase().endsWith('.m3u8') && i.name.toLowerCase() !== 'master.m3u8')
        .map((i) => i.name)
    : Object.keys(map).filter((k) => k.toLowerCase().endsWith('.m3u8') && k.toLowerCase() !== 'master.m3u8');

  if (subNames.length === 0) return true;
  if (!masterText || !masterText.includes('#EXTM3U')) return isArr;

  const referenced = new Set(
    masterText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => line.replace(/^\.?\//, '').toLowerCase())
  );
  return subNames.every((name) => referenced.has(name.replace(/^\.?\//, '').toLowerCase()));
}

function stripMasterFromM3u8Map(map) {
  if (!map || typeof map !== 'object') return;
  for (const key of Object.keys(map)) {
    if (key.toLowerCase() === 'master.m3u8') {
      delete map[key];
    }
  }
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
          const isMaster = name.toLowerCase() === 'master.m3u8';
          if (isMaster || !existingM3u8Map[name]) {
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

const PLAYLIST_PRIORITY_PATTERNS = [
  /360p/i,
  /480p/i,
  /720p/i,
  /1080p/i,
  /144p/i,
  /1440p/i,
  /2160p/i,
];

function getPlaylistPriority(name) {
  const idx = PLAYLIST_PRIORITY_PATTERNS.findIndex((re) => re.test(name));
  return idx === -1 ? PLAYLIST_PRIORITY_PATTERNS.length : idx;
}

// ดึงชื่อไฟล์ init (.mp4) และ chunk แรกๆ (.ts / .m4s) จาก m3u8_cache_br แบบ round-robin ทุกความละเอียด (สูงสุด 18 ไฟล์ เพื่อให้พอดีโควตา Graph $batch <= 20)
function extractInitialSegmentNames(m3u8Map, maxTotal = 18) {
  if (!m3u8Map || typeof m3u8Map !== 'object') return [];
  const subEntries = Object.entries(m3u8Map)
    .filter(([name, content]) => {
      const lower = String(name || '').toLowerCase();
      return lower.endsWith('.m3u8') && lower !== 'master.m3u8' && typeof content === 'string';
    })
    .sort(([a], [b]) => getPlaylistPriority(a) - getPlaylistPriority(b));

  const perPlaylistSegments = subEntries.map(([, content]) => {
    const segs = [];
    let mediaCount = 0;
    for (const rawLine of content.split('\n')) {
      const trimmed = rawLine.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('#EXT-X-MAP:')) {
        const uriMatch = trimmed.match(/URI="([^"]+)"/i);
        if (uriMatch && uriMatch[1]) {
          const cleanInit = uriMatch[1].trim().replace(/^\.?\//, '');
          if (cleanInit && !segs.includes(cleanInit)) {
            segs.unshift(cleanInit);
          }
        }
        continue;
      }
      if (trimmed.startsWith('#')) continue;
      const clean = trimmed.replace(/^\.?\//, '');
      const lower = clean.toLowerCase();
      if (lower.endsWith('.ts') || lower.endsWith('.m4s')) {
        segs.push(clean);
        mediaCount++;
        if (mediaCount >= 3) break;
      }
    }
    return segs;
  });

  const picked = [];
  const seen = new Set();
  // Include optional Hi-Res Lossless audio file (audio_hires.wav / audio_hires.flac) if declared in master.m3u8
  const masterContent = m3u8Map['master.m3u8'] || m3u8Map['MASTER.M3U8'] || '';
  if (typeof masterContent === 'string' && masterContent.includes('#EXT-X-TUBELOCK-HIRES:')) {
    const hrFileMatch = masterContent.match(/#EXT-X-TUBELOCK-HIRES:[^\n]*FILE=([^,\s]+)/i);
    const hrFile = hrFileMatch?.[1]?.trim().replace(/^\.?\//, '');
    if (hrFile) {
      seen.add(hrFile);
      picked.push(hrFile);
    }
  }
  for (let pass = 0; pass < 4 && picked.length < maxTotal; pass++) {
    for (const segs of perPlaylistSegments) {
      if (picked.length >= maxTotal) break;
      const name = segs[pass];
      if (name && !seen.has(name)) {
        seen.add(name);
        picked.push(name);
      }
    }
  }
  return picked;
}

// ยิง Microsoft Graph JSON $batch (1 HTTP request ขอ signed downloadUrl ได้สูงสุด 20 ไฟล์พร้อมกัน ~350-450ms แทนที่จะรอเซ็นทั้ง 465 ไฟล์ ~2,000ms!)
async function fetchBatchDownloadUrls(token, driveId, folderId, fileNames) {
  const batchNames = (fileNames || []).slice(0, 20);
  if (batchNames.length === 0) return [];

  const requests = batchNames.map((name, idx) => {
    const clean = name.replace(/^\.?\//, '');
    const encodedPath = clean.split('/').map(encodeURIComponent).join('/');
    return {
      id: String(idx + 1),
      method: 'GET',
      url: `/drives/${driveId}/items/${folderId}:/${encodedPath}:?select=id,name,@microsoft.graph.downloadUrl`,
    };
  });

  const res = await fetch('https://graph.microsoft.com/v1.0/$batch', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ requests }),
  });

  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data?.responses)) return [];

  const results = [];
  for (const r of data.responses) {
    if (r?.status === 200 && r.body?.['@microsoft.graph.downloadUrl']) {
      const idx = Number(r.id) - 1;
      const reqName = batchNames[idx] || r.body.name;
      if (reqName) {
        results.push({
          name: reqName,
          downloadUrl: r.body['@microsoft.graph.downloadUrl'],
        });
      }
    }
  }
  return results;
}

function resolveStreamFolderName(video, id, activeVersionId) {
  const playlistPath = video?.master_playlist_path || '';
  const match = playlistPath.match(/\/streams\/([^/]+)\//i);
  if (match && match[1]) return match[1];
  return activeVersionId ? `stream_vid_${id}_v${activeVersionId}` : `stream_vid_${id}`;
}

let columnsChecked = false;
export async function ensureSourceCacheColumns(sql) {
  if (columnsChecked) return;
  try {
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_cache JSONB;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_cache_br TEXT;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS m3u8_cache_br TEXT;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_cache_items_count INTEGER DEFAULT 0;`;
    await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS source_cache_expires_at BIGINT DEFAULT 0;`;
    try {
      await sql`ALTER TABLE video_versions ADD COLUMN IF NOT EXISTS m3u8_cache_br TEXT;`;
    } catch (_) {}
    columnsChecked = true;
  } catch (_) {}
}

async function saveSourceCacheToDb(
  sql,
  id,
  payloadObj,
  expiresAt = null,
  versionId = null,
  { persistM3u8Cache = true } = {}
) {
  const compressed = compressSourceCache(payloadObj);
  const m3u8Map = extractM3u8Map(payloadObj?.items);
  const canSaveM3u8 =
    persistM3u8Cache &&
    Object.keys(m3u8Map).length > 0 &&
    isMasterPlaylistConsistent(payloadObj?.items);
  const m3u8Compressed = canSaveM3u8 ? compressSourceCache(m3u8Map) : null;
  const shouldClearM3u8 = !persistM3u8Cache || (Object.keys(m3u8Map).length > 0 && !canSaveM3u8);
  const itemsCount = Array.isArray(payloadObj?.items) ? payloadObj.items.length : 0;

  const runUpdate = () => {
    if (versionId) {
      return expiresAt == null
        ? sql`
            UPDATE video_versions
            SET source_cache_br = ${compressed},
                m3u8_cache_br = CASE WHEN ${shouldClearM3u8} THEN NULL ELSE COALESCE(${m3u8Compressed}, m3u8_cache_br) END,
                source_cache_items_count = ${itemsCount}
            WHERE id = ${versionId} AND video_id = ${id};
          `
        : sql`
            UPDATE video_versions
            SET source_cache_br = ${compressed},
                m3u8_cache_br = CASE WHEN ${shouldClearM3u8} THEN NULL ELSE COALESCE(${m3u8Compressed}, m3u8_cache_br) END,
                source_cache_items_count = ${itemsCount},
                source_cache_expires_at = ${expiresAt}
            WHERE id = ${versionId} AND video_id = ${id};
          `;
    }
    return expiresAt == null
      ? sql`
          UPDATE videos
          SET source_cache_br = ${compressed},
              m3u8_cache_br = CASE WHEN ${shouldClearM3u8} THEN NULL ELSE COALESCE(${m3u8Compressed}, m3u8_cache_br) END,
              source_cache_items_count = ${itemsCount},
              source_cache = NULL
          WHERE id = ${id};
        `
      : sql`
          UPDATE videos
          SET source_cache_br = ${compressed},
              m3u8_cache_br = CASE WHEN ${shouldClearM3u8} THEN NULL ELSE COALESCE(${m3u8Compressed}, m3u8_cache_br) END,
              source_cache_items_count = ${itemsCount},
              source_cache = NULL,
              source_cache_expires_at = ${expiresAt}
          WHERE id = ${id};
        `;
  };

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
export async function resolveVideoSourceServer(
  numericId,
  { forceFresh = false, showAdultPreviews = false, version = null, preferFull = false } = {}
) {
  const id = Number(numericId);
  if (!id || isNaN(id)) {
    throw new Error('Video ID is required');
  }

  const reqVer = version != null && String(version).trim() !== '' ? String(version).trim() : null;
  const cacheKey = reqVer ? `${id}:v:${reqVer.toLowerCase()}` : `${id}:v:default`;
  const inflightKey = preferFull ? `${cacheKey}:full` : cacheKey;

  if (forceFresh) {
    sourceCache.delete(cacheKey);
    partialCache.delete(cacheKey);
    if (!reqVer) {
      sourceCache.delete(String(id));
      partialCache.delete(String(id));
    }
  } else {
    // ⚡ 1. Ultra-fast Full Cache Hit (<1ms) with Token Expiry Validation
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

    // ⚡ 1b. If caller wants full list (?full=1) and background full refresh is already running, join it (0 extra DB/Graph calls!)
    if (preferFull && inFlightFullRefresh.has(cacheKey)) {
      try {
        const fullData = await inFlightFullRefresh.get(cacheKey);
        if (fullData?.video && (fullData?.items?.length > 0 || fullData?.url)) {
          return { data: formatSourceForClient(fullData, showAdultPreviews), path: 'inflight-full' };
        }
      } catch (_) {}
    }

    // ⚡ 1c. Ultra-fast Partial Batch Hit (<1ms) while full background refresh is still completing
    if (!preferFull) {
      const partialCached = partialCache.get(cacheKey);
      if (
        partialCached &&
        partialCached.expiresAt > Date.now() &&
        partialCached.data?.video &&
        partialCached.data?.items?.length > 0
      ) {
        const sampleTsUrl = partialCached.data.items.find((i) =>
          isHlsSegmentFile(i.name)
        )?.downloadUrl;
        if (sampleTsUrl && isTempauthValid(sampleTsUrl)) {
          return {
            data: formatSourceForClient(partialCached.data, showAdultPreviews),
            path: 'cold-batch-hit',
          };
        } else {
          partialCache.delete(cacheKey);
        }
      }
    }
  }

  // ⚡ 2. In-Flight Request Deduplication
  if (!forceFresh && inFlightRequests.has(inflightKey)) {
    const data = await inFlightRequests.get(inflightKey);
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

    const reqVerNumeric = reqVer && /^\d+$/.test(reqVer) ? Number(reqVer) : null;
    const reqVerLower = reqVer ? reqVer.toLowerCase() : null;
    // Skip pulling heavy (180–650 KB) source_cache_br from Neon when tempauth is already expired or forceFresh is set!
    // Always fetch tiny m3u8_cache_br (~2–7 KB) so cold OneDrive refreshes skip downloading 5–6 .m3u8 files.
    const cacheMinExpiry = forceFresh ? Number.MAX_SAFE_INTEGER : Date.now();

    const queryWithVersions = () => sql`
      SELECT
        v.id, v.title, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec, v.bitrate,
        v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at, v.status,
        v.transcode_progress, v.stage_detail, v.error_message, v.source_type,
        v.onedrive_item_id, v.onedrive_folder_id, v.raw_file_name, v.master_playlist_path,
        v.content_rating, v.user_id, v.source_cache_expires_at, v.m3u8_cache_br,
        CASE WHEN (v.status = 'READY' OR v.status IS NULL) AND COALESCE(v.source_cache_expires_at, 0) > ${cacheMinExpiry}
          THEN v.source_cache_br ELSE NULL END AS source_cache_br,
        CASE WHEN (v.status = 'READY' OR v.status IS NULL) AND COALESCE(v.source_cache_expires_at, 0) > ${cacheMinExpiry} AND v.source_cache_br IS NULL
          THEN v.source_cache ELSE NULL END AS source_cache,
        u.name AS author_name,
        u.picture AS author_picture,
        vv.id AS vv_id,
        vv.version_key AS vv_key,
        vv.label AS vv_label,
        vv.badge AS vv_badge,
        vv.aspect_label AS vv_aspect_label,
        vv.description AS vv_description,
        vv.is_default AS vv_is_default,
        vv.source_type AS vv_source_type,
        vv.onedrive_item_id AS vv_onedrive_item_id,
        vv.onedrive_folder_id AS vv_onedrive_folder_id,
        vv.raw_file_name AS vv_raw_file_name,
        vv.master_playlist_path AS vv_master_playlist_path,
        vv.duration AS vv_duration,
        vv.file_size_bytes AS vv_file_size_bytes,
        vv.resolution AS vv_resolution,
        vv.fps AS vv_fps,
        vv.codec AS vv_codec,
        vv.bitrate AS vv_bitrate,
        vv.thumbnail_url AS vv_thumbnail_url,
        vv.status AS vv_status,
        vv.transcode_progress AS vv_transcode_progress,
        vv.stage_detail AS vv_stage_detail,
        vv.error_message AS vv_error_message,
        vv.subtitle_tracks_override AS vv_subtitle_tracks_override,
        vv.source_cache_expires_at AS vv_source_cache_expires_at,
        vv.m3u8_cache_br AS vv_m3u8_cache_br,
        CASE WHEN vv.id IS NOT NULL AND (vv.status = 'READY' OR vv.status IS NULL) AND COALESCE(vv.source_cache_expires_at, 0) > ${cacheMinExpiry}
          THEN vv.source_cache_br ELSE NULL END AS vv_source_cache_br
      FROM videos v
      LEFT JOIN users u ON v.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT *
        FROM video_versions ver
        WHERE ver.video_id = v.id
          AND (
            ${reqVer == null}
            OR (${reqVerNumeric != null} AND ver.id = ${reqVerNumeric || 0})
            OR LOWER(ver.version_key) = ${reqVerLower || ''}
          )
        ORDER BY
          CASE
            WHEN ${reqVer != null} AND (${reqVerNumeric != null} AND ver.id = ${reqVerNumeric || 0}) THEN 0
            WHEN ${reqVer != null} AND LOWER(ver.version_key) = ${reqVerLower || ''} THEN 1
            ELSE 2
          END ASC,
          (ver.status = 'READY' OR ver.status IS NULL) DESC,
          ver.is_default DESC,
          ver.sort_order ASC,
          ver.id ASC
        LIMIT 1
      ) vv ON TRUE
      WHERE v.id = ${id}
      LIMIT 1;
    `;

    const queryLegacyRow = () => sql`
      SELECT
        v.id, v.title, v.duration, v.file_size_bytes, v.resolution, v.fps, v.codec, v.bitrate,
        v.thumbnail_url, v.tags, v.category, v.views_count, v.created_at, v.status,
        v.transcode_progress, v.stage_detail, v.error_message, v.source_type,
        v.onedrive_item_id, v.onedrive_folder_id, v.raw_file_name, v.master_playlist_path,
        v.content_rating, v.user_id, v.source_cache_expires_at, v.m3u8_cache_br,
        CASE WHEN (v.status = 'READY' OR v.status IS NULL) AND COALESCE(v.source_cache_expires_at, 0) > ${cacheMinExpiry}
          THEN v.source_cache_br ELSE NULL END AS source_cache_br,
        CASE WHEN (v.status = 'READY' OR v.status IS NULL) AND COALESCE(v.source_cache_expires_at, 0) > ${cacheMinExpiry} AND v.source_cache_br IS NULL
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
      rows = await queryWithVersions();
    } catch (err) {
      if (err?.code === '42P01') {
        rows = await queryLegacyRow();
      } else if (err?.code === '42703' || /source_cache_br|m3u8_cache_br/i.test(err?.message || '')) {
        await ensureSourceCacheColumns(sql);
        try {
          rows = await queryWithVersions();
        } catch (retryErr) {
          if (retryErr?.code === '42P01') {
            rows = await queryLegacyRow();
          } else {
            throw retryErr;
          }
        }
      } else {
        throw err;
      }
    }

    if (!rows || rows.length === 0) {
      throw new Error('Video not found');
    }

    const rawRow = rows[0];
    const hasVersion = Boolean(rawRow.vv_id);
    const activeVersionId = hasVersion ? rawRow.vv_id : null;

    // Effective stream fields (use selected video_version when present, else parent videos row)
    const activeStatus = hasVersion ? rawRow.vv_status : rawRow.status;
    const activeProgress = hasVersion ? rawRow.vv_transcode_progress : rawRow.transcode_progress;
    const activeStageDetail = hasVersion ? rawRow.vv_stage_detail : rawRow.stage_detail;
    const activeErrorMessage = hasVersion ? rawRow.vv_error_message : rawRow.error_message;
    const activeSourceType = hasVersion ? rawRow.vv_source_type : rawRow.source_type;
    const activeItemId = hasVersion ? rawRow.vv_onedrive_item_id : rawRow.onedrive_item_id;
    const activeFolderId = hasVersion ? rawRow.vv_onedrive_folder_id : rawRow.onedrive_folder_id;
    const activeCacheBr = hasVersion ? rawRow.vv_source_cache_br : rawRow.source_cache_br;
    const activeM3u8CacheBr = hasVersion
      ? rawRow.vv_m3u8_cache_br ||
        (rawRow.vv_onedrive_folder_id && rawRow.vv_onedrive_folder_id === rawRow.onedrive_folder_id
          ? rawRow.m3u8_cache_br
          : null)
      : rawRow.m3u8_cache_br;
    const activeCacheLegacy = hasVersion ? null : rawRow.source_cache;
    const activeCacheExp = Number((hasVersion ? rawRow.vv_source_cache_expires_at : rawRow.source_cache_expires_at) || 0);

    const {
      vv_id, vv_key, vv_label, vv_badge, vv_aspect_label, vv_description, vv_is_default,
      vv_source_type, vv_onedrive_item_id, vv_onedrive_folder_id, vv_raw_file_name,
      vv_master_playlist_path, vv_duration, vv_file_size_bytes, vv_resolution,
      vv_fps, vv_codec, vv_bitrate, vv_thumbnail_url, vv_status,
      vv_transcode_progress, vv_stage_detail, vv_error_message,
      vv_subtitle_tracks_override, vv_source_cache_expires_at, vv_source_cache_br, vv_m3u8_cache_br,
      ...parentRawVideo
    } = rawRow;

    const cleanBaseVideo = stripHeavyVideoFields(parentRawVideo);
    const video = hasVersion
      ? {
          ...cleanBaseVideo,
          source_type: vv_source_type || cleanBaseVideo.source_type,
          onedrive_item_id: vv_onedrive_item_id || cleanBaseVideo.onedrive_item_id,
          onedrive_folder_id: vv_onedrive_folder_id || cleanBaseVideo.onedrive_folder_id,
          raw_file_name: vv_raw_file_name || cleanBaseVideo.raw_file_name,
          master_playlist_path: vv_master_playlist_path || cleanBaseVideo.master_playlist_path,
          duration: Number(vv_duration) || cleanBaseVideo.duration,
          file_size_bytes: Number(vv_file_size_bytes) || cleanBaseVideo.file_size_bytes,
          resolution: vv_resolution || cleanBaseVideo.resolution,
          fps: vv_fps ?? cleanBaseVideo.fps,
          codec: vv_codec || cleanBaseVideo.codec,
          bitrate: Number(vv_bitrate) || cleanBaseVideo.bitrate,
          status: vv_status || cleanBaseVideo.status,
          transcode_progress: Number(vv_transcode_progress) || 0,
          stage_detail: vv_stage_detail || '',
          error_message: vv_error_message || '',
          ...(Array.isArray(vv_subtitle_tracks_override) && vv_subtitle_tracks_override.length > 0
            ? { subtitle_tracks: vv_subtitle_tracks_override }
            : {}),
          active_version: {
            id: vv_id,
            version_key: vv_key,
            label: vv_label,
            badge: vv_badge || '',
            aspect_label: vv_aspect_label || '',
            description: vv_description || '',
            is_default: Boolean(vv_is_default),
            thumbnail_url: vv_thumbnail_url || '',
          },
        }
      : cleanBaseVideo;

    const storeInMemoryCache = (payloadData, expiresAt) => {
      sourceCache.set(cacheKey, { data: payloadData, expiresAt });
      partialCache.delete(cacheKey);
      if (activeVersionId) {
        sourceCache.set(`${id}:vid:${activeVersionId}`, { data: payloadData, expiresAt });
      } else {
        sourceCache.set(String(id), { data: payloadData, expiresAt });
      }
    };

    // Check if video/version is still being processed
    if (activeStatus && activeStatus !== 'READY') {
      return {
        success: false,
        status: activeStatus,
        progress: activeProgress || 0,
        stageDetail: activeStageDetail || '',
        errorMessage: activeErrorMessage || '',
        video,
        error:
          activeStatus === 'FAILED'
            ? `การแปลงวิดีโอล้มเหลว: ${activeErrorMessage || 'ไม่ทราบสาเหตุ'}`
            : `วิดีโอนี้อยู่ในสถานะ "${activeStatus}" (${activeStageDetail || 'กำลังประมวลผล'}) กรุณารอสักครู่`,
      };
    }

    const isCompleted = Number(activeProgress || 0) >= 100;

    // เก็บเนื้อหา .m3u8 เดิมจากคอลัมน์เล็ก m3u8_cache_br (~2–7KB ไม่หมดอายุตาม tempauth) เฉพาะคลิปที่แปลงครบ 100% และไม่ได้ขอ forceFresh
    // ช่วยให้ Cold Miss ไม่ต้องดูด source_cache_br (180–650KB) จาก Neon และไม่ต้องโหลด .m3u8 จาก SharePoint ซ้ำ!
    const existingM3u8Map = {};
    if (!forceFresh && isCompleted && activeM3u8CacheBr) {
      const parsedM3u8 = decompressSourceCache(activeM3u8CacheBr);
      if (parsedM3u8 && typeof parsedM3u8 === 'object') {
        for (const [name, content] of Object.entries(parsedM3u8)) {
          if (name && typeof content === 'string' && content.includes('#EXTM3U')) {
            existingM3u8Map[name] = content;
          }
        }
        if (!isMasterPlaylistConsistent(existingM3u8Map)) {
          stripMasterFromM3u8Map(existingM3u8Map);
        }
      }
    }
    let parsedCache = null;
    const isMigratingFromLegacy = Boolean(!activeCacheBr && activeCacheLegacy);
    if (activeCacheExp > 0) {
      if (activeCacheBr) {
        parsedCache = decompressSourceCache(activeCacheBr);
      } else if (activeCacheLegacy) {
        try {
          parsedCache =
            typeof activeCacheLegacy === 'string'
              ? JSON.parse(activeCacheLegacy)
              : activeCacheLegacy;
        } catch (_) {}
      }
      if (!forceFresh && isCompleted && Array.isArray(parsedCache?.items) && isMasterPlaylistConsistent(parsedCache.items)) {
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
        (activeProgress === 100 || activeStatus === 'READY') &&
        cachedM3u8Count <= 2 &&
        (parsedCache?.items?.length || 0) < 150;
      const hasStaleMaster =
        Array.isArray(parsedCache?.items) && !isMasterPlaylistConsistent(parsedCache.items);
      if (hasStaleMaster) {
        stripMasterFromM3u8Map(existingM3u8Map);
      }

      if (
        isTokenValid &&
        !isStaleEarlySnapshot &&
        !hasStaleMaster &&
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
        const expTime = activeCacheExp;
        storeInMemoryCache(resultData, expTime > now ? expTime : now + 5 * 60 * 1000);

        const needsSwrRefresh = expTime <= now + 10 * 60 * 1000;

        if (missingM3u8Content && expTime > now) {
          scheduleAfterOrBackground(async () => {
            try {
              await hydrateM3u8Contents(parsedCache.items, existingM3u8Map);
              await saveSourceCacheToDb(
                sql,
                id,
                {
                  success: true,
                  type: 'hls',
                  items: parsedCache.items,
                },
                null,
                activeVersionId,
                { persistM3u8Cache: isCompleted }
              );
            } catch (_) {}
          });
        } else if (isMigratingFromLegacy && !needsSwrRefresh) {
          scheduleAfterOrBackground(async () => {
            await saveSourceCacheToDb(sql, id, parsedCache, expTime, activeVersionId, {
              persistM3u8Cache: isCompleted,
            });
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
                if (activeSourceType === 'hls' || activeFolderId) {
                  const folderId = activeFolderId || activeItemId;
                  const swrM3u8Map = { ...existingM3u8Map };
                  const allItems = await listHlsFolderItems(
                    token,
                    driveId,
                    folderId,
                    swrM3u8Map
                  );
                  const freshValid = allItems
                    .filter((i) => i.name && i['@microsoft.graph.downloadUrl'])
                    .map((i) => {
                      const entry = {
                        name: i.name,
                        downloadUrl: i['@microsoft.graph.downloadUrl'],
                      };
                      if (swrM3u8Map[i.name]) entry.content = swrM3u8Map[i.name];
                      return entry;
                    });
                  if (freshValid.length > 0) {
                    const newExp = Date.now() + (isCompleted ? 50 * 60 * 1000 : 15 * 1000);
                    storeInMemoryCache({ success: true, type: 'hls', video, items: freshValid }, newExp);
                    await saveSourceCacheToDb(
                      sql,
                      id,
                      { success: true, type: 'hls', items: freshValid },
                      newExp,
                      activeVersionId,
                      { persistM3u8Cache: isCompleted }
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
    if (activeSourceType === 'hls' || activeFolderId) {
      const folderId = activeFolderId || activeItemId;

      const startFullHlsFetch = () => {
        if (!forceFresh && inFlightFullRefresh.has(cacheKey)) {
          const existing = inFlightFullRefresh.get(cacheKey);
          return { resultPromise: existing, donePromise: existing };
        }
        const m3u8Copy = { ...existingM3u8Map };
        let fullExpiresAt = 0;
        const resultPromise = (async () => {
          const allItems = await listHlsFolderItems(token, driveId, folderId, m3u8Copy);
          const validItems = allItems
            .filter((i) => i.name && i['@microsoft.graph.downloadUrl'])
            .map((i) => {
              const entry = {
                name: i.name,
                downloadUrl: i['@microsoft.graph.downloadUrl'],
              };
              if (m3u8Copy[i.name]) {
                entry.content = m3u8Copy[i.name];
              }
              return entry;
            });

          if (validItems.length === 0) {
            throw new Error('ไม่พบไฟล์ที่พร้อมเล่นในโฟลเดอร์ HLS จาก OneDrive');
          }

          const fullResultData = {
            success: true,
            type: 'hls',
            video,
            items: validItems,
          };

          fullExpiresAt = Date.now() + (isCompleted ? 50 * 60 * 1000 : 15 * 1000);
          storeInMemoryCache(fullResultData, fullExpiresAt);
          return fullResultData;
        })();

        const donePromise = resultPromise.then((fullResultData) =>
          saveSourceCacheToDb(
            sql,
            id,
            { success: true, type: 'hls', items: fullResultData.items },
            fullExpiresAt,
            activeVersionId,
            { persistM3u8Cache: isCompleted }
          ).then(() => fullResultData)
        );

        inFlightFullRefresh.set(cacheKey, resultPromise);
        resultPromise
          .finally(() => {
            if (inFlightFullRefresh.get(cacheKey) === resultPromise) {
              inFlightFullRefresh.delete(cacheKey);
            }
          })
          .catch(() => {});

        return { resultPromise, donePromise };
      };

      // ⚡ Two-Phase $batch Fast Cold Start (~350-550ms instead of 2–15s signing 465–4,343 files!)
      // Runs 12-file $batch FIRST with zero SharePoint contention, then kicks off full folder listing + Neon DB save in background via after().
      const initialSegNames =
        !forceFresh &&
        !preferFull &&
        isCompleted &&
        existingM3u8Map['master.m3u8'] &&
        isMasterPlaylistConsistent(existingM3u8Map)
          ? extractInitialSegmentNames(existingM3u8Map, 12)
          : [];

      if (initialSegNames.length > 0) {
        try {
          const batchTsItems = await fetchBatchDownloadUrls(token, driveId, folderId, initialSegNames);
          if (batchTsItems.length > 0) {
            const { donePromise: bgDonePromise } = startFullHlsFetch();
            scheduleAfterOrBackground(() => bgDonePromise.catch(() => {}));

            const streamFolder = resolveStreamFolderName(video, id, activeVersionId);
            const m3u8Items = Object.entries(existingM3u8Map).map(([name, content]) => ({
              name,
              downloadUrl: `/streams/${streamFolder}/${encodeURIComponent(name)}`,
              content,
            }));
            const partialResultData = {
              success: true,
              type: 'hls',
              partial: true,
              streamFolder,
              video,
              items: [...m3u8Items, ...batchTsItems],
            };
            if (!sourceCache.has(cacheKey)) {
              partialCache.set(cacheKey, {
                data: partialResultData,
                expiresAt: Date.now() + 45 * 1000,
              });
            }
            hitPath = 'cold-batch';
            return partialResultData;
          }
        } catch (batchErr) {
          console.warn('[Graph $batch Fast-Start fallback]:', batchErr.message);
        }
      }

      const { resultPromise, donePromise } = startFullHlsFetch();
      scheduleAfterOrBackground(() => donePromise.catch(() => {}));
      return await resultPromise;
    }

    // Case 2: Standalone Video File (MP4, MKV, etc.)
    const itemId = activeItemId;
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

    storeInMemoryCache(resultData, expiresAt);

    scheduleAfterOrBackground(async () => {
      await saveSourceCacheToDb(
        sql,
        id,
        { success: true, type: 'mp4', url: downloadUrl },
        expiresAt,
        activeVersionId
      );
    });

    return resultData;
  })();

  inFlightRequests.set(inflightKey, fetchPromise);

  try {
    const data = await fetchPromise;
    if (data?.status && data.status !== 'READY' && !data.success) {
      return { data, path: hitPath, notReady: true };
    }
    return { data: formatSourceForClient(data, showAdultPreviews), path: hitPath };
  } finally {
    inFlightRequests.delete(inflightKey);
  }
}

/**
 * Synchronous 0ms in-memory lookup (0 DB queries) for SSR handoff on /watch/[id]
 */
export function getCachedVideoSourceSync(
  numericId,
  { showAdultPreviews = false, version = null } = {}
) {
  const id = Number(numericId);
  if (!id || isNaN(id)) return null;
  const reqVer = version != null && String(version).trim() !== '' ? String(version).trim() : null;
  const cacheKey = reqVer ? `${id}:v:${reqVer.toLowerCase()}` : `${id}:v:default`;
  const cached = sourceCache.get(cacheKey);
  if (
    cached &&
    cached.expiresAt > Date.now() &&
    cached.data?.video &&
    (cached.data?.items?.length > 0 || cached.data?.url)
  ) {
    const sampleUrl = cached.data.items?.[0]?.downloadUrl || cached.data.url;
    if (isTempauthValid(sampleUrl)) {
      return formatSourceForClient(cached.data, showAdultPreviews);
    }
  }
  const partialCached = partialCache.get(cacheKey);
  if (
    partialCached &&
    partialCached.expiresAt > Date.now() &&
    partialCached.data?.video &&
    partialCached.data?.items?.length > 0
  ) {
    const sampleTsUrl = partialCached.data.items.find((i) =>
      isHlsSegmentFile(i.name)
    )?.downloadUrl;
    if (sampleTsUrl && isTempauthValid(sampleTsUrl)) {
      return formatSourceForClient(partialCached.data, showAdultPreviews);
    }
  }
  return null;
}

/**
 * Non-blocking server-side pre-warm for a video ID (used during SSR in /watch/[id] and feed load)
 */
export function prewarmVideoSourceServer(numericId, { version = null } = {}) {
  const id = Number(numericId);
  if (!id || isNaN(id)) return;
  const reqVer = version != null && String(version).trim() !== '' ? String(version).trim() : null;
  const cacheKey = reqVer ? `${id}:v:${reqVer.toLowerCase()}` : `${id}:v:default`;
  const cached = sourceCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 10 * 60 * 1000) {
    const sampleUrl = cached.data?.items?.[0]?.downloadUrl || cached.data?.url;
    if (isTempauthValid(sampleUrl)) return;
  }
  if (inFlightRequests.has(cacheKey)) return;

  resolveVideoSourceServer(id, { version: reqVer }).catch(() => {});
}

import { getGraphToken, getUserDriveId } from './onedriveServer';

const GIB = 1024 ** 3;

function bytesFromEnv(name, defaultGiB) {
  const configuredGiB = Number(process.env[name]);
  const bytes = Math.floor(configuredGiB * GIB);
  return Number.isSafeInteger(bytes) && bytes > 0 ? bytes : defaultGiB * GIB;
}

export const MAX_UPLOAD_BYTES = bytesFromEnv('TUBELOCK_MAX_UPLOAD_GIB', 10);
export const USER_STORAGE_QUOTA_BYTES = bytesFromEnv('TUBELOCK_USER_STORAGE_GIB', 100);

async function* listDriveItems(token, driveId, folder) {
  const firstPage = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${folder}:/children?$select=name,size,folder,file`;
  let page = firstPage;
  while (page) {
    if (new URL(page).origin !== 'https://graph.microsoft.com') {
      throw new Error('Unexpected OneDrive storage pagination origin');
    }
    const response = await fetch(page, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
    if (response.status === 404 && page === firstPage) return;
    if (!response.ok) throw new Error(`Unable to read OneDrive storage inventory (${response.status})`);

    const data = await response.json();
    yield* data.value ?? [];
    page = data['@odata.nextLink'];
  }
}

async function getUserStorageUsage(sql, ownerId) {
  const assets = await sql`
    SELECT id AS video_id, NULL::int AS version_id, raw_file_name, TRUE AS owned_parent
    FROM videos WHERE user_id = ${ownerId}
    UNION ALL
    SELECT v.id AS video_id, vv.id AS version_id, vv.raw_file_name, v.user_id IS NOT NULL AS owned_parent
    FROM video_versions vv JOIN videos v ON v.id = vv.video_id
    WHERE v.user_id = ${ownerId} OR (v.user_id IS NULL AND vv.upload_quota_user_id = ${ownerId});
  `;
  const usage = { videoBytes: {}, rawBytes: Object.create(null) };
  if (assets.length === 0) return usage;

  const ownedVideoIds = new Set();
  const ownedVersionFolders = new Set();
  const rawVideoIds = new Map();
  for (const asset of assets) {
    if (asset.owned_parent) {
      ownedVideoIds.add(Number(asset.video_id));
    } else {
      ownedVersionFolders.add(`stream_vid_${asset.video_id}_v${asset.version_id}`);
    }
    if (asset.raw_file_name) rawVideoIds.set(asset.raw_file_name.toLowerCase(), asset.video_id);
  }

  const token = await getGraphToken();
  const driveId = encodeURIComponent(await getUserDriveId(token));
  const addUsage = (videoId, itemSize) => {
    const size = Number(itemSize);
    if (itemSize == null || !Number.isSafeInteger(size) || size < 0) throw new Error('Invalid OneDrive item size');
    usage.videoBytes[videoId] = (usage.videoBytes[videoId] || 0) + size;
  };
  for await (const item of listDriveItems(token, driveId, 'streams')) {
    if (!item.folder) continue;
    const name = String(item.name || '').toLowerCase();
    const videoId = Number(name.match(/^stream_vid_(\d+)/)?.[1]);
    if (ownedVideoIds.has(videoId) || ownedVersionFolders.has(name)) addUsage(videoId, item.size);
  }
  if (rawVideoIds.size > 0) {
    for await (const item of listDriveItems(token, driveId, 'raw')) {
      if (!item.file) continue;
      const name = String(item.name || '').toLowerCase();
      const videoId = rawVideoIds.get(name);
      if (videoId == null) continue;
      addUsage(videoId, item.size);
      usage.rawBytes[name] = Number(item.size);
    }
  }
  return usage;
}

export async function reserveUploadCapacity(sql, ownerId, rawFileName, fileSize) {
  if (fileSize > USER_STORAGE_QUOTA_BYTES) return false;
  const storageUsage = await getUserStorageUsage(sql, ownerId);
  const [result] = await sql`
    SELECT reserve_upload_capacity(
      ${ownerId}::int, ${rawFileName}::text, ${fileSize}::bigint,
      ${USER_STORAGE_QUOTA_BYTES}::bigint, ${JSON.stringify(storageUsage)}::jsonb
    ) AS allowed;
  `;
  return result.allowed;
}

export async function getRawUploadSize(rawFileName) {
  if (typeof rawFileName !== 'string' || !rawFileName || /[\\/]/.test(rawFileName) ||
    rawFileName === '.' || rawFileName === '..') return null;
  const token = await getGraphToken();
  const driveId = encodeURIComponent(await getUserDriveId(token));
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(rawFileName)}?$select=file,size`,
    { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' }
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Unable to verify OneDrive upload (${response.status})`);

  const item = await response.json();
  const size = Number(item.size);
  if (!item.file || item.size == null || !Number.isSafeInteger(size) || size < 0) {
    throw new Error('Invalid OneDrive upload metadata');
  }
  return size;
}

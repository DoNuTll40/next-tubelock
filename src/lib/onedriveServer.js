/**
 * Server-side Microsoft Graph OneDrive Service
 * Authenticates via Azure Client Secret (No User Login Required!)
 */
import { classifyResolution, formatResolutionBadge, detectCodec } from './videoUtils';

function getEnvConfig() {
  const tenantId = (process.env.AZURE_TENANT_ID || process.env.NEXT_AZURE_TENANT_ID || '').replace(/['"]/g, '');
  const clientId = (process.env.AZURE_CLIENT_ID || process.env.NEXT_AZURE_CLIENT_ID || '').replace(/['"]/g, '');
  const clientSecret = (process.env.AZURE_CLIENT_SECRET || process.env.NEXT_AZURE_CLIENT_SECRET || '').replace(/['"]/g, '');
  let userId = (process.env.ONEDRIVE_USER_ID || process.env.NEXT_ONEDRIVE_USER_ID || '').replace(/['"]/g, '');
  userId = userId.replace('@donuttll40.', '@donutll40.');

  return { tenantId, clientId, clientSecret, userId };
}

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Get Microsoft Graph Access Token using OAuth 2.0 Client Credentials Grant
 */
export async function getGraphToken() {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  const { tenantId, clientId, clientSecret } = getEnvConfig();

  const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Failed to authenticate with Microsoft Graph (${tokenRes.status}): ${err}`);
  }

  const data = await tokenRes.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

/**
 * Get user's OneDrive Drive ID
 */
export async function getUserDriveId(token) {
  const { userId } = getEnvConfig();

  const driveRes = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/drive`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!driveRes.ok) {
    const err = await driveRes.text();
    throw new Error(`Failed to find OneDrive for ${userId} (${driveRes.status}): ${err}`);
  }

  const data = await driveRes.json();
  return data.id;
}

/**
 * Check if a subfolder is a valid HLS package
 */
async function checkIsHlsFolder(token, driveId, folderId) {
  try {
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children?select=name`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) return { isHls: false, resolution: '1080p' };
    const data = await res.json();
    const files = data.value || [];

    const hasM3u8 = files.some(
      (f) => f.name.toLowerCase() === 'master.m3u8' || f.name.toLowerCase().endsWith('.m3u8')
    );

    let detectedRes = '1080p';
    const resFile = files.find((f) => /^\d+p_playlist\.m3u8$/i.test(f.name));
    if (resFile) {
      const match = resFile.name.match(/^(\d+p)_/i);
      if (match) detectedRes = match[1];
    }

    return { isHls: hasM3u8, resolution: detectedRes };
  } catch (err) {
    console.warn('[HLS check error]:', err);
    return { isHls: false, resolution: '1080p' };
  }
}

/**
 * Scan target folder on OneDrive and return video records
 */
export async function scanOneDriveVideos(targetFolder = '/Videos') {
  const token = await getGraphToken();
  const driveId = await getUserDriveId(token);

  const cleanPath = targetFolder.replace(/^\/+|\/+$/g, '');
  const endpoint = cleanPath
    ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(cleanPath)}:/children?expand=thumbnails`
    : `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children?expand=thumbnails`;

  const res = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Folder "${targetFolder}" not found on OneDrive (${res.status}): ${err}`);
  }

  const data = await res.json();
  const items = data.value || [];
  const scannedVideos = [];
  const logs = [];

  const log = (msg) => {
    logs.push(`[${new Date().toLocaleTimeString('th-TH')}] ${msg}`);
  };

  log(`เชื่อมต่อ OneDrive สำเร็จ (Drive: ${driveId.slice(0, 15)}...)`);
  log(`พบรายการทั้งหมดใน "${targetFolder}": ${items.length} รายการ`);

  for (const item of items) {
    // 1. Check HLS Folder (starts with hls_)
    if (item.folder && item.name.startsWith('hls_')) {
      log(`ตรวจสอบชุดโฟลเดอร์ HLS: ${item.name}`);
      const { isHls, resolution } = await checkIsHlsFolder(token, driveId, item.id);

      if (isHls) {
        const cleanTitle = item.name.replace(/^hls_/, '').replace(/_\d+$/, '');
        const normRes = formatResolutionBadge(resolution);
        console.log(normRes)
        scannedVideos.push({
          onedrive_folder_id: item.id,
          source_type: 'hls',
          title: cleanTitle,
          description: `ชุด HLS จากโฟลเดอร์ ${targetFolder}/${item.name}`,
          file_size_bytes: item.size || 0,
          resolution: normRes,
          fps: 30,
          codec: 'h264',
          thumbnail_url: '',
          tags: ['HLS', normRes],
        });
        log(`✅ นำเข้า HLS: "${cleanTitle}" [${normRes}]`);
      } else {
        log(`ข้ามโฟลเดอร์: ${item.name} (ไม่ใช่ HLS)`);
      }
      continue;
    }

    // 2. Check standalone Video File
    const isVideo = item.video || item.name.match(/\.(mp4|mkv|mov|webm|m4v)$/i);
    if (isVideo) {
      const cleanTitle = item.name.replace(/\.[^/.]+$/, '');
      const thumbUrl = item.thumbnails?.[0]?.large?.url || item.thumbnails?.[0]?.medium?.url || '';

      const width = item.video?.width || 0;
      const height = item.video?.height || 0;
      const resolution = classifyResolution(width, height);
      const fps = item.video?.frameRate ? Math.round(item.video.frameRate) : 30;
      const codec = detectCodec(item.video?.fourCC, 'h264');

      scannedVideos.push({
        onedrive_item_id: item.id,
        source_type: 'file',
        title: cleanTitle,
        description: `สแกนจากโฟลเดอร์ ${targetFolder}`,
        file_size_bytes: item.size || 0,
        duration: item.video?.duration ? Math.floor(item.video.duration / 1000) : 0,
        resolution,
        fps,
        codec,
        thumbnail_url: thumbUrl,
        tags: ['File', resolution, `${fps}fps`, codec.toUpperCase()],
      });
      log(`🎬 นำเข้าไฟล์วิดีโอ: "${item.name}" [${resolution} | ${fps}fps | ${codec.toUpperCase()}]`);
    }
  }

  return {
    totalItems: items.length,
    scannedVideos,
    logs,
  };
}

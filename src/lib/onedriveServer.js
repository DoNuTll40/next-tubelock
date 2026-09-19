/**
 * Server-side Microsoft Graph OneDrive Service
 * Authenticates via Azure Client Secret (No User Login Required!)
 */
import { classifyResolution, formatResolutionBadge, detectCodec } from './videoUtils';

function getEnvConfig() {
  const tenantId = (process.env.AZURE_TENANT_ID || process.env.NEXT_AZURE_TENANT_ID || '').replace(/['"]/g, '').trim();
  const clientId = (process.env.AZURE_CLIENT_ID || process.env.NEXT_AZURE_CLIENT_ID || '').replace(/['"]/g, '').trim();
  const clientSecret = (process.env.AZURE_CLIENT_SECRET || process.env.NEXT_AZURE_CLIENT_SECRET || '').replace(/['"]/g, '').trim();
  let userId = (process.env.ONEDRIVE_USER_ID || process.env.NEXT_ONEDRIVE_USER_ID || '').replace(/['"]/g, '').trim();
  userId = userId.replace('@donuttll40.', '@donutll40.');

  return { tenantId, clientId, clientSecret, userId };
}

let cachedToken = null;
let tokenExpiresAt = 0;

/**
 * Get Microsoft Graph Access Token using OAuth 2.0 Client Credentials Grant
 * Supports forceRefresh for auto-retry when encountering 401 Unauthorized
 */
export async function getGraphToken(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  const { tenantId, clientId, clientSecret } = getEnvConfig();

  if (!tenantId || !clientId || !clientSecret) {
    const missing = [];
    if (!tenantId) missing.push('AZURE_TENANT_ID');
    if (!clientId) missing.push('AZURE_CLIENT_ID');
    if (!clientSecret) missing.push('AZURE_CLIENT_SECRET');
    throw new Error(`Azure credentials missing on server: ${missing.join(', ')}. Please check Vercel environment variables.`);
  }

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
    cachedToken = null;
    tokenExpiresAt = 0;
    console.error(`[Azure Token Authentication Error] Status: ${tokenRes.status}, Body: ${err}`);
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

/**
 * Ensure a folder path exists in OneDrive; if not, create it
 */
export async function ensureFolderExists(token, driveId, folderPath = '/Videos') {
  const cleanPath = folderPath.replace(/^\/+|\/+$/g, '');
  if (!cleanPath) {
    // Root folder
    const rootRes = await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/root`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!rootRes.ok) throw new Error(`Cannot access drive root (${rootRes.status})`);
    const rootData = await rootRes.json();
    return rootData.id;
  }

  // Check if target folder already exists
  const checkUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(cleanPath)}`;
  const checkRes = await fetch(checkUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (checkRes.ok) {
    const data = await checkRes.json();
    return data.id;
  }

  // Create folder segments sequentially
  const segments = cleanPath.split('/').filter(Boolean);
  let currentParentId = 'root';

  for (const seg of segments) {
    const checkSegUrl = currentParentId === 'root'
      ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(seg)}`
      : `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${currentParentId}:/${encodeURIComponent(seg)}`;

    const segCheck = await fetch(checkSegUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (segCheck.ok) {
      const segData = await segCheck.json();
      currentParentId = segData.id;
    } else {
      const createUrl = currentParentId === 'root'
        ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root/children`
        : `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${currentParentId}/children`;

      const createRes = await fetch(createUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: seg,
          folder: {},
          '@microsoft.graph.conflictBehavior': 'fail',
        }),
      });

      if (createRes.status === 409) {
        // Folder already exists or created concurrently
        const fetchUrl = currentParentId === 'root'
          ? `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/${encodeURIComponent(seg)}`
          : `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${currentParentId}:/${encodeURIComponent(seg)}`;
        const fetchRes = await fetch(fetchUrl, { headers: { Authorization: `Bearer ${token}` } });
        if (fetchRes.ok) {
          const fetched = await fetchRes.json();
          currentParentId = fetched.id;
        } else {
          const err = await fetchRes.text();
          throw new Error(`Failed to resolve existing folder "${seg}": ${err}`);
        }
      } else if (!createRes.ok) {
        const err = await createRes.text();
        throw new Error(`Failed to create folder "${seg}" (${createRes.status}): ${err}`);
      } else {
        const created = await createRes.json();
        currentParentId = created.id;
      }
    }
  }

  return currentParentId;
}

/**
 * Request Microsoft Graph to create a Direct Upload Session
 * Pre-authenticates an uploadUrl that the client can directly PUT chunks to!
 * Features automatic token refresh on 401 and explicit error reporting.
 */
export async function createUploadSession(fileName, targetFolder = '/Videos') {
  let token = await getGraphToken();
  let driveId;
  try {
    driveId = await getUserDriveId(token);
  } catch (err) {
    if (err.message?.includes('401') || err.message?.includes('CompactToken')) {
      console.warn('[OneDrive] Token rejected (401), refreshing token...');
      token = await getGraphToken(true);
      driveId = await getUserDriveId(token);
    } else {
      throw err;
    }
  }

  let folderId;
  try {
    folderId = await ensureFolderExists(token, driveId, targetFolder);
  } catch (err) {
    if (err.message?.includes('401')) {
      console.warn('[OneDrive] Folder check returned 401, refreshing token...');
      token = await getGraphToken(true);
      folderId = await ensureFolderExists(token, driveId, targetFolder);
    } else {
      throw err;
    }
  }

  const sessionUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/createUploadSession`;

  let sessionRes = await fetch(sessionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      item: {
        '@microsoft.graph.conflictBehavior': 'replace',
        name: fileName,
      },
    }),
  });

  if (sessionRes.status === 401) {
    console.warn('[OneDrive] createUploadSession returned 401, retrying with fresh token...');
    token = await getGraphToken(true);
    sessionRes = await fetch(sessionUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        item: {
          '@microsoft.graph.conflictBehavior': 'replace',
          name: fileName,
        },
      }),
    });
  }

  if (!sessionRes.ok) {
    const errText = await sessionRes.text();
    console.error(`[Microsoft Graph createUploadSession Error] Status: ${sessionRes.status}, Endpoint: ${sessionUrl}, Response: ${errText}`);
    throw new Error(`Microsoft Graph createUploadSession failed (${sessionRes.status}): ${errText}`);
  }

  const sessionData = await sessionRes.json();

  return {
    uploadUrl: sessionData.uploadUrl,
    expirationDateTime: sessionData.expirationDateTime,
    fileName,
    targetFolder,
    folderId,
    driveId,
  };
}

/**
 * Fetch DriveItem details from OneDrive and format into a video record
 */
export async function getDriveItemVideoRecord(itemId, targetFolder = '/Videos') {
  const token = await getGraphToken();
  const driveId = await getUserDriveId(token);

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}?expand=thumbnails`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to fetch OneDrive item (${res.status}): ${err}`);
  }

  const item = await res.json();
  const cleanTitle = item.name.replace(/\.[^/.]+$/, '');
  const thumbUrl = item.thumbnails?.[0]?.large?.url || item.thumbnails?.[0]?.medium?.url || '';

  const width = item.video?.width || 0;
  const height = item.video?.height || 0;
  const resolution = classifyResolution(width, height);
  const fps = item.video?.frameRate ? Math.round(item.video.frameRate) : 30;
  const codec = detectCodec(item.video?.fourCC, 'h264');

  return {
    onedrive_item_id: item.id,
    source_type: 'file',
    title: cleanTitle,
    description: `อัปโหลดเข้าโฟลเดอร์ ${targetFolder}`,
    file_size_bytes: item.size || 0,
    duration: item.video?.duration ? Math.floor(item.video.duration / 1000) : 0,
    resolution,
    fps,
    codec,
    thumbnail_url: thumbUrl,
    tags: ['Upload', resolution, `${fps}fps`, codec.toUpperCase()],
  };
}

/**
 * Create an HLS package folder in OneDrive (e.g. /Videos/hls_myvideo_123456)
 */
export async function createHlsFolder(parentFolder = '/Videos', subFolderName) {
  const token = await getGraphToken();
  const driveId = await getUserDriveId(token);

  const parentId = await ensureFolderExists(token, driveId, parentFolder);

  const createRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${parentId}/children`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: subFolderName,
        folder: {},
        '@microsoft.graph.conflictBehavior': 'rename',
      }),
    }
  );

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create HLS folder "${subFolderName}": ${err}`);
  }

  const folderData = await createRes.json();
  return {
    folderId: folderData.id,
    folderName: folderData.name,
    parentFolder,
    driveId,
  };
}

/**
 * Direct PUT upload of HLS playlist or segment into OneDrive folder (< 4MB)
 */
export async function uploadHlsFileDirect(folderId, fileName, fileBuffer) {
  const token = await getGraphToken();
  const driveId = await getUserDriveId(token);

  const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/content`;

  const res = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Length': fileBuffer.length.toString(),
      'Content-Type': fileName.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
    },
    body: fileBuffer,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Failed to upload ${fileName} (${res.status}): ${err}`);
  }

  return await res.json();
}

/**
 * Upload Session for HLS files >= 4MB
 */
export async function createHlsFileUploadSession(folderId, fileName) {
  const token = await getGraphToken();
  const driveId = await getUserDriveId(token);

  const sessionUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}:/${encodeURIComponent(fileName)}:/createUploadSession`;

  const sessionRes = await fetch(sessionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      item: {
        '@microsoft.graph.conflictBehavior': 'replace',
        name: fileName,
      },
    }),
  });

  if (!sessionRes.ok) {
    const err = await sessionRes.text();
    throw new Error(`Failed to create upload session for ${fileName}: ${err}`);
  }

  return await sessionRes.json();
}



/**
 * OneDrive Video Streaming & File Service
 * Connects to Microsoft Graph API and resolves HLS manifests & direct MP4 streams
 */

export async function createVideoFolder(accessToken, parentFolder, subFolderName) {
  const rootCheckUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(parentFolder)}`;
  let parentId;

  const res = await fetch(rootCheckUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (res.ok) {
    const data = await res.json();
    parentId = data.id;
  } else {
    const createRootRes = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root/children`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: parentFolder, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }),
    });
    if (!createRootRes.ok) throw new Error(`ไม่สามารถสร้างโฟลเดอร์หลักได้`);
    parentId = (await createRootRes.json()).id;
  }

  const listRes = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${parentId}/children`, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (listRes.ok) {
    const listData = await listRes.json();
    const existing = listData.value?.find(item => item.name === subFolderName && item.folder);
    if (existing) return existing.id;
  }

  const subFolderRes = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${parentId}/children`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: subFolderName, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' }),
  });

  if (subFolderRes.ok) {
    return (await subFolderRes.json()).id;
  }

  if (subFolderRes.status === 409) {
    const retryList = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${parentId}/children`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    const retryData = await retryList.json();
    const existing = retryData.value?.find(item => item.name === subFolderName && item.folder);
    if (existing) return existing.id;
  }

  throw new Error(`ไม่สามารถสร้างโฟลเดอร์ย่อยสำหรับวิดีโอได้`);
}

function uploadChunkNativeXHR(uploadUrl, chunkBlob, rangeHeader, onChunkProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl, true);
    xhr.withCredentials = false;
    xhr.setRequestHeader('Content-Range', rangeHeader);

    if (xhr.upload && onChunkProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onChunkProgress(e.loaded);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status === 200 || xhr.status === 201 || xhr.status === 202) {
        let parsed = null;
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch (_) {
          parsed = xhr.responseText;
        }
        resolve({ status: xhr.status, data: parsed });
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText || xhr.statusText}`));
      }
    };

    xhr.onerror = () => reject(new Error('การเชื่อมต่อถูกตัด (Network/CORS Rejected)'));
    xhr.ontimeout = () => reject(new Error('หมดเวลาการส่งข้อมูล (Timeout)'));
    xhr.timeout = 180000;
    xhr.send(chunkBlob);
  });
}

export async function uploadFileToFolderId(accessToken, folderId, fileObject, customFileName = null, onProgress = () => {}) {
  const fileName = customFileName || fileObject.name;

  onProgress(2, 'กำลังขอเปิด Upload Session กับ Microsoft...');
  const sessionUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}:/${encodeURIComponent(fileName)}:/createUploadSession`;

  const sessionRes = await fetch(sessionUrl, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      item: {
        '@microsoft.graph.conflictBehavior': 'replace',
        name: fileName,
      }
    })
  });

  if (!sessionRes.ok) {
    const err = await sessionRes.text();
    throw new Error(`สร้าง Upload Session ไม่สำเร็จ (${sessionRes.status}): ${err}`);
  }

  const { uploadUrl } = await sessionRes.json();
  onProgress(5, 'เชื่อมต่อสำเร็จ เริ่มส่งข้อมูลไฟล์...');

  const CHUNK_SIZE = 320 * 1024 * 32;
  const fileSize = fileObject.size;
  let start = 0;
  let lastResult = null;
  let chunkIndex = 1;
  const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
  const uploadStartTime = Date.now();

  while (start < fileSize) {
    const end = Math.min(start + CHUNK_SIZE, fileSize);
    const chunkBlob = fileObject.slice(start, end);
    const contentRange = `bytes ${start}-${end - 1}/${fileSize}`;

    let success = false;
    let attempts = 0;

    while (!success && attempts < 3) {
      attempts++;
      try {
        const res = await uploadChunkNativeXHR(uploadUrl, chunkBlob, contentRange, (chunkLoaded) => {
          const currentTotal = Math.min(start + chunkLoaded, fileSize);
          const pct = Math.min(99, Math.round((currentTotal / fileSize) * 100));
          const currentMB = (currentTotal / (1024 * 1024)).toFixed(1);
          const totalMB = (fileSize / (1024 * 1024)).toFixed(1);

          const elapsedSec = Math.max(0.1, (Date.now() - uploadStartTime) / 1000);
          const currentBytes = currentTotal;
          const speedMbps = ((currentBytes * 8) / (1000 * 1000) / elapsedSec).toFixed(1);
          const speedMBs = (currentBytes / (1024 * 1024) / elapsedSec).toFixed(1);

          onProgress(
            pct,
            `กำลังอัปโหลด... ${pct}% (${currentMB}/${totalMB} MB) • ${speedMbps} Mbps (${speedMBs} MB/s) [ก้อนที่ ${chunkIndex}/${totalChunks}]`
          );
        });

        if (res.status === 200 || res.status === 201) {
          lastResult = res.data;
        }
        success = true;
      } catch (err) {
        if (attempts >= 3) {
          throw new Error(`[ก้อนที่ ${chunkIndex}/${totalChunks}] ${err.message}`);
        }
        onProgress(
          Math.round((start / fileSize) * 100),
          `⚠️ ก้อนที่ ${chunkIndex}/${totalChunks} เกิดข้อผิดพลาด กำลังลองใหม่รอบที่ ${attempts}...`
        );
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    start = end;
    chunkIndex++;
  }

  onProgress(100, `อัปโหลดไฟล์ "${fileName}" เสร็จสมบูรณ์ 100%!`);
  return lastResult;
}

export async function uploadDirectToFolderPath(accessToken, parentFolder, fileObject, customFileName = null, onProgress = () => {}) {
  const cleanParent = parentFolder.replace(/^\/+|\/+$/g, '');

  onProgress(1, `กำลังตรวจสอบโฟลเดอร์ "${cleanParent}" บน OneDrive...`);
  const rootCheckUrl = `https://graph.microsoft.com/v1.0/me/drive/root:/${encodeURIComponent(cleanParent)}`;
  let parentId;

  const res = await fetch(rootCheckUrl, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });

  if (res.ok) {
    const data = await res.json();
    parentId = data.id;
  } else {
    onProgress(2, `ไม่พบโฟลเดอร์ กำลังสร้างโฟลเดอร์ "${cleanParent}"...`);
    const createRootRes = await fetch(`https://graph.microsoft.com/v1.0/me/drive/root/children`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: cleanParent, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' }),
    });

    if (!createRootRes.ok) throw new Error(`ไม่สามารถสร้างโฟลเดอร์หลักได้ (${createRootRes.status})`);
    parentId = (await createRootRes.json()).id;
  }

  return await uploadFileToFolderId(accessToken, parentId, fileObject, customFileName, onProgress);
}

export async function resolvePlaybackSource(accessToken, video) {
  const folderId = video.onedrive_folder_id || (video.source_type === 'hls' ? video.onedrive_item_id : null);
  
  if (video.source_type === 'hls' || folderId) {
    return await resolveHlsSource(accessToken, folderId || video.onedrive_item_id);
  }
  return await resolveFileSource(accessToken, video.onedrive_item_id);
}

async function resolveFileSource(accessToken, itemId) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${itemId}?select=id,@microsoft.graph.downloadUrl`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error('ไม่สามารถดึงลิงก์วิดีโอได้');
  const data = await res.json();
  return { type: 'mp4', url: data['@microsoft.graph.downloadUrl'] };
}

// -------------------------------------------------------------
// HLS Resolution Functions (Nested Rewriting สำหรับ ABR)
// -------------------------------------------------------------

async function rewriteSubPlaylistToBlobUrl(subPlaylistUrl, segmentUrlMap) {
  const res = await fetch(subPlaylistUrl);
  if (!res.ok) throw new Error(`ไม่สามารถโหลด Sub-Playlist จาก URL: ${subPlaylistUrl}`);
  const text = await res.text();

  const rewritten = text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;

      const cleanBase = trimmed.replace(/\.ts$/i, '');
      const realSegmentUrl = segmentUrlMap[trimmed] || segmentUrlMap[`${cleanBase}.ts`] || segmentUrlMap[cleanBase];
      return realSegmentUrl || line;
    })
    .join('\n');

  const blob = new Blob([rewritten], { type: 'application/vnd.apple.mpegurl' });
  return URL.createObjectURL(blob);
}

async function resolveHlsSource(accessToken, folderId) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?select=id,name,@microsoft.graph.downloadUrl`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error('ไม่สามารถดึงไฟล์ HLS ในโฟลเดอร์ได้');
  const data = await res.json();
  const items = data.value || [];

  const segmentUrlMap = {};
  const subPlaylistItems = {};
  let masterPlaylistItem = null;

  for (const item of items) {
    const downloadUrl = item['@microsoft.graph.downloadUrl'];
    if (!downloadUrl) continue;

    const lowerName = item.name.toLowerCase();

    if (lowerName === 'master.m3u8') {
      masterPlaylistItem = item;
    } else if (lowerName.endsWith('.m3u8')) {
      subPlaylistItems[item.name] = item;
    } else if (lowerName.endsWith('.ts')) {
      const baseName = item.name.replace(/\.ts$/i, '');
      segmentUrlMap[item.name] = downloadUrl;
      segmentUrlMap[`${baseName}.ts`] = downloadUrl;
      segmentUrlMap[baseName] = downloadUrl;
    }
  }

  // โหมด ABR: ถ้ามี master.m3u8 ให้ทำ Nested Resolution
  if (masterPlaylistItem && masterPlaylistItem['@microsoft.graph.downloadUrl']) {
    console.log('[HLS Resolver] ตรวจพบ Master Playlist (ABR Mode)');

    const subPlaylistBlobUrlMap = {};
    const subPlaylistEntries = Object.entries(subPlaylistItems);

    await Promise.all(
      subPlaylistEntries.map(async ([fileName, item]) => {
        try {
          const blobUrl = await rewriteSubPlaylistToBlobUrl(item['@microsoft.graph.downloadUrl'], segmentUrlMap);
          subPlaylistBlobUrlMap[fileName] = blobUrl;
        } catch (err) {
          console.warn(`[HLS Resolver] ข้าม playlist "${fileName}" เนื่องจาก error:`, err);
        }
      })
    );

    const masterRes = await fetch(masterPlaylistItem['@microsoft.graph.downloadUrl']);
    if (!masterRes.ok) throw new Error('ดาวน์โหลด master.m3u8 ไม่สำเร็จ');
    const masterText = await masterRes.text();

    const rewrittenMaster = masterText
      .split('\n')
      .map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return line;
        return subPlaylistBlobUrlMap[trimmed] || line;
      })
      .join('\n');

    const masterBlob = new Blob([rewrittenMaster], { type: 'application/vnd.apple.mpegurl' });
    return { type: 'hls', url: URL.createObjectURL(masterBlob) };
  }

  // โหมด Fallback: วิดีโอเดิมที่เป็น Single Playlist
  console.log('[HLS Resolver] ไม่พบ master.m3u8 กำลังเล่นแบบ Single Stream');
  const singlePlaylist = Object.values(subPlaylistItems)[0];

  if (!singlePlaylist || !singlePlaylist['@microsoft.graph.downloadUrl']) {
    throw new Error('ไม่พบไฟล์ playlist (.m3u8) ในโฟลเดอร์ HLS บน OneDrive');
  }

  const singleBlobUrl = await rewriteSubPlaylistToBlobUrl(
    singlePlaylist['@microsoft.graph.downloadUrl'],
    segmentUrlMap
  );

  return { type: 'hls', url: singleBlobUrl };
}

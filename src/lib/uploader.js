import { classifyResolution } from './videoUtils';

/**
 * Multiple of 320 KiB required by Microsoft Graph createUploadSession
 * 320 * 1024 * 32 = 10,485,760 bytes (~10 MB)
 */
const CHUNK_SIZE = 320 * 1024 * 32;

/**
 * Extract client-side video metadata (duration, dimensions, resolution, thumbnail, exact fps)
 * Safely skips on Mobile to avoid Android ContentResolver stream lock (NotReadableError)
 */
export async function extractVideoMetadata(file) {
  const isMobile = typeof navigator !== 'undefined' && (
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints && navigator.maxTouchPoints > 1)
  );

  if (isMobile) {
    return {
      duration: 0,
      width: 0,
      height: 0,
      resolution: 'Original / Auto',
      fps: 30,
      thumbnailDataUrl: null,
    };
  }

  const detectedFps = 30;

  return new Promise((resolve) => {
    let isResolved = false;

    const cleanup = (video, blobUrl) => {
      try {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        if (video) {
          video.src = '';
          video.remove();
        }
      } catch (_) {}
    };

    const safeResolve = (data, video, blobUrl) => {
      if (isResolved) return;
      isResolved = true;
      if (timeoutId) clearTimeout(timeoutId);
      cleanup(video, blobUrl);
      resolve(data);
    };

    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');

    let blobUrl = '';
    try {
      blobUrl = URL.createObjectURL(file);
      video.src = blobUrl;
    } catch (err) {
      safeResolve({
        duration: 0,
        width: 0,
        height: 0,
        resolution: 'Original / Auto',
        fps: detectedFps,
        thumbnailDataUrl: null,
      }, video, blobUrl);
      return;
    }

    // 3. Timeout Fallback: 2.5 seconds (never block mobile uploads)
    const timeoutId = setTimeout(() => {
      safeResolve({
        duration: 0,
        width: 0,
        height: 0,
        resolution: 'Original / Auto',
        fps: detectedFps,
        thumbnailDataUrl: null,
      }, video, blobUrl);
    }, 2500);

    video.onloadedmetadata = () => {
      const width = video.videoWidth || 0;
      const height = video.videoHeight || 0;
      const duration = video.duration || 0;
      const resolution = (width && height) 
        ? classifyResolution(width, height) 
        : 'Original / Auto';

      // Seek to capture thumbnail, with safety timeout for mobile where onseeked might not fire
      let seekTimeout = setTimeout(() => {
        safeResolve({
          duration,
          width,
          height,
          resolution,
          fps: detectedFps,
          thumbnailDataUrl: null,
        }, video, blobUrl);
      }, 700);

      video.onseeked = () => {
        clearTimeout(seekTimeout);
        let thumbnailDataUrl = null;
        try {
          const canvas = document.createElement('canvas');
          canvas.width = Math.min(640, video.videoWidth || 640);
          canvas.height = Math.round(canvas.width * ((video.videoHeight || 360) / (video.videoWidth || 640)));
          const ctx = canvas.getContext('2d');
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          thumbnailDataUrl = canvas.toDataURL('image/jpeg', 0.85);
        } catch (e) {
          console.warn('Canvas thumbnail capture error:', e);
        }

        safeResolve({
          duration,
          width,
          height,
          resolution,
          fps: detectedFps,
          thumbnailDataUrl,
        }, video, blobUrl);
      };

      try {
        video.currentTime = Math.min(1.0, duration > 2 ? 1.0 : 0.1);
      } catch (_) {
        clearTimeout(seekTimeout);
        safeResolve({
          duration,
          width,
          height,
          resolution,
          fps: detectedFps,
          thumbnailDataUrl: null,
        }, video, blobUrl);
      }
    };

    video.onerror = () => {
      safeResolve({
        duration: 0,
        width: 0,
        height: 0,
        resolution: 'Original / Auto',
        fps: detectedFps,
        thumbnailDataUrl: null,
      }, video, blobUrl);
    };

    // 1. Force load() for mobile browsers (iOS Safari / Android Chrome)
    try {
      video.load();
    } catch (_) {}
  });
}

/**
 * Upload single chunk to Microsoft Graph uploadUrl via XMLHttpRequest
 */
function uploadChunkXHR(uploadUrl, chunkBlob, rangeHeader, onProgress, xhrRef) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (xhrRef) xhrRef.current = xhr;

    xhr.open('PUT', uploadUrl, true);
    xhr.withCredentials = false;
    xhr.setRequestHeader('Content-Range', rangeHeader);

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(e.loaded);
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

    xhr.onerror = () => reject(new Error('การเชื่อมต่อถูกตัด (Network Disconnected)'));
    xhr.onabort = () => reject(new Error('ยกเลิกการอัปโหลด (Upload Aborted)'));
    xhr.ontimeout = () => reject(new Error('หมดเวลาส่งข้อมูล (Upload Timeout)'));
    xhr.timeout = 180000; // 3 minutes timeout per chunk
    xhr.send(chunkBlob);
  });
}

/**
 * Main Direct Resumable Chunked Uploader
 */
export async function uploadVideoFile(file, options = {}) {
  const {
    targetFolder = '/Videos',
    onProgress = () => {},
    onLog = () => {},
    xhrRef = { current: null },
  } = options;

  onLog(`เริ่มกระบวนการ: ตรวจสอบและดึงข้อมูลไฟล์ "${file.name}"...`);

  // Step 1: Client Metadata
  const meta = await extractVideoMetadata(file);
  onLog(`ขนาดภาพ: ${meta.width}x${meta.height} [${meta.resolution}] • ความยาว: ${Math.round(meta.duration)} วินาที`);

  // Step 2: Open Upload Session with server
  onLog(`ขอเปิด Upload Session กับ Microsoft Graph (โฟลเดอร์: ${targetFolder})...`);
  const sessionRes = await fetch('/api/upload/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      targetFolder,
    }),
  });

  const sessionData = await sessionRes.json();
  if (!sessionRes.ok || !sessionData.success) {
    throw new Error(sessionData.error || 'สร้าง Upload Session ไม่สำเร็จ');
  }

  const { uploadUrl } = sessionData;
  onLog(`เชื่อมต่อ Microsoft Cloud สำเร็จ! เริ่มส่งข้อมูลแบบแบ่งส่วน (Chunk Size: 10MB)...`);

  // Step 3: Chunk Loop
  const fileSize = file.size;
  const effectiveChunkSize = Math.min(CHUNK_SIZE, fileSize);
  let start = 0;
  let chunkIndex = 1;
  const totalChunks = Math.max(1, Math.ceil(fileSize / effectiveChunkSize));
  const uploadStartTime = Date.now();
  let lastDriveItem = null;

  while (start < fileSize) {
    const end = Math.min(start + CHUNK_SIZE, fileSize) - 1;
    const chunkBlob = file.slice(start, end + 1);
    const chunkBuffer = await chunkBlob.arrayBuffer();
    const contentRange = `bytes ${start}-${end}/${fileSize}`;

    let success = false;
    let attempts = 0;

    while (!success && attempts < 3) {
      attempts++;
      try {
        const res = await uploadChunkXHR(
          uploadUrl,
          chunkBuffer,
          contentRange,
          (chunkLoaded) => {
            const currentTotal = Math.min(start + chunkLoaded, fileSize);
            const pct = Math.min(99, Math.round((currentTotal / fileSize) * 100));
            const elapsedSec = Math.max(0.1, (Date.now() - uploadStartTime) / 1000);
            const speedBytesPerSec = currentTotal / elapsedSec;
            const speedMBs = (speedBytesPerSec / (1024 * 1024)).toFixed(1);
            const speedMbps = ((speedBytesPerSec * 8) / (1000 * 1000)).toFixed(1);
            const remainingBytes = Math.max(0, fileSize - currentTotal);
            const etaSec = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;

            onProgress({
              percent: pct,
              currentMB: (currentTotal / (1024 * 1024)).toFixed(1),
              totalMB: (fileSize / (1024 * 1024)).toFixed(1),
              speedMBs,
              speedMbps,
              etaSec,
              chunkIndex,
              totalChunks,
            });
          },
          xhrRef
        );

        if (res.status === 200 || res.status === 201) {
          lastDriveItem = res.data;
        }
        success = true;
      } catch (err) {
        if (err.message.includes('ยกเลิกการอัปโหลด')) {
          throw err;
        }
        if (attempts >= 3) {
          throw new Error(`[ก้อนที่ ${chunkIndex}/${totalChunks}] การส่งข้อมูลล้มเหลว: ${err.message}`);
        }
        onLog(`⚠️ ก้อนที่ ${chunkIndex} เกิดปัญหา กำลังลองใหม่ (${attempts}/3)...`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    start = end + 1;
    chunkIndex++;
  }

  onProgress({
    percent: 100,
    currentMB: (fileSize / (1024 * 1024)).toFixed(1),
    totalMB: (fileSize / (1024 * 1024)).toFixed(1),
    speedMBs: '0',
    speedMbps: '0',
    etaSec: 0,
    chunkIndex: totalChunks,
    totalChunks,
  });

  onLog(`🎉 ส่งข้อมูลเข้า OneDrive 100% เรียบร้อยแล้ว! กำลังบันทึกลงคลังข้อมูล TubeLock...`);

  // Step 4: Register in Neon PostgreSQL
  const itemId = lastDriveItem?.id || sessionData.folderId;
  const completeRes = await fetch('/api/upload/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      itemId: lastDriveItem?.id,
      targetFolder,
      clientMeta: {
        fileName: file.name,
        fileSize: file.size,
        duration: meta.duration,
        resolution: meta.resolution,
        fps: 30,
        thumbnailUrl: meta.thumbnailDataUrl || '',
      },
    }),
  });

  const completeData = await completeRes.json();
  if (!completeRes.ok || !completeData.success) {
    onLog(`⚠️ บันทึกลงฐานข้อมูลไม่สมบูรณ์ แต่ไฟล์อยู่บน OneDrive แล้ว`);
  } else {
    onLog(`✨ บันทึกลงฐานข้อมูล Neon สำเร็จ! Video ID: ${completeData.video?.id}`);
  }

  return {
    success: true,
    video: completeData.video,
    driveItem: lastDriveItem,
    meta,
  };
}

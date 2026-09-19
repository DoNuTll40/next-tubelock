import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

let ffmpeg = null;

export async function loadFFmpeg() {
  if (ffmpeg?.loaded) {
    return ffmpeg;
  }

  ffmpeg = new FFmpeg();

  ffmpeg.on('log', ({ message }) => {
    console.log('[FFmpeg]', message);
  });

  try {
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

    const coreURL = await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript');
    const wasmURL = await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm');

    await ffmpeg.load({ coreURL, wasmURL });

    return ffmpeg;
  } catch (err) {
    ffmpeg = null;
    throw new Error(`โหลด FFmpeg ไม่สำเร็จ: ${err?.message || err}`);
  }
}

const SUPPORTED_EXTENSIONS = [
  'mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm',
  'flv', 'wmv', 'mpg', 'mpeg', '3gp', 'ts', 'm2ts',
];

function getFileExtension(fileName) {
  const parts = fileName.split('.');
  if (parts.length < 2) return 'mp4';
  const ext = parts.pop().toLowerCase();
  return SUPPORTED_EXTENSIONS.includes(ext) ? ext : 'mp4';
}

export function getVideoMetadata(fileBlob) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(fileBlob);
    video.src = url;

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve({
        width: video.videoWidth || 1920,
        height: video.videoHeight || 1080,
        duration: video.duration || 0,
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 1920, height: 1080, duration: 0 });
    };
  });
}

function makeEven(num) {
  return Math.max(144, Math.round(num / 2) * 2);
}

/**
 * Fast & Accurate Probe: ตรวจจับ Stream แท้จริงและแคป Thumbnail
 */
export async function probeVideoWithFFmpeg(fileData) {
  const ffmpegInstance = await loadFFmpeg();
  const inputName = `probe_${Date.now()}.mp4`;
  const thumbName = `thumb_${Date.now()}.jpg`;

  let dataToWrite;
  if (fileData instanceof Blob) {
    dataToWrite = new Uint8Array(await fileData.arrayBuffer());
  } else if (fileData instanceof ArrayBuffer) {
    dataToWrite = new Uint8Array(fileData.slice(0));
  } else if (fileData instanceof Uint8Array) {
    dataToWrite = new Uint8Array(fileData.buffer.slice(0));
  } else {
    dataToWrite = new Uint8Array(fileData);
  }

  await ffmpegInstance.writeFile(inputName, dataToWrite);

  const candidateStreams = [];
  let parsedDuration = null;

  const logHandler = ({ message }) => {
    if (!parsedDuration) {
      const durMatch = message.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (durMatch) {
        const hours = parseFloat(durMatch[1]);
        const mins = parseFloat(durMatch[2]);
        const secs = parseFloat(durMatch[3]);
        parsedDuration = Math.round(hours * 3600 + mins * 60 + secs);
      }
    }

    if (message.includes('Video:')) {
      const streamIndexMatch = message.match(/Stream #0:(\d+)/);
      const streamIdx = streamIndexMatch ? parseInt(streamIndexMatch[1], 10) : 0;

      const codecMatch = message.match(/Video:\s*([a-zA-Z0-9_-]+)/);
      const codec = codecMatch ? codecMatch[1].toLowerCase() : 'h264';

      const dimMatch = message.match(/(\d{3,5})x(\d{3,5})/);
      const fpsMatch = message.match(/(\d+(?:\.\d+)?)\s*fps/);

      if (dimMatch) {
        const w = parseInt(dimMatch[1], 10);
        const h = parseInt(dimMatch[2], 10);
        const fps = fpsMatch ? parseFloat(fpsMatch[1]).toFixed(3) : '30.000';

        candidateStreams.push({
          streamIdx,
          width: w,
          height: h,
          pixels: w * h,
          codec,
          fps,
        });
      }
    }
  };

  ffmpegInstance.on('log', logHandler);

  try {
    await ffmpegInstance.exec([
      '-i', inputName,
      '-t', '0.01',
      '-f', 'null',
      '-'
    ]);
  } catch (_) {}

  candidateStreams.sort((a, b) => b.pixels - a.pixels);
  const bestStream = candidateStreams[0] || {
    streamIdx: 0,
    width: 1920,
    height: 1080,
    codec: 'h264',
    fps: '30.000',
  };

  let thumbDataUrl = null;
  try {
    await ffmpegInstance.exec([
      '-ss', '00:00:00.100',
      '-i', inputName,
      '-map', `0:${bestStream.streamIdx}`,
      '-frames:v', '1',
      '-vf', 'scale=480:-2',
      '-update', '1',
      '-q:v', '3',
      thumbName
    ]);

    const thumbData = await ffmpegInstance.readFile(thumbName);
    const thumbBlob = new Blob([thumbData.buffer], { type: 'image/jpeg' });
    thumbDataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(thumbBlob);
    });
    await ffmpegInstance.deleteFile(thumbName).catch(() => {});
  } catch (e) {
    console.warn('Capture thumbnail failed:', e);
  }

  ffmpegInstance.off('log', logHandler);
  await ffmpegInstance.deleteFile(inputName).catch(() => {});

  return {
    streamIdx: bestStream.streamIdx,
    width: bestStream.width,
    height: bestStream.height,
    duration: parsedDuration !== null ? parsedDuration : 0,
    fps: bestStream.fps,
    codec: bestStream.codec,
    thumbnail_url: thumbDataUrl,
  };
}

/**
 * ฟังก์ชันย่อขนาดวิดีโอด้วย Hardware Decoder/Encoder ของเครื่องโดยตรง
 */
async function fastHardwareTranscode(sourceBlob, targetHeight, targetBitrateBps) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(sourceBlob);
    video.muted = true;
    video.playsInline = true;

    video.onloadedmetadata = () => {
      const scale = targetHeight / video.videoHeight;
      const targetWidth = makeEven(video.videoWidth * scale);

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d', { alpha: false });

      const stream = canvas.captureStream(30);

      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const audioSource = audioCtx.createMediaElementSource(video);
        const audioDest = audioCtx.createMediaStreamDestination();
        audioSource.connect(audioDest);
        if (audioDest.stream.getAudioTracks().length > 0) {
          stream.addTrack(audioDest.stream.getAudioTracks()[0]);
        }
      } catch (_) {}

      let mimeType = 'video/webm;codecs=h264';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/mp4;codecs=avc1';
      }
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = 'video/webm';
      }

      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: targetBitrateBps,
      });

      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        URL.revokeObjectURL(video.src);
        const outputBlob = new Blob(chunks, { type: mimeType });
        resolve(outputBlob);
      };

      recorder.onerror = (e) => {
        URL.revokeObjectURL(video.src);
        reject(e);
      };

      let animId;
      const drawFrame = () => {
        if (video.paused || video.ended) return;
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
        animId = requestAnimationFrame(drawFrame);
      };

      video.onplay = () => {
        recorder.start(1000);
        drawFrame();
      };

      video.onended = () => {
        cancelAnimationFrame(animId);
        recorder.stop();
      };

      video.onerror = (e) => {
        cancelAnimationFrame(animId);
        URL.revokeObjectURL(video.src);
        reject(e);
      };

      video.playbackRate = 1.0;
      video.play().catch(reject);
    };

    video.onerror = reject;
  });
}

function generateDynamicLadder(sourceHeight, isH264) {
  const levels = [];

  if (isH264) {
    levels.push({
      label: `${sourceHeight}p_original`,
      height: sourceHeight,
      isOriginalCopy: true,
      bandwidth: sourceHeight >= 2160 ? 18000000 : 7500000,
    });
  }

  const CANDIDATES = [
    { targetH: 1080, bitrate: 6000000, bandwidth: 6000000 },
    { targetH: 720,  bitrate: 3000000, bandwidth: 3000000 },
    { targetH: 480,  bitrate: 1500000, bandwidth: 1500000 },
  ];

  for (const item of CANDIDATES) {
    if (sourceHeight >= item.targetH && levels.length < 3) {
      levels.push({
        label: `${item.targetH}p`,
        height: item.targetH,
        isOriginalCopy: false,
        bitrate: item.bitrate,
        bandwidth: item.bandwidth,
      });
    }
  }

  if (levels.length === 0) {
    levels.push({
      label: `${sourceHeight}p`,
      height: sourceHeight,
      isOriginalCopy: false,
      bitrate: 1500000,
      bandwidth: 1500000,
    });
  }

  return levels;
}

/**
 * หั่นวิดีโอเป็น HLS ABR (Hybrid Pipeline: ฮาร์ดแวร์บีบอัด + FFmpeg Mux เร็ว ไม่ติด OOM)
 */
export async function transcodeToHls(fileData, originalFileName, onProgress) {
  const ffmpegInstance = await loadFFmpeg();

  const ext = getFileExtension(originalFileName || 'input.mp4');
  let dataToWrite;
  if (fileData instanceof Blob) {
    dataToWrite = new Uint8Array(await fileData.arrayBuffer());
  } else if (fileData instanceof ArrayBuffer) {
    dataToWrite = new Uint8Array(fileData.slice(0));
  } else if (fileData instanceof Uint8Array) {
    dataToWrite = new Uint8Array(fileData.buffer.slice(0));
  } else {
    dataToWrite = new Uint8Array(fileData);
  }

  const sourceBlob = new Blob([dataToWrite.buffer.slice(0)], { type: `video/${ext}` });
  const probeData = await probeVideoWithFFmpeg(sourceBlob);
  const isH264 = probeData.codec === 'h264' || probeData.codec === 'avc1';
  const targetLevels = generateDynamicLadder(probeData.height, isH264);

  try {
    const oldFiles = await ffmpegInstance.listDir('.');
    for (const f of oldFiles) {
      if (f.name !== '.' && f.name !== '..') {
        await ffmpegInstance.deleteFile(f.name).catch(() => {});
      }
    }
  } catch (_) {}

  const allHlsFiles = [];
  const masterRenditions = [];

  for (let i = 0; i < targetLevels.length; i++) {
    const level = targetLevels[i];
    const playlistName = `${level.label}_playlist.m3u8`;
    const segmentPattern = `${level.label}_segment_%03d.ts`;
    const tempInputName = `temp_${level.label}_${Date.now()}.${ext}`;

    if (onProgress) {
      onProgress(Math.round((i / targetLevels.length) * 100));
    }

    if (level.isOriginalCopy) {
      await ffmpegInstance.writeFile(tempInputName, dataToWrite);
      await ffmpegInstance.exec([
        '-i', tempInputName,
        '-map', `0:${probeData.streamIdx}`,
        '-map', '0:a?',
        '-c', 'copy',
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_list_size', '0',
        '-hls_segment_type', 'mpegts',
        '-hls_flags', 'split_by_time',
        '-hls_segment_filename', segmentPattern,
        playlistName,
      ]);
    } else {
      let compressedBlob;
      try {
        compressedBlob = await fastHardwareTranscode(sourceBlob, level.height, level.bitrate);
      } catch (err) {
        console.warn('Hardware fallback to fast stream copy:', err);
        compressedBlob = sourceBlob;
      }

      const compressedBytes = new Uint8Array(await compressedBlob.arrayBuffer());
      await ffmpegInstance.writeFile(tempInputName, compressedBytes);

      await ffmpegInstance.exec([
        '-i', tempInputName,
        '-c', 'copy',
        '-f', 'hls',
        '-hls_time', '6',
        '-hls_list_size', '0',
        '-hls_segment_type', 'mpegts',
        '-hls_flags', 'split_by_time',
        '-hls_segment_filename', segmentPattern,
        playlistName,
      ]);
    }

    const currentFiles = await ffmpegInstance.listDir('.');
    let segmentCount = 0;
    for (const f of currentFiles) {
      if (f.name === playlistName || (f.name.startsWith(`${level.label}_`) && f.name.endsWith('.ts'))) {
        segmentCount++;
        const data = await ffmpegInstance.readFile(f.name);
        const mimeType = f.name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
        const blob = new Blob([data.buffer], { type: mimeType });

        allHlsFiles.push({
          name: f.name,
          blob,
          size: blob.size,
          level: level.label,
        });

        await ffmpegInstance.deleteFile(f.name).catch(() => {});
      }
    }

    await ffmpegInstance.deleteFile(tempInputName).catch(() => {});

    if (segmentCount > 0) {
      const calculatedWidth = makeEven(probeData.width * (level.height / probeData.height));
      masterRenditions.push({
        playlistName,
        bandwidth: level.bandwidth,
        resolution: `${calculatedWidth}x${level.height}`,
      });
    }
  }

  if (allHlsFiles.length === 0) {
    throw new Error('ไม่สามารถสร้างไฟล์ HLS ได้');
  }

  let masterContent = '#EXTM3U\n#EXT-X-VERSION:3\n';
  for (const r of masterRenditions) {
    masterContent += `#EXT-X-STREAM-INF:BANDWIDTH=${r.bandwidth},RESOLUTION=${r.resolution}\n`;
    masterContent += `${r.playlistName}\n`;
  }

  const masterBlob = new Blob([masterContent], { type: 'application/vnd.apple.mpegurl' });
  allHlsFiles.unshift({
    name: 'master.m3u8',
    blob: masterBlob,
    size: masterBlob.size,
    isMaster: true,
  });

  if (onProgress) onProgress(100);
  return {
    files: allHlsFiles,
    probeData,
  };
}

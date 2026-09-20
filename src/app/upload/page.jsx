'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Upload, Film, CheckCircle2, AlertCircle, RefreshCw,
  Play, HardDrive, Folder, Clock, ChevronDown, ChevronUp,
  Copy, Check, FileVideo, ListOrdered, ArrowRight, RotateCcw,
  Sliders, Database, Terminal, Trash2, XCircle
} from 'lucide-react';
import { extractVideoMetadata } from '@/lib/uploader';

const STAGES = [
  { id: 'UPLOADING', label: '1. ส่งเข้า OneDrive' },
  { id: 'QUEUED', label: '2. เข้าคิวประมวลผล' },
  { id: 'PROCESSING', label: '3. ดึงไฟล์ & เตรียมระบบ' },
  { id: 'TRANSCODING', label: '4. หั่น HLS Multi-bitrate' },
  { id: 'READY', label: '5. พร้อมรับชม' },
];

function formatDuration(sec) {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function calculateAspectRatio(w, h) {
  if (!w || !h) return '16:9';
  const gcd = (a, b) => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(w, h);
  const rw = w / divisor;
  const rh = h / divisor;
  if (Math.abs(rw / rh - 16 / 9) < 0.05) return '16:9 Widescreen';
  if (Math.abs(rw / rh - 4 / 3) < 0.05) return '4:3 Standard';
  if (Math.abs(rw / rh - 9 / 16) < 0.05) return '9:16 Vertical';
  return `${rw}:${rh}`;
}

export default function UploadPage() {
  const fileInputRef = useRef(null);
  const fileRef = useRef(null);
  const titleRef = useRef('');
  const descriptionRef = useRef('');
  const logEndRef = useRef(null);
  const pollingTimerRef = useRef(null);

  // Tab: 'upload' or 'queue'
  const [activeTab, setActiveTab] = useState('upload');

  // File & Detailed Metadata
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('HLS, stream');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [fileDetails, setFileDetails] = useState({
    name: '',
    sizeFormatted: '0 MB',
    sizeBytes: 0,
    width: 0,
    height: 0,
    resolution: '',
    aspectRatio: '',
    durationSec: 0,
    durationFormatted: '0:00',
    approxBitrate: '0 Mbps',
    fps: 30,
    codec: 'h264',
    mimeType: 'video/mp4',
    lastModified: '',
  });

  // Chunk Size Configuration (No throttling, maximum speed)
  // 320 KiB multiples: 10MB = 10,485,760 bytes, 20MB = 20,971,520 bytes, 50MB = 52,428,800 bytes
  const [chunkSizeMB, setChunkSizeMB] = useState(10);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tubelock_chunk_size');
        if (saved) {
          const num = parseInt(saved, 10);
          if ([10, 20, 50].includes(num)) {
            setChunkSizeMB(num);
          }
        }
      } catch (_) {}
    }
  }, []);

  const handleSelectChunkSize = (size) => {
    setChunkSizeMB(size);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('tubelock_chunk_size', String(size));
      } catch (_) {}
    }
  };

  // Upload Progress & Stats (Client -> OneDrive)
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStats, setUploadStats] = useState({
    percent: 0,
    uploadedBytes: 0,
    totalBytes: 0,
    speedMBs: '0.0',
    etaSeconds: 0,
    currentChunk: 0,
    totalChunks: 0,
  });

  // Active Transcoding State
  const [activeVideoId, setActiveVideoId] = useState(null);
  const [rawFileName, setRawFileName] = useState('');
  const [currentStatus, setCurrentStatus] = useState(null);
  const [transcodeProgress, setTranscodeProgress] = useState(0);
  const [stageDetail, setStageDetail] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const [completedVideo, setCompletedVideo] = useState(null);

  // Queue Data
  const [queueItems, setQueueItems] = useState([]);
  const [loadingQueue, setLoadingQueue] = useState(false);

  // Logs
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [copiedLog, setCopiedLog] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString('th-TH');
    setLogs((prev) => [...prev, `[${time}] ${msg}`]);
  };

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Handle File Selection
  const handleFile = async (selectedFile) => {
    if (!selectedFile) return;
    setErrorMsg(null);
    setCompletedVideo(null);
    setCurrentStatus(null);
    setTranscodeProgress(0);

    const cleanBaseName = selectedFile.name.replace(/\.[^/.]+$/, '');
    setTitle(cleanBaseName);
    titleRef.current = cleanBaseName;
    const defaultDesc = `สตรีมมิ่งผ่าน HLS Multi-bitrate (Serverless HLS Engine)`;
    setDescription(defaultDesc);
    descriptionRef.current = defaultDesc;

    const sizeFormatted = formatBytes(selectedFile.size);
    const lastModifiedDate = selectedFile.lastModified
      ? new Date(selectedFile.lastModified).toLocaleDateString('th-TH', {
          year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
        })
      : '-';

    addLog(`เลือกไฟล์: "${selectedFile.name}" (${sizeFormatted})`);

    // Instant default fallback: never block user from uploading on mobile
    const detectedMime = selectedFile.type || (
      selectedFile.name.toLowerCase().endsWith('.mov') ? 'video/quicktime' :
      selectedFile.name.toLowerCase().endsWith('.mkv') ? 'video/x-matroska' : 'video/mp4'
    );

    setFileDetails({
      name: selectedFile.name,
      sizeFormatted,
      sizeBytes: selectedFile.size,
      width: 0,
      height: 0,
      resolution: 'Original / Auto',
      aspectRatio: 'Auto',
      durationSec: 0,
      durationFormatted: '0:00',
      approxBitrate: 'คำนวณตอน Transcode',
      fps: 30,
      codec: 'Source / H.264',
      mimeType: detectedMime,
      lastModified: lastModifiedDate,
    });

    const isMobile = typeof navigator !== 'undefined' && (
      /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
      (Boolean(navigator.maxTouchPoints && navigator.maxTouchPoints > 1) && /Macintosh/i.test(navigator.userAgent))
    );
    const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

    // In-Memory Clone Workaround for Android SAF Permission Revocation:
    // บน Android Content URI จะถูกเพิกถอนสิทธิ์ทันทีหากปล่อยให้มี Async Delay (เช่น รอ fetch API)
    // ดังนั้นเราต้องดึง ArrayBuffer เข้า RAM ทันทีตั้งแต่ใน User Event Tick ก่อนที่จะมี Network Delay ใดๆ
    let activeFile = selectedFile;
    if (isAndroid && selectedFile.size <= 250 * 1024 * 1024) {
      try {
        addLog(`กำลังอ่านไฟล์เข้า Memory Cache ทันที เพื่อป้องกัน Android SAF Revoke (${sizeFormatted})...`);
        const buffer = await selectedFile.arrayBuffer();
        activeFile = new File([buffer], selectedFile.name, {
          type: detectedMime,
          lastModified: selectedFile.lastModified || Date.now(),
        });
        addLog(`โหลดไฟล์เข้าหน่วยความจำสำเร็จ ปลดล็อกสิทธิ์ Android เรียบร้อย`);
      } catch (readErr) {
        console.error("In-memory clone error:", readErr);
        if (readErr?.name === 'NotReadableError' || String(readErr).includes('NotReadableError')) {
          const msg = 'ไม่สามารถเข้าถึงข้อมูลไฟล์นี้ได้ เนื่องจากไฟล์ถูกเก็บไว้บน Cloud (เช่น Google Photos หรือ Google Drive) ที่ยังไม่ได้ดาวน์โหลดลงตัวเครื่องจริง กรุณาเลือกไฟล์ที่บันทึกอยู่ในเครื่องโดยตรง (เช่น จากโฟลเดอร์ "ดาวน์โหลด" หรือเปิด Google Photos แล้วกด "ดาวน์โหลด" ลงเครื่องก่อน)';
          setErrorMsg(msg);
          addLog(`❌ ${msg}`);
          return;
        }
        addLog(`คำเตือน: โคลนเข้าหน่วยความจำไม่สำเร็จ (${readErr.message}) จะใช้สตรีมไฟล์โดยตรง`);
      }
    }

    fileRef.current = activeFile;
    setFile(activeFile);

    if (isMobile) {
      addLog(`โหมด Mobile Direct Stream: เริ่มส่งไฟล์เข้า OneDrive ทันที`);
      handleStartPipeline(activeFile);
      return;
    }

    try {
      const meta = await extractVideoMetadata(selectedFile);
      const dur = Math.round(meta.duration || 0);
      const w = meta.width || 0;
      const h = meta.height || 0;
      const resLabel = (w && h)
        ? (meta.resolution || (h >= 2160 ? '4K UHD' : h >= 1080 ? '1080p FHD' : h >= 720 ? '720p HD' : '480p SD'))
        : 'Original / Auto';
      const bitrateNum = dur > 0 ? ((selectedFile.size * 8) / dur / 1000000).toFixed(2) : '0';

      setFileDetails({
        name: selectedFile.name,
        sizeFormatted,
        sizeBytes: selectedFile.size,
        width: w,
        height: h,
        resolution: (w && h) ? `${w} x ${h} (${resLabel})` : 'Original / Auto',
        aspectRatio: (w && h) ? calculateAspectRatio(w, h) : 'Auto',
        durationSec: dur,
        durationFormatted: formatDuration(dur),
        approxBitrate: dur > 0 ? `${bitrateNum} Mbps` : 'คำนวณตอน Transcode',
        fps: meta.fps || 30,
        codec: 'AVC1 / H.264 / Source',
        mimeType: detectedMime,
        lastModified: lastModifiedDate,
      });

      if (meta.thumbnailDataUrl) {
        setThumbnailUrl(meta.thumbnailDataUrl);
      }

      if (w && h) {
        addLog(`วิเคราะห์ข้อมูลวิดีโอ: ${w}x${h} [${resLabel}], ความยาว ${formatDuration(dur)}`);
      }
    } catch {
      addLog(`เข้าสู่โหมดอัปโหลดทันที (การวิเคราะห์สเปกวิดีโอจะทำบน Cloud ตอน Transcode)`);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handleFile(dropped);
  };

  const handleReset = () => {
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    fileRef.current = null;
    titleRef.current = '';
    descriptionRef.current = '';
    setFile(null);
    setTitle('');
    setDescription('');
    setThumbnailUrl('');
    setIsUploading(false);
    setActiveVideoId(null);
    setRawFileName('');
    setCurrentStatus(null);
    setTranscodeProgress(0);
    setStageDetail('');
    setErrorMsg(null);
    setCompletedVideo(null);
    setLogs([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Status Poller
  const startPollingStatus = useCallback((videoId) => {
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);

    pollingTimerRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/videos/${videoId}/status`);
        if (!res.ok) return;

        const data = await res.json();
        if (!data.success || !data.video) return;

        const vid = data.video;
        setCurrentStatus(vid.status);
        setTranscodeProgress(vid.transcodeProgress || 0);
        setStageDetail(vid.stageDetail || '');

        // 🌟 If worker captured the thumbnail, display it immediately!
        if (vid.thumbnailUrl) {
          setThumbnailUrl(vid.thumbnailUrl);
        }

        // 🌟 If worker extracted metadata with ffprobe, update file details!
        if (vid.duration || vid.resolution) {
          setFileDetails((prev) => ({
            ...prev,
            durationSec: vid.duration || prev.durationSec,
            durationFormatted: vid.duration ? formatDuration(vid.duration) : prev.durationFormatted,
            resolution: vid.resolution || prev.resolution,
            fps: vid.fps || prev.fps,
            codec: vid.codec || prev.codec,
          }));
        }

        if (vid.status === 'READY') {
          // Keep polling until 100% complete if it's still doing background passes, or stop when 100
          setCompletedVideo(vid);
          if (vid.transcodeProgress >= 100) {
            clearInterval(pollingTimerRef.current);
            addLog(`🎉 การแปลงวิดีโอ "${vid.title}" เสร็จสมบูรณ์ครบทุกความละเอียด 100%!`);
          }
        } else if (vid.status === 'FAILED') {
          clearInterval(pollingTimerRef.current);
          setErrorMsg(vid.errorMessage || 'การประมวลผลล้มเหลวใน GitHub Actions');
          addLog(`❌ การแปลงไฟล์ล้มเหลว: ${vid.errorMessage || 'ไม่ทราบสาเหตุ'}`);
        }
      } catch (err) {
        console.warn('Status poll error:', err.message);
      }
    }, 3000);
  }, []);

  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, []);

  // Fetch Queue Data
  const loadQueue = useCallback(async () => {
    try {
      setLoadingQueue(true);
      const res = await fetch('/api/videos/queue');
      if (res.ok) {
        const data = await res.json();
        setQueueItems(data.queue || []);
      }
    } catch (err) {
      console.warn('Load queue error:', err);
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'queue') {
      loadQueue();
      const interval = setInterval(loadQueue, 4000);
      return () => clearInterval(interval);
    }
  }, [activeTab, loadQueue]);

  // Start Pipeline: Direct Full-Speed Upload to OneDrive
  const handleStartPipeline = async (overrideFile = null) => {
    // 1. Guard against React SyntheticEvent when invoked via onClick
    const candidateFile = (overrideFile && (overrideFile instanceof Blob || overrideFile instanceof File))
      ? overrideFile
      : null;
    const activeFile = candidateFile || fileRef.current || file;
    if (!activeFile || isUploading) return;

    const resolvedFileName = activeFile.name || fileDetails.name || `video_${Date.now()}.mp4`;

    setIsUploading(true);
    setErrorMsg(null);
    setCompletedVideo(null);
    setCurrentStatus('UPLOADING');
    setTranscodeProgress(0);
    setStageDetail('กำลังสร้าง Upload Session กับ Microsoft Graph API...');
    addLog(`เริ่มต้น: ขอ Direct Upload Session เข้า OneDrive Business (/raw/) สำหรับ "${resolvedFileName}"`);

    try {
      const activeTitle = (titleRef.current || title || '').trim() || resolvedFileName.replace(/\.[^/.]+$/, '');
      const activeDesc = (descriptionRef.current || description || '').trim();

      // 1. Session Request
      const sessionRes = await fetch('/api/upload/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: resolvedFileName,
          title: activeTitle,
          description: activeDesc,
          fileSize: activeFile.size || 0,
        }),
      });

      if (!sessionRes.ok) {
        const errJson = await sessionRes.json().catch(() => ({}));
        const detailedMsg = errJson.error || errJson.details || `HTTP ${sessionRes.status}: ไม่สามารถขอ Direct Upload Session จากระบบได้`;
        throw new Error(`[OneDrive Session Error] ${detailedMsg}`);
      }

      const sessionData = await sessionRes.json();
      const { uploadUrl, videoId, rawFileName: serverRawName } = sessionData;

      setActiveVideoId(videoId);
      setRawFileName(serverRawName);
      addLog(`ได้รับ Upload URL (Video ID: #${videoId})`);
      addLog(`เริ่มส่งไฟล์ตรงเข้า OneDrive /raw/${serverRawName} (ขนาดก้อน ${chunkSizeMB} MB ไม่อั้นสปีด)...`);

      // 2. Direct Chunked Upload (Aligned to 320 KiB boundary)
      const isMobile = typeof navigator !== 'undefined' && (
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints && navigator.maxTouchPoints > 1)
      );

      // บังคับใช้ Chunk Size ขนาดปลอดภัยสำหรับ Mobile (หรือขนาดไฟล์ต่ำกว่า 200MB) ไม่เกิน 10 MB เพื่อไม่ให้หน่วยความจำในมือถือล้น
      const activeChunkSizeMB = (isMobile || activeFile.size < 200 * 1024 * 1024)
        ? Math.min(chunkSizeMB, 10)
        : chunkSizeMB;

      const CHUNK_SIZE = activeChunkSizeMB === 50
        ? 160 * 327680 // 52,428,800 bytes (50 MiB, exactly 160 x 320 KiB)
        : activeChunkSizeMB === 20
        ? 64 * 327680  // 20,971,520 bytes (20 MiB, exactly 64 x 320 KiB)
        : 32 * 327680; // 10,485,760 bytes (10 MiB, exactly 32 x 320 KiB)

      const totalSize = activeFile.size;
      const totalChunks = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE));
      let start = 0;
      let chunkIndex = 0;
      const uploadStartTime = Date.now();

      while (start < totalSize) {
        // ตัด Chunk (Slicing) ตามมาตรฐาน Microsoft Graph API:
        // end = Math.min(start + CHUNK_SIZE, activeFile.size) - 1
        // chunkBlob = activeFile.slice(start, end + 1)
        const end = Math.min(start + CHUNK_SIZE, totalSize) - 1;

        let chunkBuffer;
        try {
          const chunkBlob = activeFile.slice(start, end + 1);
          // แปลง Blob เป็น ArrayBuffer เสมอก่อนส่งเข้า XHR เพื่อให้อ่าน byte ตรงเข้า RAM และปลดล็อก Android ContentProvider stream
          chunkBuffer = await chunkBlob.arrayBuffer();
        } catch (err) {
          console.error("Chunk read error:", err);
          throw new Error(`ไม่สามารถอ่านข้อมูลไบนารีจากอุปกรณ์ได้ (Android SAF/NotReadableError): ${err?.message || err}`);
        }

        const rangeHeader = `bytes ${start}-${end}/${totalSize}`;

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', uploadUrl, true);
          // ปิด credentials เพื่อป้องกัน CORS Preflight ล้มเหลว Status 0
          xhr.withCredentials = false;
          // ล้าง headers: กำหนดเฉพาะ Content-Range เท่านั้น (ห้ามใส่ Authorization หรือ headers อื่น)
          xhr.setRequestHeader('Content-Range', rangeHeader);

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const currentTotal = start + e.loaded;
              const pct = Math.min(100, Math.round((currentTotal / totalSize) * 100));
              const elapsedSec = Math.max(0.1, (Date.now() - uploadStartTime) / 1000);
              const speedBytesPerSec = currentTotal / elapsedSec;
              const speedMBs = (speedBytesPerSec / (1024 * 1024)).toFixed(1);
              const remainingBytes = Math.max(0, totalSize - currentTotal);
              const etaSeconds = speedBytesPerSec > 0 ? Math.round(remainingBytes / speedBytesPerSec) : 0;

              setUploadStats({
                percent: pct,
                uploadedBytes: currentTotal,
                totalBytes: totalSize,
                speedMBs,
                etaSeconds,
                currentChunk: chunkIndex + 1,
                totalChunks,
              });

              setTranscodeProgress(Math.round(pct * 0.2)); // 0-20%
              setStageDetail(`กำลังส่งเข้า OneDrive: ${pct}% (${formatBytes(currentTotal)} / ${formatBytes(totalSize)} • ${speedMBs} MB/s)`);
            }
          };

          xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 201 || xhr.status === 202) {
              resolve();
            } else {
              let graphError = xhr.responseText || xhr.statusText;
              try {
                const parsed = JSON.parse(xhr.responseText);
                if (parsed.error?.message) graphError = parsed.error.message;
              } catch (_) {}
              console.error('[OneDrive PUT Error Response]', { status: xhr.status, response: graphError, range: rangeHeader });
              reject(new Error(`Microsoft Graph ส่งคืนสถานะ (${xhr.status}): ${graphError}`));
            }
          };

          xhr.onerror = (e) => {
            console.error('[OneDrive PUT CORS/Network Error]', {
              status: xhr.status,
              statusText: xhr.statusText,
              uploadUrl,
              rangeHeader,
              chunkBytes: chunkBuffer.byteLength,
              event: e,
            });
            reject(new Error(`การเชื่อมต่อกับ OneDrive ขัดข้อง (Status: ${xhr.status || 0} CORS/Network Aborted) ขณะส่งก้อนที่ ${chunkIndex + 1}/${totalChunks} (Range: ${rangeHeader})`));
          };

          xhr.ontimeout = () => {
            reject(new Error(`หมดเวลาเชื่อมต่อกับ OneDrive ในก้อนที่ ${chunkIndex + 1}/${totalChunks} (Timeout 3 นาที)`));
          };

          xhr.timeout = 180000;
          xhr.send(chunkBuffer);
        });

        start = end + 1;
        chunkIndex++;
      }

      addLog(`อัปโหลดไฟล์เข้า OneDrive Business 100% ครบถ้วน!`);
      setIsUploading(false);
      setCurrentStatus('QUEUED');
      setStageDetail('กำลังส่ง Webhook สั่งรัน GitHub Actions Transcoder...');
      addLog(`เรียก POST /api/upload/complete เพื่อ Trigger GitHub Actions...`);

      // 3. Trigger Complete & Dispatch with latest edited title & description
      const finalTitle = (titleRef.current || title || '').trim() || resolvedFileName.replace(/\.[^/.]+$/, '');
      const finalDesc = (descriptionRef.current || description || '').trim();

      const completeRes = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          rawFileName: serverRawName,
          title: finalTitle,
          description: finalDesc,
          clientMeta: {
            duration: fileDetails.durationSec,
            resolution: fileDetails.resolution,
            fps: fileDetails.fps,
            codec: fileDetails.codec,
            // รอให้ GitHub Actions สร้าง poster.jpg และอัปเดตลง DB ตามที่ผู้ใช้ระบุ ไม่ส่ง base64 ขนาดใหญ่
            thumbnailDataUrl: (thumbnailUrl && !thumbnailUrl.startsWith('data:')) ? thumbnailUrl : '',
          },
        }),
      });

      const completeData = await completeRes.json();
      if (!completeRes.ok && !completeData.warning) {
        throw new Error(completeData.error || 'ส่งคำสั่งรัน GitHub Actions ไม่สำเร็จ');
      }

      if (completeData.warning) {
        addLog(`แจ้งเตือน: ${completeData.warning}`);
        setStageDetail(completeData.warning);
      } else {
        addLog(`คำสั่งรัน GitHub Actions ถูกส่งเรียบร้อย (สถานะ: PROCESSING)`);
        setCurrentStatus('PROCESSING');
      }

      // 4. Start Polling
      startPollingStatus(videoId);

    } catch (err) {
      setIsUploading(false);
      console.error('[Upload Error]:', err);
      let userFriendlyMsg = err.message || 'เกิดข้อผิดพลาดในการอัปโหลดหรือแปลงไฟล์';
      if (err?.name === 'NotReadableError' || String(err).includes('NotReadableError')) {
        userFriendlyMsg = 'ไม่สามารถเข้าถึงไฟล์ได้เนื่องจากสิทธิ์ของ Android (ไฟล์อาจอยู่บน Google Photos/Drive ที่ยังไม่ได้ดาวน์โหลดลงเครื่องจริง) กรุณาเลือกไฟล์ที่บันทึกอยู่ในเครื่องโดยตรง หรือเปิด Google Photos แล้วกดดาวน์โหลดลงเครื่องก่อนครับ';
      }
      setErrorMsg(userFriendlyMsg);
      setCurrentStatus('FAILED');
      setStageDetail(userFriendlyMsg);
      addLog(`ข้อผิดพลาด: ${userFriendlyMsg}`);
    }
  };

  // Retry Trigger
  const handleRetryTrigger = async (vidId, rFileName, vidTitle) => {
    if (!vidId) {
      addLog(`ยังไม่มี Video ID ในระบบ กำลังเริ่มต้นอัปโหลดใหม่ตั้งแต่ขั้นตอนแรก...`);
      handleStartPipeline();
      return;
    }

    try {
      addLog(`สั่งรัน GitHub Actions ใหม่สำหรับ Video #${vidId}...`);
      setErrorMsg(null);
      setCurrentStatus('QUEUED');
      setStageDetail('กำลังส่งคำสั่งเข้า GitHub Actions ใหม่...');

      const res = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: vidId,
          rawFileName: rFileName,
          title: vidTitle,
          clientMeta: {
            duration: fileDetails.durationSec,
            resolution: fileDetails.resolution,
            fps: fileDetails.fps,
            codec: fileDetails.codec,
            thumbnailDataUrl: (thumbnailUrl && !thumbnailUrl.startsWith('data:')) ? thumbnailUrl : '',
          },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'สั่งรันใหม่ไม่สำเร็จ');

      addLog(`ส่งคำสั่งสำเร็จ เริ่มติดตามสถานะแบบ Real-time`);
      startPollingStatus(vidId);
      if (activeTab === 'queue') loadQueue();
    } catch (err) {
      setErrorMsg(err.message);
      addLog(`ลองใหม่ไม่สำเร็จ: ${err.message}`);
    }
  };

  // Delete queue item permanently from DB and OneDrive
  const handleDeleteQueueItem = async (id, itemTitle) => {
    if (!confirm(`ต้องการยกเลิกและลบคิว "${itemTitle || '#' + id}" ออกจากระบบถาวรใช่หรือไม่?`)) return;

    // Optimistically remove from state immediately (Zero Cache!)
    setQueueItems((prev) => prev.filter((item) => item.id !== id));
    addLog(`ลบคิว #${id} ออกจากระบบ...`);

    try {
      const res = await fetch(`/api/videos/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        addLog(`ลบคิว #${id} สำเร็จเรียบร้อย`);
      } else {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'ลบคิวไม่สำเร็จ');
      }
    } catch (err) {
      addLog(`ข้อผิดพลาดในการลบคิว: ${err.message}`);
    } finally {
      loadQueue();
    }
  };

  // Clear all failed queue items
  const handleClearAllFailed = async () => {
    const failedItems = queueItems.filter((i) => i.status === 'FAILED');
    if (failedItems.length === 0) return;
    if (!confirm(`ต้องการลบคิวที่ล้มเหลวทั้งหมด (${failedItems.length} รายการ) หรือไม่?`)) return;

    setQueueItems((prev) => prev.filter((item) => item.status !== 'FAILED'));
    for (const item of failedItems) {
      try {
        await fetch(`/api/videos/${item.id}`, { method: 'DELETE' });
      } catch (_) {}
    }
    loadQueue();
  };

  const copyLogText = () => {
    navigator.clipboard.writeText(logs.join('\n'));
    setCopiedLog(true);
    setTimeout(() => setCopiedLog(false), 2000);
  };

  const copyWatchLink = (vidId) => {
    const url = `${window.location.origin}/watch/${vidId}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const getStepState = (stepId) => {
    const order = ['UPLOADING', 'QUEUED', 'PROCESSING', 'TRANSCODING', 'READY'];
    const currentIndex = order.indexOf(currentStatus);
    const stepIndex = order.indexOf(stepId);

    if (currentStatus === 'READY') return 'completed';
    if (currentStatus === 'FAILED' && stepIndex === currentIndex) return 'failed';
    if (stepIndex < currentIndex) return 'completed';
    if (stepIndex === currentIndex) return 'active';
    return 'pending';
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 select-none pb-36 sm:pb-24">
      {/* Top Bar Navigation */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#EFECE6] mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#212529] tracking-tight flex items-center gap-2.5">
            <Upload className="w-5 h-5 text-[#FF7A00]" />
            จัดการการอัปโหลดและแปลงไฟล์ (Studio Uploader)
          </h1>
          <p className="text-xs text-[#8C857B] mt-0.5">
            สถาปัตยกรรม Direct OneDrive Upload + GitHub Actions Progressive Multi-bitrate HLS
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center p-1 bg-[#F5F2EB] rounded-xl border border-[#EFECE6] w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`flex-1 sm:flex-none py-1.5 px-4 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-2 ${
              activeTab === 'upload'
                ? 'bg-white text-[#212529] shadow-xs'
                : 'text-[#8C857B] hover:text-[#212529]'
            }`}
          >
            <Upload className="w-3.5 h-3.5 text-[#FF7A00]" />
            <span>อัปโหลดคลิปใหม่</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`flex-1 sm:flex-none py-1.5 px-4 rounded-lg text-xs font-semibold transition flex items-center justify-center gap-2 ${
              activeTab === 'queue'
                ? 'bg-white text-[#212529] shadow-xs'
                : 'text-[#8C857B] hover:text-[#212529]'
            }`}
          >
            <ListOrdered className="w-3.5 h-3.5 text-blue-600" />
            <span>คิวงานแปลงไฟล์</span>
            {queueItems.length > 0 && (
              <span className="w-4 h-4 rounded-full bg-[#FF7A00] text-white text-[10px] font-mono flex items-center justify-center">
                {queueItems.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {activeTab === 'upload' ? (
        <div className="flex flex-col gap-6">
          {/* File Dropzone when no file selected */}
          {!file && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-12 sm:p-16 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                isDragOver
                  ? 'border-[#FF7A00] bg-orange-50/40'
                  : 'border-[#D1C9BD] hover:border-[#FF7A00] bg-white'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
                className="hidden"
              />

              <div className="w-14 h-14 rounded-2xl bg-orange-50 text-[#FF7A00] flex items-center justify-center mb-3">
                <Upload className="w-7 h-7" />
              </div>

              <h2 className="text-base font-bold text-[#212529]">
                ลากไฟล์วิดีโอมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์ (คอมพิวเตอร์และมือถือ)
              </h2>
              <p className="text-xs text-[#8C857B] mt-1 max-w-md">
                รองรับไฟล์ .mp4, .mov, .mkv และวิดีโอจากมือถือทุกรูปแบบ (iOS / Android) ระบบจะส่งตรงเข้า OneDrive Business ด้วยความเร็วอินเทอร์เน็ตเต็มสปีด
              </p>
              <div className="mt-3 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200/80 text-[11px] text-amber-900 flex items-center gap-1.5 max-w-md text-left">
                <span>💡 <strong>คำแนะนำสำหรับ Android:</strong> แนะนำให้เลือกไฟล์ที่บันทึกอยู่ในเครื่องโดยตรง (เช่น ในโฟลเดอร์ &quot;ดาวน์โหลด&quot; หรือแกลเลอรีในเครื่อง) หากไฟล์อยู่ใน Google Photos หรือ Cloud Drive ให้กดดาวน์โหลดลงเครื่องก่อนครับ</span>
              </div>
            </div>
          )}

          {/* 2-Column Desktop Grid Layout when file is selected */}
          {file && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* LEFT COLUMN: Main Form & Execution (8 Cols) */}
              <div className="lg:col-span-8 flex flex-col gap-5">
                {/* Error Banner */}
                {errorMsg && (
                  <div className="bg-rose-50 border border-rose-200 rounded-2xl p-4 flex items-start gap-3 shadow-xs">
                    <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                    <div className="flex-1 text-xs">
                      <h4 className="font-bold text-rose-900">เกิดข้อผิดพลาดในการเข้าถึงไฟล์</h4>
                      <p className="text-rose-700 mt-1 leading-relaxed">{errorMsg}</p>
                      <div className="mt-2.5 pt-2.5 border-t border-rose-200 text-[11px] text-rose-800 flex flex-col gap-1">
                        <span className="font-semibold">💡 วิธีแก้ไขสำหรับมือถือ Android:</span>
                        <span>1. เปิดแอป <strong>Google Photos</strong> หรือ <strong>Google Drive</strong></span>
                        <span>2. แตะเปิดคลิปวิดีโอที่ต้องการ &gt; กดเมนู 3 จุด &gt; เลือก <strong>&quot;ดาวน์โหลด (Download)&quot;</strong></span>
                        <span>3. กลับมาที่หน้านี้ กดปุ่ม &quot;เปลี่ยนไฟล์&quot; แล้วเลือกไฟล์จากโฟลเดอร์ <strong>&quot;ดาวน์โหลด&quot;</strong> ในเครื่อง</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setErrorMsg(null)}
                      className="text-rose-400 hover:text-rose-600 p-1 text-sm font-bold"
                    >
                      ✕
                    </button>
                  </div>
                )}
                {/* Form Card */}
                <div className="bg-white border border-[#EFECE6] rounded-2xl p-5 sm:p-6 shadow-xs flex flex-col gap-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[#EFECE6]">
                    <span className="text-xs font-bold text-[#212529] flex items-center gap-2">
                      <FileVideo className="w-4 h-4 text-[#FF7A00]" />
                      รายละเอียดวิดีโอ
                    </span>

                    <button
                      type="button"
                      onClick={handleReset}
                      disabled={isUploading}
                      className="text-xs text-rose-600 hover:text-rose-700 font-semibold px-2 py-1 rounded-lg hover:bg-rose-50 transition disabled:opacity-50"
                    >
                      เปลี่ยนไฟล์
                    </button>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#212529]">ชื่อวิดีโอ (Title)</label>
                    <input
                      type="text"
                      value={title}
                      disabled={currentStatus && currentStatus !== 'UPLOADING'}
                      onChange={(e) => {
                        setTitle(e.target.value);
                        titleRef.current = e.target.value;
                      }}
                      placeholder="ระบุชื่อวิดีโอ"
                      className="w-full bg-[#FBF9F5] border border-[#EFECE6] rounded-xl px-3.5 py-2.5 text-xs text-[#212529] outline-none focus:border-[#FF7A00] focus:bg-white transition"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#212529]">คำอธิบาย (Description)</label>
                    <textarea
                      rows={3}
                      value={description}
                      disabled={currentStatus && currentStatus !== 'UPLOADING'}
                      onChange={(e) => {
                        setDescription(e.target.value);
                        descriptionRef.current = e.target.value;
                      }}
                      placeholder="ใส่รายละเอียดหรือคำอธิบายวิดีโอ"
                      className="w-full bg-[#FBF9F5] border border-[#EFECE6] rounded-xl px-3.5 py-2.5 text-xs text-[#212529] outline-none focus:border-[#FF7A00] focus:bg-white transition"
                    />
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold text-[#212529]">แท็ก (Tags)</label>
                    <input
                      type="text"
                      value={tagsInput}
                      disabled={currentStatus && currentStatus !== 'UPLOADING'}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="คั่นด้วยเครื่องหมายจุลภาค เช่น HLS, 1080p, stream"
                      className="w-full bg-[#FBF9F5] border border-[#EFECE6] rounded-xl px-3.5 py-2 text-xs text-[#212529] outline-none focus:border-[#FF7A00] focus:bg-white transition"
                    />
                  </div>
                </div>

                {/* Live Upload Stats (No Throttling, True Internet Speed) */}
                {isUploading && (
                  <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-5 flex flex-col gap-3.5 shadow-xs">
                    <div className="flex items-center justify-between text-xs font-bold text-blue-950">
                      <span className="flex items-center gap-2">
                        <Upload className="w-4 h-4 text-blue-600 animate-pulse" />
                        กำลังส่งไฟล์เข้า OneDrive Business (ก้อนละ {chunkSizeMB} MB)
                      </span>
                      <span className="font-mono text-base">{uploadStats.percent}%</span>
                    </div>

                    <div className="w-full bg-blue-100 h-2 rounded-full overflow-hidden">
                      <div
                        className="bg-blue-600 h-full transition-all duration-300"
                        style={{ width: `${uploadStats.percent}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono text-blue-900 pt-1">
                      <div>
                        <span className="text-[#8C857B] text-[11px] block">ขนาดที่ส่งแล้ว</span>
                        <span className="font-bold">{formatBytes(uploadStats.uploadedBytes)} / {formatBytes(uploadStats.totalBytes)}</span>
                      </div>
                      <div>
                        <span className="text-[#8C857B] text-[11px] block">ความเร็วอัปโหลด</span>
                        <span className="font-bold text-emerald-700">{uploadStats.speedMBs} MB/s</span>
                      </div>
                      <div>
                        <span className="text-[#8C857B] text-[11px] block">เวลาที่เหลือ (ETA)</span>
                        <span className="font-bold">{uploadStats.etaSeconds} วินาที</span>
                      </div>
                      <div>
                        <span className="text-[#8C857B] text-[11px] block">ชิ้นส่วน</span>
                        <span className="font-bold">{uploadStats.currentChunk} / {uploadStats.totalChunks}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Real-time Lifecycle Stepper & Status */}
                {currentStatus && (
                  <div className="bg-white border border-[#EFECE6] rounded-2xl p-5 shadow-xs flex flex-col gap-4">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#212529]">
                        สถานะการประมวลผลวิดีโอบน Cloud
                      </span>
                      <span className="text-xs font-mono font-bold text-[#FF7A00]">
                        {transcodeProgress}%
                      </span>
                    </div>

                    <div className="w-full bg-[#F5F2EB] h-2 rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${
                          currentStatus === 'FAILED'
                            ? 'bg-rose-500'
                            : currentStatus === 'READY'
                            ? 'bg-emerald-500'
                            : 'bg-[#FF7A00]'
                        }`}
                        style={{ width: `${transcodeProgress}%` }}
                      />
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                      {STAGES.map((s, idx) => {
                        const state = getStepState(s.id);
                        return (
                          <div
                            key={s.id}
                            className={`p-2.5 rounded-xl border text-xs flex flex-col gap-1 transition ${
                              state === 'completed'
                                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900 font-medium'
                                : state === 'active'
                                ? 'bg-orange-50 border-orange-300 text-orange-950 font-bold ring-1 ring-orange-200'
                                : state === 'failed'
                                ? 'bg-rose-50 border-rose-300 text-rose-900 font-bold'
                                : 'bg-[#FBF9F5] border-[#EFECE6] text-[#8C857B]'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-mono opacity-70">0{idx + 1}</span>
                              {state === 'completed' ? (
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                              ) : state === 'active' ? (
                                <RefreshCw className="w-3 h-3 text-[#FF7A00] animate-spin" />
                              ) : state === 'failed' ? (
                                <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                              ) : (
                                <div className="w-1.5 h-1.5 rounded-full bg-[#D1C9BD]" />
                              )}
                            </div>
                            <span className="text-[11px] leading-tight">{s.label}</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="bg-[#FBF9F5] border border-[#EFECE6] rounded-xl px-4 py-2.5 flex items-center justify-between text-xs">
                      <span className="text-[#212529] font-medium">
                        {stageDetail || 'กำลังดำเนินการ...'}
                      </span>
                      {currentStatus === 'FAILED' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (activeVideoId && rawFileName) {
                              handleRetryTrigger(activeVideoId, rawFileName, title);
                            } else {
                              handleStartPipeline();
                            }
                          }}
                          className="flex items-center gap-1.5 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-xs transition cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>ลองใหม่อีกครั้ง</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Instant Playback Ready Card */}
                {completedVideo && (
                  <div className="bg-emerald-50 border border-emerald-300 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0">
                        <Check className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-emerald-950">
                          วิดีโอพร้อมรับชมได้แล้ว!
                        </h3>
                        <p className="text-xs text-emerald-800 mt-0.5">
                          {stageDetail || 'แปลงเป็น HLS สำเร็จ สามารถเปิดดูผ่าน HLS.js ได้ทันที'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Link
                        href={`/watch/${completedVideo.id}`}
                        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition"
                      >
                        <Play className="w-3.5 h-3.5 fill-white" />
                        <span>เปิดดูวิดีโอ</span>
                      </Link>

                      <button
                        type="button"
                        onClick={() => copyWatchLink(completedVideo.id)}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-emerald-300 text-emerald-900 font-semibold text-xs hover:bg-emerald-100 transition"
                      >
                        {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedLink ? 'คัดลอกแล้ว' : 'แชร์ลิงก์'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Action Trigger Button */}
                {!currentStatus && (
                  <button
                    type="button"
                    onClick={() => handleStartPipeline()}
                    disabled={isUploading}
                    className="w-full py-3 px-6 rounded-xl bg-[#FF7A00] hover:bg-[#E56E00] active:scale-[0.99] text-white font-bold text-sm flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
                  >
                    <Upload className="w-4 h-4" />
                    <span>เริ่มต้นอัปโหลดและสั่งแปลงไฟล์ HLS Multi-bitrate</span>
                  </button>
                )}

                {/* Expandable Console Logs Drawer */}
                <div className="bg-white border border-[#EFECE6] rounded-2xl shadow-xs overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setShowLogs(!showLogs)}
                    className="w-full px-4 py-3 bg-[#FBF9F5] border-b border-[#EFECE6] flex items-center justify-between text-left"
                  >
                    <span className="text-xs font-semibold text-[#212529] flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-[#8C857B]" />
                      บันทึกกิจกรรมระบบ (Logs)
                      <span className="font-mono text-[11px] text-[#8C857B]">({logs.length})</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {logs.length > 0 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); copyLogText(); }}
                          className="text-[11px] text-[#8C857B] hover:text-[#212529] px-2 py-0.5 rounded border border-[#EFECE6] bg-white transition"
                        >
                          {copiedLog ? 'คัดลอกแล้ว' : 'คัดลอก'}
                        </button>
                      )}
                      {showLogs ? <ChevronUp className="w-4 h-4 text-[#8C857B]" /> : <ChevronDown className="w-4 h-4 text-[#8C857B]" />}
                    </div>
                  </button>

                  {showLogs && (
                    <div className="p-3 bg-[#1E1E1E] text-[#D4D4D4] font-mono text-[11px] h-40 overflow-y-auto space-y-1 select-text">
                      {logs.length === 0 ? (
                        <span className="text-[#6A9955]">// ยังไม่มีกิจกรรม พร้อมสำหรับการอัปโหลด</span>
                      ) : (
                        logs.map((log, index) => (
                          <div key={index} className="leading-relaxed">
                            {log.includes('❌') ? (
                              <span className="text-rose-400">{log}</span>
                            ) : log.includes('✅') || log.includes('🎉') ? (
                              <span className="text-emerald-400">{log}</span>
                            ) : log.includes('⚠️') ? (
                              <span className="text-amber-400">{log}</span>
                            ) : (
                              <span>{log}</span>
                            )}
                          </div>
                        ))
                      )}
                      <div ref={logEndRef} />
                    </div>
                  )}
                </div>
              </div>

              {/* RIGHT COLUMN: Video Preview & Complete Metadata (4 Cols) */}
              <div className="lg:col-span-4 flex flex-col gap-5">
                {/* Poster / Frame Preview Card */}
                <div className="bg-white border border-[#EFECE6] rounded-2xl p-4 shadow-xs flex flex-col gap-3">
                  <div className="w-full aspect-video bg-[#1A1A1A] rounded-xl overflow-hidden relative flex items-center justify-center">
                    {thumbnailUrl ? (
                      <img
                        src={thumbnailUrl}
                        alt="Video Thumbnail Preview"
                        className="w-full h-full object-cover animate-fadeIn"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center text-white/50 gap-2.5 p-4 text-center">
                        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center animate-pulse">
                          <Film className="w-5 h-5 text-[#FF7A00]" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs font-semibold text-white/80">
                            {currentStatus === 'UPLOADING'
                              ? 'กำลังส่งไฟล์เข้า Cloud...'
                              : currentStatus === 'PROCESSING' || currentStatus === 'TRANSCODING'
                              ? 'กำลังสกัดภาพหน้าปกจาก Cloud Worker...'
                              : 'รอประมวลผลภาพหน้าปก'}
                          </span>
                          <span className="text-[10px] text-white/40">
                            ภาพปกจะแสดงอัตโนมัติเมื่อ Worker แคปภาพเสร็จ
                          </span>
                        </div>
                      </div>
                    )}
                    <span className="absolute bottom-2 right-2 bg-black/70 text-white text-[10px] font-mono font-bold px-1.5 py-0.5 rounded">
                      {fileDetails.durationFormatted}
                    </span>
                  </div>

                  <div className="text-xs">
                    <span className="font-bold text-[#212529] line-clamp-1">{fileDetails.name}</span>
                    <span className="text-[#8C857B] text-[11px] block mt-0.5">
                      {fileDetails.sizeFormatted} • {fileDetails.resolution}
                    </span>
                  </div>
                </div>

                {/* Complete Technical Metadata Card */}
                <div className="bg-white border border-[#EFECE6] rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col gap-3">
                  <span className="text-xs font-bold text-[#212529] flex items-center gap-2 pb-2 border-b border-[#EFECE6]">
                    <Database className="w-4 h-4 text-[#FF7A00]" />
                    ข้อมูลไฟล์ต้นฉบับฉบับเต็ม (Full File Metadata)
                  </span>

                  <div className="divide-y divide-[#F5F2EB] text-xs">
                    <div className="py-2 flex items-center justify-between">
                      <span className="text-[#8C857B]">ความละเอียด (Resolution)</span>
                      <span className="font-semibold text-[#212529] font-mono">{fileDetails.resolution}</span>
                    </div>

                    <div className="py-2 flex items-center justify-between">
                      <span className="text-[#8C857B]">อัตราส่วนภาพ (Aspect Ratio)</span>
                      <span className="font-semibold text-[#212529]">{fileDetails.aspectRatio}</span>
                    </div>

                    <div className="py-2 flex items-center justify-between">
                      <span className="text-[#8C857B]">ความยาว (Duration)</span>
                      <span className="font-semibold text-[#212529] font-mono">
                        {fileDetails.durationFormatted} ({fileDetails.durationSec} วิ)
                      </span>
                    </div>

                    <div className="py-2 flex items-center justify-between">
                      <span className="text-[#8C857B]">ขนาดไฟล์ (File Size)</span>
                      <span className="font-semibold text-[#212529] font-mono">
                        {fileDetails.sizeFormatted} ({fileDetails.sizeBytes.toLocaleString()} bytes)
                      </span>
                    </div>

                    <div className="py-2 flex items-center justify-between">
                      <span className="text-[#8C857B]">บิตเรตโดยประมาณ (Bitrate)</span>
                      <span className="font-semibold text-[#212529] font-mono text-emerald-700">
                        {fileDetails.approxBitrate}
                      </span>
                    </div>

                    <div className="py-2 flex items-center justify-between">
                      <span className="text-[#8C857B]">อัตราเฟรม (Frame Rate)</span>
                      <span className="font-semibold text-[#212529] font-mono">{fileDetails.fps} fps</span>
                    </div>

                    <div className="py-2 flex items-center justify-between">
                      <span className="text-[#8C857B]">รูปแบบ / Codec</span>
                      <span className="font-semibold text-[#212529] font-mono">{fileDetails.codec}</span>
                    </div>

                    <div className="py-2 flex items-center justify-between">
                      <span className="text-[#8C857B]">MIME Type</span>
                      <span className="font-semibold text-[#212529] font-mono">{fileDetails.mimeType}</span>
                    </div>

                    <div className="py-2 flex items-center justify-between">
                      <span className="text-[#8C857B]">วันที่แก้ไขไฟล์</span>
                      <span className="font-semibold text-[#212529] text-[11px]">{fileDetails.lastModified}</span>
                    </div>
                  </div>
                </div>

                {/* Upload Performance Chunk Setting */}
                <div className="bg-white border border-[#EFECE6] rounded-2xl p-4 shadow-xs flex flex-col gap-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#212529] flex items-center gap-1.5">
                      <Sliders className="w-3.5 h-3.5 text-[#FF7A00]" />
                      ขนาดชิ้นส่วนอัปโหลด (Chunk Size)
                    </span>
                    <span className="text-[11px] font-mono text-[#8C857B]">
                      {chunkSizeMB} MB ต่อก้อน
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => handleSelectChunkSize(10)}
                      className={`py-2 px-2 rounded-xl border text-xs font-semibold transition flex flex-col items-center justify-center gap-0.5 text-center cursor-pointer ${
                        chunkSizeMB === 10
                          ? 'bg-orange-50 border-orange-300 text-orange-950 ring-1 ring-orange-200'
                          : 'bg-[#FBF9F5] border-[#EFECE6] text-[#8C857B] hover:text-[#212529]'
                      }`}
                    >
                      <span className="font-bold">10 MB</span>
                      <span className="text-[10px] opacity-80 font-normal">มาตรฐาน / ทั่วไป</span>
                    </button>

                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => handleSelectChunkSize(20)}
                      className={`py-2 px-2 rounded-xl border text-xs font-semibold transition flex flex-col items-center justify-center gap-0.5 text-center cursor-pointer ${
                        chunkSizeMB === 20
                          ? 'bg-orange-50 border-orange-300 text-orange-950 ring-1 ring-orange-200'
                          : 'bg-[#FBF9F5] border-[#EFECE6] text-[#8C857B] hover:text-[#212529]'
                      }`}
                    >
                      <span className="font-bold">20 MB</span>
                      <span className="text-[10px] opacity-80 font-normal">เน็ตเร็วเต็มสปีด</span>
                    </button>

                    <button
                      type="button"
                      disabled={isUploading}
                      onClick={() => handleSelectChunkSize(50)}
                      className={`py-2 px-2 rounded-xl border text-xs font-semibold transition flex flex-col items-center justify-center gap-0.5 text-center cursor-pointer ${
                        chunkSizeMB === 50
                          ? 'bg-orange-50 border-orange-300 text-orange-950 ring-1 ring-orange-200'
                          : 'bg-[#FBF9F5] border-[#EFECE6] text-[#8C857B] hover:text-[#212529]'
                      }`}
                    >
                      <span className="font-bold">50 MB</span>
                      <span className="text-[10px] opacity-80 font-normal">Fiber แรงพิเศษ</span>
                    </button>
                  </div>
                  <span className="text-[10px] text-[#8C857B] leading-relaxed">
                    ก้อนขนาดใหญ่ (เช่น 50 MB) ช่วยลด HTTP Overhead สูงสุด เหมาะสำหรับเน็ตบ้าน Fiber ความเร็วสูง
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* Queue & Status Overview Dashboard */
        <div className="bg-white border border-[#EFECE6] rounded-2xl p-6 shadow-xs flex flex-col gap-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#EFECE6]">
            <div>
              <h2 className="text-sm font-bold text-[#212529] flex items-center gap-2">
                <ListOrdered className="w-4 h-4 text-blue-600" />
                คิวงานแปลงไฟล์ทั้งหมด (Transcode Queue Dashboard)
              </h2>
              <p className="text-xs text-[#8C857B] mt-0.5">
                รายการวิดีโอที่กำลังอยู่ในคิวหรือประมวลผลบน GitHub Actions (สามารถยกเลิกหรือลบออกได้ทันที)
              </p>
            </div>

            <div className="flex items-center gap-2">
              {queueItems.some((i) => i.status === 'FAILED') && (
                <button
                  type="button"
                  onClick={handleClearAllFailed}
                  className="flex items-center gap-1 text-xs text-rose-600 hover:text-rose-700 px-3 py-1.5 rounded-xl border border-rose-200 bg-rose-50 hover:bg-rose-100 transition font-medium"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>ล้างที่ล้มเหลว</span>
                </button>
              )}

              <button
                type="button"
                onClick={loadQueue}
                disabled={loadingQueue}
                className="flex items-center gap-1.5 text-xs text-[#8C857B] hover:text-[#212529] px-3 py-1.5 rounded-xl border border-[#EFECE6] hover:bg-[#FBF9F5] transition"
              >
                <RefreshCw className={`w-3 h-3 ${loadingQueue ? 'animate-spin' : ''}`} />
                <span>รีเฟรช</span>
              </button>
            </div>
          </div>

          {queueItems.length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-center text-[#8C857B]">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2 stroke-[1.5]" />
              <span className="text-sm font-bold text-[#212529]">ไม่มีคิวงานค้างในขณะนี้</span>
              <span className="text-xs mt-0.5">วิดีโอทั้งหมดแปลงเสร็จสมบูรณ์และพร้อมรับชมแล้ว 100%</span>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {queueItems.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-xl border border-[#EFECE6] bg-[#FBF9F5] flex flex-col gap-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#212529] truncate">{item.title}</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0 ${
                            item.status === 'READY'
                              ? 'bg-emerald-100 text-emerald-800 font-semibold'
                              : item.status === 'TRANSCODING'
                              ? 'bg-orange-100 text-orange-800'
                              : item.status === 'PROCESSING'
                              ? 'bg-purple-100 text-purple-800'
                              : item.status === 'QUEUED'
                              ? 'bg-amber-100 text-amber-800'
                              : item.status === 'FAILED'
                              ? 'bg-rose-100 text-rose-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {item.status === 'READY' ? '⚡ เปิดดูได้แล้ว (กำลังแปลงความละเอียดสูง...)' : item.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#8C857B] mt-0.5 block truncate">
                        ไฟล์ดิบ: {item.rawFileName} • ID: #{item.id}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {item.status === 'READY' && (
                        <Link
                          href={`/watch/${item.id}`}
                          target="_blank"
                          className="flex items-center gap-1 px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold transition shadow-xs"
                        >
                          <Play className="w-3 h-3 fill-white" />
                          <span>เปิดดูคลิป</span>
                        </Link>
                      )}

                      {item.status === 'FAILED' && (
                        <button
                          type="button"
                          onClick={() => handleRetryTrigger(item.id, item.rawFileName, item.title)}
                          className="flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold transition"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>ลองใหม่</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => handleDeleteQueueItem(item.id, item.title)}
                        title="ยกเลิกและลบคิวนี้ถาวร"
                        className="flex items-center gap-1 px-2 py-1 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-rose-200 rounded-lg font-medium transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>ลบคิว</span>
                      </button>
                    </div>
                  </div>

                  <div className="w-full bg-[#EFECE6] h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${item.status === 'FAILED' ? 'bg-rose-500' : 'bg-[#FF7A00]'}`}
                      style={{ width: `${item.transcodeProgress || 0}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-[#8C857B]">
                    <span>{item.stageDetail || 'กำลังดำเนินการ...'}</span>
                    <span className="font-mono font-bold text-[#212529]">
                      {item.transcodeProgress || 0}%
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

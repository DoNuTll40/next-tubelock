'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Upload,
  ArrowLeft,
  ArrowRight,
  ListOrdered,
  FileVideo,
  XCircle,
  Loader2,
} from 'lucide-react';
import { extractVideoMetadata } from '@/lib/uploader';
import {
  formatAspectRatio,
  detectResolutionLabel,
  detectCodecFromHeader,
} from '@/lib/videoUtils';

// Import Modular Studio Components
import StepIndicator from '@/components/upload/StepIndicator';
import StepDetails from '@/components/upload/StepDetails';
import StepSubtitles from '@/components/upload/StepSubtitles';
import StepRatingVision from '@/components/upload/StepRatingVision';
import StepPublish from '@/components/upload/StepPublish';
import UploadSidebar from '@/components/upload/UploadSidebar';
import UploadLogs from '@/components/upload/UploadLogs';

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

export default function UploadPage() {
  const fileInputRef = useRef(null);
  const fileRef = useRef(null);
  const titleRef = useRef('');
  const descriptionRef = useRef('');
  const categoryRef = useRef('general');
  const tagsRef = useRef(['HLS', 'stream']);
  const logEndRef = useRef(null);
  const pollingTimerRef = useRef(null);

  // Refs for immediate OneDrive upload & cancellation
  const activeXhrRef = useRef(null);
  const activeUploadUrlRef = useRef('');
  const activeVideoIdRef = useRef(null);
  const uploadAbortedRef = useRef(false);

  // Active Wizard Step (1: Details, 2: Subtitles & AI, 3: Rating & Vision, 4: Summary & Publish)
  const [activeStep, setActiveStep] = useState(1);

  // Queue Count for top bar indicator
  const [queueCount, setQueueCount] = useState(0);

  // File & Source Metadata State
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [tags, setTags] = useState(['HLS', 'stream']);
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [runnerSpecs, setRunnerSpecs] = useState(null);
  const runnerSpecsLoggedRef = useRef(false);

  // Step 2: Subtitles & AI State (AI Key & Model come from .env)
  const [subtitleMode, setSubtitleMode] = useState('ai'); // 'manual' | 'ai'
  const [manualSubtitleFile, setManualSubtitleFile] = useState(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [subtitleStatus, setSubtitleStatus] = useState('waiting'); // 'waiting' | 'processing' | 'ready' | 'failed'
  const [generatedSubtitleSrt, setGeneratedSubtitleSrt] = useState('');

  // Step 3: Content Rating & Sprite Sheet Vision State
  const [contentRating, setContentRating] = useState('all'); // 'all' | '13+' | '18+' | 'mature' | 'auto'
  const [spritePreviewUrl, setSpritePreviewUrl] = useState('');
  const [ratingCheckStatus, setRatingCheckStatus] = useState('pending');
  const [visionResult, setVisionResult] = useState(null);

  // GitHub Actions Pipeline Real-time State
  const [audioStatus, setAudioStatus] = useState('waiting'); // 'waiting' | 'extracting' | 'ready' | 'failed'
  const [spriteSheetStatus, setSpriteSheetStatus] = useState('waiting'); // 'waiting' | 'generating' | 'ready' | 'failed'

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

  // Chunk Size Configuration for OneDrive
  const [chunkSizeMB, setChunkSizeMB] = useState(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('tubelock_chunk_size');
        if (saved) {
          const num = parseInt(saved, 10);
          if ([10, 20, 50].includes(num)) return num;
        }
      } catch (_) { }
    }
    return 10;
  });

  const handleSelectChunkSize = (size) => {
    setChunkSizeMB(size);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('tubelock_chunk_size', String(size));
      } catch (_) { }
    }
  };

  // Upload Progress & Stats (Immediate Client -> OneDrive)
  const [isUploading, setIsUploading] = useState(false);
  const [isRawUploaded, setIsRawUploaded] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [uploadStats, setUploadStats] = useState({
    percent: 0,
    uploadedBytes: 0,
    totalBytes: 0,
    speedMBs: '0.0',
    etaSeconds: 0,
    currentChunk: 0,
    totalChunks: 0,
  });

  // Active Video & Transcoding State
  const [activeVideoId, setActiveVideoId] = useState(null);
  const [rawFileName, setRawFileName] = useState('');
  const [currentStatus, setCurrentStatus] = useState(null);
  const [transcodeProgress, setTranscodeProgress] = useState(0);
  const [stageDetail, setStageDetail] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const [completedVideo, setCompletedVideo] = useState(null);

  // System Activity Logs
  const [logs, setLogs] = useState([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const addLog = useCallback((msg) => {
    const time = new Date().toLocaleTimeString('th-TH');
    setLogs((prev) => [...prev, `[${time}] ${msg}`]);
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  // Status Poller for all 3 GitHub Actions (Audio/Subtitles, Sprite/Rating, HLS Transcode)
  const startPollingStatus = useCallback(
    (videoId) => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);

      pollingTimerRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/videos/${videoId}/status`);
          if (!res.ok) return;

          const data = await res.json();
          if (!data.success || !data.video) return;

          const vid = data.video;
          if (vid.status && vid.status !== 'UPLOADING') {
            setCurrentStatus(vid.status);
          }
          setTranscodeProgress(vid.transcodeProgress || 0);
          setStageDetail(vid.stageDetail || '');

          // Workflow #1: Audio & Subtitles status
          if (vid.audioStatus) setAudioStatus(vid.audioStatus);
          if (vid.subtitleStatus) setSubtitleStatus(vid.subtitleStatus);
          if (vid.subtitleSrt) setGeneratedSubtitleSrt(vid.subtitleSrt);

          // Workflow #2: Sprite Sheet Grid & Content Rating status
          if (vid.spriteStatus) setSpriteSheetStatus(vid.spriteStatus);
          if (vid.spritePreviewUrl) setSpritePreviewUrl(vid.spritePreviewUrl);
          if (vid.ratingCheckStatus) setRatingCheckStatus(vid.ratingCheckStatus);
          if (vid.visionAnalysis) {
            setVisionResult(vid.visionAnalysis);
          }
          if (vid.ratingCheckStatus === 'AI_AUTO_SELECTED' && vid.contentRating) {
            setContentRating(vid.contentRating);
          }

          if (vid.runnerSpecs) {
            setRunnerSpecs(vid.runnerSpecs);
            if (!runnerSpecsLoggedRef.current) {
              runnerSpecsLoggedRef.current = true;
              addLog(
                `🖥️ สเปกเครื่อง GitHub Actions: ${vid.runnerSpecs.cpuModel} (${vid.runnerSpecs.cpuCores} Cores) • RAM: ${vid.runnerSpecs.totalRamGb} • ${vid.runnerSpecs.osName}`
              );
            }
          }

          if (vid.thumbnailUrl && !vid.thumbnailUrl.startsWith('/streams/')) {
            setThumbnailUrl(vid.thumbnailUrl);
          }

          if (vid.status === 'READY') {
            setCompletedVideo(vid);
            const isSubStillRunning = vid.subtitleStatus === 'processing' || vid.audioStatus === 'extracting';
            const isRatingStillRunning = vid.ratingCheckStatus === 'analyzing' || vid.spriteStatus === 'generating';
            if (vid.transcodeProgress >= 100 && !isSubStillRunning && !isRatingStillRunning) {
              clearInterval(pollingTimerRef.current);
              addLog(`🎉 การประมวลผลวิดีโอ "${vid.title}" เสร็จสมบูรณ์ครบทุกขั้นตอน 100%!`);
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
    },
    [addLog]
  );

  useEffect(() => {
    return () => {
      if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);
    };
  }, []);

  // Immediate Upload to OneDrive as soon as a video file is selected
  const startImmediateOneDriveUpload = async (selectedFile, initialTitle, initialDesc) => {
    if (!selectedFile) return;

    uploadAbortedRef.current = false;
    setIsUploading(true);
    setIsRawUploaded(false);
    setErrorMsg(null);
    setUploadStats({
      percent: 0,
      uploadedBytes: 0,
      totalBytes: selectedFile.size || 0,
      speedMBs: '0.0',
      etaSeconds: 0,
      currentChunk: 0,
      totalChunks: 1,
    });

    const resolvedFileName =
      selectedFile.name ||
      (selectedFile.lastModified ? `video_${selectedFile.lastModified}.mp4` : 'video_upload.mp4');

    setStageDetail('กำลังสร้าง Upload Session กับ OneDrive อัตโนมัติ...');
    addLog(`⚡ เริ่มอัปโหลดวิดีโอขึ้น OneDrive อัตโนมัติทันที: "${resolvedFileName}"`);

    try {
      const sessionRes = await fetch('/api/upload/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: resolvedFileName,
          title: initialTitle,
          description: initialDesc,
          fileSize: selectedFile.size || 0,
        }),
      });

      if (!sessionRes.ok) {
        const errJson = await sessionRes.json().catch(() => ({}));
        throw new Error(`[OneDrive Session Error] ${errJson.error || errJson.details || sessionRes.statusText}`);
      }

      const sessionData = await sessionRes.json();
      const { uploadUrl, videoId, rawFileName: serverRawName } = sessionData;

      if (uploadAbortedRef.current) return;

      activeUploadUrlRef.current = uploadUrl;
      activeVideoIdRef.current = videoId;
      setActiveVideoId(videoId);
      setRawFileName(serverRawName);
      addLog(`ได้รับ OneDrive Session (Video ID: #${videoId}) กำลังส่งไฟล์เข้า /raw/${serverRawName}...`);

      const isMobile =
        typeof navigator !== 'undefined' &&
        (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
          (navigator.maxTouchPoints && navigator.maxTouchPoints > 1));

      const activeChunkSizeMB =
        isMobile || selectedFile.size < 200 * 1024 * 1024 ? Math.min(chunkSizeMB, 10) : chunkSizeMB;

      const CHUNK_SIZE =
        activeChunkSizeMB === 50
          ? 160 * 327680
          : activeChunkSizeMB === 20
            ? 64 * 327680
            : 32 * 327680;

      const totalSize = selectedFile.size;
      const totalChunks = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE));
      let start = 0;
      let chunkIndex = 0;
      const uploadStartTime = typeof performance !== 'undefined' ? performance.now() : 0;

      while (start < totalSize) {
        if (uploadAbortedRef.current) {
          throw new Error('UPLOAD_CANCELLED_BY_USER');
        }

        const end = Math.min(start + CHUNK_SIZE, totalSize) - 1;
        const chunkBlob = selectedFile.slice(start, end + 1);
        const chunkBuffer = await chunkBlob.arrayBuffer();
        const rangeHeader = `bytes ${start}-${end}/${totalSize}`;

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          activeXhrRef.current = xhr;
          xhr.open('PUT', uploadUrl, true);
          xhr.withCredentials = false;
          xhr.setRequestHeader('Content-Range', rangeHeader);

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && !uploadAbortedRef.current) {
              const currentTotal = start + e.loaded;
              const pct = Math.min(100, Math.round((currentTotal / totalSize) * 100));
              const now = typeof performance !== 'undefined' ? performance.now() : 0;
              const elapsedSec = Math.max(0.1, (now - uploadStartTime) / 1000);
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

              setStageDetail(
                `กำลังอัปโหลดขึ้น OneDrive: ${pct}% (${formatBytes(currentTotal)} / ${formatBytes(totalSize)} • ${speedMBs} MB/s)`
              );
            }
          };

          xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 201 || xhr.status === 202) {
              resolve();
            } else {
              reject(new Error(`Microsoft Graph ส่งคืนสถานะ (${xhr.status}): ${xhr.statusText}`));
            }
          };

          xhr.onabort = () => reject(new Error('UPLOAD_CANCELLED_BY_USER'));
          xhr.onerror = () => reject(new Error('การเชื่อมต่อกับ OneDrive ขัดข้อง'));
          xhr.ontimeout = () => reject(new Error('หมดเวลาเชื่อมต่อกับ OneDrive'));
          xhr.timeout = 180000;
          xhr.send(chunkBuffer);
        });

        start = end + 1;
        chunkIndex++;
      }

      activeXhrRef.current = null;
      if (uploadAbortedRef.current) return;

      setIsUploading(false);
      setIsRawUploaded(true);
      setUploadStats((prev) => ({ ...prev, percent: 100, uploadedBytes: totalSize, etaSeconds: 0 }));
      setStageDetail('อัปโหลดวิดีโอขึ้น OneDrive ครบ 100% พร้อมให้ GitHub Actions ดึงข้อมูลได้ทันที');
      addLog(`✅ อัปโหลดวิดีโอขึ้น OneDrive (/raw/${serverRawName}) สำเร็จ 100%! พร้อมรัน GitHub Actions`);

      startPollingStatus(videoId);
    } catch (err) {
      activeXhrRef.current = null;
      setIsUploading(false);
      if (err.message === 'UPLOAD_CANCELLED_BY_USER' || uploadAbortedRef.current) {
        addLog(`🛑 ยกเลิกการอัปโหลดขึ้น OneDrive ตามคำสั่งผู้ใช้เรียบร้อย`);
        return;
      }
      console.error('[Immediate OneDrive Upload Error]:', err);
      setErrorMsg(err.message);
      addLog(`❌ อัปโหลดขึ้น OneDrive ล้มเหลว: ${err.message}`);
    }
  };

  // Cancel Upload to OneDrive & Clean up OneDrive /raw/ file + Neon DB row
  const handleCancelUpload = async () => {
    setIsCancelling(true);
    uploadAbortedRef.current = true;
    if (pollingTimerRef.current) clearInterval(pollingTimerRef.current);

    addLog(`🛑 กำลังยกเลิกการอัปโหลดและลบไฟล์วิดีโอออกจาก OneDrive...`);

    // 1. Abort active XHR chunk upload if running
    if (activeXhrRef.current) {
      try {
        activeXhrRef.current.abort();
      } catch (_) { }
      activeXhrRef.current = null;
    }

    // 2. Cancel Microsoft Graph Upload Session URL if present
    if (activeUploadUrlRef.current) {
      try {
        await fetch(activeUploadUrlRef.current, { method: 'DELETE' });
      } catch (_) { }
      activeUploadUrlRef.current = '';
    }

    // 3. Delete /raw/ file on OneDrive & DB record via DELETE /api/videos/[id]
    const targetVideoId = activeVideoIdRef.current || activeVideoId;
    if (targetVideoId) {
      try {
        await fetch(`/api/videos/${targetVideoId}`, { method: 'DELETE' });
        addLog(`🗑️ ลบไฟล์ต้นฉบับบน OneDrive และข้อมูลวิดีโอ #${targetVideoId} ออกจากระบบเรียบร้อย`);
      } catch (delErr) {
        console.warn('[Cancel Delete Error]:', delErr.message);
      }
    }

    // 4. Reset all states back to file selection dropzone
    activeVideoIdRef.current = null;
    fileRef.current = null;
    titleRef.current = '';
    descriptionRef.current = '';
    setFile(null);
    setTitle('');
    setDescription('');
    setCategory('general');
    setTags(['HLS', 'stream']);
    setThumbnailUrl('');
    setIsUploading(false);
    setIsRawUploaded(false);
    setIsCancelling(false);
    setActiveVideoId(null);
    setRawFileName('');
    setCurrentStatus(null);
    setTranscodeProgress(0);
    setStageDetail('');
    setErrorMsg(null);
    setCompletedVideo(null);
    setRunnerSpecs(null);
    runnerSpecsLoggedRef.current = false;
    setActiveStep(1);
    setManualSubtitleFile(null);
    setSubtitleStatus('waiting');
    setGeneratedSubtitleSrt('');
    setContentRating('all');
    setSpritePreviewUrl('');
    setRatingCheckStatus('pending');
    setVisionResult(null);
    setAudioStatus('waiting');
    setSpriteSheetStatus('waiting');
    setLogs([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Handle File Selection
  const handleFile = async (selectedFile) => {
    if (!selectedFile) return;
    setErrorMsg(null);
    setCompletedVideo(null);
    setCurrentStatus(null);
    setTranscodeProgress(0);

    const cleanBaseName = selectedFile.name.replace(/\.[^/.]+$/, '').trim();
    setTitle(cleanBaseName);
    titleRef.current = cleanBaseName;
    const defaultDesc = `สตรีมมิ่งผ่าน HLS Multi-bitrate (Serverless HLS Engine)`;
    setDescription(defaultDesc);
    descriptionRef.current = defaultDesc;

    const sizeFormatted = formatBytes(selectedFile.size);
    const lastModifiedDate = selectedFile.lastModified
      ? new Date(selectedFile.lastModified).toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
      : '-';

    addLog(`เลือกไฟล์: "${selectedFile.name}" (${sizeFormatted})`);

    const detectedMime =
      selectedFile.type ||
      (selectedFile.name.toLowerCase().endsWith('.mov')
        ? 'video/quicktime'
        : selectedFile.name.toLowerCase().endsWith('.mkv')
          ? 'video/x-matroska'
          : 'video/mp4');

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

    const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

    let activeFile = selectedFile;
    if (isAndroid && selectedFile.size <= 250 * 1024 * 1024) {
      try {
        addLog(`กำลังอ่านไฟล์เข้า Memory Cache เพื่อป้องกัน Android SAF Revoke (${sizeFormatted})...`);
        const buffer = await selectedFile.arrayBuffer();
        activeFile = new File([buffer], selectedFile.name, {
          type: detectedMime,
          lastModified: selectedFile.lastModified || Date.now(),
        });
        addLog(`โหลดไฟล์เข้าหน่วยความจำสำเร็จ ปลดล็อกสิทธิ์ Android เรียบร้อย`);
      } catch (readErr) {
        console.error('In-memory clone error:', readErr);
        addLog(`คำเตือน: โคลนเข้าหน่วยความจำไม่สำเร็จ (${readErr.message}) จะใช้สตรีมไฟล์โดยตรง`);
      }
    }

    fileRef.current = activeFile;
    setFile(activeFile);

    // Start immediate OneDrive upload in the background right away!
    startImmediateOneDriveUpload(activeFile, cleanBaseName, defaultDesc);

    try {
      const headerCodec = await detectCodecFromHeader(selectedFile);
      const meta = await extractVideoMetadata(selectedFile);
      const dur = Math.round(meta.duration || 0);
      const w = meta.width || 0;
      const h = meta.height || 0;
      const activeCodec = headerCodec ? headerCodec.toUpperCase() : 'H.264';
      const resLabel =
        w && h
          ? detectResolutionLabel(w, h, { fileSize: selectedFile.size, codec: headerCodec })
          : headerCodec
            ? detectResolutionLabel(0, 0, { fileSize: selectedFile.size, codec: headerCodec })
            : 'Original / Auto';
      const aspectLabel = w && h ? formatAspectRatio(w, h) : 'Auto';
      const bitrateNum = dur > 0 ? ((selectedFile.size * 8) / dur / 1000000).toFixed(2) : '0';

      setFileDetails({
        name: selectedFile.name,
        sizeFormatted,
        sizeBytes: selectedFile.size,
        width: w,
        height: h,
        resolution: w && h ? `${w} x ${h} (${resLabel})` : resLabel,
        aspectRatio: aspectLabel,
        durationSec: dur,
        durationFormatted: formatDuration(dur),
        approxBitrate: dur > 0 ? `${bitrateNum} Mbps` : 'คำนวณตอน Transcode',
        fps: meta.fps || 30,
        codec: `${activeCodec} / Source`,
        mimeType: detectedMime,
        lastModified: lastModifiedDate,
      });

      if (meta.thumbnailDataUrl) {
        setThumbnailUrl(meta.thumbnailDataUrl);
      }

      if (w && h && (h > w || aspectLabel.includes('9:16'))) {
        setCategory('shorts');
        categoryRef.current = 'shorts';
        setTags((prev) => (prev.includes('Shorts') ? prev : ['Shorts', ...prev]));
      }

      if (w && h) {
        addLog(`วิเคราะห์ข้อมูลวิดีโอ: ${w}x${h} [${resLabel}], สัดส่วน: ${aspectLabel}, ความยาว ${formatDuration(dur)}`);
      }
    } catch {
      addLog(`เข้าสู่โหมดอัปโหลด (ข้อมูลสเปกวิดีโอแบบละเอียดจะถูกดึงตอน Transcode)`);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) handleFile(dropped);
  };

  // Dispatch Workflow #1: Extract Audio & AI Subtitles
  const handleDispatchAudioSubtitles = async () => {
    const vidId = activeVideoIdRef.current || activeVideoId;
    if (!vidId || !isRawUploaded) return;

    setAudioStatus('extracting');
    setSubtitleStatus('processing');
    addLog(`🚀 สั่งรัน GitHub Action #1 (extract-audio-subtitles.yml) สำหรับ Video ID #${vidId}...`);

    try {
      const res = await fetch('/api/upload/dispatch-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: vidId,
          workflowType: 'audio_subtitles',
          rawFileName,
          model: selectedModel,
          customPrompt,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'ไม่สามารถส่งคำสั่งรัน GitHub Action #1 ได้');
      }
      addLog(`✅ ส่งคำสั่ง GitHub Action #1 สำเร็จ: กำลังดึงวิดีโอจาก OneDrive มาสกัดเสียงและสร้างซับด้วย AI`);
      startPollingStatus(vidId);
    } catch (err) {
      setAudioStatus('failed');
      setSubtitleStatus('failed');
      addLog(`❌ สั่งรัน GitHub Action #1 ล้มเหลว: ${err.message}`);
    }
  };

  // Dispatch Workflow #2: Detailed Sprite Sheet Grid & Content Rating AI Verification
  const handleDispatchSpriteRating = async ({ userRating = contentRating, autoApply = false } = {}) => {
    const vidId = activeVideoIdRef.current || activeVideoId;
    if (!vidId || !isRawUploaded) return;

    setSpriteSheetStatus('generating');
    setRatingCheckStatus('analyzing');
    addLog(`🚀 สั่งรัน GitHub Action #2 (sprite-content-rating.yml) สร้าง Sprite Sheet Grid 25 เฟรม & ตรวจเรตเนื้อหา...`);

    try {
      const res = await fetch('/api/upload/dispatch-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: vidId,
          workflowType: 'sprite_rating',
          rawFileName,
          userRating,
          autoApply,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'ไม่สามารถส่งคำสั่งรัน GitHub Action #2 ได้');
      }
      addLog(`✅ ส่งคำสั่ง GitHub Action #2 สำเร็จ: กำลังสร้าง Sprite Sheet Grid และส่งให้ Gemini Vision ประเมินเรตเนื้อหา`);
      startPollingStatus(vidId);
    } catch (err) {
      setSpriteSheetStatus('failed');
      addLog(`❌ สั่งรัน GitHub Action #2 ล้มเหลว: ${err.message}`);
    }
  };

  // Start Pipeline (Step 4 Deploy): Trigger HLS Transcode (#3) + AI Subtitles (#1) + Sprite Rating (#2)
  const handleStartPipeline = async () => {
    const vidId = activeVideoIdRef.current || activeVideoId;
    if (!vidId || !isRawUploaded || isUploading) {
      addLog(`⚠️ กรุณารอให้อัปโหลดวิดีโอขึ้น OneDrive เสร็จครบ 100% ก่อนทำการกดยืนยันเผยแพร่`);
      return;
    }

    setErrorMsg(null);
    setCurrentStatus('QUEUED');
    setStageDetail('กำลังส่งคำสั่งรัน GitHub Actions (HLS Multi-bitrate + AI Subtitles + Sprite Rating)...');
    addLog(`เรียก POST /api/upload/complete เพื่อสั่งรัน GitHub Actions...`);

    try {
      const finalTitle = (titleRef.current || title || '').trim() || fileDetails.name.replace(/\.[^/.]+$/, '').trim();
      const finalDesc = (descriptionRef.current || description || '').trim();
      const finalCategory = categoryRef.current || category || 'general';
      const finalTags = tagsRef.current || tags || [];

      const completeRes = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: vidId,
          rawFileName,
          title: finalTitle,
          description: finalDesc,
          category: finalCategory,
          tags: finalTags,
          contentRating,
          subtitleMode,
          manualSubtitleSrt:
            subtitleMode === 'manual' && manualSubtitleFile?.ext === 'srt'
              ? manualSubtitleFile.textContent
              : '',
          manualSubtitleVtt:
            subtitleMode === 'manual' && manualSubtitleFile?.ext === 'vtt'
              ? manualSubtitleFile.textContent
              : '',
          selectedModel,
          customPrompt,
          runAiRatingVerify: true,
          clientMeta: {
            duration: fileDetails.durationSec,
            resolution: fileDetails.resolution,
            fps: fileDetails.fps,
            codec: fileDetails.codec,
            thumbnailDataUrl: thumbnailUrl && !thumbnailUrl.startsWith('data:') ? thumbnailUrl : '',
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
        addLog(`✅ ส่งคำสั่งรัน GitHub Actions สำเร็จ (HLS Audio 192kbps Uniform + AI Workflows)`);
        setCurrentStatus('PROCESSING');
        if (completeData.dispatchedAudioSub) {
          setAudioStatus('extracting');
          setSubtitleStatus('processing');
        }
        if (completeData.dispatchedSpriteRating) {
          setSpriteSheetStatus((prev) => (prev === 'ready' ? 'ready' : 'generating'));
          setRatingCheckStatus('analyzing');
        }
      }

      startPollingStatus(vidId);
    } catch (err) {
      console.error('[Complete Pipeline Error]:', err);
      setErrorMsg(err.message);
      addLog(`❌ เกิดข้อผิดพลาด: ${err.message}`);
    }
  };

  // Fetch Queue Count
  const fetchQueueCount = useCallback(async () => {
    try {
      const res = await fetch('/api/videos/queue');
      if (res.ok) {
        const data = await res.json();
        setQueueCount(data.queue ? data.queue.length : 0);
      }
    } catch (_) { }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchQueueCount();
    }, 0);
    const interval = setInterval(fetchQueueCount, 6000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [fetchQueueCount]);

  // Step Status Mapping for Stepper Badges
  const stepStatus = {
    1: { completed: Boolean(title && title.trim().length > 0) },
    2: { completed: Boolean(manualSubtitleFile || subtitleMode === 'ai' || subtitleStatus === 'ready'), optional: true },
    3: { completed: Boolean(contentRating) },
    4: { completed: Boolean(completedVideo) },
  };

  return (
    <div className=" bg-[#0a0a0a] text-[#F1F1F1] pb-24">
      {/* Top Banner / Breadcrumb Bar */}
      <div className="border-b border-[#262626] bg-[#121212]/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="p-2 rounded-xl bg-[#1c1c1c] hover:bg-[#252525] text-[#A1A1AA] hover:text-white border border-[#2e2e2e] transition"
              title="กลับหน้าหลัก"
            >
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div>
              <h1 className="text-sm font-bold text-white flex items-center gap-2">
                <Upload className="w-4 h-4 text-[#f97316]" />
                TubeLock Upload Studio
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <Link
              href="/upload/queue"
              className="text-xs px-3 py-1.5 rounded-xl bg-[#1c1c1c] hover:bg-[#252525] text-[#A1A1AA] hover:text-[#f97316] border border-[#2e2e2e] transition flex items-center gap-1.5"
            >
              <ListOrdered className="w-3.5 h-3.5" />
              <span>คิวแปลงไฟล์</span>
              {queueCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[#f97316] text-white text-[10px] font-mono">
                  {queueCount}
                </span>
              )}
            </Link>

            {file && (
              <button
                type="button"
                disabled={isCancelling}
                onClick={handleCancelUpload}
                className="text-xs px-3 py-1.5 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isCancelling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" />
                )}
                <span>ยกเลิกการอัปโหลดขึ้น OneDrive</span>
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8">
        {/* State A: File Drop Zone (No file selected yet) */}
        {!file ? (
          <div className="max-w-3xl mx-auto space-y-6 pt-4">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-3xl p-10 sm:p-16 text-center cursor-pointer transition-all duration-200 bg-[#141414] shadow-2xl relative overflow-hidden group ${isDragOver
                ? 'border-[#f97316] bg-[#f97316]/5 scale-[1.01]'
                : 'border-[#2e2e2e] hover:border-[#f97316]/70 hover:bg-[#181818]'
                }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mp4,.mkv,.mov,.webm,.avi"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />

              <div className="w-20 h-20 rounded-3xl bg-[#1e1e1e] group-hover:bg-[#ea580c]/15 border border-[#333333] group-hover:border-[#f97316]/40 flex items-center justify-center text-[#f97316] mx-auto mb-6 shadow-xl transition-transform duration-300 group-hover:scale-110">
                <FileVideo className="w-10 h-10 stroke-[1.5]" />
              </div>

              <h2 className="text-lg sm:text-xl font-bold text-white mb-2">
                ลากไฟล์วิดีโอมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์
              </h2>
              <p className="text-xs sm:text-sm text-[#8C857B] max-w-md mx-auto mb-6">
                เมื่อเลือกไฟล์แล้ว ระบบจะอัปโหลดขึ้น OneDrive ทันทีโดยอัตโนมัติ เพื่อให้ 3 GitHub Actions (ถอดเสียงทำซับ AI, สร้าง Sprite Grid ตรวจเรต, และหั่น HLS เสียงคุณภาพเดียวกัน) ดึงข้อมูลได้ทันที
              </p>

              <button
                type="button"
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-[#ea580c] to-[#f97316] text-white text-xs sm:text-sm font-semibold shadow-lg shadow-[#ea580c]/20 hover:brightness-110 transition pointer-events-none"
              >
                เลือกไฟล์วิดีโอจากอุปกรณ์
              </button>
            </div>

            {/* Quick feature badges */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
              <div className="p-4 bg-[#141414] border border-[#262626] rounded-2xl">
                <div className="text-xs font-semibold text-white mb-1">1. ถอดเสียง & AI Subtitles</div>
                <div className="text-[11px] text-[#71717A]">ดึงวิดีโอจาก OneDrive ถอดเสียงส่ง AI สร้างซับอัตโนมัติ</div>
              </div>
              <div className="p-4 bg-[#141414] border border-[#262626] rounded-2xl">
                <div className="text-xs font-semibold text-white mb-1">2. Sprite Grid & Content Rating</div>
                <div className="text-[11px] text-[#71717A]">สร้าง Sprite Sheet 25 เฟรม ส่ง AI ตรวจเรตเนื้อหา</div>
              </div>
              <div className="p-4 bg-[#141414] border border-[#262626] rounded-2xl">
                <div className="text-xs font-semibold text-white mb-1">3. HLS Uniform Audio (192k)</div>
                <div className="text-[11px] text-[#71717A]">แปลงเฉพาะภาพ ล็อกคุณภาพเสียงเท่ากันทุกความละเอียด</div>
              </div>
            </div>
          </div>
        ) : (
          /* State B: Multi-Step Studio Workspace */
          <div className="space-y-6">
            {/* Top Interactive Stepper Bar (Clickable in any order) */}
            <StepIndicator
              activeStep={activeStep}
              setActiveStep={setActiveStep}
              stepStatus={stepStatus}
            />

            {/* Main Grid: 2/3 Left (Active Step) & 1/3 Right (Sidebar) */}
            <div className="grid grid-cols-12 gap-6 items-start">
              {/* Left Column: Active Step Form (2/3 width) */}
              <div className="col-span-12 lg:col-span-8 space-y-6">
                {/* Step 1: Details */}
                {activeStep === 1 && (
                  <StepDetails
                    title={title}
                    setTitle={(val) => {
                      setTitle(val);
                      titleRef.current = val;
                    }}
                    description={description}
                    setDescription={(val) => {
                      setDescription(val);
                      descriptionRef.current = val;
                    }}
                    category={category}
                    setCategory={(val) => {
                      setCategory(val);
                      categoryRef.current = val;
                    }}
                    tags={tags}
                    setTags={(val) => {
                      setTags(val);
                      tagsRef.current = val;
                    }}
                    visionResult={visionResult}
                    onAddLog={addLog}
                  />
                )}

                {/* Step 2: Subtitles & AI (Workflow #1) */}
                {activeStep === 2 && (
                  <StepSubtitles
                    subtitleMode={subtitleMode}
                    setSubtitleMode={setSubtitleMode}
                    manualSubtitleFile={manualSubtitleFile}
                    setManualSubtitleFile={setManualSubtitleFile}
                    selectedModel={selectedModel}
                    setSelectedModel={setSelectedModel}
                    customPrompt={customPrompt}
                    setCustomPrompt={setCustomPrompt}
                    isRawUploaded={isRawUploaded}
                    isUploading={isUploading}
                    uploadPercent={uploadStats.percent}
                    audioStatus={audioStatus}
                    subtitleStatus={subtitleStatus}
                    generatedSubtitleSrt={generatedSubtitleSrt}
                    onDispatchAudioSubtitles={handleDispatchAudioSubtitles}
                    onAddLog={addLog}
                  />
                )}

                {/* Step 3: Rating & Vision AI (Workflow #2) */}
                {activeStep === 3 && (
                  <StepRatingVision
                    contentRating={contentRating}
                    setContentRating={setContentRating}
                    isRawUploaded={isRawUploaded}
                    uploadPercent={uploadStats.percent}
                    spriteSheetStatus={spriteSheetStatus}
                    spritePreviewUrl={spritePreviewUrl}
                    ratingCheckStatus={ratingCheckStatus}
                    visionResult={visionResult}
                    thumbnailUrl={thumbnailUrl}
                    onDispatchSpriteRating={handleDispatchSpriteRating}
                    onApplyRecommendation={(result) => {
                      setContentRating(result.suggestedRating);
                      addLog(`นำเรตติ้ง "${result.suggestedRatingLabel}" ไปใช้กับวิดีโอเรียบร้อย`);
                    }}
                  />
                )}

                {/* Step 4: Summary & Publish (Workflow #3 + Auto Workflows) */}
                {activeStep === 4 && (
                  <StepPublish
                    title={title}
                    description={description}
                    category={category}
                    tags={tags}
                    contentRating={contentRating}
                    subtitleMode={subtitleMode}
                    manualSubtitleFile={manualSubtitleFile}
                    chunkSizeMB={chunkSizeMB}
                    onSelectChunkSize={handleSelectChunkSize}
                    isUploading={isUploading}
                    isRawUploaded={isRawUploaded}
                    uploadPercent={uploadStats.percent}
                    isCancelling={isCancelling}
                    onCancelUpload={handleCancelUpload}
                    currentStatus={currentStatus}
                    transcodeProgress={transcodeProgress}
                    stageDetail={stageDetail}
                    completedVideo={completedVideo}
                    onStartPipeline={handleStartPipeline}
                    errorMsg={errorMsg}
                  />
                )}

                {/* Bottom Step Navigation Bar (Back / Next) */}
                <div className="flex items-center justify-between p-4 bg-[#141414] border border-[#262626] rounded-2xl shadow-xl">
                  <button
                    type="button"
                    disabled={activeStep <= 1}
                    onClick={() => setActiveStep((prev) => Math.max(1, prev - 1))}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-[#222222] hover:bg-[#2a2a2a] text-[#A1A1AA] hover:text-[#F1F1F1] border border-[#333333] transition disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>ย้อนกลับ</span>
                  </button>

                  <div className="text-xs text-[#71717A] font-mono">
                    ขั้นตอน {activeStep} จาก 4
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (activeStep < 4) {
                        setActiveStep((prev) => Math.min(4, prev + 1));
                      } else {
                        handleStartPipeline();
                      }
                    }}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-gradient-to-r from-[#ea580c] to-[#f97316] text-white hover:brightness-110 transition shadow-lg shadow-[#ea580c]/20 cursor-pointer"
                  >
                    <span>{activeStep === 4 ? 'ยืนยันและแปลงไฟล์ HLS' : 'ถัดไป'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>

                {/* Collapsible System Activity Logs */}
                <UploadLogs
                  logs={logs}
                  logEndRef={logEndRef}
                  onClearLogs={() => setLogs([])}
                />
              </div>

              {/* Right Column: Sticky Sidebar (1/3 width) */}
              <div className="col-span-12 lg:col-span-4">
                <UploadSidebar
                  file={file}
                  fileDetails={fileDetails}
                  thumbnailUrl={thumbnailUrl}
                  currentStatus={currentStatus}
                  transcodeProgress={transcodeProgress}
                  stageDetail={stageDetail}
                  uploadStats={uploadStats}
                  isUploading={isUploading}
                  isRawUploaded={isRawUploaded}
                  isCancelling={isCancelling}
                  onCancelUpload={handleCancelUpload}
                  audioStatus={audioStatus}
                  setAudioStatus={setAudioStatus}
                  subtitleStatus={subtitleStatus}
                  spriteSheetStatus={spriteSheetStatus}
                  setSpriteSheetStatus={setSpriteSheetStatus}
                  ratingCheckStatus={ratingCheckStatus}
                  runnerSpecs={runnerSpecs}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

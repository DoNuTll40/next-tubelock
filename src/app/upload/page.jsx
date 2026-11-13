'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Upload,
  ArrowLeft,
  ArrowRight,
  ListOrdered,
  MoreHorizontal,
  Loader2,
} from 'lucide-react';
import { extractVideoMetadata } from '@/lib/uploader';
import {
  formatAspectRatio,
  detectResolutionLabel,
  detectCodecFromHeader,
  decodeUploadId,
  encodeUploadId,
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
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const overflowMenuRef = useRef(null);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (overflowMenuRef.current && !overflowMenuRef.current.contains(e.target)) {
        setShowOverflowMenu(false);
      }
    };
    if (showOverflowMenu) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [showOverflowMenu]);

  // Queue Count for top bar indicator
  const [queueCount, setQueueCount] = useState(0);

  // File & Source Metadata State
  const [isRestoring, setIsRestoring] = useState(true);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [tags, setTags] = useState(['HLS', 'stream']);
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [thumbnailOptions, setThumbnailOptions] = useState([]);
  const [thumbnailStatus, setThumbnailStatus] = useState('waiting');
  const [isSavingThumbnail, setIsSavingThumbnail] = useState(false);
  const thumbnailRef = useRef('');
  const thumbnailOptionsRef = useRef([]);
  const isDispatchingThumbsRef = useRef(false);
  const hasAutoDispatchedThumbsRef = useRef(false);
  const [runnerSpecs, setRunnerSpecs] = useState(null);
  const runnerSpecsLoggedRef = useRef(false);

  // Step 2: Subtitles & AI State (AI Key & Model come from .env)
  const [subtitleMode, setSubtitleMode] = useState('ai'); // 'manual' | 'ai'
  const [manualSubtitleFile, setManualSubtitleFile] = useState(null);
  const [selectedModel, setSelectedModel] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [subtitleStatus, setSubtitleStatus] = useState('waiting'); // 'waiting' | 'processing' | 'ready' | 'failed'
  const [generatedSubtitleSrt, setGeneratedSubtitleSrt] = useState('');
  const [subtitleTracks, setSubtitleTracks] = useState([]);

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
  const [isStartingPipeline, setIsStartingPipeline] = useState(false);
  const isStartingPipelineRef = useRef(false);
  const isDispatchingAudioRef = useRef(false);
  const isDispatchingSpriteRef = useRef(false);

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
          if (Array.isArray(vid.subtitleTracks)) setSubtitleTracks(vid.subtitleTracks);

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

          if (vid.thumbnailStatus) setThumbnailStatus(vid.thumbnailStatus);
          if (Array.isArray(vid.thumbnailOptions) && vid.thumbnailOptions.length > 0) {
            setThumbnailOptions(vid.thumbnailOptions);
            thumbnailOptionsRef.current = vid.thumbnailOptions;
          }
          if (vid.thumbnailUrl && (!vid.thumbnailUrl.startsWith('/streams/') || !thumbnailRef.current)) {
            setThumbnailUrl(vid.thumbnailUrl);
            thumbnailRef.current = vid.thumbnailUrl;
          }
          if (vid.duration > 0) {
            setFileDetails((prev) => ({
              ...prev,
              durationSec: prev.durationSec || vid.duration,
              durationFormatted: prev.durationSec ? prev.durationFormatted : formatDuration(vid.duration),
              resolution: prev.resolution || vid.resolution,
              fps: prev.fps || vid.fps,
              codec: prev.codec || vid.codec,
            }));
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

  // Persist draft metadata or chosen thumbnail immediately to Neon DB (+ OneDrive poster.jpg sync)
  const persistVideoPatch = useCallback(async (videoId, patch) => {
    if (!videoId || !patch) return null;
    try {
      const res = await fetch(`/api/videos/${videoId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  }, []);

  // Dispatch lightweight GitHub Action to extract 3 segment thumbnails (15% / 50% / 85%)
  const handleDispatchThumbnails = useCallback(
    async (overrideVideoId, overrideRawName, { quietIfNotDeployed = false } = {}) => {
      const vidId = overrideVideoId || activeVideoIdRef.current;
      if (!vidId || isDispatchingThumbsRef.current) return;

      isDispatchingThumbsRef.current = true;
      setThumbnailStatus('generating');
      try {
        const res = await fetch('/api/upload/dispatch-action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoId: vidId,
            workflowType: 'thumbnails',
            rawFileName: overrideRawName || '',
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          if (quietIfNotDeployed && data.workflowNotFound) {
            setThumbnailStatus('waiting');
            return;
          }
          throw new Error(data.error || 'ไม่สามารถสั่งดึงภาพปก 3 ช่วงได้');
        }
        addLog('🖼️ ส่งคำสั่ง GitHub Actions สกัดภาพปก 3 ช่วงของวิดีโอแล้ว');
        startPollingStatus(vidId);
      } catch (err) {
        setThumbnailStatus('failed');
        addLog(`⚠️ สกัดภาพปก 3 ช่วงอัตโนมัติไม่สำเร็จ: ${err.message}`);
      } finally {
        isDispatchingThumbsRef.current = false;
      }
    },
    [addLog, startPollingStatus]
  );

  const handleSelectThumbnail = async (nextUrl, sourceLabel = '') => {
    const vidId = activeVideoIdRef.current || activeVideoId;
    thumbnailRef.current = nextUrl;
    setThumbnailUrl(nextUrl);
    if (sourceLabel) {
      addLog(`🖼️ เลือกภาพปกวิดีโอ (${sourceLabel === 'custom' ? 'อัปโหลดไฟล์เอง' : sourceLabel}) เรียบร้อย`);
    }
    if (!vidId) return;
    setIsSavingThumbnail(true);
    try {
      await persistVideoPatch(vidId, { thumbnailUrl: nextUrl });
    } finally {
      setIsSavingThumbnail(false);
    }
  };

  useEffect(() => {
    const uploadId = new URLSearchParams(window.location.search).get('upload_id');
    if (!uploadId) {
      setIsRestoring(false);
      return;
    }

    const id = decodeUploadId(uploadId);
    if (!id) {
      setErrorMsg('รหัสงานอัปโหลดไม่ถูกต้อง');
      setIsRestoring(false);
      return;
    }

    const controller = new AbortController();
    async function restore() {
      try {
        const response = await fetch(`/api/videos/${id}/status?restore=1`, { signal: controller.signal });
        const { video: job, error } = await response.json();
        if (!response.ok || !job) throw new Error(error || 'ไม่พบงานอัปโหลด');
        if (controller.signal.aborted) return;
        const canonicalId = encodeUploadId(id);
        if (canonicalId !== uploadId) {
          const url = new URL(window.location.href);
          url.searchParams.set('upload_id', canonicalId);
          window.history.replaceState(null, '', url);
        }

        activeVideoIdRef.current = id;
        setActiveVideoId(id);
        setRawFileName(job.rawFileName);
        setCurrentStatus(job.status);
        setTranscodeProgress(job.transcodeProgress);
        setStageDetail(job.stageDetail);
        const uploaded = job.rawUploaded ?? ['QUEUED', 'PROCESSING', 'TRANSCODING', 'READY'].includes(job.status);
        const totalBytes = Number(job.fileSizeBytes);
        setIsRawUploaded(uploaded);
        setUploadStats(prev => ({
          ...prev, percent: uploaded ? 100 : 0, uploadedBytes: uploaded ? totalBytes : 0, totalBytes,
        }));
        let draft;
        try { draft = JSON.parse(localStorage.getItem(`tubelock_upload_${id}`)); } catch {}
        setTitle(titleRef.current = draft?.title ?? job.title);
        setDescription(descriptionRef.current = draft?.description ?? job.description);
        setCategory(categoryRef.current = draft?.category ?? job.category);
        setTags(tagsRef.current = draft?.tags ?? job.tags);
        setContentRating(draft?.contentRating ?? job.userSelectedRating ?? job.contentRating);
        setActiveStep(job.status === 'UPLOADING' ? draft?.activeStep ?? 1 : 4);
        setSubtitleMode(draft?.subtitleMode ?? 'ai');
        setManualSubtitleFile(draft?.manualSubtitleFile ?? null);
        setSelectedModel(draft?.selectedModel ?? '');
        setCustomPrompt(draft?.customPrompt ?? '');
        const restoredThumbOptions =
          Array.isArray(job.thumbnailOptions) && job.thumbnailOptions.length > 0
            ? job.thumbnailOptions
            : Array.isArray(draft?.thumbnailOptions)
              ? draft.thumbnailOptions
              : [];
        const restoredThumbUrl =
          job.thumbnailUrl ||
          draft?.thumbnailUrl ||
          restoredThumbOptions[1]?.dataUrl ||
          restoredThumbOptions[0]?.dataUrl ||
          '';
        thumbnailRef.current = restoredThumbUrl;
        thumbnailOptionsRef.current = restoredThumbOptions;
        setThumbnailUrl(restoredThumbUrl);
        setThumbnailOptions(restoredThumbOptions);
        setThumbnailStatus(job.thumbnailStatus || (restoredThumbOptions.length > 0 ? 'ready' : 'waiting'));
        if (!job.thumbnailUrl && (restoredThumbUrl || restoredThumbOptions.length > 0)) {
          void persistVideoPatch(id, {
            thumbnailUrl: restoredThumbUrl || undefined,
            thumbnailOptions: restoredThumbOptions.length > 0 ? restoredThumbOptions : undefined,
          });
        }
        if (
          uploaded &&
          job.status !== 'READY' &&
          restoredThumbOptions.length === 0 &&
          (job.thumbnailStatus || 'waiting') === 'waiting' &&
          !hasAutoDispatchedThumbsRef.current
        ) {
          hasAutoDispatchedThumbsRef.current = true;
          void handleDispatchThumbnails(id, job.rawFileName, { quietIfNotDeployed: true });
        }
        setAudioStatus(job.audioStatus);
        setSubtitleStatus(job.subtitleStatus);
        setGeneratedSubtitleSrt(job.subtitleSrt);
        setSubtitleTracks(Array.isArray(job.subtitleTracks) ? job.subtitleTracks : []);
        setSpriteSheetStatus(job.spriteStatus);
        setSpritePreviewUrl(job.spritePreviewUrl);
        setRatingCheckStatus(job.ratingCheckStatus);
        setVisionResult(job.visionAnalysis);
        setRunnerSpecs(job.runnerSpecs);
        if (job.status === 'READY') setCompletedVideo(job);
        setFileDetails(prev => ({
          ...prev,
          name: job.rawFileName || job.title,
          sizeBytes: Number(job.fileSizeBytes),
          sizeFormatted: `${(Number(job.fileSizeBytes) / 1048576).toFixed(1)} MB`,
          durationSec: job.duration,
          durationFormatted: formatDuration(job.duration),
          resolution: job.resolution,
          fps: job.fps,
          codec: job.codec,
        }));
        setErrorMsg(job.errorMessage || (job.status === 'UPLOADING' && !job.rawUploaded
          ? 'ไฟล์ต้นทางยังอัปโหลดไม่ครบ เปิดงานในแท็บเดิมเพื่ออัปโหลดต่อ หรือเริ่มอัปโหลดใหม่'
          : null));
        startPollingStatus(id);
      } catch (error) {
        if (!controller.signal.aborted) setErrorMsg(error.message);
      } finally {
        if (!controller.signal.aborted) setIsRestoring(false);
      }
    }
    void restore();
    return () => controller.abort();
  }, [startPollingStatus, persistVideoPatch, handleDispatchThumbnails]);

  useEffect(() => {
    if (!activeVideoId || isRestoring) return;
    try {
      localStorage.setItem(`tubelock_upload_${activeVideoId}`, JSON.stringify({
        title, description, category, tags, contentRating, activeStep,
        subtitleMode, manualSubtitleFile, selectedModel, customPrompt,
        thumbnailUrl, thumbnailOptions,
      }));
    } catch {}
  }, [activeVideoId, isRestoring, title, description, category, tags, contentRating, activeStep,
    subtitleMode, manualSubtitleFile, selectedModel, customPrompt, thumbnailUrl, thumbnailOptions]);

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
      window.history.replaceState(null, '', `/upload?upload_id=${encodeUploadId(videoId)}`);
      setRawFileName(serverRawName);
      addLog(`ได้รับ OneDrive Session (Video ID: #${videoId}) กำลังส่งไฟล์เข้า /raw/${serverRawName}...`);

      // Persist client-captured thumbnails immediately if already extracted
      if (thumbnailRef.current || thumbnailOptionsRef.current.length > 0) {
        void persistVideoPatch(videoId, {
          thumbnailUrl: thumbnailRef.current || undefined,
          thumbnailOptions: thumbnailOptionsRef.current.length > 0 ? thumbnailOptionsRef.current : undefined,
        });
      }

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

      // Immediately dispatch 3-segment thumbnail extractor in the background
      void handleDispatchThumbnails(videoId, serverRawName, { quietIfNotDeployed: true });

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
    try { localStorage.removeItem(`tubelock_upload_${targetVideoId}`); } catch {}
    window.history.replaceState(null, '', '/upload');
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

      if (Array.isArray(meta.thumbnailOptions) && meta.thumbnailOptions.length > 0) {
        setThumbnailOptions(meta.thumbnailOptions);
        thumbnailOptionsRef.current = meta.thumbnailOptions;
      }

      if (meta.thumbnailDataUrl && !thumbnailRef.current) {
        setThumbnailUrl(meta.thumbnailDataUrl);
        thumbnailRef.current = meta.thumbnailDataUrl;
      }

      const activeVid = activeVideoIdRef.current;
      if (activeVid && (meta.thumbnailDataUrl || meta.thumbnailOptions?.length > 0)) {
        void persistVideoPatch(activeVid, {
          thumbnailUrl: thumbnailRef.current || meta.thumbnailDataUrl || undefined,
          thumbnailOptions: meta.thumbnailOptions?.length > 0 ? meta.thumbnailOptions : undefined,
        });
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
    if (!vidId || !isRawUploaded || isDispatchingAudioRef.current) return;
    if (audioStatus === 'extracting' || subtitleStatus === 'processing') return;

    isDispatchingAudioRef.current = true;
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
      if (data.alreadyRunning) {
        addLog(`ℹ️ GitHub Action #1 กำลังทำงานอยู่แล้ว ไม่ต้องส่งซ้ำ`);
      } else {
        addLog(`✅ ส่งคำสั่ง GitHub Action #1 สำเร็จ: กำลังดึงวิดีโอจาก OneDrive มาสกัดเสียงและสร้างซับด้วย AI`);
      }
      startPollingStatus(vidId);
    } catch (err) {
      setAudioStatus('failed');
      setSubtitleStatus('failed');
      addLog(`❌ สั่งรัน GitHub Action #1 ล้มเหลว: ${err.message}`);
    } finally {
      isDispatchingAudioRef.current = false;
    }
  };

  // Dispatch Workflow #2: Detailed Sprite Sheet Grid & Content Rating AI Verification
  const handleDispatchSpriteRating = async ({ userRating = contentRating, autoApply = false } = {}) => {
    const vidId = activeVideoIdRef.current || activeVideoId;
    if (!vidId || !isRawUploaded || isDispatchingSpriteRef.current) return;
    if (spriteSheetStatus === 'generating' || ratingCheckStatus === 'analyzing') return;

    isDispatchingSpriteRef.current = true;
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
      if (data.alreadyRunning) {
        addLog(`ℹ️ GitHub Action #2 กำลังสร้าง Sprite Grid หรือตรวจเรตเนื้อหาอยู่แล้ว`);
      } else {
        addLog(`✅ ส่งคำสั่ง GitHub Action #2 สำเร็จ: กำลังสร้าง Sprite Sheet Grid และส่งให้ Gemini Vision ประเมินเรตเนื้อหา`);
      }
      startPollingStatus(vidId);
    } catch (err) {
      setSpriteSheetStatus('failed');
      addLog(`❌ สั่งรัน GitHub Action #2 ล้มเหลว: ${err.message}`);
    } finally {
      isDispatchingSpriteRef.current = false;
    }
  };

  // Start Pipeline (Step 4 Deploy): Trigger HLS Transcode (#3) + AI Subtitles (#1) + Sprite Rating (#2)
  const handleStartPipeline = async () => {
    const vidId = activeVideoIdRef.current || activeVideoId;
    if (!vidId || !isRawUploaded || isUploading) {
      addLog(`⚠️ กรุณารอให้อัปโหลดวิดีโอขึ้น OneDrive เสร็จครบ 100% ก่อนทำการกดยืนยันเผยแพร่`);
      return;
    }
    if (
      isStartingPipelineRef.current ||
      isStartingPipeline ||
      currentStatus === 'PROCESSING' ||
      currentStatus === 'TRANSCODING' ||
      currentStatus === 'QUEUED' ||
      currentStatus === 'READY'
    ) {
      addLog(`⚠️ วิดีโอนี้อยู่ในคิวหรือกำลังประมวลผลอยู่แล้ว ไม่สามารถส่งซ้ำได้`);
      return;
    }

    isStartingPipelineRef.current = true;
    setIsStartingPipeline(true);
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
            thumbnailDataUrl: thumbnailUrl || '',
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
      } else if (completeData.alreadyRunning) {
        addLog(`ℹ️ ${completeData.message}`);
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
    } finally {
      isStartingPipelineRef.current = false;
      setIsStartingPipeline(false);
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

  const hasTitle = Boolean(title && title.trim().length > 0);
  const hasRating = Boolean(contentRating);

  // Honest Step Status Mapping for Stepper Badges
  const stepStatus = {
    1: {
      completed: hasTitle,
      statusText: hasTitle ? 'กรอกแล้ว' : 'รอระบุชื่อ',
    },
    2: {
      completed: Boolean(manualSubtitleFile || subtitleStatus === 'ready'),
      statusText:
        subtitleStatus === 'ready'
          ? 'สร้างซับแล้ว'
          : manualSubtitleFile
          ? 'แนบไฟล์แล้ว'
          : subtitleStatus === 'processing' || audioStatus === 'extracting'
          ? 'กำลังถอดเสียง...'
          : 'รันตอนเผยแพร่ได้',
    },
    3: {
      completed: Boolean(
        ratingCheckStatus === 'VERIFIED_MATCH' ||
          ratingCheckStatus === 'AI_AUTO_SELECTED' ||
          activeStep > 3
      ),
      statusText:
        ratingCheckStatus === 'AI_AUTO_SELECTED'
          ? 'AI จัดเรตแล้ว'
          : ratingCheckStatus === 'VERIFIED_MATCH'
          ? 'ตรวจสอบแล้ว'
          : ratingCheckStatus === 'analyzing' || spriteSheetStatus === 'generating'
          ? 'กำลังจัดเรต...'
          : contentRating === 'auto'
          ? 'ให้ AI จัดเรต'
          : 'เลือกเอง (ตรวจหลัง HLS)',
    },
    4: {
      completed: Boolean(completedVideo),
      statusText: completedVideo
        ? 'เผยแพร่แล้ว'
        : isStartingPipeline ||
          currentStatus === 'PROCESSING' ||
          currentStatus === 'TRANSCODING' ||
          currentStatus === 'QUEUED'
        ? 'กำลังดำเนินการ'
        : 'พร้อมตรวจสอบ',
    },
  };

  const isReadyToPublish =
    hasTitle &&
    hasRating &&
    isRawUploaded &&
    !isUploading &&
    !isStartingPipeline &&
    currentStatus !== 'PROCESSING' &&
    currentStatus !== 'TRANSCODING' &&
    currentStatus !== 'QUEUED' &&
    currentStatus !== 'READY';

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#0F0F0F] text-[#212529] dark:text-[#F1F1F1] pb-28 transition-colors duration-200">
      {/* Studio Sub-header */}
      <div className="border-b border-[#EFECE6] dark:border-white/10 bg-white/90 dark:bg-[#181818]/90 backdrop-blur-md sticky top-14 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="px-3 py-1.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] text-xs font-semibold text-[#212529] dark:text-[#F1F1F1] border border-[#EFECE6] dark:border-white/10 transition inline-flex items-center gap-1.5 shrink-0"
              title="กลับหน้าหลัก"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">กลับหน้าหลัก</span>
            </Link>

            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h1 className="text-sm sm:text-[15px] font-bold text-[#212529] dark:text-[#F1F1F1] truncate max-w-[180px] sm:max-w-[360px]">
                  {file || activeVideoId
                    ? title || fileDetails.name || 'กำลังเตรียมวิดีโอ'
                    : 'TubeLock Studio'}
                </h1>
                {(file || activeVideoId) && (
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${
                      completedVideo || currentStatus === 'READY'
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                        : 'bg-[#FF7A00]/10 text-[#FF7A00]'
                    }`}
                  >
                    {completedVideo || currentStatus === 'READY'
                      ? 'เผยแพร่แล้ว'
                      : isRawUploaded
                      ? 'กำลังตั้งค่า'
                      : `อัปโหลด ${uploadStats.percent}%`}
                  </span>
                )}
              </div>
              {(activeVideoId || fileDetails.sizeFormatted !== '0 MB') && (
                <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] truncate">
                  {activeVideoId ? `ID: ${activeVideoId}` : ''}
                  {activeVideoId && fileDetails.sizeFormatted !== '0 MB' ? ' • ' : ''}
                  {fileDetails.sizeFormatted !== '0 MB' ? fileDetails.sizeFormatted : ''}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/upload/queue"
              className="text-xs px-3 py-1.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] text-[#212529] dark:text-[#F1F1F1] border border-[#EFECE6] dark:border-white/10 transition flex items-center gap-1.5 font-medium"
            >
              <ListOrdered className="w-3.5 h-3.5 text-[#8C857B]" />
              <span>คิวแปลงไฟล์</span>
              {queueCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-[#FF7A00] text-white text-[10px] font-mono">
                  {queueCount}
                </span>
              )}
            </Link>

            {/* Single Safe Overflow Menu for Destructive Cancel Action */}
            {(file || activeVideoId) && currentStatus !== 'READY' && (
              <div className="relative" ref={overflowMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowOverflowMenu((prev) => !prev)}
                  className="p-2 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] text-[#212529] dark:text-[#F1F1F1] border border-[#EFECE6] dark:border-white/10 transition cursor-pointer"
                  aria-label="เมนูเพิ่มเติม"
                  aria-expanded={showOverflowMenu}
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>

                {showOverflowMenu && (
                  <div className="absolute right-0 top-full mt-1.5 w-52 bg-white dark:bg-[#1c1c1c] border border-[#EFECE6] dark:border-white/15 rounded-xl shadow-xl p-1.5 z-50">
                    <button
                      type="button"
                      disabled={isCancelling}
                      onClick={() => {
                        setShowOverflowMenu(false);
                        setShowCancelModal(true);
                      }}
                      className="w-full text-left px-3 py-2 rounded-lg text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition cursor-pointer disabled:opacity-50"
                    >
                      ยกเลิกและลบงานนี้...
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-5 sm:pt-6">
        {errorMsg && (!activeVideoId || activeStep !== 4) && (
          <div role="alert" className="mb-4 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs sm:text-sm text-rose-700 dark:text-rose-400">
            {errorMsg}
          </div>
        )}

        {/* State A: File Drop Zone (No file selected yet) */}
        {isRestoring ? (
          <div role="status" className="py-16 text-center text-sm text-[#8C857B] dark:text-[#9A9A9A] flex items-center justify-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#FF7A00]" />
            <span>กำลังโหลดงานอัปโหลด...</span>
          </div>
        ) : !file && !activeVideoId ? (
          <div className="max-w-3xl mx-auto space-y-5 pt-2">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-10 sm:p-14 text-center cursor-pointer transition-all duration-200 bg-white dark:bg-[#181818] shadow-xs group ${
                isDragOver
                  ? 'border-[#FF7A00] bg-[#FF7A00]/5 scale-[1.01]'
                  : 'border-[#FF7A00]/35 hover:border-[#FF7A00]'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*,.mp4,.mkv,.mov,.webm,.avi"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0])}
              />

              <div className="w-14 h-14 rounded-2xl bg-[#FF7A00] text-white flex items-center justify-center mx-auto mb-5 shadow-md shadow-[#FF7A00]/20">
                <Upload className="w-6 h-6" />
              </div>

              <h2 className="text-lg sm:text-xl font-bold text-[#212529] dark:text-[#F1F1F1] mb-2">
                ลากไฟล์วิดีโอมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์
              </h2>
              <p className="text-xs sm:text-sm text-[#6C655D] dark:text-[#AAAAAA] max-w-md mx-auto mb-6 leading-relaxed">
                รองรับ MP4, MKV, MOV, WebM เมื่อเลือกไฟล์แล้วสามารถตั้งค่ารายละเอียด สั่ง AI ถอดเสียง และกำหนดเรตเนื้อหาได้ทันที
              </p>

              <button
                type="button"
                className="px-6 py-2.5 rounded-xl bg-[#FF7A00] hover:bg-[#E86E00] text-white text-xs sm:text-sm font-semibold transition pointer-events-none"
              >
                เลือกไฟล์วิดีโอจากเครื่อง
              </button>
            </div>

            {/* Pre-Upload Chunk Size Configuration (Moved from Step 4) */}
            <div className="p-4 bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
                  ตั้งค่าขนาดก้อนอัปโหลด (Chunk Size)
                </div>
                <div className="text-xs text-[#8C857B] dark:text-[#9A9A9A] mt-0.5">
                  ปรับก่อนเลือกไฟล์ — แนะนำ 10MB สำหรับอินเทอร์เน็ตทั่วไป
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {[10, 20, 50].map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => handleSelectChunkSize(sz)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold border transition cursor-pointer ${
                      chunkSizeMB === sz
                        ? 'bg-[#FF7A00] text-white border-[#FF7A00]'
                        : 'bg-[#F4F0E8] dark:bg-[#222222] border-[#EFECE6] dark:border-white/10 text-[#6C655D] dark:text-[#AAAAAA] hover:text-[#212529] dark:hover:text-[#F1F1F1]'
                    }`}
                  >
                    {sz} MB
                  </button>
                ))}
              </div>
            </div>

            {/* Clean Feature Highlights */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
              <div className="p-4 bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl">
                <div className="text-xs font-bold text-[#212529] dark:text-[#F1F1F1] mb-1">
                  1. ถอดเสียง &amp; สร้างซับ AI
                </div>
                <div className="text-xs text-[#6C655D] dark:text-[#9A9A9A] leading-relaxed">
                  สั่งถอดเสียงทำซับไตเติลอัตโนมัติ หรือแนบไฟล์ .SRT / .VTT เอง
                </div>
              </div>
              <div className="p-4 bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl">
                <div className="text-xs font-bold text-[#212529] dark:text-[#F1F1F1] mb-1">
                  2. จัดเรต &amp; ตรวจหลังหั่น HLS
                </div>
                <div className="text-xs text-[#6C655D] dark:text-[#9A9A9A] leading-relaxed">
                  เลือกเรตเองให้ AI ตรวจหลังหั่น HLS เสร็จ หรือกดให้ AI จัดเรตให้ทันที
                </div>
              </div>
              <div className="p-4 bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl">
                <div className="text-xs font-bold text-[#212529] dark:text-[#F1F1F1] mb-1">
                  3. สตรีม HLS เสียงสม่ำเสมอ
                </div>
                <div className="text-xs text-[#6C655D] dark:text-[#9A9A9A] leading-relaxed">
                  รองรับหลายความละเอียด พร้อมล็อกคุณภาพเสียงเท่ากันทุกระดับ
                </div>
              </div>
            </div>
          </div>
        ) : (
          /* State B: Multi-Step Studio Workspace */
          <div className="space-y-5">
            {/* Top Interactive Stepper Bar */}
            <StepIndicator
              activeStep={activeStep}
              setActiveStep={setActiveStep}
              stepStatus={stepStatus}
            />

            {/* Main Grid: Preview/Cloud Status Left (lg:col-span-4) & Active Step Right (lg:col-span-8) */}
            <div className="grid grid-cols-12 gap-5 items-start">
              {/* Right Column on Desktop, First on Mobile: Active Step Form */}
              <div className="col-span-12 lg:col-span-8 order-1 lg:order-2 space-y-5">
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
                    thumbnailUrl={thumbnailUrl}
                    thumbnailOptions={thumbnailOptions}
                    thumbnailStatus={thumbnailStatus}
                    isRawUploaded={isRawUploaded}
                    isSavingThumbnail={isSavingThumbnail}
                    onSelectThumbnail={handleSelectThumbnail}
                    onDispatchThumbnails={() =>
                      handleDispatchThumbnails(activeVideoIdRef.current || activeVideoId, rawFileName)
                    }
                    visionResult={visionResult}
                    onAddLog={addLog}
                  />
                )}

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
                    subtitleTracks={subtitleTracks}
                    onDispatchAudioSubtitles={handleDispatchAudioSubtitles}
                    onAddLog={addLog}
                  />
                )}

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
                    onDispatchSpriteRating={handleDispatchSpriteRating}
                    onApplyRecommendation={(result) => {
                      setContentRating(result.suggestedRating);
                      addLog(`นำเรตติ้ง "${result.suggestedRatingLabel}" ไปใช้กับวิดีโอเรียบร้อย`);
                    }}
                  />
                )}

                {activeStep === 4 && (
                  <StepPublish
                    title={title}
                    description={description}
                    category={category}
                    tags={tags}
                    contentRating={contentRating}
                    subtitleMode={subtitleMode}
                    manualSubtitleFile={manualSubtitleFile}
                    isUploading={isUploading}
                    isRawUploaded={isRawUploaded}
                    uploadPercent={uploadStats.percent}
                    currentStatus={currentStatus}
                    transcodeProgress={transcodeProgress}
                    completedVideo={completedVideo}
                    isStartingPipeline={isStartingPipeline}
                    errorMsg={errorMsg}
                    ratingCheckStatus={ratingCheckStatus}
                  />
                )}

                {/* Unified Bottom Step Navigation Bar (No redundant cancel, single Primary CTA) */}
                <div className="flex items-center justify-between p-4 bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl shadow-xs gap-3">
                  <button
                    type="button"
                    disabled={activeStep <= 1}
                    onClick={() => setActiveStep((prev) => Math.max(1, prev - 1))}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] text-[#212529] dark:text-[#F1F1F1] border border-[#EFECE6] dark:border-white/10 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>ย้อนกลับ</span>
                  </button>

                  <div className="text-xs text-[#8C857B] dark:text-[#9A9A9A] font-mono hidden sm:block">
                    ขั้นตอน {activeStep} จาก 4
                  </div>

                  <button
                    type="button"
                    disabled={activeStep === 4 && (!isReadyToPublish || isStartingPipeline)}
                    onClick={() => {
                      if (activeStep < 4) {
                        setActiveStep((prev) => Math.min(4, prev + 1));
                      } else {
                        handleStartPipeline();
                      }
                    }}
                    className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition ${
                      activeStep === 4 && (!isReadyToPublish || isStartingPipeline)
                        ? 'bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 text-[#8C857B] dark:text-[#666666] cursor-not-allowed'
                        : 'bg-[#FF7A00] hover:bg-[#E86E00] text-white cursor-pointer'
                    }`}
                  >
                    {activeStep === 4 && isStartingPipeline ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        <span>กำลังส่งเผยแพร่...</span>
                      </>
                    ) : activeStep === 4 &&
                      (currentStatus === 'PROCESSING' ||
                        currentStatus === 'TRANSCODING' ||
                        currentStatus === 'QUEUED') ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>กำลังแปลงสตรีม ({transcodeProgress}%)</span>
                      </>
                    ) : (
                      <>
                        <span>
                          {activeStep === 4 ? 'ยืนยันและเผยแพร่วิดีโอ' : 'ถัดไป'}
                        </span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>

                {/* Collapsible System Activity Logs */}
                <UploadLogs
                  logs={logs}
                  logEndRef={logEndRef}
                  onClearLogs={() => setLogs([])}
                />
              </div>

              {/* Left Column on Desktop, Second on Mobile: Video Preview & Cloud Status */}
              <div className="col-span-12 lg:col-span-4 order-2 lg:order-1">
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
                  audioStatus={audioStatus}
                  subtitleStatus={subtitleStatus}
                  spriteSheetStatus={spriteSheetStatus}
                  ratingCheckStatus={ratingCheckStatus}
                  contentRating={contentRating}
                  thumbnailStatus={thumbnailStatus}
                  runnerSpecs={runnerSpecs}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Safe Cancel Confirmation Modal */}
      {showCancelModal && (
        <div
          className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancelModalTitle"
        >
          <div className="w-full max-w-md bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/15 rounded-2xl p-6 shadow-2xl space-y-4">
            <div>
              <h3 id="cancelModalTitle" className="text-base font-bold text-[#212529] dark:text-[#F1F1F1]">
                ยืนยันการยกเลิกและลบงานนี้?
              </h3>
              <p className="text-xs sm:text-sm text-[#6C655D] dark:text-[#AAAAAA] mt-1.5 leading-relaxed">
                ไฟล์วิดีโอที่อัปโหลดขึ้น OneDrive และข้อมูลชั่วคราวของงานนี้จะถูกลบออกจากสตูดิโอ และไม่สามารถกู้คืนได้
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                disabled={isCancelling}
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] text-[#212529] dark:text-[#F1F1F1] border border-[#EFECE6] dark:border-white/10 transition cursor-pointer"
              >
                เก็บงานไว้ก่อน
              </button>
              <button
                type="button"
                disabled={isCancelling}
                onClick={async () => {
                  await handleCancelUpload();
                  setShowCancelModal(false);
                }}
                className="px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold bg-rose-600 hover:bg-rose-500 text-white transition flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
              >
                {isCancelling && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <span>{isCancelling ? 'กำลังลบงาน...' : 'ยืนยันลบงาน'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

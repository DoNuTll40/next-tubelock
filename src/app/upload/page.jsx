'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  Layers, Film, CheckCircle2, AlertCircle, RefreshCw,
  Play, HardDrive, Zap, ShieldCheck, Folder, Sparkles,
  Loader2, Clock, ChevronDown, ChevronUp, Copy, Check,
  Image as ImageIcon, Database, Activity, Maximize2, Code,
  Cpu, HardDriveDownload, CloudUpload, ArrowRight, RotateCcw,
  ListOrdered, ExternalLink
} from 'lucide-react';
import { extractVideoMetadata } from '@/lib/uploader';

const STAGES = [
  { id: 'UPLOADING', label: '1. ส่งไฟล์เข้า OneDrive', color: 'blue' },
  { id: 'QUEUED', label: '2. รอคิว GitHub Actions', color: 'amber' },
  { id: 'PROCESSING', label: '3. ดึงไฟล์ & เตรียมระบบ', color: 'purple' },
  { id: 'TRANSCODING', label: '4. หั่น HLS Multi-bitrate', color: 'orange' },
  { id: 'READY', label: '5. เสร็จสมบูรณ์ พร้อมดู', color: 'emerald' },
];

export default function UploadPage() {
  const fileInputRef = useRef(null);
  const logEndRef = useRef(null);
  const pollingTimerRef = useRef(null);

  // Tab View: 'upload' or 'queue'
  const [activeTab, setActiveTab] = useState('upload');

  // File & Metadata
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tagsInput, setTagsInput] = useState('HLS, 1080p, stream');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [metaInfo, setMetaInfo] = useState({
    width: 0,
    height: 0,
    duration: 0,
    fps: 30,
    codec: 'h264',
    resolutionLabel: '',
  });

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
  const [currentStatus, setCurrentStatus] = useState(null); // 'UPLOADING' | 'QUEUED' | 'PROCESSING' | 'TRANSCODING' | 'READY' | 'FAILED'
  const [transcodeProgress, setTranscodeProgress] = useState(0);
  const [stageDetail, setStageDetail] = useState('');
  const [errorMsg, setErrorMsg] = useState(null);
  const [completedVideo, setCompletedVideo] = useState(null);

  // Queue Dashboard Data
  const [queueItems, setQueueItems] = useState([]);
  const [loadingQueue, setLoadingQueue] = useState(false);

  // Logs & UI
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(true);
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

  // Handle File Select
  const handleFile = async (selectedFile) => {
    if (!selectedFile) return;
    setErrorMsg(null);
    setCompletedVideo(null);
    setCurrentStatus(null);
    setTranscodeProgress(0);
    setFile(selectedFile);

    const cleanBaseName = selectedFile.name.replace(/\.[^/.]+$/, '');
    setTitle(cleanBaseName);
    setDescription(`สตรีมมิ่งผ่าน HLS Multi-bitrate (ประมวลผลโดย GitHub Actions Ubuntu Runner)`);

    addLog(`เลือกไฟล์: "${selectedFile.name}" (${(selectedFile.size / (1024 * 1024)).toFixed(1)} MB)`);

    try {
      const meta = await extractVideoMetadata(selectedFile);
      setMetaInfo({
        width: meta.width || 1920,
        height: meta.height || 1080,
        duration: Math.round(meta.duration || 0),
        fps: 30,
        codec: 'h264',
        resolutionLabel: meta.resolution || '1080p',
      });
      if (meta.thumbnailDataUrl) {
        setThumbnailUrl(meta.thumbnailDataUrl);
      }
      addLog(`วิเคราะห์ขนาดไฟล์: ${meta.width}x${meta.height} [${meta.resolution}] • ความยาว ${Math.round(meta.duration)} วินาที`);
    } catch {
      console.warn('Could not extract metadata preview');
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
    setFile(null);
    setTitle('');
    setDescription('');
    setTagsInput('HLS, 1080p, stream');
    setThumbnailUrl('');
    setMetaInfo({ width: 0, height: 0, duration: 0, fps: 30, codec: 'h264', resolutionLabel: '' });
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

  // Status Poller Function
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

        if (vid.stageDetail) {
          addLog(`[คลาวด์สถานะ]: ${vid.status} • ${vid.stageDetail} (${vid.transcodeProgress || 0}%)`);
        }

        if (vid.status === 'READY') {
          clearInterval(pollingTimerRef.current);
          setCompletedVideo(vid);
          addLog(`🎉 แปลงวิดีโอ "${vid.title}" สำเร็จ 100%! พร้อมรับชมผ่าน HLS ทันที`);
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

  // Stop polling on unmount
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
      const interval = setInterval(loadQueue, 5000);
      return () => clearInterval(interval);
    }
  }, [activeTab, loadQueue]);

  // Start Pipeline: Step 1 Session -> Step 2 Direct Chunk Upload -> Step 3 Complete & Trigger
  const handleStartPipeline = async () => {
    if (!file || isUploading) return;

    setIsUploading(true);
    setErrorMsg(null);
    setCompletedVideo(null);
    setCurrentStatus('UPLOADING');
    setTranscodeProgress(0);
    setStageDetail('กำลังสร้าง Upload Session กับ Microsoft Graph API...');
    addLog(`🚀 เริ่มต้นกระบวนการ: ขอ Direct Upload Session เข้า OneDrive Business (/raw/)`);

    try {
      // 1. Request Upload Session
      const sessionRes = await fetch('/api/upload/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          title: title.trim() || file.name.replace(/\.[^/.]+$/, ''),
          description: description.trim(),
          fileSize: file.size,
        }),
      });

      if (!sessionRes.ok) {
        const errJson = await sessionRes.json().catch(() => ({}));
        throw new Error(errJson.error || 'ไม่สามารถเปิด Upload Session กับ Microsoft Graph ได้');
      }

      const sessionData = await sessionRes.json();
      const { uploadUrl, videoId, rawFileName: serverRawName } = sessionData;

      setActiveVideoId(videoId);
      setRawFileName(serverRawName);
      addLog(`✅ ได้รับ Upload URL จาก Microsoft Graph (Video ID: ${videoId})`);
      addLog(`📤 กำลังส่งไฟล์ตรงจาก Browser เข้าสู่ OneDrive /raw/${serverRawName} (Bypass Vercel 4.5MB)...`);

      // 2. Direct Chunked Upload to OneDrive
      // Microsoft Graph requires chunk sizes to be a multiple of 320 KiB (327,680 bytes)
      // 5 MiB = 5 * 1024 * 1024 = 5,242,880 bytes (exactly 16 * 327,680 bytes!)
      const CHUNK_SIZE = 5 * 1024 * 1024;
      const totalSize = file.size;
      const totalChunks = Math.ceil(totalSize / CHUNK_SIZE);
      let offset = 0;
      let chunkIndex = 0;
      const uploadStartTime = Date.now();

      while (offset < totalSize) {
        const end = Math.min(offset + CHUNK_SIZE, totalSize);
        const chunkBlob = file.slice(offset, end);
        const contentLength = end - offset;

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', uploadUrl, true);
          xhr.setRequestHeader('Content-Length', contentLength.toString());
          xhr.setRequestHeader('Content-Range', `bytes ${offset}-${end - 1}/${totalSize}`);

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const currentTotal = offset + e.loaded;
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

              setTranscodeProgress(Math.round(pct * 0.15)); // Upload phase represents 0-15% of total
              setStageDetail(`กำลังอัปโหลดเข้า OneDrive: ${pct}% (${(currentTotal / (1024 * 1024)).toFixed(1)} / ${(totalSize / (1024 * 1024)).toFixed(1)} MB • ${speedMBs} MB/s)`);
            }
          };

          xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 201 || xhr.status === 202) {
              resolve();
            } else {
              reject(new Error(`ส่งไฟล์เข้า OneDrive ล้มเหลว (${xhr.status}): ${xhr.responseText}`));
            }
          };

          xhr.onerror = () => reject(new Error('การเชื่อมต่อกับ OneDrive ขัดข้อง'));
          xhr.send(chunkBlob);
        });

        offset = end;
        chunkIndex++;
      }

      addLog(`✅ อัปโหลดไฟล์เข้า OneDrive Business 100% ครบถ้วน!`);
      setIsUploading(false);
      setCurrentStatus('QUEUED');
      setStageDetail('กำลังส่ง Webhook เพื่อเริ่มการทำงานของ GitHub Actions Transcoder...');
      addLog(`⚡ กำลังเรียก POST /api/upload/complete เพื่อ Trigger GitHub Actions...`);

      // 3. Trigger GitHub Actions via Complete API
      const completeRes = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          rawFileName: serverRawName,
          title: title.trim() || file.name.replace(/\.[^/.]+$/, ''),
          clientMeta: {
            duration: metaInfo.duration,
            resolution: metaInfo.resolutionLabel,
            fps: metaInfo.fps,
            codec: metaInfo.codec,
          },
        }),
      });

      const completeData = await completeRes.json();
      if (!completeRes.ok && !completeData.warning) {
        throw new Error(completeData.error || 'ส่งคำสั่งรัน GitHub Actions ไม่สำเร็จ');
      }

      if (completeData.warning) {
        addLog(`⚠️ แจ้งเตือน: ${completeData.warning}`);
        setStageDetail(completeData.warning);
      } else {
        addLog(`🚀 คำสั่งรัน GitHub Actions ถูกส่งเรียบร้อยแล้ว (สถานะ: PROCESSING)`);
        setCurrentStatus('PROCESSING');
      }

      // 4. Start real-time status polling every 3 seconds
      startPollingStatus(videoId);

    } catch (err) {
      setIsUploading(false);
      console.error('[Upload Pipeline Error]:', err);
      setErrorMsg(err.message || 'เกิดข้อผิดพลาดในการอัปโหลดหรือแปลงไฟล์');
      setCurrentStatus('FAILED');
      addLog(`❌ ข้อผิดพลาด: ${err.message}`);
    }
  };

  // Retry triggering GitHub Actions for an existing video
  const handleRetryTrigger = async (vidId, rFileName, vidTitle) => {
    try {
      addLog(`🔄 สั่งเริ่มรัน GitHub Actions ใหม่อีกครั้งสำหรับ Video #${vidId}...`);
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
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'สั่งรันใหม่ไม่สำเร็จ');

      addLog(`✅ ส่งคำสั่งสำเร็จ เริ่มติดตามสถานะแบบ Real-time`);
      startPollingStatus(vidId);
      if (activeTab === 'queue') loadQueue();
    } catch (err) {
      setErrorMsg(err.message);
      addLog(`❌ ลองใหม่ไม่สำเร็จ: ${err.message}`);
    }
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

  // Helper to determine step active/done
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
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8 flex flex-col gap-6 select-none pb-28">
      {/* Page Header */}
      <div className="pb-3 border-b border-[#EFECE6] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-[#212529] tracking-tight flex items-center gap-2.5">
            <CloudUpload className="w-6 h-6 text-[#FF7A00]" />
            TubeLock Cloud Transcoding Engine
          </h1>
          <p className="text-xs text-[#8C857B] mt-1">
            สถาปัตยกรรม Serverless Direct Upload + GitHub Actions (Ubuntu 2-Core / 7GB RAM) + HLS Multi-bitrate
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center p-1 bg-[#F5F2EB] rounded-2xl border border-[#EFECE6] self-stretch sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab('upload')}
            className={`flex-1 sm:flex-none py-1.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
              activeTab === 'upload'
                ? 'bg-white text-[#212529] shadow-xs'
                : 'text-[#8C857B] hover:text-[#212529]'
            }`}
          >
            <CloudUpload className="w-3.5 h-3.5 text-[#FF7A00]" />
            <span>อัปโหลดคลิปใหม่</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('queue')}
            className={`flex-1 sm:flex-none py-1.5 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 ${
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
        <>
          {/* Architecture Highlights Banner */}
          <div className="bg-gradient-to-r from-orange-50/70 via-amber-50/50 to-emerald-50/60 border border-[#EFECE6] rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-10 h-10 rounded-xl bg-white shadow-xs text-[#FF7A00] flex items-center justify-center shrink-0 border border-orange-100">
                <Cpu className="w-5 h-5 stroke-[2.2]" />
              </div>
              <div className="flex flex-col">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#212529]">Direct-to-Cloud Pipeline</span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800">
                    Bypass Vercel 4.5MB Limit
                  </span>
                </div>
                <span className="text-[11px] text-[#8C857B] mt-0.5">
                  Chunked Upload ตรงเข้า OneDrive Business • FFmpeg Multi-bitrate 1080p, 720p, 480p • อัปเดตสถานะสดทุก 3 วิ
                </span>
              </div>
            </div>

            {file && (
              <button
                type="button"
                onClick={handleReset}
                disabled={isUploading}
                className="flex items-center gap-1.5 text-xs text-rose-600 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 rounded-xl font-semibold transition active:scale-95 disabled:opacity-50"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>ล้างฟอร์ม</span>
              </button>
            )}
          </div>

          {/* Stepper Indicator */}
          {currentStatus && (
            <div className="bg-white border border-[#EFECE6] rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#212529] flex items-center gap-2">
                  <Activity className="w-4 h-4 text-[#FF7A00]" />
                  ขั้นตอนการประมวลผลวิดีโอ (Real-time Lifecycle)
                </span>
                <span className="text-xs font-mono font-bold text-[#FF7A00]">
                  {transcodeProgress}%
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full bg-[#F5F2EB] h-2.5 rounded-full overflow-hidden">
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

              {/* Steps Layout */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-2">
                {STAGES.map((s, idx) => {
                  const state = getStepState(s.id);
                  return (
                    <div
                      key={s.id}
                      className={`p-2.5 rounded-xl border text-xs flex flex-col gap-1 transition ${
                        state === 'completed'
                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-800 font-semibold'
                          : state === 'active'
                          ? 'bg-orange-50 border-orange-300 text-orange-900 font-bold ring-2 ring-orange-200'
                          : state === 'failed'
                          ? 'bg-rose-50 border-rose-300 text-rose-800 font-bold'
                          : 'bg-[#FBF9F5] border-[#EFECE6] text-[#8C857B]'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono opacity-80">0{idx + 1}</span>
                        {state === 'completed' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        ) : state === 'active' ? (
                          <Loader2 className="w-3.5 h-3.5 text-[#FF7A00] animate-spin" />
                        ) : state === 'failed' ? (
                          <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                        ) : (
                          <div className="w-2 h-2 rounded-full bg-[#D1C9BD]" />
                        )}
                      </div>
                      <span className="text-[11px] leading-tight mt-0.5">{s.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Status Message Text */}
              <div className="bg-[#FBF9F5] border border-[#EFECE6] rounded-xl px-3.5 py-2.5 flex items-center justify-between text-xs">
                <span className="text-[#212529] font-medium flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5 text-[#FF7A00]" />
                  {stageDetail || 'กำลังดำเนินการ...'}
                </span>
                {currentStatus === 'FAILED' && (
                  <button
                    type="button"
                    onClick={() => handleRetryTrigger(activeVideoId, rawFileName, title)}
                    className="flex items-center gap-1.5 px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold text-[11px] transition shadow-xs"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>ลองใหม่อีกครั้ง</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Success Banner when READY */}
          {completedVideo && (
            <div className="bg-emerald-50 border-2 border-emerald-400/80 rounded-2xl p-5 shadow-sm flex flex-col gap-4 animate-in fade-in zoom-in-95">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-xs">
                    <CheckCircle2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-emerald-950">
                      หั่นวิดีโอ HLS Multi-bitrate สำเร็จแล้ว!
                    </h3>
                    <p className="text-xs text-emerald-700 mt-0.5">
                      พร้อมรับชมผ่าน HLS.js บนทุกเบราว์เซอร์ด้วยความละเอียดปรับระดับอัตโนมัติ (ABR)
                    </p>
                  </div>
                </div>

                <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-emerald-200 text-emerald-900">
                  READY 100%
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <Link
                  href={`/watch/${completedVideo.id}`}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-xs transition active:scale-95"
                >
                  <Play className="w-3.5 h-3.5 fill-white" />
                  <span>เปิดดูวิดีโอทันที</span>
                </Link>

                <button
                  type="button"
                  onClick={() => copyWatchLink(completedVideo.id)}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-emerald-300 text-emerald-900 font-semibold text-xs hover:bg-emerald-100/50 transition"
                >
                  {copiedLink ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedLink ? 'คัดลอกลิงก์แล้ว!' : 'คัดลอกลิงก์วิดีโอ'}</span>
                </button>
              </div>
            </div>
          )}

          {/* File Selector & Drag-and-Drop */}
          {!file && (
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 flex flex-col items-center justify-center text-center cursor-pointer transition-all ${
                isDragOver
                  ? 'border-[#FF7A00] bg-orange-50/50 scale-[1.01]'
                  : 'border-[#D1C9BD] hover:border-[#FF7A00] bg-white'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/x-matroska"
                onChange={(e) => handleFile(e.target.files?.[0])}
                className="hidden"
              />

              <div className="w-14 h-14 rounded-2xl bg-orange-50 text-[#FF7A00] flex items-center justify-center mb-3 shadow-xs">
                <CloudUpload className="w-7 h-7 stroke-[2]" />
              </div>

              <h2 className="text-sm sm:text-base font-bold text-[#212529]">
                ลากไฟล์วิดีโอ .mp4 มาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์
              </h2>
              <p className="text-xs text-[#8C857B] mt-1 max-w-md">
                รองรับไฟล์ขนาดใหญ่ ไม่จำกัดขนาด ระบบจะส่งตรงเข้า OneDrive Business ผ่าน Chunked Upload
              </p>
            </div>
          )}

          {/* File Selected & Configuration */}
          {file && (
            <div className="bg-white border border-[#EFECE6] rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col gap-4">
              <div className="flex items-center justify-between pb-3 border-b border-[#EFECE6]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-50 text-[#FF7A00] flex items-center justify-center shrink-0">
                    <Film className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-bold text-[#212529] line-clamp-1">{file.name}</h3>
                    <span className="text-[11px] text-[#8C857B]">
                      {(file.size / (1024 * 1024)).toFixed(1)} MB • {metaInfo.width}x{metaInfo.height} [{metaInfo.resolutionLabel || '1080p'}]
                    </span>
                  </div>
                </div>

                <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-blue-100 text-blue-800">
                  พร้อมเริ่มทำงาน
                </span>
              </div>

              {/* Title & Description Fields */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-[#212529]">ชื่อวิดีโอ (Title)</label>
                  <input
                    type="text"
                    value={title}
                    disabled={isUploading || currentStatus === 'TRANSCODING'}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="ใส่ชื่อวิดีโอของคุณ"
                    className="w-full bg-[#FBF9F5] border border-[#EFECE6] rounded-xl px-3.5 py-2 text-xs text-[#212529] outline-none focus:border-[#FF7A00] focus:bg-white transition"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-[#212529]">คำอธิบาย (Description)</label>
                  <textarea
                    rows={2}
                    value={description}
                    disabled={isUploading || currentStatus === 'TRANSCODING'}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="ใส่คำอธิบายเพิ่มเติม"
                    className="w-full bg-[#FBF9F5] border border-[#EFECE6] rounded-xl px-3.5 py-2 text-xs text-[#212529] outline-none focus:border-[#FF7A00] focus:bg-white transition"
                  />
                </div>
              </div>

              {/* Direct Upload Live Stats Box (Client -> OneDrive) */}
              {isUploading && (
                <div className="bg-blue-50/70 border border-blue-200 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex items-center justify-between text-xs font-bold text-blue-900">
                    <span className="flex items-center gap-1.5">
                      <CloudUpload className="w-4 h-4 text-blue-600 animate-bounce" />
                      กำลังส่งไฟล์ตรงเข้า OneDrive Business (/raw/)
                    </span>
                    <span className="font-mono text-sm">{uploadStats.percent}%</span>
                  </div>

                  <div className="w-full bg-blue-100 h-2.5 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full transition-all duration-300"
                      style={{ width: `${uploadStats.percent}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono text-blue-800">
                    <div>
                      <span className="text-[#8C857B] block">ขนาดที่ส่งแล้ว:</span>
                      <span className="font-bold">
                        {(uploadStats.uploadedBytes / (1024 * 1024)).toFixed(1)} / {(uploadStats.totalBytes / (1024 * 1024)).toFixed(1)} MB
                      </span>
                    </div>
                    <div>
                      <span className="text-[#8C857B] block">ความเร็วอัปโหลด:</span>
                      <span className="font-bold text-emerald-700">{uploadStats.speedMBs} MB/s</span>
                    </div>
                    <div>
                      <span className="text-[#8C857B] block">เวลาที่เหลือ (ETA):</span>
                      <span className="font-bold">{uploadStats.etaSeconds} วินาที</span>
                    </div>
                    <div>
                      <span className="text-[#8C857B] block">ก้อน Chunk ที่:</span>
                      <span className="font-bold">{uploadStats.currentChunk} / {uploadStats.totalChunks}</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Button */}
              {!currentStatus && (
                <button
                  type="button"
                  onClick={handleStartPipeline}
                  disabled={isUploading}
                  className="w-full py-3 px-4 rounded-xl bg-[#FF7A00] hover:bg-[#E56E00] active:scale-[0.99] text-white font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition cursor-pointer"
                >
                  <Zap className="w-4 h-4 fill-white" />
                  <span>เริ่มต้นอัปโหลดและสั่งแปลงไฟล์ HLS Multi-bitrate</span>
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        /* Queue & Status Overview Dashboard */
        <div className="bg-white border border-[#EFECE6] rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col gap-4">
          <div className="flex items-center justify-between pb-3 border-b border-[#EFECE6]">
            <div>
              <h2 className="text-sm font-bold text-[#212529] flex items-center gap-2">
                <ListOrdered className="w-4 h-4 text-blue-600" />
                คิวงานแปลงไฟล์ล่าสุด (Transcode Queue Dashboard)
              </h2>
              <p className="text-xs text-[#8C857B] mt-0.5">
                รายการวิดีโอที่กำลังอยู่ในคิวแปลงไฟล์ หรือกำลังประมวลผลบน GitHub Actions
              </p>
            </div>

            <button
              type="button"
              onClick={loadQueue}
              disabled={loadingQueue}
              className="flex items-center gap-1 text-xs text-[#8C857B] hover:text-[#212529] px-2.5 py-1 rounded-lg border border-[#EFECE6] hover:bg-[#FBF9F5] transition"
            >
              <RefreshCw className={`w-3 h-3 ${loadingQueue ? 'animate-spin' : ''}`} />
              <span>รีเฟรช</span>
            </button>
          </div>

          {queueItems.length === 0 ? (
            <div className="py-12 flex flex-col items-center justify-center text-center text-[#8C857B]">
              <CheckCircle2 className="w-8 h-8 text-emerald-500 mb-2 stroke-[1.5]" />
              <span className="text-xs font-bold text-[#212529]">ไม่มีคิวงานค้างในขณะนี้</span>
              <span className="text-[11px] mt-0.5">วิดีโอทั้งหมดถูกแปลงเป็น HLS และพร้อมรับชมแล้ว 100%</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {queueItems.map((item) => (
                <div
                  key={item.id}
                  className="p-4 rounded-xl border border-[#EFECE6] bg-[#FBF9F5] flex flex-col gap-2.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[#212529] line-clamp-1">{item.title}</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                            item.status === 'TRANSCODING'
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
                          {item.status}
                        </span>
                      </div>
                      <span className="text-[11px] text-[#8C857B] mt-0.5 block">
                        ไฟล์ดิบ: {item.rawFileName} • ID: #{item.id}
                      </span>
                    </div>

                    {item.status === 'FAILED' && (
                      <button
                        type="button"
                        onClick={() => handleRetryTrigger(item.id, item.rawFileName, item.title)}
                        className="flex items-center gap-1 px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-bold transition shrink-0"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>ลองใหม่</span>
                      </button>
                    )}
                  </div>

                  {/* Progress bar in card */}
                  <div className="w-full bg-[#EFECE6] h-1.5 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${
                        item.status === 'FAILED' ? 'bg-rose-500' : 'bg-[#FF7A00]'
                      }`}
                      style={{ width: `${item.transcodeProgress || 0}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-[#8C857B]">
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

      {/* Terminal Logs Drawer */}
      <div className="bg-white border border-[#EFECE6] rounded-2xl shadow-xs overflow-hidden">
        <div
          onClick={() => setShowLogs(!showLogs)}
          className="px-4 py-3 bg-[#FBF9F5] border-b border-[#EFECE6] flex items-center justify-between cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Code className="w-4 h-4 text-[#FF7A00]" />
            <span className="text-xs font-bold text-[#212529]">บันทึกการทำงานสด (Real-time Console Logs)</span>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#EFECE6] text-[#8C857B]">
              {logs.length} บรรทัด
            </span>
          </div>

          <div className="flex items-center gap-2">
            {logs.length > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); copyLogText(); }}
                className="text-[11px] text-[#8C857B] hover:text-[#212529] px-2 py-0.5 rounded border border-[#EFECE6] hover:bg-white transition flex items-center gap-1"
              >
                {copiedLog ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                <span>{copiedLog ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
              </button>
            )}
            {showLogs ? <ChevronUp className="w-4 h-4 text-[#8C857B]" /> : <ChevronDown className="w-4 h-4 text-[#8C857B]" />}
          </div>
        </div>

        {showLogs && (
          <div className="p-3 bg-[#1E1E1E] text-[#D4D4D4] font-mono text-[11px] h-48 overflow-y-auto space-y-1 select-text">
            {logs.length === 0 ? (
              <span className="text-[#6A9955]">// ยังไม่มีกิจกรรม พร้อมสำหรับการอัปโหลด...</span>
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
  );
}

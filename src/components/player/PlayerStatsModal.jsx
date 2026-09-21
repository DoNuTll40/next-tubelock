'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Activity, Copy, X, AlertTriangle, Zap } from 'lucide-react';

export default function PlayerStatsModal({
  showStats,
  setShowStats,
  video,
  hlsRef,
  containerRef,
  videoRatio = 1.777,
  aspectMode = 'fit',
  isPlaying,
  fps = 30,
  codec = 'h264',
  videoId = '',
  src = '',
  showToast,
}) {
  const [copied, setCopied] = useState(false);
  const [realtimeFps, setRealtimeFps] = useState('0.0');
  const [stats, setStats] = useState({
    viewport: '0x0',
    dpr: '1.0',
    optimalRes: '0x0',
    currentRes: '0x0',
    bufferHealth: 0,
    droppedFrames: 0,
    totalFrames: 0,
    dropRate: '0.0%',
    protocol: 'Direct MP4 Stream',
    isHeavyCodec: false,
    connectionSpeedKbps: 52000,
    streamBitrateKbps: 4500,
    networkActivityKB: 0,
    isNetworkActive: false,
    volumeNormalized: '100% / 100%',
    sCPN: '',
    date: '',
  });

  const scpnRef = useRef('');
  const rvfcIdRef = useRef(null);
  const frameCountRef = useRef(0);
  const lastFpsTimeRef = useRef(0);
  const lastChunkBitrateRef = useRef(0);
  const networkActivityTimeoutRef = useRef(null);
  const currentNetworkKBRef = useRef(0);

  // Initialize unique session sCPN once
  if (!scpnRef.current) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const chunk = (len) => Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    scpnRef.current = `${chunk(4)} ${chunk(4)} ${chunk(4)} ${chunk(4)}`;
  }

  // 1. ISOLATED FPS TELEMETRY (Only re-renders PlayerStatsModal, ZERO VideoPlayer re-renders!)
  useEffect(() => {
    const v = video?.current;
    if (!showStats || !v || !isPlaying) {
      if (rvfcIdRef.current && v?.cancelVideoFrameCallback) {
        v.cancelVideoFrameCallback(rvfcIdRef.current);
      }
      return;
    }

    frameCountRef.current = 0;
    lastFpsTimeRef.current = performance.now();

    const handleVideoFrame = (now) => {
      frameCountRef.current += 1;
      const elapsed = now - lastFpsTimeRef.current;

      if (elapsed >= 500) {
        const measuredFps = frameCountRef.current / (elapsed / 1000);
        setRealtimeFps(measuredFps.toFixed(1));
        frameCountRef.current = 0;
        lastFpsTimeRef.current = now;
      }

      if (video?.current && 'requestVideoFrameCallback' in video.current) {
        rvfcIdRef.current = video.current.requestVideoFrameCallback(handleVideoFrame);
      }
    };

    if ('requestVideoFrameCallback' in v) {
      rvfcIdRef.current = v.requestVideoFrameCallback(handleVideoFrame);
    }

    return () => {
      if (rvfcIdRef.current && v?.cancelVideoFrameCallback) {
        v.cancelVideoFrameCallback(rvfcIdRef.current);
      }
    };
  }, [showStats, isPlaying, video]);

  // 2. LIVE HLS NETWORK ACTIVITY & REAL-TIME VBR BITRATE LISTENER
  useEffect(() => {
    if (!showStats) return;
    const hls = hlsRef?.current;
    if (!hls) return;

    let HlsEvents = null;
    try {
      // Access HLS events from global or constructor if available
      HlsEvents = hls.constructor?.Events || {
        FRAG_LOADING: 'hlsFragLoading',
        FRAG_LOAD_PROGRESS: 'hlsFragLoadProgress',
        FRAG_LOADED: 'hlsFragLoaded',
      };
    } catch {
      return;
    }

    const onFragLoading = () => {
      setStats((prev) => ({ ...prev, isNetworkActive: true }));
    };

    const onFragLoadProgress = (event, data) => {
      if (data?.stats?.loaded) {
        const kb = Math.round(data.stats.loaded / 1024);
        currentNetworkKBRef.current = kb;
        setStats((prev) => ({
          ...prev,
          networkActivityKB: kb,
          isNetworkActive: true,
        }));
      }
    };

    const onFragLoaded = (event, data) => {
      if (data?.stats?.total) {
        const kb = Math.round(data.stats.total / 1024);
        currentNetworkKBRef.current = kb;

        // Calculate actual instantaneous VBR chunk bitrate: (bytes * 8) / (duration * 1000)
        const durationSec = data.frag?.duration || 2.0;
        if (durationSec > 0) {
          const vbrKbps = Math.round((data.stats.total * 8) / (durationSec * 1000));
          if (vbrKbps > 500) {
            lastChunkBitrateRef.current = vbrKbps;
          }
        }

        setStats((prev) => ({
          ...prev,
          networkActivityKB: kb,
          streamBitrateKbps: lastChunkBitrateRef.current || prev.streamBitrateKbps,
          isNetworkActive: true,
        }));

        // After chunk finishes downloading and buffer is idle, smoothly reset activity to 0 KB
        if (networkActivityTimeoutRef.current) clearTimeout(networkActivityTimeoutRef.current);
        networkActivityTimeoutRef.current = setTimeout(() => {
          currentNetworkKBRef.current = 0;
          setStats((prev) => ({
            ...prev,
            networkActivityKB: 0,
            isNetworkActive: false,
          }));
        }, 1800);
      }
    };

    if (HlsEvents?.FRAG_LOADING) hls.on(HlsEvents.FRAG_LOADING, onFragLoading);
    if (HlsEvents?.FRAG_LOAD_PROGRESS) hls.on(HlsEvents.FRAG_LOAD_PROGRESS, onFragLoadProgress);
    if (HlsEvents?.FRAG_LOADED) hls.on(HlsEvents.FRAG_LOADED, onFragLoaded);

    return () => {
      if (HlsEvents?.FRAG_LOADING) hls.off(HlsEvents.FRAG_LOADING, onFragLoading);
      if (HlsEvents?.FRAG_LOAD_PROGRESS) hls.off(HlsEvents.FRAG_LOAD_PROGRESS, onFragLoadProgress);
      if (HlsEvents?.FRAG_LOADED) hls.off(HlsEvents.FRAG_LOADED, onFragLoaded);
      if (networkActivityTimeoutRef.current) clearTimeout(networkActivityTimeoutRef.current);
    };
  }, [showStats, hlsRef]);

  // 3. ISOLATED TELEMETRY POLLING INTERVAL (1s)
  useEffect(() => {
    if (!showStats) return;

    const interval = setInterval(() => {
      const v = video?.current;
      const c = containerRef?.current;
      const hls = hlsRef?.current;
      if (!v || !c) return;

      const cur = v.currentTime || 0;
      let bufHealth = 0;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= cur && cur <= v.buffered.end(i)) {
          bufHealth = v.buffered.end(i) - cur;
          break;
        }
      }

      let dropped = 0;
      let total = 0;
      if (typeof v.getVideoPlaybackQuality === 'function') {
        const quality = v.getVideoPlaybackQuality();
        dropped = quality.droppedVideoFrames;
        total = quality.totalVideoFrames;
      } else {
        dropped = v.webkitDroppedFrameCount || 0;
      }

      const isHls = src?.startsWith('blob:') || src?.includes('.m3u8') || src?.includes('playlist');
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      const dropRate = total > 0 ? ((dropped / total) * 100).toFixed(1) + '%' : '0.0%';
      const isAv1or4K =
        (codec?.toLowerCase().includes('av1') || codec?.toLowerCase().includes('av01')) &&
        (v.videoWidth >= 2500 || Number(fps) >= 50);

      // Connection speed from live HLS bandwidth estimator
      let bandwidthBps = 0;
      if (hls?.bandwidthEstimate && hls.bandwidthEstimate > 0) {
        bandwidthBps = hls.bandwidthEstimate;
      } else if (typeof navigator !== 'undefined' && navigator.connection?.downlink) {
        bandwidthBps = navigator.connection.downlink * 1000 * 1000;
      } else {
        bandwidthBps = 54000000;
      }
      const connectionSpeedKbps = Math.round(bandwidthBps / 1000);

      // Stream Bitrate: Live VBR from latest fragment if available, else current level bitrate
      let streamBitrate = lastChunkBitrateRef.current;
      if (!streamBitrate && hls?.levels && hls.currentLevel >= 0) {
        const lvl = hls.levels[hls.currentLevel];
        if (lvl?.bitrate) streamBitrate = Math.round(lvl.bitrate / 1000);
      }
      if (!streamBitrate) {
        const h = v.videoHeight || 1080;
        streamBitrate = h >= 2160 ? 18000 : h >= 1440 ? 10000 : h >= 1080 ? 4500 : h >= 720 ? 2500 : 1200;
      }

      const volPct = Math.round((v.muted ? 0 : v.volume) * 100);

      setStats((prev) => ({
        ...prev,
        viewport: `${c.clientWidth}x${c.clientHeight}`,
        dpr: dpr.toFixed(1),
        optimalRes: `${v.videoWidth || 1920}x${v.videoHeight || 1080}`,
        currentRes: `${v.videoWidth || 1920}x${v.videoHeight || 1080}`,
        bufferHealth: bufHealth,
        droppedFrames: dropped,
        totalFrames: total,
        dropRate,
        protocol: isHls ? 'HLS Adaptive Bitrate' : 'Direct MP4 Stream',
        isHeavyCodec: isAv1or4K,
        connectionSpeedKbps,
        streamBitrateKbps: streamBitrate,
        volumeNormalized: `${volPct}% / ${volPct}%`,
        sCPN: scpnRef.current,
        date: new Date().toString(),
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [showStats, video, hlsRef, containerRef, src, codec, fps]);

  if (!showStats) return null;

  const currentFpsNumber = parseFloat(realtimeFps) || 0;
  const targetFpsNumber = parseFloat(fps) || 30;

  const handleCopy = () => {
    const text = [
      `Video ID / sCPN: ${videoId || 'N/A'} / ${stats.sCPN || 'N/A'}`,
      `Viewport / Frames: ${stats.viewport}*${stats.dpr} / ${stats.droppedFrames} dropped of ${stats.totalFrames} (${stats.dropRate})`,
      `Current / Optimal Res: ${stats.currentRes}@${fps || 30} / ${stats.optimalRes}@${fps || 30}`,
      `Volume / Normalized: ${stats.volumeNormalized}`,
      `Codecs: ${codec} (${stats.protocol})`,
      `Color: bt709 / bt709`,
      `Connection Speed: ${stats.connectionSpeedKbps.toLocaleString()} Kbps`,
      `Stream Bitrate: ${stats.streamBitrateKbps.toLocaleString()} Kbps (VBR)`,
      `Network Activity: ${stats.networkActivityKB} KB`,
      `Buffer Health: ${stats.bufferHealth.toFixed(2)} s`,
      `Live FPS: ${isPlaying ? realtimeFps : '0.0'} / ${fps || 30} fps`,
      `Date: ${stats.date || new Date().toString()}`,
    ].join('\n');

    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {});
      setCopied(true);
      showToast?.('คัดลอกข้อมูลสถิติแล้ว');
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div
      className="absolute top-3 left-3 sm:top-4 sm:left-4 z-40 bg-black/50 border border-white/15 rounded-2xl p-3.5 sm:p-4 text-[10.5px] sm:text-[11px] font-mono text-zinc-200 shadow-2xl backdrop-blur-md w-[92%] sm:w-[390px] md:w-[420px] max-h-[85%] overflow-y-auto select-text scrollbar-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* HUD Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2.5 mb-2.5 font-sans">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-[#FF7A00]" />
          <h4 className="text-xs font-bold text-white leading-none">สถิติสำหรับเด็กเนิร์ด</h4>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/10 text-emerald-400 font-mono font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleCopy}
            className="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 border border-white/10 text-zinc-200 text-[10px] font-sans flex items-center gap-1.5 transition cursor-pointer"
            title="คัดลอกข้อมูลสถิติเพื่อการวิเคราะห์"
          >
            <Copy className="w-3 h-3 text-[#FF7A00]" />
            <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowStats?.(false)}
            className="p-1 rounded-lg hover:bg-white/15 text-zinc-400 hover:text-white transition cursor-pointer"
            aria-label="ปิด"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Heavy Codec Warning */}
      {stats.isHeavyCodec && (
        <div className="mb-2 p-2 bg-amber-500/10 border border-amber-500/25 rounded-xl text-[10px] text-amber-200 flex items-start gap-1.5 font-sans">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="leading-snug">
            <span className="font-bold text-amber-300">แจ้งเตือนโหลดสูง (4K AV1):</span> อุปกรณ์ที่ไม่มีชิปฮาร์ดแวร์ AV1 จะถอดรหัสด้วย CPU อาจทำให้กระตุกได้
          </div>
        </div>
      )}

      {/* Telemetry Metrics Table */}
      <div className="flex flex-col gap-1.5 leading-tight">
        {/* Video ID / sCPN */}
        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Video ID / sCPN</span>
          <span className="text-zinc-100 font-medium truncate ml-3 max-w-[210px] sm:max-w-[240px]">
            {videoId || '827'} / {stats.sCPN}
          </span>
        </div>

        {/* Viewport / Frames */}
        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Viewport / Frames</span>
          <span className="text-zinc-100">
            {stats.viewport}*{stats.dpr} /{' '}
            <span className={stats.droppedFrames > 10 ? 'text-rose-400 font-bold' : 'text-zinc-200'}>
              {stats.droppedFrames} dropped of {stats.totalFrames}
            </span>
          </span>
        </div>

        {/* Current / Optimal Res */}
        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Current / Optimal Res</span>
          <span className="text-zinc-100 font-medium">
            <span className="text-[#FF7A00]">{stats.currentRes}@{fps || 30}</span>
            <span className="text-zinc-400"> / {stats.optimalRes}@{fps || 30}</span>
          </span>
        </div>

        {/* Volume / Normalized */}
        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Volume / Normalized</span>
          <span className="text-zinc-200">{stats.volumeNormalized}</span>
        </div>

        {/* Codecs & Stream Protocol */}
        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Codecs</span>
          <span className="text-zinc-100 font-medium">
            <span className="uppercase text-amber-300">{codec}</span>
            <span className="text-zinc-400 text-[10px]"> ({stats.protocol})</span>
          </span>
        </div>

        {/* Color Space */}
        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Color</span>
          <span className="text-zinc-300 font-mono">bt709 / bt709</span>
        </div>

        {/* Aspect Ratio / Fit */}
        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Aspect Ratio / Fit</span>
          <span className="text-zinc-200">
            {videoRatio?.toFixed?.(3) || '1.778'}:1{' '}
            <span className="text-[#FF7A00] font-semibold uppercase">({aspectMode})</span>
          </span>
        </div>

        {/* Live Playback FPS */}
        <div className="flex justify-between items-center bg-white/5 px-2.5 py-1 rounded-xl my-0.5 border border-white/5">
          <span className="text-zinc-300 flex items-center gap-1">
            <Zap className="w-3 h-3 text-emerald-400" /> Live FPS (จริง / เป้าหมาย):
          </span>
          <span className="font-bold font-mono">
            <span
              className={
                !isPlaying
                  ? 'text-zinc-400'
                  : currentFpsNumber > 0 && currentFpsNumber < targetFpsNumber - 4
                  ? 'text-rose-400'
                  : 'text-emerald-400'
              }
            >
              {isPlaying ? realtimeFps : '0.0'}
            </span>
            <span className="text-zinc-400 font-normal"> / {fps || 30} fps</span>
          </span>
        </div>

        {/* Connection Speed (YouTube-Style with Blue Bar) */}
        <div className="flex flex-col gap-1 py-1 border-t border-white/5">
          <div className="flex justify-between items-center">
            <span className="text-zinc-400 flex items-center gap-1.5">
              Connection Speed
              <span className="text-[9px] text-zinc-500 font-sans">(เน็ตเวิร์ก)</span>
            </span>
            <span className="text-sky-400 font-bold font-mono">
              {stats.connectionSpeedKbps.toLocaleString()} Kbps
            </span>
          </div>
          <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/10">
            <div
              className="h-full bg-gradient-to-r from-blue-600 via-sky-500 to-sky-400 transition-all duration-300 rounded-full"
              style={{
                width: `${Math.min(Math.max((stats.connectionSpeedKbps / 80000) * 100, 3), 100)}%`,
              }}
            />
          </div>
        </div>

        {/* Real-time Stream Bitrate (Live Dynamic VBR) */}
        <div className="flex justify-between items-center py-1 border-t border-white/5">
          <span className="text-zinc-400 flex items-center gap-1">
            Stream Bitrate
            <span className="text-[9px] text-emerald-400 font-sans px-1 py-0.2 rounded bg-emerald-500/10">
              VBR
            </span>
          </span>
          <span className="text-emerald-400 font-bold font-mono">
            {stats.streamBitrateKbps.toLocaleString()} Kbps
          </span>
        </div>

        {/* Network Activity (YouTube-Style Live Pulse) */}
        <div className="flex flex-col gap-1 py-1 border-t border-white/5">
          <div className="flex justify-between items-center">
            <span className="text-zinc-400 flex items-center gap-1">
              Network Activity
              {stats.isNetworkActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-ping" />
              )}
            </span>
            <span className="text-zinc-300 font-mono">
              {stats.networkActivityKB > 0 ? (
                <span className="text-sky-300 font-semibold">{stats.networkActivityKB.toLocaleString()} KB</span>
              ) : (
                <span className="text-zinc-500">0 KB (พักบัฟเฟอร์)</span>
              )}
            </span>
          </div>
          <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/10">
            <div
              className={`h-full transition-all duration-200 rounded-full ${
                stats.isNetworkActive ? 'bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.5)]' : 'bg-zinc-600'
              }`}
              style={{
                width: `${Math.min(Math.max((stats.networkActivityKB / 3000) * 100, stats.isNetworkActive ? 15 : 0), 100)}%`,
              }}
            />
          </div>
        </div>

        {/* Buffer Health (YouTube-Style with Countdown & Refill) */}
        <div className="flex flex-col gap-1 py-1 border-t border-white/5">
          <div className="flex justify-between items-center">
            <span className="text-zinc-400">Buffer Health</span>
            <span
              className={`font-bold font-mono ${
                stats.bufferHealth > 15
                  ? 'text-[#FFA726]'
                  : stats.bufferHealth > 5
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            >
              {stats.bufferHealth.toFixed(2)} s
            </span>
          </div>
          <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden border border-white/10">
            <div
              className="h-full transition-all duration-300 rounded-full"
              style={{
                backgroundColor:
                  stats.bufferHealth > 15
                    ? '#FFA726'
                    : stats.bufferHealth > 5
                    ? '#FBBF24'
                    : '#F43F5E',
                width: `${Math.min((stats.bufferHealth / 40) * 100, 100)}%`,
              }}
            />
          </div>
        </div>

        {/* Live Date / Timestamp */}
        <div className="flex justify-between items-center pt-1.5 text-[9.5px] text-zinc-500 border-t border-white/5 font-mono">
          <span className="shrink-0">Date:</span>
          <span className="truncate ml-2 text-zinc-400">{stats.date || new Date().toString()}</span>
        </div>
      </div>
    </div>
  );
}

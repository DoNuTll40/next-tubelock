'use client';

import React from 'react';
import { Activity, Copy, X, AlertTriangle, Zap } from 'lucide-react';

export default function PlayerStatsModal({
  showStats,
  setShowStats,
  copyTelemetry,
  statsCopied,
  nerdStats,
  videoRatio = 1.777,
  aspectMode = 'fit',
  isPlaying,
  realtimeFps = '0.0',
  fps = 30,
  codec = 'h264',
}) {
  if (!showStats) return null;

  const currentFpsNumber = parseFloat(realtimeFps) || 0;
  const targetFpsNumber = parseFloat(fps) || 30;

  return (
    <div className="absolute top-3 left-3 sm:top-4 sm:left-4 z-40 bg-[#0F0E0D]/95 border border-white/15 rounded-2xl p-3.5 sm:p-4 text-[11px] font-mono text-zinc-300 shadow-2xl w-[92%] sm:w-[350px] md:w-[370px] max-h-[82%] overflow-y-auto select-text scrollbar-none">
      {/* HUD Header */}
      <div className="flex items-center justify-between border-b border-white/10 pb-2 mb-2 font-sans">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-red-500/20 flex items-center justify-center text-red-500">
            <Activity className="w-3.5 h-3.5" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-white leading-none">สถิติสำหรับเด็กเนิร์ด</h4>
            <span className="text-[9px] text-emerald-400 font-mono font-medium flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Live Telemetry
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={copyTelemetry}
            className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-200 text-[10px] font-sans flex items-center gap-1 transition cursor-pointer"
          >
            <Copy className="w-3 h-3 text-red-500" />
            <span>{statsCopied ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowStats?.(false)}
            className="p-1 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Heavy Codec Warning for Mobile Phones */}
      {nerdStats?.isHeavyCodec && (
        <div className="mb-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-[10px] text-amber-200 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div className="leading-snug">
            <span className="font-bold text-amber-300">แจ้งเตือนโหลดสูง (4K AV1):</span> มือถือรุ่นเก่าหรือไม่มีชิป AV1 ฮาร์ดแวร์ จะถอดรหัสด้วย CPU ทำให้เกิด Dropframe ได้
          </div>
        </div>
      )}

      {/* Telemetry Metrics */}
      <div className="flex flex-col gap-1.5 text-[10px] leading-tight">
        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Stream Source:</span>
          <span className="text-white font-bold">{nerdStats?.protocol}</span>
        </div>

        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Viewport / DPR:</span>
          <span className="text-zinc-200">
            {nerdStats?.viewport} <span className="text-zinc-400">({nerdStats?.dpr}x)</span>
          </span>
        </div>

        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Native Resolution:</span>
          <span className="text-red-500 font-bold">{nerdStats?.optimalRes}</span>
        </div>

        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Aspect Ratio / Fit:</span>
          <span className="text-zinc-200">
            {videoRatio?.toFixed?.(3) || '1.777'}:1{' '}
            <span className="text-amber-400 uppercase font-semibold">({aspectMode})</span>
          </span>
        </div>

        {/* Live Playback FPS */}
        <div className="flex justify-between items-center bg-white/5 px-2 py-1 rounded-lg my-0.5">
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

        {/* Dropped Frames with Highlight */}
        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Dropped Frames:</span>
          <span className={nerdStats?.droppedFrames > 10 ? 'text-rose-400 font-bold' : 'text-zinc-200'}>
            {nerdStats?.droppedFrames} / {nerdStats?.totalFrames}{' '}
            <span className="text-zinc-400">({nerdStats?.dropRate})</span>
          </span>
        </div>

        <div className="flex justify-between items-center py-0.5 border-b border-white/5">
          <span className="text-zinc-400">Video Codec:</span>
          <span className="text-zinc-100 uppercase font-bold">{codec}</span>
        </div>

        {/* Buffer Health Meter */}
        <div className="flex flex-col gap-1 pt-1">
          <div className="flex justify-between items-center">
            <span className="text-zinc-400">Buffer Health:</span>
            <span
              className={`font-bold ${
                (nerdStats?.bufferHealth || 0) > 15
                  ? 'text-emerald-400'
                  : (nerdStats?.bufferHealth || 0) > 5
                  ? 'text-amber-400'
                  : 'text-rose-400'
              }`}
            >
              {(nerdStats?.bufferHealth || 0).toFixed(1)} s
            </span>
          </div>
          <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                (nerdStats?.bufferHealth || 0) > 15
                  ? 'bg-emerald-400'
                  : (nerdStats?.bufferHealth || 0) > 5
                  ? 'bg-amber-400'
                  : 'bg-rose-400'
              }`}
              style={{ width: `${Math.min(((nerdStats?.bufferHealth || 0) / 40) * 100, 100)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import {
  Cpu,
  HardDrive,
  RefreshCw,
  ExternalLink,
  Terminal,
  Loader2,
} from 'lucide-react';
import { encodeUploadId } from '@/lib/videoUtils';

export default function StudioTechTab({
  video,
  isRetranscoding = false,
  onDispatchTranscode,
}) {
  if (!video) return null;

  const fileSizeMb = (Number(video.fileSizeBytes || 0) / (1024 * 1024)).toFixed(2);
  const bitrateKbps = video.bitrate ? `${Math.round(Number(video.bitrate) / 1000)} kbps` : '-';
  const logs = Array.isArray(video.workerLogs) ? video.workerLogs : [];

  return (
    <div className="space-y-6">
      <section className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1] flex items-center gap-2">
              <Cpu className="w-4 h-4 text-[#FF7A00]" />
              <span>ข้อมูลเทคนิคและไฟล์ต้นฉบับ</span>
            </h3>
            <p className="text-[11px] text-[#6C655D] dark:text-[#9A9A9A] mt-0.5">
              สเปกวิดีโอจากการสแกนของ FFprobe และสถานะการแปลงสตรีม HLS
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/upload?upload_id=${encodeUploadId(video.id)}`}
              className="px-3 py-1.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border border-[#EFECE6] dark:border-white/10 text-xs font-semibold text-[#212529] dark:text-[#F1F1F1] inline-flex items-center gap-1.5 transition"
            >
              <ExternalLink className="w-3.5 h-3.5 text-[#FF7A00]" />
              <span>เปิดหน้า Pipeline อัปโหลด</span>
            </Link>

            {video.rawFileName && onDispatchTranscode && (
              <button
                type="button"
                disabled={isRetranscoding}
                onClick={onDispatchTranscode}
                className="px-3 py-1.5 rounded-xl bg-[#FF7A00]/10 hover:bg-[#FF7A00] text-[#FF7A00] hover:text-white border border-[#FF7A00]/30 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-50"
              >
                {isRetranscoding ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                <span>{isRetranscoding ? 'กำลังส่งคำสั่ง...' : 'สั่งแปลง HLS ใหม่'}</span>
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'ความละเอียด', value: video.resolution || '-' },
            { label: 'เฟรมเรต (FPS)', value: video.fps ? `${Number(video.fps)} fps` : '-' },
            { label: 'Codec ต้นฉบับ', value: (video.codec || '-').toUpperCase() },
            { label: 'บิตเรตต้นฉบับ', value: bitrateKbps },
            { label: 'ขนาดไฟล์', value: `${fileSizeMb} MB` },
            { label: 'สถานะ HLS', value: `${video.status || 'READY'} (${video.transcodeProgress || 0}%)` },
          ].map((item) => (
            <div
              key={item.label}
              className="p-3 rounded-xl bg-[#F4F0E8]/70 dark:bg-[#222222]/80 border border-[#EFECE6] dark:border-white/10"
            >
              <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A]">{item.label}</div>
              <div className="text-xs sm:text-sm font-bold font-mono text-[#212529] dark:text-[#F1F1F1] mt-0.5 truncate">
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div className="p-3.5 rounded-xl bg-[#F4F0E8]/70 dark:bg-[#222222]/80 border border-[#EFECE6] dark:border-white/10 space-y-2 text-xs">
          <div className="flex items-center gap-1.5 font-semibold text-[#212529] dark:text-[#F1F1F1]">
            <HardDrive className="w-3.5 h-3.5 text-[#FF7A00]" />
            <span>เส้นทางไฟล์บน OneDrive Business</span>
          </div>
          <div className="font-mono text-[11px] text-[#6C655D] dark:text-[#CCCCCC] break-all">
            Raw: {video.rawFileName ? `/raw/${video.rawFileName}` : 'ไม่มีไฟล์ต้นฉบับ'}
          </div>
          <div className="font-mono text-[11px] text-[#6C655D] dark:text-[#CCCCCC] break-all">
            Stream: {video.masterPlaylistPath || `/streams/stream_vid_${video.id}/master.m3u8`}
          </div>
        </div>
      </section>

      {logs.length > 0 && (
        <section className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-3">
          <h3 className="text-xs sm:text-sm font-bold text-[#212529] dark:text-[#F1F1F1] flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#FF7A00]" />
            <span>บันทึกการทำงานล่าสุด (Worker Logs)</span>
          </h3>
          <div className="max-h-72 overflow-y-auto rounded-xl bg-[#111111] border border-white/10 p-3.5 space-y-1.5 font-mono text-[11px] text-zinc-300">
            {logs.slice(-40).map((entry, idx) => (
              <div key={idx} className="leading-relaxed break-words">
                <span className="text-zinc-500 mr-2">[{entry.time || entry.source || 'log'}]</span>
                <span
                  className={
                    entry.level === 'error'
                      ? 'text-rose-400'
                      : entry.level === 'warn'
                      ? 'text-amber-400'
                      : entry.level === 'success'
                      ? 'text-emerald-400'
                      : 'text-zinc-200'
                  }
                >
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

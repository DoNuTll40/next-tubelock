'use client';

import Link from 'next/link';
import { Play, Clock, HardDrive, MoreVertical, Layers } from 'lucide-react';
import { useState } from 'react';
import { formatResolutionBadge } from '@/lib/videoUtils';

export default function VideoCard({ video, replace = false, compact = false }) {
  const [showMenu, setShowMenu] = useState(false);

  const formatDuration = (sec) => {
    if (!sec) return '00:00';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const fileSizeMB = (Number(video.file_size_bytes || 0) / (1024 * 1024)).toFixed(1);
  const resBadge = formatResolutionBadge(video.resolution);
  const is4K = resBadge === '4K';
  const is2K = resBadge === '2K';

  if (compact) {
    return (
      <div className="flex gap-3 group relative select-none items-start">
        <Link
          href={`/watch/${video.id}`}
          replace={replace}
          className="relative w-36 sm:w-40 aspect-video rounded-xl bg-[#1E1B18] overflow-hidden border border-[#EFECE6] shrink-0 shadow-2xs"
        >
          {video.thumbnail_url ? (
            <>
              <img
                src={video.thumbnail_url}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover blur-sm scale-110 opacity-30 select-none pointer-events-none"
              />
              <img
                src={video.thumbnail_url}
                alt={video.title}
                className="relative z-10 w-full h-full object-contain drop-shadow-xs"
                loading="lazy"
              />
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[#151413]">
              <Play className="w-6 h-6 text-[#C4BEB4] stroke-[1.5]" />
            </div>
          )}

          <div className="absolute top-1.5 left-1.5 z-10 flex gap-1 items-center">
            <span
              className={`text-[9px] font-bold px-1.5 py-0.2 rounded border backdrop-blur-md uppercase ${
                is4K
                  ? 'bg-[#FF7A00] text-white border-[#FF7A00]'
                  : is2K
                  ? 'bg-amber-500/90 text-white border-amber-400/50'
                  : 'bg-black/75 text-white border-white/10 font-semibold'
              }`}
            >
              {resBadge}
            </span>
          </div>

          {video.duration > 0 && (
            <div className="absolute bottom-1.5 right-1.5 z-10 bg-black/80 text-white text-[10px] font-semibold px-1.5 py-0.2 rounded flex items-center gap-1 border border-white/10 font-mono">
              {formatDuration(video.duration)}
            </div>
          )}
        </Link>

        <div className="flex-1 min-w-0 pr-1 flex flex-col justify-start">
          <Link href={`/watch/${video.id}`} replace={replace}>
            <h4 className="text-xs sm:text-[13px] font-bold text-[#212529] line-clamp-2 leading-snug group-hover:text-[#FF7A00] transition-colors">
              {video.title}
            </h4>
          </Link>
          <span className="text-[11px] text-[#8C857B] mt-1 truncate">
            {video.description ? video.description.replace('สแกนจากโฟลเดอร์ ', '') : 'OneDrive Storage'}
          </span>
          <div className="flex items-center gap-1 text-[10px] text-[#8C857B] mt-0.5">
            <span className="font-semibold text-[#FF7A00] uppercase bg-[#FFF4EB] px-1 py-0.2 rounded">
              {video.codec ? video.codec.toUpperCase() : 'H264'}
            </span>
            <span>•</span>
            <span className="font-mono">{fileSizeMB} MB</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col group relative select-none">
      <Link
        href={`/watch/${video.id}`}
        replace={replace}
        className="flex flex-col"
      >
        {/* 16:9 Thumbnail Screen */}
        <div className="relative aspect-video w-full rounded-2xl bg-[#1E1B18] overflow-hidden border border-[#EFECE6] shadow-xs">
          {video.thumbnail_url ? (
            <>
              <img
                src={video.thumbnail_url}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover blur-sm scale-110 opacity-30 select-none pointer-events-none"
              />
              <img
                src={video.thumbnail_url}
                alt={video.title}
                className="relative z-10 w-full h-full object-contain drop-shadow-sm"
                loading="lazy"
              />
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-[#151413]">
              <Play className="w-8 h-8 text-[#C4BEB4] stroke-[1.5]" />
            </div>
          )}

          {/* Top Badges */}
          <div className="absolute top-2.5 left-2.5 z-10 flex gap-1 items-center">
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-md border backdrop-blur-md uppercase tracking-wide ${
                is4K
                  ? 'bg-[#FF7A00] text-white border-[#FF7A00] shadow-xs'
                  : is2K
                  ? 'bg-amber-500/90 text-white border-amber-400/50'
                  : 'bg-black/75 text-white border-white/10 font-semibold'
              }`}
            >
              {resBadge}
            </span>
            {Number(video.fps) > 0 && (
              <span className="bg-black/75 backdrop-blur-md text-zinc-200 text-[10px] font-medium px-1.5 py-0.5 rounded-md border border-white/10 font-mono">
                {Number(video.fps).toFixed(0)} fps
              </span>
            )}
          </div>

          {/* Bottom Duration Badge */}
          {video.duration > 0 && (
            <div className="absolute bottom-2.5 right-2.5 z-10 bg-black/80 text-white text-[11px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 border border-white/10 font-mono">
              <Clock className="w-3 h-3 stroke-[2]" />
              {formatDuration(video.duration)}
            </div>
          )}
        </div>
      </Link>

      {/* Video Details Row (YouTube PC & Mobile Layout) */}
      <div className="flex items-start gap-3 pt-3 px-0.5">
        {/* Author / Channel Avatar */}
        <div className="w-9 h-9 rounded-full bg-[#FFF4EB] border border-[#FF7A00]/20 flex items-center justify-center shrink-0 mt-0.5 shadow-xs">
          <Layers className="w-4 h-4 text-[#FF7A00]" />
        </div>

        {/* Info Column */}
        <div className="flex-1 min-w-0 pr-1">
          <Link href={`/watch/${video.id}`} replace={replace}>
            <h3 className="text-sm font-bold text-[#212529] line-clamp-2 leading-snug group-hover:text-[#FF7A00] transition-colors">
              {video.title}
            </h3>
          </Link>

          <div className="flex flex-col text-[12px] text-[#8C857B] mt-1 leading-normal">
            <span className="truncate hover:text-[#212529] transition-colors">
              {video.description ? video.description.replace('สแกนจากโฟลเดอร์ ', '') : 'OneDrive Storage'}
            </span>
            <div className="flex items-center gap-1.5 text-[11px] text-[#8C857B]">
              <span className="font-semibold text-[#FF7A00] uppercase bg-[#FFF4EB] px-1.5 py-0.2 rounded text-[10px]">
                {video.codec ? video.codec.toUpperCase() : 'H264'}
              </span>
              <span>•</span>
              <span className="font-mono">{fileSizeMB} MB</span>
              <span>•</span>
              <span>{video.source_type === 'hls' ? 'HLS Stream' : 'Direct'}</span>
            </div>
          </div>
        </div>

        {/* 3-Dots Menu Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowMenu(!showMenu)}
            className="p-1.5 -mr-1 rounded-full hover:bg-[#EFECE6] text-[#8C857B] hover:text-[#212529] transition cursor-pointer"
            title="ตัวเลือกเพิ่มเติม"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {/* Quick Dropdown Menu */}
          {showMenu && (
            <div
              className="absolute right-0 top-8 z-30 w-44 bg-white rounded-2xl border border-[#EFECE6] shadow-xl p-1.5 flex flex-col gap-1 text-xs"
              onMouseLeave={() => setShowMenu(false)}
            >
              <Link
                href={`/watch/${video.id}`}
                className="px-3 py-2 rounded-xl hover:bg-[#FBF9F5] text-[#212529] font-medium flex items-center gap-2"
              >
                <Play className="w-3.5 h-3.5 text-[#FF7A00]" />
                <span>เล่นวิดีโอ</span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(`${window.location.origin}/watch/${video.id}`);
                  setShowMenu(false);
                }}
                className="w-full text-left px-3 py-2 rounded-xl hover:bg-[#FBF9F5] text-[#212529] font-medium"
              >
                คัดลอกลิงก์
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

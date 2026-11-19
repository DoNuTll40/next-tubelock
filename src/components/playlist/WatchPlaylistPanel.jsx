'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Film, Loader2, LockKeyhole, Play, Repeat, Repeat1, Shuffle, X } from 'lucide-react';
import { PlaylistVisibility } from './PlaylistCard';
import { useVideoWatchProgress } from '@/lib/useVideoWatchProgress';
import { formatVideoDuration } from '@/lib/videoEditorUtils';
import { isMatureVideo, RESTRICTED_POSTER } from '@/lib/videoUtils';

const desktopQuery = '(min-width: 1024px)';
const getDesktop = () => window.matchMedia(desktopQuery).matches;
const getServerDesktop = () => false;
const subscribeDesktop = (onChange) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
};

const loopLabels = {
  none: 'ปิดการเล่นวน',
  all: 'เล่นวนทั้งเพลย์ลิสต์',
  one: 'เล่นวนคลิปนี้',
};

const panelClass = 'overflow-hidden rounded-2xl border border-[#EFECE6] bg-white text-[#212529] shadow-xs dark:border-white/10 dark:bg-[#181818] dark:text-[#F1F1F1]';
const iconButtonClass = 'grid size-9 shrink-0 cursor-pointer place-items-center rounded-full text-[#6C655D] hover:bg-[#F4F0E8] dark:text-[#AAAAAA] dark:hover:bg-white/10';
const activeControlClass = 'aria-pressed:bg-[#FFF4EB] aria-pressed:text-[#9E4700] dark:aria-pressed:bg-[#FF7A00]/15 dark:aria-pressed:text-[#FF9E40]';

function PlaylistRow({ video, index, active, rowRef, onSelect }) {
  const { progressPct } = useVideoWatchProgress(video);
  const mature = isMatureVideo(video);
  const thumbnail = mature ? RESTRICTED_POSTER : video.thumbnail_url;
  const duration = Number(video.duration);

  return (
    <li ref={rowRef}>
      <button
        type="button"
        onClick={() => onSelect(index)}
        aria-current={active ? 'true' : undefined}
        className={`flex w-full cursor-pointer items-center gap-2.5 border-l-2 px-2.5 py-2 text-left transition ${
          active
            ? 'border-[#FF7A00] bg-[#FFF4EB] dark:bg-[#FF7A00]/12'
            : 'border-transparent hover:bg-[#F4F0E8] dark:hover:bg-white/5'
        }`}
      >
        <span className="grid w-6 shrink-0 place-items-center font-mono text-xs text-[#6C655D] dark:text-[#AAAAAA]">
          {active ? (
            <>
              <span className="sr-only">{index + 1}</span>
              <Play className="size-3.5 fill-[#FF7A00] text-[#FF7A00]" aria-hidden="true" />
            </>
          ) : index + 1}
        </span>
        <span className="relative grid aspect-video w-[100px] shrink-0 place-items-center overflow-hidden rounded-lg bg-[#222222] text-white">
          {thumbnail ? (
            <Image src={thumbnail} alt="" fill unoptimized className="object-cover" />
          ) : (
            <Film className="size-5 text-white/60" aria-hidden="true" />
          )}
          {mature && (
            <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded bg-black/80 px-1 py-0.5 text-[9px] font-semibold">
              <LockKeyhole className="size-2.5" aria-hidden="true" />18+
            </span>
          )}
          {duration > 0 && (
            <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 font-mono text-[10px] font-semibold">
              {formatVideoDuration(duration)}
            </span>
          )}
          {progressPct > 0 && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-black/40" aria-hidden="true">
              <span className="block h-full bg-[#FF7A00]" style={{ width: `${progressPct}%` }} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-xs font-semibold leading-snug text-[#212529] dark:text-[#F1F1F1]">
            {video.title}
          </span>
          {video.author_name && (
            <span className="mt-1 block truncate text-[11px] text-[#6C655D] dark:text-[#AAAAAA]">{video.author_name}</span>
          )}
        </span>
      </button>
    </li>
  );
}

export default function WatchPlaylistPanel({
  state,
  nextVideo,
  onSelect,
  onToggleShuffle,
  onCycleLoop,
  onClose,
}) {
  const listId = useId();
  const listRef = useRef(null);
  const activeRowRef = useRef(null);
  const desktop = useSyncExternalStore(subscribeDesktop, getDesktop, getServerDesktop);
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [mobileOpen, setMobileOpen] = useState(false);
  const expanded = desktop ? desktopOpen : mobileOpen;
  const playlist = state?.playlist;
  const items = state?.items;
  const index = state?.currentIndex ?? -1;

  useEffect(() => {
    const list = listRef.current;
    const row = activeRowRef.current;
    if (!expanded || !list || !row) return;

    // Keep the active row visible without moving the surrounding watch page.
    const listRect = list.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top < listRect.top) list.scrollTop += rowRect.top - listRect.top;
    else if (rowRect.bottom > listRect.bottom) list.scrollTop += rowRect.bottom - listRect.bottom;
  }, [desktop, expanded, index, items]);

  if (!state) return null;
  if (state.isLoading) {
    return (
      <section aria-label="เพลย์ลิสต์" className={`${panelClass} flex items-center justify-between gap-2 px-3.5 py-2`}>
        <p role="status" className="flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin text-[#FF7A00]" aria-hidden="true" />
          กำลังโหลดเพลย์ลิสต์…
        </p>
        <button type="button" onClick={onClose} aria-label="ปิดแผงเพลย์ลิสต์" className={iconButtonClass}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </section>
    );
  }
  if (!playlist || !items?.length) return null;

  const detailHref = `/playlist/${encodeURIComponent(playlist.route_key ?? state.listKey)}`;
  const counter = `${Math.max(0, index + 1)} / ${items.length}`;
  const loopMode = state.loopMode ?? 'none';
  const loopLabel = loopLabels[loopMode];
  const LoopIcon = loopMode === 'one' ? Repeat1 : Repeat;
  const DisclosureIcon = expanded ? ChevronUp : ChevronDown;
  const activeClass = `${iconButtonClass} ${activeControlClass}`;

  return (
    <section aria-label={`เพลย์ลิสต์ ${playlist.title}`} className={panelClass}>
      {desktop ? (
        <div className="flex items-start justify-between gap-2 px-3.5 pt-3">
          <div className="min-w-0">
            <h2>
              <Link href={detailHref} prefetch={false} className="block truncate text-base font-bold hover:underline">
                {playlist.title}
              </Link>
            </h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 pb-3 text-xs text-[#6C655D] dark:text-[#AAAAAA]">
              <PlaylistVisibility visibility={playlist.visibility} />
              {playlist.owner_name && <><span aria-hidden="true">•</span><span className="truncate">{playlist.owner_name}</span></>}
              <span aria-hidden="true">•</span>
              <span className="font-mono">{counter}</span>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              aria-label={expanded ? 'พับเพลย์ลิสต์' : 'แสดงเพลย์ลิสต์'}
              onClick={() => setDesktopOpen(!expanded)}
              className={iconButtonClass}
            >
              <DisclosureIcon className="size-4" aria-hidden="true" />
            </button>
            <button type="button" onClick={onClose} aria-label="ปิดแผงเพลย์ลิสต์" className={iconButtonClass}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-1 px-2.5 py-2">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setMobileOpen(!expanded)}
            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-xl px-1 py-1 text-left"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {nextVideo ? `ถัดไป: ${nextVideo.title}` : 'สิ้นสุดเพลย์ลิสต์'}
              </span>
              <span className="mt-0.5 flex items-center gap-1.5 text-xs text-[#6C655D] dark:text-[#AAAAAA]">
                <span className="truncate">{playlist.title}</span>
                <span className="shrink-0 font-mono font-semibold text-[#9E4700] dark:text-[#FF9E40]">{counter}</span>
              </span>
            </span>
            <DisclosureIcon className="size-4 shrink-0 text-[#6C655D] dark:text-[#AAAAAA]" aria-hidden="true" />
          </button>
          <button type="button" onClick={onClose} aria-label="ปิดแผงเพลย์ลิสต์" className={iconButtonClass}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      )}
      <div id={listId} hidden={!expanded}>
        {expanded && (
          <>
            <div className="flex items-center gap-1 px-2.5 pb-2">
              <button
                type="button"
                aria-label={`เปลี่ยนโหมดวนซ้ำ (${loopLabel})`}
                aria-pressed={loopMode !== 'none'}
                title={loopLabel}
                onClick={onCycleLoop}
                className={activeClass}
              >
                <LoopIcon className="size-[18px]" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="สุ่มเล่น"
                aria-pressed={state.isShuffled}
                title="สุ่มเล่น"
                onClick={onToggleShuffle}
                className={activeClass}
              >
                <Shuffle className="size-[18px]" aria-hidden="true" />
              </button>
              {!desktop && (
                <Link href={detailHref} prefetch={false} className="ml-auto rounded-lg px-2 py-2 text-xs font-semibold hover:underline">
                  ดูทั้งเพลย์ลิสต์
                </Link>
              )}
            </div>
            <ol ref={listRef} className="max-h-[55dvh] overflow-y-auto overscroll-contain border-t border-[#EFECE6] lg:max-h-[420px] dark:border-white/10">
              {items.map((video, position) => (
                <PlaylistRow
                  key={video.item_id ?? video.id}
                  video={video}
                  index={position}
                  active={position === index}
                  rowRef={position === index ? activeRowRef : null}
                  onSelect={onSelect}
                />
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

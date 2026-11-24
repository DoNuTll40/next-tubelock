'use client';

import Image from 'next/image';
import { extractDominantColor } from '@/lib/colorExtractor';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown, ArrowUp, GripVertical, ListVideo, LockKeyhole, MoreVertical, Pencil, Play,
  Share2, Shuffle, Trash2, UserRound,
} from 'lucide-react';
import { PlaylistCover, PlaylistVisibility } from '@/components/playlist/PlaylistCard';
import PlaylistFormModal, { PlaylistDeleteModal } from '@/components/playlist/PlaylistFormModal';
import { requestPlaylistJson } from '@/components/playlist/PlaylistPicker';
import { usePosterPreference } from '@/lib/usePosterPreference';
import { isMatureVideo, protectVideoPoster } from '@/lib/videoUtils';

const statusLabels = {
  FAILED: 'ประมวลผลไม่สำเร็จ',
  PROCESSING: 'กำลังประมวลผล',
  QUEUED: 'รอประมวลผล',
  TRANSCODING: 'กำลังแปลงวิดีโอ',
  UPLOADING: 'กำลังอัปโหลด',
};
const primaryAction = 'inline-flex min-h-10 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#FF7A00] px-4 text-sm font-semibold text-white hover:bg-[#E56E00] dark:hover:bg-[#FF8C1A]';
const secondaryAction = 'inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[#0000000a] px-4 text-sm font-medium hover:bg-[#00000012] dark:bg-white/10 dark:hover:bg-white/15';
const rowAction = 'inline-flex size-8 items-center justify-center rounded-full hover:bg-black/[0.06] focus-visible:outline-[#FF7A00] disabled:cursor-default disabled:opacity-30 dark:hover:bg-white/10';
const disabledAction = 'disabled:cursor-default disabled:opacity-40';

function isPlayable(item) {
  return item.status == null || item.status === 'READY';
}

function watchUrl(item, index, routeKey, shuffle = false) {
  return `/watch/${item.slug}?list=${encodeURIComponent(routeKey)}&index=${index + 1}${shuffle ? '&shuffle=1' : ''}`;
}

function formatVideoDuration(duration) {
  const seconds = Math.max(0, Math.floor(Number(duration) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}

function formatTotalDuration(duration) {
  const seconds = Math.max(0, Math.floor(duration));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours) return minutes ? `${hours} ชม. ${minutes} นาที` : `${hours} ชม.`;
  return minutes ? `${minutes} นาที` : `${seconds} วินาที`;
}

function VideoRowContent({ item }) {
  const { thumbnail_url: protectedThumb } = protectVideoPoster(item);
  const mature = isMatureVideo(item);
  const allow18Plus = usePosterPreference(mature);
  const isMasked = mature && !allow18Plus;
  const thumbnail = mature && allow18Plus && item.id
    ? `/api/videos/${item.id}/poster`
    : protectedThumb;
  const playable = isPlayable(item);

  return (
    <>
      <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-lg bg-[#F4F0E8] dark:bg-[#222222] sm:w-40">
        {thumbnail ? (
          <Image src={thumbnail} alt="" fill sizes="(min-width: 640px) 160px, 144px" unoptimized className="object-cover" />
        ) : (
          <ListVideo aria-hidden="true" className="absolute inset-0 m-auto size-5 opacity-35" />
        )}
        {isMasked && (
          <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white">
            <LockKeyhole aria-hidden="true" className="size-3 text-[#FF9E40]" />
            18+
          </span>
        )}
        {playable && Number(item.duration) > 0 && (
          <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 text-[10px] font-semibold tabular-nums text-white">
            {formatVideoDuration(item.duration)}
          </span>
        )}
      </div>
      <div className="min-w-0 space-y-1">
        <p className="line-clamp-2 text-sm font-semibold leading-snug sm:text-base">{item.title}</p>
        {item.author_name && (
          <p className="truncate text-xs text-black/55 dark:text-white/55">{item.author_name}</p>
        )}
        {!playable && (
          <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium ${item.status === 'FAILED'
            ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
            : 'bg-[#FFF4EB] text-[#9C4900] dark:bg-[#FF7A00]/15 dark:text-[#FF9E40]'}`}>
            {statusLabels[item.status] || 'ยังไม่พร้อมเล่น'}
          </span>
        )}
      </div>
    </>
  );
}

export default function PlaylistDetailClient({ initialPlaylist, initialItems }) {
  const router = useRouter();
  const [playlist, setPlaylist] = useState(initialPlaylist);
  const [coverColor, setCoverColor] = useState(null);
  const [items, setItems] = useState(initialItems);
  const [dialog, setDialog] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [removing, setRemoving] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [dropTarget, setDropTarget] = useState(null);
  const draggedItemId = useRef(null);
  const mutations = useRef({
    active: true,
    confirmedItems: initialItems,
    visibleItems: initialItems,
    pendingOrder: null,
    orderRequest: null,
    orderTimer: null,
    removing: false,
    recovering: false,
  });
  const endpoint = `/api/playlists/${encodeURIComponent(playlist.route_key)}`;

  const publishItems = useCallback((nextItems) => {
    mutations.current.visibleItems = nextItems;
    if (mutations.current.active) setItems(nextItems);
  }, []);

  const refreshItems = useCallback(async () => {
    const state = mutations.current;
    if (!state.active) return;
    state.recovering = true;
    setRecovering(true);
    publishItems(state.confirmedItems);
    try {
      const current = await requestPlaylistJson(endpoint, { cache: 'no-store' }, 'โหลดเพลย์ลิสต์ไม่สำเร็จ');
      state.confirmedItems = current.items;
      publishItems(current.items);
    } catch {
      // The last successfully saved order is already on screen.
    } finally {
      state.recovering = false;
      if (state.active) setRecovering(false);
    }
  }, [endpoint, publishItems]);

  const savePendingOrder = useCallback(function saveOrder() {
    const state = mutations.current;
    if (state.orderRequest) return state.orderRequest;
    if (!state.pendingOrder) return Promise.resolve();

    const orderedItems = state.pendingOrder;
    state.pendingOrder = null;
    const body = JSON.stringify({ orderedVideoIds: orderedItems.map((item) => item.id) });
    state.orderRequest = requestPlaylistJson(
      `${endpoint}/items/reorder`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
        keepalive: body.length < 60000,
      },
      'บันทึกลำดับวิดีโอไม่สำเร็จ',
    ).then(() => {
      state.confirmedItems = orderedItems;
    }).catch(async (error) => {
      clearTimeout(state.orderTimer);
      state.orderTimer = null;
      state.pendingOrder = null;
      if (state.active) setNotice({ message: error.message, error: true });
      await refreshItems();
    }).finally(() => {
      state.orderRequest = null;
      if (!state.orderTimer && state.pendingOrder) void saveOrder();
    });
    return state.orderRequest;
  }, [endpoint, refreshItems]);

  useEffect(() => {
    const state = mutations.current;
    state.active = true;
    return () => {
      state.active = false;
      clearTimeout(state.orderTimer);
      state.orderTimer = null;
      if (state.pendingOrder) void savePendingOrder();
    };
  }, [savePendingOrder]);

  function moveItem(itemId, toIndex) {
    const state = mutations.current;
    if (state.removing || state.recovering) return;

    const fromIndex = state.visibleItems.findIndex((item) => item.id === itemId);
    if (fromIndex < 0 || fromIndex === toIndex || toIndex < 0 || toIndex >= state.visibleItems.length) return;

    const next = [...state.visibleItems];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    publishItems(next);
    setNotice(null);
    state.pendingOrder = next;
    clearTimeout(state.orderTimer);
    state.orderTimer = setTimeout(() => {
      state.orderTimer = null;
      void savePendingOrder();
    }, 300);
  }

  function moveBy(itemId, offset) {
    const index = mutations.current.visibleItems.findIndex((item) => item.id === itemId);
    moveItem(itemId, index + offset);
  }

  function startDrag(event, itemId) {
    const state = mutations.current;
    if (state.removing || state.recovering) {
      event.preventDefault();
      return;
    }
    draggedItemId.current = itemId;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(itemId));
    const row = event.currentTarget.closest('li');
    if (row) event.dataTransfer.setDragImage(row, 16, row.offsetHeight / 2);
  }

  function finishDrag() {
    draggedItemId.current = null;
    setDropTarget(null);
  }

  function dragAfter(event) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY > bounds.top + bounds.height / 2;
  }

  function dragOver(event, itemId) {
    if (draggedItemId.current === null) return;
    if (draggedItemId.current === itemId) {
      setDropTarget(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const after = dragAfter(event);
    setDropTarget((current) => current?.id === itemId && current.after === after ? current : { id: itemId, after });
  }

  function dropOn(event, itemId) {
    const id = draggedItemId.current;
    if (id === null) return;
    event.preventDefault();

    const current = mutations.current.visibleItems;
    const from = current.findIndex((item) => item.id === id);
    const to = current.findIndex((item) => item.id === itemId);
    if (from >= 0 && to >= 0 && from !== to) {
      const insertion = to + (dragAfter(event) ? 1 : 0);
      moveItem(id, insertion - (from < insertion ? 1 : 0));
    }
    finishDrag();
  }

  async function removeItem(item) {
    const state = mutations.current;
    if (state.removing || state.recovering) return;

    state.removing = true;
    setRemoving(true);
    setNotice(null);
    clearTimeout(state.orderTimer);
    state.orderTimer = null;
    try {
      while (state.orderRequest || state.pendingOrder) {
        await savePendingOrder();
      }
      if (!state.active) return;

      const next = state.visibleItems.filter((video) => video.id !== item.id);
      publishItems(next);
      await requestPlaylistJson(
        `${endpoint}/items?videoId=${item.id}`,
        { method: 'DELETE' },
        'นำวิดีโอออกจากเพลย์ลิสต์ไม่สำเร็จ',
      );
      state.confirmedItems = next;
      if (state.active) setNotice({ message: 'นำวิดีโอออกจากเพลย์ลิสต์แล้ว' });
    } catch (error) {
      if (state.active) setNotice({ message: error.message, error: true });
      await refreshItems();
    } finally {
      state.removing = false;
      if (state.active) setRemoving(false);
    }
  }

  async function sharePlaylist() {
    try {
      const url = new URL(`/playlist/${encodeURIComponent(playlist.route_key)}`, window.location.origin);
      if (navigator.share) {
        await navigator.share({ title: playlist.title, url: url.href });
      } else {
        await navigator.clipboard.writeText(url.href);
        setNotice({ message: 'คัดลอกลิงก์เพลย์ลิสต์แล้ว' });
      }
    } catch (error) {
      if (error.name !== 'AbortError') setNotice({ message: 'แชร์เพลย์ลิสต์ไม่สำเร็จ', error: true });
    }
  }

  const routeKey = playlist.route_key;
  const firstPlayableIndex = items.findIndex(isPlayable);
  const firstPlayable = items[firstPlayableIndex];
  const cover = items.find((item) => !isMatureVideo(item)) || items[0];
  const coverInfo = {
    preview_thumbnail: cover
      ? protectVideoPoster(cover).thumbnail_url || `/streams/stream_vid_${cover.id}/poster.jpg`
      : '',
    preview_is_mature: isMatureVideo(cover),
  };
  const tintSource = coverInfo.preview_is_mature ? null : coverInfo.preview_thumbnail;
  const tint = coverColor?.src === tintSource ? coverColor?.rgb : null;
  const totalDuration = items.reduce((total, item) => total + Number(item.duration || 0), 0);
  const canEdit = playlist.can_manage && playlist.kind === 'normal';
  const controlsDisabled = removing || recovering;

  function playShuffled() {
    const playableIndices = items.flatMap((item, index) => isPlayable(item) ? [index] : []);
    if (!playableIndices.length) return;
    const index = playableIndices[Math.floor(Math.random() * playableIndices.length)];
    router.push(watchUrl(items[index], index, routeKey, true));
  }

  return (
    <section className="mx-auto grid w-full max-w-[1380px] gap-3 px-3 py-4 sm:gap-5 sm:px-6 sm:py-6 lg:h-[calc(100dvh_-_3.5rem)] lg:grid-cols-[minmax(260px,1fr)_minmax(0,2fr)] lg:grid-rows-[minmax(0,1fr)] xl:grid-cols-[360px_minmax(0,1fr)] xl:gap-8">
      <div
        className="relative isolate -mx-3 -mt-4 min-w-0 overflow-hidden rounded-none bg-transparent px-4 pt-4 pb-5 sm:mx-0 sm:mt-0 sm:rounded-2xl sm:p-5 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain"
        style={tint ? { '--playlist-cover-color': tint } : undefined}
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden [mask-image:linear-gradient(to_bottom,black_0%,rgba(0,0,0,0.45)_55%,transparent_88%)]">
          {tint ? (
            <div className="absolute inset-0 bg-[rgba(var(--playlist-cover-color),0.20)] dark:bg-[rgba(var(--playlist-cover-color),0.38)]" />
          ) : !tintSource ? (
            <div className="absolute inset-0 bg-black/[0.04] dark:bg-white/[0.06]" />
          ) : null}
          {tintSource && !tint && (
            <Image src={tintSource} alt="" fill unoptimized className="scale-125 object-cover opacity-20 blur-[64px] dark:opacity-35" />
          )}
        </div>
        <PlaylistCover
          playlist={coverInfo}
          className="rounded-xl shadow-lg"
          onLoad={tintSource ? ({ currentTarget }) => {
            const color = extractDominantColor(currentTarget);
            if (color) setCoverColor({ src: tintSource, rgb: color.rgb });
          } : undefined}
        />
        <h1 className="mt-4 break-words text-2xl font-bold leading-tight sm:text-3xl">{playlist.title}</h1>
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
              {playlist.owner_name && (
                <div className="flex min-w-0 items-center gap-2 font-medium">
                  <span className="relative flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#F4F0E8] dark:bg-[#222222]">
                    {playlist.owner_picture
                      ? <Image src={playlist.owner_picture} alt="" fill sizes="24px" unoptimized className="object-cover" />
                      : <UserRound aria-hidden="true" className="size-3.5 opacity-55" />}
                  </span>
                  <span className="truncate">{playlist.owner_name}</span>
                </div>
              )}
              <PlaylistVisibility visibility={playlist.visibility} />
            </div>
            <p className="mt-1 text-xs text-black/60 dark:text-white/60 sm:text-sm">
              วิดีโอ {items.length.toLocaleString('th-TH')} รายการ
              {items.length > 0 && ` · ${formatTotalDuration(totalDuration)}`}
            </p>
          </div>

          {/* Compact YouTube-style circular utility actions beside metadata */}
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={sharePlaylist}
              title="แชร์เพลย์ลิสต์"
              aria-label="แชร์เพลย์ลิสต์"
              className="inline-flex size-9 items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.12] dark:bg-white/10 dark:hover:bg-white/15 transition cursor-pointer"
            >
              <Share2 aria-hidden="true" className="size-4" />
            </button>
            {canEdit && (
              <>
                <button
                  type="button"
                  onClick={() => setDialog('edit')}
                  title="แก้ไขเพลย์ลิสต์"
                  aria-label="แก้ไขเพลย์ลิสต์"
                  className="inline-flex size-9 items-center justify-center rounded-full bg-black/[0.06] hover:bg-black/[0.12] dark:bg-white/10 dark:hover:bg-white/15 transition cursor-pointer"
                >
                  <Pencil aria-hidden="true" className="size-4" />
                </button>
                <button
                  type="button"
                  disabled={controlsDisabled}
                  onClick={() => setDialog('delete')}
                  title="ลบเพลย์ลิสต์"
                  aria-label="ลบเพลย์ลิสต์"
                  className="inline-flex size-9 items-center justify-center rounded-full bg-black/[0.06] text-rose-600 hover:bg-rose-50 disabled:opacity-40 dark:bg-white/10 dark:text-rose-400 dark:hover:bg-rose-500/20 transition cursor-pointer"
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </button>
              </>
            )}
          </div>
        </div>
        {playlist.description && (
          <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-black/75 dark:text-white/75">
            {playlist.description}
          </p>
        )}
        <div className="mt-4 flex items-center gap-2.5">
          {firstPlayable ? (
            <Link href={watchUrl(firstPlayable, firstPlayableIndex, routeKey)} prefetch={false} className={primaryAction}>
              <Play aria-hidden="true" className="size-4 fill-current" />
              เล่นทั้งหมด
            </Link>
          ) : (
            <button type="button" disabled className={`${primaryAction} ${disabledAction}`}>
              <Play aria-hidden="true" className="size-4 fill-current" />
              เล่นทั้งหมด
            </button>
          )}
          <button
            type="button"
            onClick={playShuffled}
            disabled={!firstPlayable}
            className={`${secondaryAction} flex-1 ${disabledAction}`}
          >
            <Shuffle aria-hidden="true" className="size-4" />
            สุ่มเล่น
          </button>
        </div>
      </div>

      <div className="min-w-0 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain">
        {notice && (
          <div
            role={notice.error ? 'alert' : 'status'}
            className={`mb-3 rounded-xl px-4 py-2.5 text-sm ${notice.error
              ? 'bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300'
              : 'bg-[#F4F0E8] dark:bg-[#222222]'}`}
          >
            {notice.message}
          </div>
        )}
        {items.length ? (
          <ol aria-label="วิดีโอในเพลย์ลิสต์" className="space-y-1">
            {items.map((item, index) => {
              const indicator = dropTarget?.id === item.id;
              const isMenuOpen = openMenuId === item.id;
              return (
                <li
                  key={item.id}
                  onDragOver={playlist.can_manage ? (event) => dragOver(event, item.id) : undefined}
                  onDrop={playlist.can_manage ? (event) => dropOn(event, item.id) : undefined}
                  className="relative flex items-center gap-2 rounded-xl px-1 py-1.5 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.06] sm:gap-3 sm:px-2.5 sm:py-2"
                >
                  {indicator && (
                    <span aria-hidden="true" className={`pointer-events-none absolute inset-x-0 z-10 border-t-2 border-[#FF7A00] ${dropTarget.after ? '-bottom-1' : '-top-1'}`} />
                  )}
                  {playlist.can_manage && (
                    <span
                      draggable={!controlsDisabled}
                      onDragStart={(event) => startDrag(event, item.id)}
                      onDragEnd={finishDrag}
                      title="ลากเพื่อจัดลำดับ"
                      className="hidden size-6 shrink-0 select-none items-center justify-center text-black/45 dark:text-white/45 lg:flex lg:cursor-grab lg:active:cursor-grabbing"
                    >
                      <GripVertical aria-hidden="true" className="size-5" />
                    </span>
                  )}
                  <span aria-hidden="true" className="w-5 shrink-0 text-center text-xs tabular-nums text-black/50 dark:text-white/50 sm:w-7">
                    {index + 1}
                  </span>
                  {isPlayable(item) ? (
                    <Link
                      href={watchUrl(item, index, routeKey)}
                      prefetch={false}
                      className="flex min-w-0 flex-1 items-start gap-2.5 rounded-lg focus-visible:outline-[#FF7A00] sm:items-center sm:gap-3"
                    >
                      <VideoRowContent item={item} />
                    </Link>
                  ) : (
                    <div className="flex min-w-0 flex-1 items-start gap-2.5 sm:items-center sm:gap-3">
                      <VideoRowContent item={item} />
                    </div>
                  )}
                  {playlist.can_manage && (
                    <>
                      {/* Desktop inline reorder & remove buttons */}
                      <div className="hidden shrink-0 items-center sm:flex">
                        <button
                          type="button"
                          title="เลื่อนขึ้น"
                          aria-label={`เลื่อน ${item.title} ขึ้น`}
                          className={rowAction}
                          disabled={controlsDisabled || index === 0}
                          onClick={() => moveBy(item.id, -1)}
                        >
                          <ArrowUp aria-hidden="true" className="size-4" />
                        </button>
                        <button
                          type="button"
                          title="เลื่อนลง"
                          aria-label={`เลื่อน ${item.title} ลง`}
                          className={rowAction}
                          disabled={controlsDisabled || index === items.length - 1}
                          onClick={() => moveBy(item.id, 1)}
                        >
                          <ArrowDown aria-hidden="true" className="size-4" />
                        </button>
                        <button
                          type="button"
                          title="นำออกจากเพลย์ลิสต์"
                          aria-label={`นำ ${item.title} ออกจากเพลย์ลิสต์`}
                          className={`${rowAction} text-rose-600 dark:text-rose-400`}
                          disabled={controlsDisabled}
                          onClick={() => void removeItem(item)}
                        >
                          <Trash2 aria-hidden="true" className="size-4" />
                        </button>
                      </div>

                      {/* Mobile clean ⋮ menu (YouTube style — keeps title wide & readable!) */}
                      <div className="relative shrink-0 sm:hidden">
                        <button
                          type="button"
                          aria-label={`ตัวเลือกสำหรับ ${item.title}`}
                          aria-expanded={isMenuOpen}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(isMenuOpen ? null : item.id);
                          }}
                          className="inline-flex size-8 items-center justify-center rounded-full text-black/65 hover:bg-black/[0.06] dark:text-white/70 dark:hover:bg-white/10 cursor-pointer"
                        >
                          <MoreVertical aria-hidden="true" className="size-4" />
                        </button>
                        {isMenuOpen && (
                          <>
                            <div
                              className="fixed inset-0 z-30"
                              onClick={() => setOpenMenuId(null)}
                            />
                            <div className="absolute right-0 top-full z-40 mt-1 w-44 rounded-xl border border-[#EFECE6] bg-white p-1.5 text-xs shadow-2xl dark:border-white/10 dark:bg-[#242424]">
                              <button
                                type="button"
                                disabled={controlsDisabled || index === 0}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  moveBy(item.id, -1);
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-black/[0.05] disabled:opacity-35 dark:hover:bg-white/10"
                              >
                                <ArrowUp className="size-3.5" />
                                เลื่อนขึ้น
                              </button>
                              <button
                                type="button"
                                disabled={controlsDisabled || index === items.length - 1}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  moveBy(item.id, 1);
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-black/[0.05] disabled:opacity-35 dark:hover:bg-white/10"
                              >
                                <ArrowDown className="size-3.5" />
                                เลื่อนลง
                              </button>
                              <button
                                type="button"
                                disabled={controlsDisabled}
                                onClick={() => {
                                  setOpenMenuId(null);
                                  void removeItem(item);
                                }}
                                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-rose-600 hover:bg-rose-50 disabled:opacity-35 dark:text-rose-400 dark:hover:bg-rose-500/15"
                              >
                                <Trash2 className="size-3.5" />
                                นำออกจากเพลย์ลิสต์
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-[#EFECE6] text-sm text-black/60 dark:border-white/10 dark:text-white/60">
            <ListVideo aria-hidden="true" className="size-8 text-[#FF7A00]" />
            ยังไม่มีวิดีโอในเพลย์ลิสต์นี้
          </div>
        )}
      </div>

      {dialog === 'edit' && (
        <PlaylistFormModal
          playlist={playlist}
          onClose={() => setDialog(null)}
          onSaved={(updated) => setPlaylist((current) => ({ ...current, ...updated }))}
        />
      )}
      {dialog === 'delete' && (
        <PlaylistDeleteModal
          playlist={playlist}
          onClose={() => setDialog(null)}
          onDeleted={() => router.replace('/playlists')}
        />
      )}
    </section>
  );
}

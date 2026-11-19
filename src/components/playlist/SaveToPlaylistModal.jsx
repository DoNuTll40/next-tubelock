'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import { PlaylistChoice, PlaylistCreateForm, requestPlaylistJson } from './PlaylistPicker';

export default function SaveToPlaylistModal({ isOpen = true, videoId, onClose, onMembershipChange }) {
  if (!isOpen) return null;
  return (
    <SaveDialog
      key={videoId}
      videoId={videoId}
      onClose={onClose}
      onMembershipChange={onMembershipChange}
    />
  );
}

function SaveDialog({ videoId, onClose, onMembershipChange }) {
  const titleId = useId();
  const dialogRef = useRef(null);
  const closeButtonRef = useRef(null);
  const toastTimer = useRef(null);
  const [result, setResult] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [pending, setPending] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState('');
  const [toast, setToast] = useState(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => {
      dialog.close();
      clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    queueMicrotask(async () => {
      if (signal.aborted) return;
      try {
        const { playlists } = await requestPlaylistJson(
          `/api/playlists?videoId=${encodeURIComponent(videoId)}`,
          { signal },
          'โหลดเพลย์ลิสต์ไม่สำเร็จ',
        );
        if (!signal.aborted) setResult({ playlists });
      } catch (error) {
        if (!signal.aborted) setResult({ error: error.message });
      }
    });
    return () => controller.abort();
  }, [videoId, retryCount]);

  function showToast(message, error = false) {
    clearTimeout(toastTimer.current);
    setToast({ message, error });
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }

  function updateMembership(playlists) {
    setResult({ playlists });
    const memberships = playlists.filter(({ contains_video }) => contains_video);
    onMembershipChange?.({
      saved: memberships.some(({ kind }) => kind === 'watch_later' || kind === 'normal'),
      watchLater: memberships.some(({ kind }) => kind === 'watch_later'),
      playlistIds: memberships.map(({ id }) => id),
    });
  }

  async function togglePlaylist(playlist) {
    if (pending) return;
    const previous = result.playlists;
    const adding = !playlist.contains_video;
    const next = previous.map((entry) => entry.id === playlist.id ? {
      ...entry,
      contains_video: adding,
      item_count: Math.max(0, Number(entry.item_count) + (adding ? 1 : -1)),
    } : entry);

    setPending(playlist.id);
    updateMembership(next);
    showToast(adding ? `บันทึกไปยัง “${playlist.title}” แล้ว` : `นำออกจาก “${playlist.title}” แล้ว`);
    try {
      const url = `/api/playlists/${encodeURIComponent(playlist.route_key)}/items`;
      const { itemCount } = await requestPlaylistJson(
        adding ? url : `${url}?videoId=${encodeURIComponent(videoId)}`,
        adding ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId }),
        } : { method: 'DELETE' },
        adding ? 'บันทึกวิดีโอไม่สำเร็จ' : 'นำวิดีโอออกไม่สำเร็จ',
      );
      if (!dialogRef.current) return;
      if (Number.isInteger(itemCount)) {
        setResult({ playlists: next.map((entry) => entry.id === playlist.id ? { ...entry, item_count: itemCount } : entry) });
      }
    } catch (error) {
      if (!dialogRef.current) return;
      updateMembership(previous);
      showToast(error.message, true);
    } finally {
      setPending(null);
    }
  }

  async function createPlaylist(fields) {
    if (pending) return;
    setPending('create');
    setCreateError('');
    try {
      const { playlist } = await requestPlaylistJson('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, initialVideoId: videoId }),
      }, 'สร้างเพลย์ลิสต์ไม่สำเร็จ');
      if (!dialogRef.current) return;
      updateMembership([{ ...playlist, contains_video: true }, ...result.playlists]);
      setShowCreate(false);
      closeButtonRef.current?.focus();
      showToast(`บันทึกไปยัง “${playlist.title}” แล้ว`);
    } catch (error) {
      setCreateError(error.message);
    } finally {
      setPending(null);
    }
  }

  function close() {
    if (!pending) onClose();
  }

  const playlists = result?.playlists;
  const watchLater = playlists?.find(({ kind }) => kind === 'watch_later');
  const regularPlaylists = playlists?.filter(({ kind }) => kind === 'normal') ?? [];

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) close();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      className="fixed inset-x-0 top-auto bottom-0 m-0 h-fit max-h-none w-full max-w-none overflow-visible bg-transparent p-0 text-[#212529] backdrop:bg-black/60 backdrop:backdrop-blur-xs sm:inset-0 sm:m-auto sm:max-w-[380px] dark:text-[#F1F1F1]"
    >
      <div className="flex max-h-[80dvh] flex-col rounded-t-2xl border border-[#EFECE6] bg-white pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:pb-3 dark:border-white/10 dark:bg-[#181818]">
        <div aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-black/15 sm:hidden dark:bg-white/20" />
        <div className="flex items-center justify-between gap-2 border-b border-[#EFECE6] px-4 py-2.5 dark:border-white/10">
          <h2 id={titleId} className="text-sm font-bold">บันทึกไปยังเพลย์ลิสต์</h2>
          <button
            ref={closeButtonRef}
            type="button"
            aria-label="ปิดหน้าต่างบันทึกเพลย์ลิสต์"
            aria-disabled={Boolean(pending)}
            onClick={close}
            className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-[#F4F0E8] aria-disabled:cursor-default aria-disabled:opacity-50 dark:hover:bg-white/10"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="flex min-h-0 flex-col overflow-y-auto overscroll-contain">
          {!result && (
            <p role="status" className="flex items-center gap-2 px-4 py-4 text-xs text-[#6C655D] dark:text-[#AAAAAA]">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              กำลังโหลดเพลย์ลิสต์…
            </p>
          )}
          {result?.error && (
            <div className="space-y-2 px-4 py-4 text-xs">
              <p role="alert" className="text-rose-600 dark:text-rose-400">{result.error}</p>
              <button
                type="button"
                onClick={() => {
                  setResult(null);
                  setRetryCount((count) => count + 1);
                }}
                className="cursor-pointer font-semibold underline"
              >
                ลองอีกครั้ง
              </button>
            </div>
          )}
          {playlists && (
            <>
              {watchLater && (
                <div className="shrink-0 border-b border-[#EFECE6] px-2.5 py-1 dark:border-white/10">
                  <PlaylistChoice
                    playlist={watchLater}
                    checked={Boolean(watchLater.contains_video)}
                    disabled={Boolean(pending)}
                    onChange={() => togglePlaylist(watchLater)}
                    compact
                  />
                </div>
              )}
              {regularPlaylists.length > 0 && (
                <div className="min-h-14 overflow-y-auto overscroll-contain px-2.5 py-1">
                  {regularPlaylists.map((playlist) => (
                    <PlaylistChoice
                      key={playlist.id}
                      playlist={playlist}
                      checked={Boolean(playlist.contains_video)}
                      disabled={Boolean(pending)}
                      onChange={() => togglePlaylist(playlist)}
                      compact
                    />
                  ))}
                </div>
              )}
              <div className={`shrink-0 px-4 pt-2 ${regularPlaylists.length ? 'border-t border-[#EFECE6] dark:border-white/10' : ''}`}>
                {showCreate ? (
                  <PlaylistCreateForm
                    onCreate={createPlaylist}
                    onCancel={() => {
                      setShowCreate(false);
                      setCreateError('');
                      closeButtonRef.current?.focus();
                    }}
                    busy={pending === 'create'}
                    submitDisabled={Boolean(pending)}
                    error={createError}
                  />
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(pending)}
                    onClick={() => setShowCreate(true)}
                    className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-xl px-2 text-left text-sm font-semibold text-[#9E4700] hover:bg-[#FFF4EB] disabled:opacity-50 dark:text-[#FF9E40] dark:hover:bg-[#FF7A00]/15"
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    สร้างเพลย์ลิสต์ใหม่
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {toast && (
        <div
          role={toast.error ? 'alert' : 'status'}
          className={`pointer-events-none fixed bottom-20 left-1/2 z-[120] w-max max-w-[calc(100%_-_2rem)] -translate-x-1/2 rounded-full px-4 py-2 text-center text-xs text-white shadow-lg sm:bottom-6 ${toast.error ? 'bg-rose-700' : 'bg-[#212529]'}`}
        >
          {toast.message}
        </div>
      )}
    </dialog>
  );
}

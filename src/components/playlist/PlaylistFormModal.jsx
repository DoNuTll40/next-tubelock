'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Trash2, X } from 'lucide-react';
import { requestPlaylistJson } from './PlaylistPicker';

const controlClass = 'w-full min-w-0 rounded-xl border border-[#EFECE6] bg-[#F4F0E8] px-3 py-2.5 text-sm font-normal outline-none focus:border-[#FF7A00] focus:ring-2 focus:ring-[#FF7A00]/15 disabled:opacity-60 dark:border-white/10 dark:bg-[#222222]';
const cancelClass = 'cursor-pointer rounded-xl bg-[#F4F0E8] px-3.5 py-2.5 text-xs font-semibold hover:bg-[#EFECE6] disabled:cursor-default disabled:opacity-50 dark:bg-[#222222] dark:hover:bg-white/15';
const submitClass = 'inline-flex cursor-pointer items-center gap-1.5 rounded-xl px-3.5 py-2.5 text-xs font-bold text-white disabled:cursor-default disabled:opacity-50';

function PlaylistDialog({ dialogRef, title, busy, onClose, children }) {
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, [dialogRef]);

  function close() {
    if (!busy) onClose();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
        if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) close();
      }}
      className="fixed inset-x-0 top-auto bottom-0 m-0 h-fit max-h-[85dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-2xl border border-[#EFECE6] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] text-[#212529] shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-xs sm:inset-0 sm:m-auto sm:max-w-md sm:rounded-2xl sm:p-5 dark:border-white/10 dark:bg-[#181818] dark:text-[#F1F1F1]"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 id={titleId} className="text-base font-bold">{title}</h2>
        <button
          type="button"
          onClick={close}
          aria-disabled={busy}
          aria-label="ปิดหน้าต่าง"
          className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-[#F4F0E8] aria-disabled:cursor-default aria-disabled:opacity-50 dark:hover:bg-white/10"
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export default function PlaylistFormModal({ playlist = null, onClose, onSaved }) {
  const dialogRef = useRef(null);
  const titleRef = useRef(null);
  const [title, setTitle] = useState(playlist?.title ?? '');
  const [description, setDescription] = useState(playlist?.description ?? '');
  const [visibility, setVisibility] = useState(playlist?.visibility ?? 'private');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const editing = Boolean(playlist);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  async function submit(event) {
    event.preventDefault();
    if (busy || !title.trim()) return;
    setBusy(true);
    setError('');
    const endpoint = editing ? `/api/playlists/${encodeURIComponent(playlist.route_key)}` : '/api/playlists';
    try {
      const { playlist: updatedPlaylist } = await requestPlaylistJson(endpoint, {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), visibility }),
      }, 'บันทึกเพลย์ลิสต์ไม่สำเร็จ');
      if (!dialogRef.current) return;
      onSaved(updatedPlaylist);
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlaylistDialog dialogRef={dialogRef} title={editing ? 'แก้ไขเพลย์ลิสต์' : 'สร้างเพลย์ลิสต์ใหม่'} busy={busy} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1.5 text-xs font-semibold">
          <span>ชื่อเพลย์ลิสต์</span>
          <input
            ref={titleRef}
            className={controlClass}
            type="text"
            required
            maxLength={120}
            value={title}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block space-y-1.5 text-xs font-semibold">
          <span>คำอธิบาย</span>
          <textarea
            className={controlClass}
            rows={3}
            maxLength={1000}
            value={description}
            disabled={busy}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        <label className="block space-y-1.5 text-xs font-semibold">
          <span>การมองเห็น</span>
          <select
            className={controlClass}
            value={visibility}
            disabled={busy}
            onChange={(event) => setVisibility(event.target.value)}
          >
            <option value="private">ส่วนตัว</option>
            <option value="unlisted">ไม่แสดงในรายการ</option>
            <option value="public">สาธารณะ</option>
          </select>
        </label>
        {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className={cancelClass}>ยกเลิก</button>
          <button
            type="submit"
            disabled={busy || !title.trim()}
            className={`${submitClass} bg-[#FF7A00] hover:bg-[#E56E00] dark:hover:bg-[#FF8C1A]`}
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {editing ? 'บันทึก' : 'สร้างเพลย์ลิสต์'}
          </button>
        </div>
      </form>
    </PlaylistDialog>
  );
}

export function PlaylistDeleteModal({ playlist, onClose, onDeleted }) {
  const dialogRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { deletedId } = await requestPlaylistJson(`/api/playlists/${encodeURIComponent(playlist.route_key)}`, {
        method: 'DELETE',
      }, 'ลบเพลย์ลิสต์ไม่สำเร็จ');
      if (!dialogRef.current) return;
      onDeleted(deletedId);
      onClose();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <PlaylistDialog dialogRef={dialogRef} title="ลบเพลย์ลิสต์นี้?" busy={busy} onClose={onClose}>
      <p className="mb-1 break-words text-sm font-semibold">{playlist.title}</p>
      <p className="text-sm text-[#6C655D] dark:text-[#AAAAAA]">วิดีโอทั้งหมดจะยังคงอยู่ในคลังวิดีโอ</p>
      {error && <p role="alert" className="mt-3 text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" disabled={busy} onClick={onClose} className={cancelClass}>ยกเลิก</button>
        <button
          type="button"
          disabled={busy}
          onClick={remove}
          className={`${submitClass} bg-rose-700 hover:bg-rose-800`}
        >
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
          ลบเพลย์ลิสต์
        </button>
      </div>
    </PlaylistDialog>
  );
}

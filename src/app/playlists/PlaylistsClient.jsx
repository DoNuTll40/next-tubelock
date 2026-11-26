'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ListVideo, Loader2, Plus, X } from 'lucide-react';
import { AnimatedTabs, AnimatedTabPanel } from '@/components/ui/AnimatedTabs';
import Select from '@/components/ui/Select';
import PlaylistCard from '@/components/playlist/PlaylistCard';
import PlaylistFormModal, { PlaylistDeleteModal } from '@/components/playlist/PlaylistFormModal';

const sortOptions = [
  { value: 'updated', label: 'อัปเดตล่าสุด' },
  { value: 'created', label: 'สร้างล่าสุด' },
  { value: 'title', label: 'ชื่อ ก–ฮ' },
];

const filterOptions = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'normal', label: 'เพลย์ลิสต์ของฉัน' },
  { id: 'system', label: 'ดูภายหลังและที่ชอบ' },
];

const titleOrder = new Intl.Collator('th', { numeric: true, sensitivity: 'base' });
const createButtonClass = 'inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-[#FF7A00] px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:bg-[#E56E00] active:scale-95 sm:text-sm dark:hover:bg-[#FF8C1A]';

export default function PlaylistsClient({ initialPlaylists }) {
  const router = useRouter();
  const [localPlaylists, setLocalPlaylists] = useState(null);
  const [sort, setSort] = useState('updated');
  const [filter, setFilter] = useState('all');
  const [dialog, setDialog] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [isRefreshing, startRefresh] = useTransition();
  const playlists = localPlaylists ?? initialPlaylists;

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 2800);
    return () => clearTimeout(timer);
  }, [feedback]);

  const visiblePlaylists = useMemo(() => {
    const filtered = (playlists ?? []).filter(({ kind }) => (
      filter === 'all' || (filter === 'normal' ? kind === 'normal' : kind !== 'normal')
    ));
    const dateField = sort === 'created' ? 'created_at' : 'updated_at';
    filtered.sort((a, b) => {
      const order = sort === 'title' ? titleOrder.compare(a.title, b.title) : Date.parse(b[dateField]) - Date.parse(a[dateField]);
      return order || b.id - a.id;
    });
    return filtered;
  }, [playlists, filter, sort]);

  function handleSaved(updated) {
    const editing = Boolean(dialog?.playlist);
    if (playlists) {
      setLocalPlaylists((current) => {
        const rows = current ?? initialPlaylists;
        if (!editing) return [updated, ...rows];
        return rows.map((entry) => entry.id === updated.id ? { ...entry, ...updated } : entry);
      });
    } else {
      startRefresh(() => router.refresh());
    }
    if (!editing && filter === 'system') setFilter('all');
    setFeedback({ message: editing ? 'บันทึกรายละเอียดแล้ว' : 'สร้างเพลย์ลิสต์แล้ว' });
  }

  function handleDeleted(deletedId) {
    setLocalPlaylists((current) => (current ?? initialPlaylists ?? []).filter(({ id }) => id !== deletedId));
    setFeedback({ message: 'ลบเพลย์ลิสต์แล้ว' });
  }

  async function copyPlaylistLink(href) {
    try {
      await navigator.clipboard.writeText(new URL(href, location.origin).href);
      setFeedback({ message: 'คัดลอกลิงก์แล้ว' });
    } catch {
      setFeedback({ message: 'คัดลอกลิงก์ไม่สำเร็จ', error: true });
    }
  }

  function openCreateDialog() {
    setDialog({ mode: 'form', playlist: null });
  }

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-5 pb-8 sm:px-6 sm:py-7 lg:px-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[#212529] sm:text-2xl dark:text-[#F1F1F1]">เพลย์ลิสต์</h1>
          {playlists && <p className="mt-0.5 text-xs text-[#6C655D] dark:text-[#AAAAAA]">{playlists.length} เพลย์ลิสต์</p>}
        </div>
        <button type="button" onClick={openCreateDialog} className={createButtonClass}>
          <Plus className="size-4" aria-hidden="true" />
          เพลย์ลิสต์ใหม่
        </button>
      </header>

      {playlists ? (
        <>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Select options={sortOptions} value={sort} onChange={setSort} />
            <AnimatedTabs
              label="กรองเพลย์ลิสต์"
              tabs={filterOptions}
              value={filter}
              onChange={setFilter}
              behavior="filter"
              variant="pill"
              className="max-w-full py-1"
            />
          </div>

          <AnimatedTabPanel value={filter} behavior="filter">
            {visiblePlaylists.length > 0 ? (
              <div className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {visiblePlaylists.map((playlist) => (
                  <PlaylistCard
                    key={playlist.id}
                    playlist={playlist}
                    onCopyLink={copyPlaylistLink}
                    onEdit={() => setDialog({ mode: 'form', playlist })}
                    onDelete={() => setDialog({ mode: 'delete', playlist })}
                  />
                ))}
              </div>
            ) : (
              <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-[#EFECE6] bg-white p-8 text-center dark:border-white/10 dark:bg-[#181818]">
                <ListVideo className="size-8 text-[#FF7A00]" aria-hidden="true" />
                <p className="font-semibold">
                  {filter === 'normal' ? 'ยังไม่มีเพลย์ลิสต์ที่คุณสร้าง' : 'ยังไม่มีเพลย์ลิสต์'}
                </p>
                {filter !== 'system' && (
                  <button type="button" onClick={openCreateDialog} className={createButtonClass}>
                    <Plus className="size-4" aria-hidden="true" />
                    สร้างเพลย์ลิสต์แรกของคุณ
                  </button>
                )}
              </div>
            )}
          </AnimatedTabPanel>
        </>
      ) : (
        <div className="mt-6 rounded-2xl border border-[#EFECE6] bg-white p-5 dark:border-white/10 dark:bg-[#181818]">
          <p role="alert" className="text-sm text-rose-600 dark:text-rose-400">โหลดเพลย์ลิสต์ไม่สำเร็จ</p>
          <button
            type="button"
            disabled={isRefreshing}
            onClick={() => startRefresh(() => router.refresh())}
            className="mt-2 flex cursor-pointer items-center gap-1.5 text-sm font-semibold underline disabled:opacity-50"
          >
            {isRefreshing && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            ลองอีกครั้ง
          </button>
        </div>
      )}

      {dialog?.mode === 'form' && (
        <PlaylistFormModal playlist={dialog.playlist} onClose={() => setDialog(null)} onSaved={handleSaved} />
      )}
      {dialog?.mode === 'delete' && (
        <PlaylistDeleteModal playlist={dialog.playlist} onClose={() => setDialog(null)} onDeleted={handleDeleted} />
      )}
      {feedback && (
        <div
          role={feedback.error ? 'alert' : 'status'}
          className={`fixed bottom-20 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-full px-4 py-2 text-xs text-white shadow-lg sm:bottom-6 ${feedback.error ? 'bg-rose-700' : 'bg-[#212529]'}`}
        >
          <span>{feedback.message}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="ปิดการแจ้งเตือน"
            className="shrink-0 cursor-pointer text-white/80 hover:text-white"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Clock,
  Globe,
  Link2,
  ListVideo,
  Loader2,
  Lock,
  Plus,
  Search,
  ThumbsUp,
  X,
} from 'lucide-react';

const visibilityOptions = {
  private: { label: 'ส่วนตัว', icon: Lock },
  unlisted: { label: 'ไม่แสดงในรายการ', icon: Link2 },
  public: { label: 'สาธารณะ', icon: Globe },
};

const inputClass = 'w-full min-w-0 rounded-xl border border-[#EFECE6] bg-[#F4F0E8] px-3 py-2.5 text-sm text-[#212529] outline-none transition focus:border-[#FF7A00] focus:ring-2 focus:ring-[#FF7A00]/15 dark:border-white/10 dark:bg-[#222222] dark:text-[#F1F1F1]';

export async function requestPlaylistJson(url, options, fallbackError) {
  const response = await fetch(url, options).catch(() => null);
  if (!response) throw new Error(fallbackError);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.success) throw new Error(data?.error || fallbackError);
  return data;
}

export function PlaylistChoice({ playlist, checked, disabled, compact = false, onChange }) {
  const { label, icon: VisibilityIcon } = visibilityOptions[playlist.visibility] ?? visibilityOptions.private;
  const KindIcon = playlist.kind === 'watch_later' ? Clock : playlist.kind === 'liked' ? ThumbsUp : null;

  return (
    <label className="relative flex min-h-11 cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm text-[#212529] transition hover:bg-[#F4F0E8] has-[:disabled]:cursor-default dark:text-[#F1F1F1] dark:hover:bg-white/5">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="peer sr-only"
      />
      <span className="grid size-5 shrink-0 place-items-center rounded border border-[#8C857B] peer-checked:border-[#FF7A00] peer-checked:bg-[#FF7A00] peer-focus-visible:ring-2 peer-focus-visible:ring-[#FF7A00] peer-focus-visible:ring-offset-2 dark:border-white/35" aria-hidden="true">
        {checked && <Check className="size-3.5 text-white" strokeWidth={3} />}
      </span>
      {KindIcon && <KindIcon className="size-4 shrink-0 text-[#6C655D] dark:text-[#AAAAAA]" aria-hidden="true" />}
      <span className="min-w-0 flex-1 truncate font-medium" title={playlist.title}>{playlist.title}</span>
      <span className="flex shrink-0 items-center gap-1 text-xs text-[#6C655D] dark:text-[#AAAAAA]" title={label}>
        <VisibilityIcon className="size-3.5" aria-hidden="true" />
        <span className={compact ? 'sr-only' : 'sr-only sm:not-sr-only'}>{label}</span>
      </span>
      {playlist.kind !== 'watch_later' && (
        <span className="shrink-0 text-xs tabular-nums text-[#6C655D] dark:text-[#AAAAAA]">
          {playlist.item_count} คลิป
        </span>
      )}
    </label>
  );
}

export function PlaylistCreateForm({ onCreate, onCancel, busy, submitDisabled = false, error }) {
  const titleId = useId();
  const radioName = useId();
  const titleRef = useRef(null);
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState('private');

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !submitDisabled && title.trim()) onCreate({ title: title.trim(), visibility });
      }}
      className="space-y-3"
    >
      <div className="space-y-1.5">
        <label htmlFor={titleId} className="text-xs font-semibold">ชื่อเพลย์ลิสต์</label>
        <input
          ref={titleRef}
          id={titleId}
          type="text"
          required
          maxLength={120}
          value={title}
          disabled={busy}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="เช่น รวมเพลงโปรด"
          className={inputClass}
        />
      </div>
      <fieldset disabled={busy} className="space-y-1.5">
        <legend className="text-xs font-semibold">การมองเห็น</legend>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(visibilityOptions).map(([value, { label, icon: Icon }]) => (
            <label key={value} className="cursor-pointer has-[:disabled]:cursor-default">
              <input
                type="radio"
                name={radioName}
                value={value}
                checked={visibility === value}
                onChange={() => setVisibility(value)}
                className="peer sr-only"
              />
              <span className="flex items-center gap-1 rounded-lg border border-[#EFECE6] px-2 py-2 text-xs text-[#6C655D] peer-checked:border-[#FF7A00]/70 peer-checked:bg-[#FFF4EB] peer-checked:text-[#9E4700] peer-focus-visible:ring-2 peer-focus-visible:ring-[#FF7A00] dark:border-white/10 dark:text-[#AAAAAA] dark:peer-checked:bg-[#FF7A00]/15 dark:peer-checked:text-[#FF9E40]">
                <Icon className="size-3.5 shrink-0" aria-hidden="true" />
                {label}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && <p role="alert" className="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="cursor-pointer rounded-xl bg-[#F4F0E8] px-3 py-2 text-xs font-semibold hover:bg-[#EFECE6] disabled:opacity-50 dark:bg-[#222222] dark:hover:bg-white/15"
        >
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={busy || submitDisabled || !title.trim()}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl bg-[#FF7A00] px-3 py-2 text-xs font-semibold text-white hover:bg-[#E56E00] disabled:cursor-default disabled:opacity-50 dark:hover:bg-[#FF8C1A]"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {busy ? 'กำลังสร้าง…' : 'สร้าง'}
        </button>
      </div>
    </form>
  );
}

export default function PlaylistPicker({
  selectedIds = [],
  onChange,
  includeSystem = false,
  disabled = false,
  label = 'เพลย์ลิสต์',
  helperText = 'เพิ่มวิดีโอนี้เข้าเพลย์ลิสต์ (บันทึกเมื่อกดเผยแพร่)',
}) {
  const panelId = useId();
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const [playlists, setPlaylists] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const open = isOpen && !disabled;

  useEffect(() => {
    if (!open || isCreating) return;
    function closeOnOutsideClick(event) {
      if (!containerRef.current?.contains(event.target)) setIsOpen(false);
    }
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [open, isCreating]);

  async function loadPlaylists() {
    setIsLoading(true);
    setLoadError('');
    try {
      const url = includeSystem ? '/api/playlists' : '/api/playlists?filter=normal';
      const data = await requestPlaylistJson(url, undefined, 'โหลดเพลย์ลิสต์ไม่สำเร็จ');
      setPlaylists(data.playlists);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setIsLoading(false);
    }
  }

  function togglePicker() {
    setIsOpen(!open);
    if (!open && !playlists && !isLoading) void loadPlaylists();
  }

  function toggleSelection(id) {
    onChange(selectedIds.includes(id) ? selectedIds.filter((selectedId) => selectedId !== id) : [...selectedIds, id]);
  }

  async function createPlaylist(fields) {
    setCreateError('');
    setIsCreating(true);
    try {
      const { playlist } = await requestPlaylistJson('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      }, 'สร้างเพลย์ลิสต์ไม่สำเร็จ');
      if (!containerRef.current) return;
      setPlaylists((previous) => [playlist, ...previous]);
      onChange([...selectedIds, playlist.id]);
      setSearch('');
      setShowCreate(false);
      triggerRef.current?.focus();
    } catch (error) {
      setCreateError(error.message);
    } finally {
      setIsCreating(false);
    }
  }

  function cancelCreation() {
    setCreateError('');
    setShowCreate(false);
    triggerRef.current?.focus();
  }

  const query = search.trim().toLocaleLowerCase('th');
  const selectedPlaylists = playlists?.filter(({ id }) => selectedIds.includes(id)) ?? [];
  const visiblePlaylists = playlists?.filter(({ title }) => title.toLocaleLowerCase('th').includes(query)) ?? [];

  return (
    <div ref={containerRef} className="space-y-2.5 text-[#212529] dark:text-[#F1F1F1]">
      <div>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-semibold sm:text-sm">{label}</span>
          {selectedIds.length > 0 && <span className="text-xs text-[#6C655D] dark:text-[#AAAAAA]">เลือกแล้ว {selectedIds.length}</span>}
        </div>
        {helperText && <p className="mt-0.5 text-xs text-[#6C655D] dark:text-[#AAAAAA]">{helperText}</p>}
      </div>

      {selectedPlaylists.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedPlaylists.map((playlist) => (
            <button
              type="button"
              key={playlist.id}
              disabled={disabled || isCreating}
              onClick={() => toggleSelection(playlist.id)}
              aria-label={`นำ ${playlist.title} ออกจากที่เลือก`}
              className="inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-full bg-[#FFF4EB] px-2.5 py-1.5 text-xs font-medium text-[#9E4700] disabled:opacity-50 dark:bg-[#FF7A00]/15 dark:text-[#FF9E40]"
            >
              <ListVideo className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{playlist.title}</span>
              <X className="size-3 shrink-0" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      <div
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open && !isCreating) {
            event.stopPropagation();
            setIsOpen(false);
            triggerRef.current?.focus();
          }
        }}
      >
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-disabled={isCreating || undefined}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => !isCreating && togglePicker()}
          className="flex w-full cursor-pointer items-center gap-2 rounded-xl border border-[#EFECE6] bg-[#F4F0E8] px-3.5 py-2.5 text-left text-sm transition hover:border-[#FF7A00]/50 disabled:cursor-default disabled:opacity-50 dark:border-white/10 dark:bg-[#222222]"
        >
          <ListVideo className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">เลือกเพลย์ลิสต์ หรือสร้างใหม่…</span>
          <ChevronDown className={`size-4 shrink-0 transition ${open ? 'rotate-180 text-[#FF7A00]' : ''}`} aria-hidden="true" />
        </button>

        <div id={panelId} hidden={!open} className="mt-1.5 space-y-2 rounded-xl border border-[#EFECE6] bg-white p-2 dark:border-white/10 dark:bg-[#181818]">
          {isLoading && (
            <p role="status" className="flex items-center gap-2 px-2.5 py-3 text-xs text-[#6C655D] dark:text-[#AAAAAA]">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              กำลังโหลดเพลย์ลิสต์…
            </p>
          )}
          {loadError && (
            <div className="space-y-2 px-2.5 py-2 text-xs">
              <p role="alert" className="text-rose-600 dark:text-rose-400">{loadError}</p>
              <button type="button" onClick={loadPlaylists} className="cursor-pointer font-semibold underline">ลองอีกครั้ง</button>
            </div>
          )}
          {playlists && (
            <>
              {playlists.length > 5 && (
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#8C857B]" aria-hidden="true" />
                  <input
                    type="search"
                    aria-label="ค้นหาเพลย์ลิสต์"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="ค้นหาเพลย์ลิสต์…"
                    className={`${inputClass} pl-9`}
                  />
                </label>
              )}
              <div role="group" aria-label={label} className="max-h-60 overflow-y-auto overscroll-contain">
                {visiblePlaylists.map((playlist) => (
                  <PlaylistChoice
                    key={playlist.id}
                    playlist={playlist}
                    checked={selectedIds.includes(playlist.id)}
                    disabled={isCreating}
                    onChange={() => toggleSelection(playlist.id)}
                  />
                ))}
                {visiblePlaylists.length === 0 && (
                  <p className="px-2.5 py-2 text-xs text-[#6C655D] dark:text-[#AAAAAA]">{query ? 'ไม่พบเพลย์ลิสต์ที่ค้นหา' : 'ยังไม่มีเพลย์ลิสต์'}</p>
                )}
              </div>
              <div className="border-t border-[#EFECE6] pt-2 dark:border-white/10">
                {showCreate ? (
                  <div className="px-2">
                    <PlaylistCreateForm onCreate={createPlaylist} onCancel={cancelCreation} busy={isCreating} error={createError} />
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowCreate(true)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm font-semibold text-[#9E4700] hover:bg-[#FFF4EB] dark:text-[#FF9E40] dark:hover:bg-[#FF7A00]/15"
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
    </div>
  );
}

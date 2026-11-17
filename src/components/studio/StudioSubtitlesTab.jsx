'use client';

import { Fragment, useDeferredValue, useState, useRef, useMemo } from 'react';
import {
  Captions,
  Plus,
  Upload,
  Download,
  Trash2,
  Wand2,
  CheckCircle2,
  List,
  Code2,
  Check,
  X,
  Search,
  RotateCcw,
} from 'lucide-react';
import SubtitleGenerationCard from '@/components/SubtitleGenerationCard';
import {
  parseSrtCues,
  parseSrtTimestampToMs,
  cuesToSrt,
  convertSrtToVtt,
  formatMsToSrtTimestamp,
} from '@/lib/subtitleUtils';

function parseTimelineTimestampInput(rawValue) {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) return null;
  // parseSrtTimestampToMs does not parse bare MM:SS without milliseconds; normalize it to 00:MM:SS.
  const normalized = /^\d{1,2}:\d{1,2}$/.test(trimmed) ? `00:${trimmed}` : trimmed;
  return parseSrtTimestampToMs(normalized);
}

const TIMELINE_PAGE_SIZE = 50;

function matchOriginalCues(translatedCues, originalCues) {
  const matches = new Map();
  const originals = [...originalCues].sort((a, b) => a.startMs - b.startMs);
  const ordered = translatedCues.map((cue, idx) => ({ cue, idx }))
    .sort((a, b) => a.cue.startMs - b.cue.startMs);
  let first = 0;
  for (const { cue, idx } of ordered) {
    while (first < originals.length && originals[first].endMs <= cue.startMs) first++;
    const texts = new Set();
    for (let i = first; i < originals.length && originals[i].startMs < cue.endMs; i++) {
      const original = originals[i];
      const overlap = Math.min(cue.endMs, original.endMs) - Math.max(cue.startMs, original.startMs);
      if (overlap > 0 && overlap >= Math.min(cue.endMs - cue.startMs, original.endMs - original.startMs) / 2) {
        texts.add(original.text);
      }
    }
    if (texts.size) matches.set(idx, [...texts].join('\n'));
  }
  return matches;
}

function validateCueDraft(draft) {
  const startMs = parseTimelineTimestampInput(draft?.start);
  const endMs = parseTimelineTimestampInput(draft?.end);
  const cleanText = String(draft?.text || '').replace(/\r\n/g, '\n').trim();

  if (startMs === null || endMs === null) {
    return { ok: false, error: 'รูปแบบเวลาไม่ถูกต้อง (ใช้ HH:MM:SS,mmm หรือ MM:SS)' };
  }
  if (endMs <= startMs) {
    return { ok: false, error: 'เวลาสิ้นสุดต้องมากกว่าเวลาเริ่มต้น' };
  }
  if (!cleanText) {
    return { ok: false, error: 'กรุณากรอกข้อความซับไตเติล' };
  }
  return { ok: true, cue: { startMs, endMs, text: cleanText } };
}

function CueDraftEditor({ title, draft, onChange, onSave, onCancel, saveLabel }) {
  const handleTimeKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      onSave();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleTextKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      onSave();
    }
  };

  return (
    <div className="p-3 bg-[#FFF8F0] dark:bg-[#1E1A16] border-y border-[#FF7A00]/30 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-[#FF7A00]">{title}</span>
        <div className="flex items-center gap-1.5 flex-wrap">
          <input
            type="text"
            value={draft.start}
            onChange={(e) => onChange({ start: e.target.value, error: '' })}
            onKeyDown={handleTimeKeyDown}
            placeholder="00:00:00,000"
            aria-label="เวลาเริ่มต้น"
            className="w-32 px-2 py-1 rounded-lg bg-white dark:bg-[#121212] border border-[#E5E0D8] dark:border-white/15 font-mono text-xs text-[#212529] dark:text-[#E4E4E7] focus:outline-none focus:border-[#FF7A00]"
          />
          <span className="text-xs text-[#8C857B] dark:text-[#9A9A9A]">→</span>
          <input
            type="text"
            value={draft.end}
            onChange={(e) => onChange({ end: e.target.value, error: '' })}
            onKeyDown={handleTimeKeyDown}
            placeholder="00:00:02,000"
            aria-label="เวลาสิ้นสุด"
            className="w-32 px-2 py-1 rounded-lg bg-white dark:bg-[#121212] border border-[#E5E0D8] dark:border-white/15 font-mono text-xs text-[#212529] dark:text-[#E4E4E7] focus:outline-none focus:border-[#FF7A00]"
          />
        </div>
      </div>

      <textarea
        rows={2}
        autoFocus
        value={draft.text}
        onChange={(e) => onChange({ text: e.target.value, error: '' })}
        onKeyDown={handleTextKeyDown}
        placeholder="พิมพ์ข้อความซับไตเติล... (รองรับหลายบรรทัด)"
        aria-label="ข้อความซับไตเติล"
        className="w-full px-3 py-2 rounded-lg bg-white dark:bg-[#121212] border border-[#E5E0D8] dark:border-white/15 text-xs text-[#212529] dark:text-[#E4E4E7] leading-relaxed focus:outline-none focus:border-[#FF7A00] resize-y"
      />

      {draft.error ? (
        <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">{draft.error}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A]">
          Ctrl+Enter เพื่อบันทึก • Esc ยกเลิก
        </span>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-white dark:bg-[#181818] border border-[#E5E0D8] dark:border-white/15 text-[#5C544B] dark:text-[#B0B0B0] hover:bg-[#F4F0E8] dark:hover:bg-[#222222] transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
            <span>ยกเลิก</span>
          </button>
          <button
            type="button"
            onClick={onSave}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#FF7A00] hover:bg-[#E56D00] text-white shadow-sm transition-colors cursor-pointer"
          >
            <Check className="w-3.5 h-3.5" />
            <span>{saveLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:04,000
พิมพ์ข้อความซับไตเติลบรรทัดแรกที่นี่
`;

function triggerTextDownload(filename, content, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function StudioSubtitlesTab({
  videoTitle = 'video',
  tracks = [],
  onChangeTracks,
  subtitleStatus = 'waiting',
  audioStatus = 'waiting',
  canGenerateSubtitles = false,
  onDispatchAudioSubtitles,
  workerDetail = '',
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [viewMode, setViewMode] = useState('editor'); // 'editor' | 'timeline'
  const [timelineSearch, setTimelineSearch] = useState('');
  const deferredSearch = useDeferredValue(timelineSearch);
  const [timelinePage, setTimelinePage] = useState({ key: '', index: 0 });
  const timelineListRef = useRef(null);
  const [editingCue, setEditingCue] = useState(null); // { trackKey, srtSnapshot, cueIdx, start, end, text, error }
  const [newCueComposer, setNewCueComposer] = useState(null); // { trackKey, srtSnapshot, insertAfterIdx, start, end, text, error }
  const [undoSnapshot, setUndoSnapshot] = useState(null); // { trackKey, previousSrt, label }
  const [customPrompt, setCustomPrompt] = useState('');
  const [isDispatchingAi, setIsDispatchingAi] = useState(false);
  const [statusNotice, setStatusNotice] = useState('');
  const replaceInputRef = useRef(null);
  const newTrackInputRef = useRef(null);

  const safeIdx = selectedIdx >= 0 && selectedIdx < tracks.length ? selectedIdx : 0;
  const activeTrack = tracks[safeIdx] || null;
  const activeSrt = activeTrack?.srt || '';
  const activeTrackKey = activeTrack ? `${activeTrack.id ?? 'track'}-${safeIdx}` : 'none';

  const parsedCues = useMemo(() => {
    if (!activeSrt) return [];
    return parseSrtCues(activeSrt);
  }, [activeSrt]);

  const originalTrack = tracks.find((track) =>
    (track.isOriginal || ['original', 'orig'].includes(track.id)) && !track.isAutoTranslate && track.srt
  );
  const originalSrt = activeTrack !== originalTrack &&
    (activeTrack?.isAutoTranslate || activeTrack?.id === 'th') ? originalTrack?.srt : '';
  const originalCues = useMemo(() => originalSrt ? parseSrtCues(originalSrt) : [], [originalSrt]);
  const originalByIndex = useMemo(() =>
    originalCues.length ? matchOriginalCues(parsedCues, originalCues) : new Map(),
  [parsedCues, originalCues]);
  const trackCueCounts = useMemo(() => tracks.map((track) => parseSrtCues(track.srt || '').length), [tracks]);

  const filteredCues = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const mapped = parsedCues.map((cue, idx) => ({ cue, idx }));
    if (!q) return mapped;
    const hashNumberMatch = q.match(/^#(\d+)$/);
    return mapped.filter(({ cue, idx }) => {
      if (hashNumberMatch) {
        return String(idx + 1).startsWith(hashNumberMatch[1]);
      }
      if (String(idx + 1) === q) return true;
      if (cue.text.toLowerCase().includes(q)) return true;
      if (originalByIndex.get(idx)?.toLowerCase().includes(q)) return true;
      const startStr = formatMsToSrtTimestamp(cue.startMs).toLowerCase();
      const endStr = formatMsToSrtTimestamp(cue.endMs).toLowerCase();
      return startStr.includes(q) || endStr.includes(q);
    });
  }, [parsedCues, deferredSearch, originalByIndex]);
  const pageKey = JSON.stringify([activeTrackKey, deferredSearch]);
  const lastPage = Math.max(0, Math.ceil(filteredCues.length / TIMELINE_PAGE_SIZE) - 1);
  const pageIndex = timelinePage.key === pageKey ? Math.min(timelinePage.index, lastPage) : 0;
  const pageStart = pageIndex * TIMELINE_PAGE_SIZE;

  // Scope drafts to trackKey + activeSrt snapshot so track changes or SRT reformats automatically close stale edits without useEffect.
  const activeEdit =
    editingCue &&
    editingCue.trackKey === activeTrackKey &&
    editingCue.srtSnapshot === activeSrt
      ? editingCue
      : null;

  const activeNewComposer =
    newCueComposer &&
    newCueComposer.trackKey === activeTrackKey &&
    newCueComposer.srtSnapshot === activeSrt
      ? newCueComposer
      : null;

  const activeUndo =
    undoSnapshot &&
    undoSnapshot.trackKey === activeTrackKey &&
    undoSnapshot.afterSrt === activeSrt
      ? undoSnapshot
      : null;

  const updateTrackAt = (index, updater) => {
    const next = tracks.map((t, i) => (i === index ? { ...t, ...updater } : t));
    onChangeTracks(next);
  };

  const commitCueList = (nextCues, undoLabel = '') => {
    if (!activeTrack) return;
    const normalized = nextCues
      .map((cue, order) => ({
        startMs: Math.max(0, Math.round(Number(cue.startMs) || 0)),
        endMs: Math.max(0, Math.round(Number(cue.endMs) || 0)),
        text: String(cue.text || '').trim(),
        _order: order,
      }))
      .filter((cue) => cue.text && cue.endMs > cue.startMs)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs || a._order - b._order)
      .map(({ startMs, endMs, text }) => ({ startMs, endMs, text }));

    const nextSrt = normalized.length > 0 ? cuesToSrt(normalized) : '';
    const nextVtt = nextSrt ? convertSrtToVtt(nextSrt) : '';
    if (undoLabel) {
      setUndoSnapshot({
        trackKey: activeTrackKey,
        previousSrt: activeSrt,
        afterSrt: nextSrt,
        label: undoLabel,
      });
    }
    updateTrackAt(safeIdx, { srt: nextSrt, vtt: nextVtt });
  };

  const openCueEditor = (idx) => {
    const cue = parsedCues[idx];
    if (!cue || !activeTrack) return;
    setNewCueComposer(null);
    setEditingCue({
      trackKey: activeTrackKey,
      srtSnapshot: activeSrt,
      cueIdx: idx,
      start: formatMsToSrtTimestamp(cue.startMs),
      end: formatMsToSrtTimestamp(cue.endMs),
      text: cue.text,
      error: '',
    });
  };

  const saveCueEditor = () => {
    if (!activeEdit) return;
    const res = validateCueDraft(activeEdit);
    if (!res.ok) {
      setEditingCue((prev) => (prev ? { ...prev, error: res.error } : null));
      return;
    }
    const nextCues = parsedCues.map((cue, idx) =>
      idx === activeEdit.cueIdx ? res.cue : cue
    );
    commitCueList(nextCues, `แก้ไขประโยค #${activeEdit.cueIdx + 1}`);
    setEditingCue(null);
  };

  const openNewCueComposer = (insertAfterIdx = null) => {
    if (!activeTrack) return;
    setEditingCue(null);

    let defaultStartMs = 0;
    let defaultEndMs = 2000;
    if (insertAfterIdx !== null && parsedCues[insertAfterIdx]) {
      const anchor = parsedCues[insertAfterIdx];
      const nextCue = parsedCues[insertAfterIdx + 1];
      defaultStartMs = anchor.endMs + 50;
      if (nextCue && nextCue.startMs > anchor.endMs + 250) {
        defaultEndMs = Math.min(nextCue.startMs - 50, defaultStartMs + 2000);
      } else {
        defaultEndMs = defaultStartMs + 2000;
      }
    } else if (parsedCues.length > 0) {
      const lastCue = parsedCues[parsedCues.length - 1];
      defaultStartMs = lastCue.endMs + 100;
      defaultEndMs = defaultStartMs + 2000;
    }

    setNewCueComposer({
      trackKey: activeTrackKey,
      srtSnapshot: activeSrt,
      insertAfterIdx,
      start: formatMsToSrtTimestamp(defaultStartMs),
      end: formatMsToSrtTimestamp(defaultEndMs),
      text: '',
      error: '',
    });
  };

  const saveNewCueComposer = () => {
    if (!activeNewComposer) return;
    const res = validateCueDraft(activeNewComposer);
    if (!res.ok) {
      setNewCueComposer((prev) => (prev ? { ...prev, error: res.error } : null));
      return;
    }
    const nextCues = [...parsedCues, res.cue];
    commitCueList(nextCues, 'เพิ่มประโยคใหม่');
    setNewCueComposer(null);
  };

  const deleteCueAt = (idx) => {
    if (!activeTrack || idx < 0 || idx >= parsedCues.length) return;
    if (activeEdit?.cueIdx === idx) {
      setEditingCue(null);
    }
    const nextCues = parsedCues.filter((_, i) => i !== idx);
    commitCueList(nextCues, `ลบประโยค #${idx + 1}`);
  };

  const handleUndoTimeline = () => {
    if (!activeUndo || !activeTrack) return;
    const restoredSrt = activeUndo.previousSrt || '';
    const restoredVtt = restoredSrt ? convertSrtToVtt(restoredSrt) : '';
    setEditingCue(null);
    setNewCueComposer(null);
    setUndoSnapshot(null);
    updateTrackAt(safeIdx, { srt: restoredSrt, vtt: restoredVtt });
  };

  const handleAddBlankTrack = () => {
    const nextNum = tracks.length + 1;
    const defaultIsTh = !tracks.some((t) => t.id === 'th' || t.lang === 'th');
    const newTrack = {
      id: defaultIsTh ? 'th' : `sub_${Date.now().toString(36)}`,
      label: defaultIsTh ? 'ไทย (กำหนดเอง)' : `แทร็ก ${nextNum}`,
      lang: defaultIsTh ? 'th' : 'en',
      srt: SAMPLE_SRT,
      vtt: convertSrtToVtt(SAMPLE_SRT),
    };
    const next = [...tracks, newTrack];
    onChangeTracks(next);
    setSelectedIdx(next.length - 1);
    setViewMode('editor');
    setStatusNotice('');
  };

  const handleFileImport = async (file, mode = 'replace') => {
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (ext !== 'srt' && ext !== 'vtt') {
      setStatusNotice('รองรับเฉพาะไฟล์ .srt หรือ .vtt เท่านั้น');
      return;
    }

    const rawText = (await file.text()).replace(/^\uFEFF/, '');
    const cues = parseSrtCues(rawText);
    const normalizedSrt = cues.length > 0 ? cuesToSrt(cues) : rawText.replace(/^WEBVTT[^\n]*\n*/i, '').trim();
    const normalizedVtt = convertSrtToVtt(normalizedSrt);
    const baseLabel = file.name.replace(/\.[^/.]+$/, '').slice(0, 40) || 'ซับไตเติลอัปโหลด';

    if (mode === 'replace' && activeTrack) {
      updateTrackAt(safeIdx, {
        srt: normalizedSrt,
        vtt: normalizedVtt,
      });
      setStatusNotice(`นำเข้าไฟล์ "${file.name}" (${cues.length} ประโยค) ทับแทร็กปัจจุบันแล้ว — อย่าลืมกด "บันทึก"`);
    } else {
      const hasTh = tracks.some((t) => t.id === 'th' || t.lang === 'th');
      const newTrack = {
        id: hasTh ? `sub_${Date.now().toString(36)}` : 'th',
        label: hasTh ? baseLabel : 'ไทย (อัปโหลดเอง)',
        lang: hasTh ? 'und' : 'th',
        srt: normalizedSrt,
        vtt: normalizedVtt,
      };
      const next = [...tracks, newTrack];
      onChangeTracks(next);
      setSelectedIdx(next.length - 1);
      setStatusNotice(`เพิ่มแทร็กใหม่ "${newTrack.label}" (${cues.length} ประโยค) แล้ว — อย่าลืมกด "บันทึก"`);
    }
  };

  const handleFormatCues = () => {
    if (!activeTrack?.srt) return;
    const cues = parseSrtCues(activeTrack.srt);
    if (cues.length === 0) {
      setStatusNotice('ไม่พบรูปแบบเวลา --> ที่แปลงได้ กรุณาตรวจสอบรูปแบบ SRT');
      return;
    }
    const cleanSrt = cuesToSrt(cues);
    updateTrackAt(safeIdx, {
      srt: cleanSrt,
      vtt: convertSrtToVtt(cleanSrt),
    });
    setStatusNotice(`จัดเรียงเลขลำดับและ Timecode ใหม่เรียบร้อย (${cues.length} ประโยค)`);
  };

  const handleRemoveTrack = (index) => {
    const target = tracks[index];
    if (!target) return;
    if (target.srt?.trim() && !confirm(`ต้องการลบแทร็ก "${target.label}" ใช่หรือไม่?`)) {
      return;
    }
    const next = tracks.filter((_, i) => i !== index);
    onChangeTracks(next);
    setSelectedIdx(Math.max(0, Math.min(index, next.length - 1)));
    setStatusNotice('ลบแทร็กออกจากรายการแล้ว — กด "บันทึก" เพื่อยืนยันลงระบบ');
  };

  const handleTriggerAi = async () => {
    if (!onDispatchAudioSubtitles || isDispatchingAi) return;
    setIsDispatchingAi(true);
    setStatusNotice('');
    try {
      await onDispatchAudioSubtitles(customPrompt);
    } finally {
      setIsDispatchingAi(false);
    }
  };

  const isAiRunning =
    isDispatchingAi || audioStatus === 'extracting' || subtitleStatus === 'processing';
  const safeBaseName = (videoTitle || 'subtitles').replace(/[^a-zA-Z0-9ก-๙_-]/g, '_').slice(0, 50);

  return (
    <div className="space-y-6">
      <input
        ref={replaceInputRef}
        type="file"
        accept=".srt,.vtt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          handleFileImport(f, 'replace');
        }}
      />
      <input
        ref={newTrackInputRef}
        type="file"
        accept=".srt,.vtt"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          handleFileImport(f, 'add');
        }}
      />

      {/* Track List & Actions */}
      <section className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1] flex items-center gap-2">
              <Captions className="w-4 h-4 text-[#FF7A00]" />
              <span>คำบรรยายของวิดีโอ ({tracks.length} แทร็ก)</span>
            </h3>
            <p className="text-[11px] text-[#6C655D] dark:text-[#9A9A9A] mt-0.5">
              แก้ไขข้อความซับไตเติล ปรับเวลา นำเข้าหรือส่งออกไฟล์ .SRT / .VTT ได้โดยตรง
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => newTrackInputRef.current?.click()}
              className="px-3 py-1.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border border-[#EFECE6] dark:border-white/10 text-xs font-semibold text-[#212529] dark:text-[#F1F1F1] inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-[#FF7A00]" />
              <span>นำเข้าเป็นแทร็กใหม่</span>
            </button>
            <button
              type="button"
              onClick={handleAddBlankTrack}
              className="px-3 py-1.5 rounded-xl bg-[#FF7A00] hover:bg-[#E56E00] text-white text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>เพิ่มแทร็กใหม่</span>
            </button>
          </div>
        </div>

        {/* Track Pills */}
        {tracks.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {tracks.map((track, idx) => {
              const isSelected = idx === safeIdx;
              const cueCount = trackCueCounts[idx];
              return (
                <button
                  key={`${track.id}-${idx}`}
                  type="button"
                  onClick={() => setSelectedIdx(idx)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer inline-flex items-center gap-2 ${
                    isSelected
                      ? 'bg-[#FF7A00]/12 border-[#FF7A00] text-[#FF7A00]'
                      : 'bg-[#F4F0E8] dark:bg-[#222222] border-[#EFECE6] dark:border-white/10 text-[#6C655D] dark:text-[#CCCCCC] hover:border-[#D5CFC5] dark:hover:border-white/25'
                  }`}
                >
                  <span>
                    {idx + 1}. {track.label || track.lang || 'แทร็ก'}
                  </span>
                  <span className="text-[10px] font-mono opacity-80">({cueCount})</span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[#DFD9CE] dark:border-white/15 bg-[#F4F0E8]/50 dark:bg-[#222222]/40 p-8 text-center space-y-2.5">
            <Captions className="w-8 h-8 text-[#8C857B] dark:text-[#71717A] mx-auto stroke-[1.5]" />
            <div className="text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
              วิดีโอนี้ยังไม่มีแทร็กคำบรรยาย
            </div>
            <p className="text-xs text-[#6C655D] dark:text-[#9A9A9A] max-w-md mx-auto">
              กด &ldquo;นำเข้าเป็นแทร็กใหม่&rdquo; เพื่ออัปโหลดไฟล์ .SRT / .VTT หรือให้ AI ช่วยถอดเสียงด้านล่าง
            </p>
          </div>
        )}

        {statusNotice && (
          <div className="px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-[#FF7A00]" />
            <span>{statusNotice}</span>
          </div>
        )}

        {/* Active Track Editor */}
        {activeTrack && (
          <div className="pt-2 border-t border-[#EFECE6] dark:border-white/10 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2 space-y-1">
                <label className="text-[11px] font-semibold text-[#6C655D] dark:text-[#AAAAAA] block">
                  ชื่อแทร็กที่แสดงในตัวเล่น (Label)
                </label>
                <input
                  type="text"
                  maxLength={60}
                  value={activeTrack.label || ''}
                  onChange={(e) => updateTrackAt(safeIdx, { label: e.target.value })}
                  placeholder="เช่น ไทย, English, จีนกลาง (ต้นฉบับ)"
                  className="w-full px-3 py-2 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 focus:border-[#FF7A00] text-xs sm:text-sm text-[#212529] dark:text-[#F1F1F1] outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-semibold text-[#6C655D] dark:text-[#AAAAAA] block">
                  รหัสภาษา (Lang)
                </label>
                <input
                  type="text"
                  maxLength={12}
                  value={activeTrack.lang || ''}
                  onChange={(e) => updateTrackAt(safeIdx, { lang: e.target.value.toLowerCase() })}
                  placeholder="th / en / zh / ja"
                  className="w-full px-3 py-2 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 focus:border-[#FF7A00] text-xs sm:text-sm font-mono text-[#212529] dark:text-[#F1F1F1] outline-none"
                />
              </div>
            </div>

            {/* Editor Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex p-0.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 gap-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingCue(null);
                    setNewCueComposer(null);
                    setViewMode('editor');
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition ${
                    viewMode === 'editor'
                      ? 'bg-white dark:bg-[#181818] text-[#212529] dark:text-[#F1F1F1] shadow-2xs'
                      : 'text-[#6C655D] dark:text-[#9A9A9A]'
                  }`}
                >
                  <Code2 className="w-3.5 h-3.5" />
                  <span>แก้ไขข้อความ SRT</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('timeline')}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer transition ${
                    viewMode === 'timeline'
                      ? 'bg-white dark:bg-[#181818] text-[#212529] dark:text-[#F1F1F1] shadow-2xs'
                      : 'text-[#6C655D] dark:text-[#9A9A9A]'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  <span>แก้ไขไทม์ไลน์ ({parsedCues.length})</span>
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => replaceInputRef.current?.click()}
                  className="px-2.5 py-1.5 rounded-lg bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border border-[#EFECE6] dark:border-white/10 text-[11px] font-semibold text-[#212529] dark:text-[#E4E4E7] inline-flex items-center gap-1 cursor-pointer transition"
                >
                  <Upload className="w-3 h-3" />
                  <span>นำเข้าทับแทร็กนี้</span>
                </button>

                <button
                  type="button"
                  onClick={handleFormatCues}
                  className="px-2.5 py-1.5 rounded-lg bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border border-[#EFECE6] dark:border-white/10 text-[11px] font-semibold text-[#212529] dark:text-[#E4E4E7] inline-flex items-center gap-1 cursor-pointer transition"
                >
                  <Wand2 className="w-3 h-3 text-[#FF7A00]" />
                  <span>จัด Timecode</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    triggerTextDownload(`${safeBaseName}_${activeTrack.id || 'sub'}.srt`, activeTrack.srt || '')
                  }
                  disabled={!activeTrack.srt}
                  className="px-2.5 py-1.5 rounded-lg bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border border-[#EFECE6] dark:border-white/10 text-[11px] font-semibold text-[#212529] dark:text-[#E4E4E7] inline-flex items-center gap-1 cursor-pointer transition disabled:opacity-40"
                >
                  <Download className="w-3 h-3" />
                  <span>.SRT</span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    triggerTextDownload(
                      `${safeBaseName}_${activeTrack.id || 'sub'}.vtt`,
                      convertSrtToVtt(activeTrack.srt || ''),
                      'text/vtt;charset=utf-8'
                    )
                  }
                  disabled={!activeTrack.srt}
                  className="px-2.5 py-1.5 rounded-lg bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border border-[#EFECE6] dark:border-white/10 text-[11px] font-semibold text-[#212529] dark:text-[#E4E4E7] inline-flex items-center gap-1 cursor-pointer transition disabled:opacity-40"
                >
                  <Download className="w-3 h-3" />
                  <span>.VTT</span>
                </button>

                <button
                  type="button"
                  onClick={() => handleRemoveTrack(safeIdx)}
                  className="px-2.5 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-[11px] font-semibold text-rose-600 dark:text-rose-400 inline-flex items-center gap-1 cursor-pointer transition"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>ลบแทร็ก</span>
                </button>
              </div>
            </div>

            {viewMode === 'editor' ? (
              <div className="space-y-1.5">
                <textarea
                  rows={15}
                  value={activeTrack.srt || ''}
                  onChange={(e) =>
                    updateTrackAt(safeIdx, {
                      srt: e.target.value,
                      vtt: convertSrtToVtt(e.target.value),
                    })
                  }
                  spellCheck={false}
                  placeholder={`1\n00:00:01,000 --> 00:00:04,500\nข้อความซับไตเติล`}
                  className="w-full px-3.5 py-3 rounded-xl bg-[#F4F0E8] dark:bg-[#121212] border border-[#EFECE6] dark:border-white/10 focus:bg-white dark:focus:bg-[#141414] focus:border-[#FF7A00] text-xs sm:text-[13px] font-mono leading-relaxed text-[#212529] dark:text-[#E4E4E7] outline-none transition resize-y"
                />
                <div className="flex items-center justify-between text-[11px] text-[#8C857B] dark:text-[#9A9A9A]">
                  <span>รองรับมาตรฐาน SubRip (.srt) และแปลงเป็น WebVTT ให้อัตโนมัติตอนบันทึก</span>
                  <span className="font-mono">
                    ตรวจพบ {parsedCues.length} ประโยค
                  </span>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="rounded-xl border border-[#EFECE6] dark:border-white/10 bg-[#F4F0E8]/60 dark:bg-[#121212] overflow-hidden">
                  {/* Timeline Control Bar */}
                  <div className="px-3 py-2 border-b border-[#EFECE6] dark:border-white/10 bg-white/70 dark:bg-[#161616] flex flex-wrap items-center justify-between gap-2">
                    <div className="relative flex-1 min-w-[180px] max-w-xs">
                      <Search className="w-3.5 h-3.5 text-[#8C857B] dark:text-[#9A9A9A] absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={timelineSearch}
                        onChange={(e) => setTimelineSearch(e.target.value)}
                        placeholder="ค้นหาข้อความ, เวลา หรือ #ลำดับ..."
                        aria-label="ค้นหาซับไตเติลในไทม์ไลน์"
                        className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 text-xs text-[#212529] dark:text-[#E4E4E7] placeholder:text-[#8C857B] dark:placeholder:text-[#787878] focus:outline-none focus:border-[#FF7A00]"
                      />
                      {timelineSearch ? (
                        <button
                          type="button"
                          onClick={() => setTimelineSearch('')}
                          title="ล้างคำค้นหา"
                          aria-label="ล้างคำค้นหา"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8C857B] hover:text-[#212529] dark:hover:text-white cursor-pointer"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      ) : null}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {timelineSearch ? (
                        <span className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] px-1.5">
                          พบ {filteredCues.length} / {parsedCues.length}
                        </span>
                      ) : null}
                      {activeUndo ? (
                        <button
                          type="button"
                          onClick={handleUndoTimeline}
                          title={`ย้อนกลับ: ${activeUndo.label}`}
                          className="px-2.5 py-1.5 rounded-lg bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border border-[#EFECE6] dark:border-white/10 text-[11px] font-semibold text-[#5C544B] dark:text-[#D4D4D8] inline-flex items-center gap-1 cursor-pointer transition"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>ย้อนกลับ</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openNewCueComposer(null)}
                        className="px-2.5 py-1.5 rounded-lg bg-[#FF7A00] hover:bg-[#E56D00] text-white text-[11px] font-semibold inline-flex items-center gap-1 cursor-pointer transition shadow-2xs"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>เพิ่มประโยค</span>
                      </button>
                    </div>
                  </div>

                  {activeNewComposer && activeNewComposer.insertAfterIdx === null ? (
                    <CueDraftEditor
                      title="เพิ่มประโยคใหม่"
                      draft={activeNewComposer}
                      onChange={(patch) =>
                        setNewCueComposer((prev) => (prev ? { ...prev, ...patch } : null))
                      }
                      onSave={saveNewCueComposer}
                      onCancel={() => setNewCueComposer(null)}
                      saveLabel="เพิ่มประโยค"
                    />
                  ) : null}

                  <div ref={timelineListRef} className="max-h-[460px] overflow-y-auto divide-y divide-[#EFECE6] dark:divide-white/5">
                    {parsedCues.length === 0 ? (
                      <div className="p-6 text-center space-y-2">
                        <p className="text-xs text-[#8C857B] dark:text-[#9A9A9A]">
                          ไม่พบประโยคที่เวลาถูกต้องในแทร็กนี้
                        </p>
                        {!activeNewComposer ? (
                          <button
                            type="button"
                            onClick={() => openNewCueComposer(null)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#FF7A00]/10 hover:bg-[#FF7A00]/20 text-[#FF7A00] text-xs font-semibold cursor-pointer transition"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>เพิ่มประโยคแรก</span>
                          </button>
                        ) : null}
                      </div>
                    ) : filteredCues.length === 0 ? (
                      <div className="p-6 text-center text-xs text-[#8C857B] dark:text-[#9A9A9A]">
                        ไม่พบประโยคที่ตรงกับ &quot;{timelineSearch}&quot;
                      </div>
                    ) : (
                      filteredCues.slice(pageStart, pageStart + TIMELINE_PAGE_SIZE).map(({ cue, idx }) => {
                        const isEditing = activeEdit?.cueIdx === idx;
                        const originalText = originalByIndex.get(idx);
                        const startTs = formatMsToSrtTimestamp(cue.startMs);
                        const endTs = formatMsToSrtTimestamp(cue.endMs);

                        return (
                          <Fragment key={idx}>
                            <div className="group px-3.5 py-2.5 flex items-start justify-between gap-2 text-xs hover:bg-white/75 dark:hover:bg-white/[0.04] transition-colors">
                              {isEditing ? (
                                <div
                                  className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2.5"
                                  onKeyDown={(event) => {
                                    if (event.nativeEvent.isComposing) return;
                                    if (event.key === 'Escape') {
                                      event.preventDefault();
                                      setEditingCue(null);
                                    } else if (event.key === 'Enter' && (!event.shiftKey || event.ctrlKey || event.metaKey)) {
                                      event.preventDefault();
                                      saveCueEditor();
                                    }
                                  }}
                                >
                                  <div className="flex shrink-0 items-center gap-1 font-mono text-[11px] text-[#FF7A00] sm:w-56">
                                    <span>#{idx + 1}</span>
                                    {[
                                      ['start', 'เวลาเริ่มต้น'],
                                      ['end', 'เวลาสิ้นสุด'],
                                    ].map(([field, label], index) => (
                                      <Fragment key={field}>
                                        <span aria-hidden="true">{index === 0 ? '•' : '→'}</span>
                                        <input
                                          className="w-[13ch] min-w-0 border-b border-[#D5CFC5] dark:border-white/25 bg-transparent py-1 outline-none focus:border-[#FF7A00]"
                                          value={activeEdit[field]}
                                          aria-label={label}
                                          onChange={(event) => {
                                            const value = event.target.value;
                                            setEditingCue((prev) => prev && { ...prev, [field]: value, error: '' });
                                          }}
                                        />
                                      </Fragment>
                                    ))}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <label className="block text-[10px] font-medium text-[#6C655D] dark:text-[#AAAAAA]">
                                      ข้อความซับไตเติล
                                      <textarea
                                        rows={1}
                                        autoFocus
                                        value={activeEdit.text}
                                        aria-invalid={Boolean(activeEdit.error)}
                                        onChange={(event) => {
                                          const value = event.target.value;
                                          setEditingCue((prev) => prev && { ...prev, text: value, error: '' });
                                        }}
                                        className="block w-full resize-none [field-sizing:content] border-b border-[#D5CFC5] dark:border-white/25 bg-transparent pb-1 text-xs leading-relaxed text-[#212529] dark:text-[#E4E4E7] outline-none focus:border-[#FF7A00]"
                                      />
                                    </label>
                                    {originalText && (
                                      <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[#6C655D] dark:text-[#AAAAAA]">
                                        <span className="sr-only">ต้นฉบับ </span>{originalText}
                                      </p>
                                    )}
                                    {activeEdit.error && (
                                      <p role="alert" className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{activeEdit.error}</p>
                                    )}
                                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-medium">
                                      <button type="button" onClick={saveCueEditor} className="cursor-pointer text-[#A54B00] dark:text-[#FF9A39]">ยืนยัน</button>
                                      <button type="button" onClick={() => setEditingCue(null)} className="cursor-pointer text-[#6C655D] dark:text-[#AAAAAA]">ยกเลิก</button>
                                      <button type="button" onClick={() => openNewCueComposer(idx)} className="cursor-pointer text-[#6C655D] dark:text-[#AAAAAA]">แทรกถัดไป</button>
                                      <button type="button" onClick={() => deleteCueAt(idx)} className="cursor-pointer text-rose-600 dark:text-rose-400">ลบ</button>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openCueEditor(idx)}
                                  title="คลิกเพื่อแก้ไขประโยคนี้"
                                  className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-2.5 text-left cursor-pointer"
                                >
                                  <span className="font-mono text-[11px] text-[#FF7A00] shrink-0 sm:w-56">
                                    #{idx + 1} • {startTs.slice(0, 8)}
                                    <span className="opacity-65">{startTs.slice(8)}</span> →{' '}
                                    {endTs.slice(0, 8)}
                                    <span className="opacity-65">{endTs.slice(8)}</span>
                                  </span>
                                  <span className="min-w-0 grow whitespace-pre-wrap leading-relaxed break-words text-[#212529] dark:text-[#E4E4E7]">
                                    {cue.text}
                                    {originalText && (
                                      <span className="mt-1 block text-[11px] text-[#6C655D] dark:text-[#AAAAAA]">
                                        <span className="sr-only">ต้นฉบับ </span>{originalText}
                                      </span>
                                    )}
                                  </span>
                                </button>
                              )}
                            </div>

                            {activeNewComposer && activeNewComposer.insertAfterIdx === idx ? (
                              <CueDraftEditor
                                title={`แทรกประโยคหลัง #${idx + 1}`}
                                draft={activeNewComposer}
                                onChange={(patch) =>
                                  setNewCueComposer((prev) => (prev ? { ...prev, ...patch } : null))
                                }
                                onSave={saveNewCueComposer}
                                onCancel={() => setNewCueComposer(null)}
                                saveLabel="เพิ่มประโยค"
                              />
                            ) : null}
                          </Fragment>
                        );
                      })
                    )}
                  </div>
                  {lastPage > 0 && (
                    <nav aria-label="หน้าไทม์ไลน์" className="flex items-center justify-between gap-2 border-t border-[#EFECE6] px-3 py-2 text-[11px] text-[#6C655D] dark:border-white/10 dark:text-[#AAAAAA]">
                      <span>{pageStart + 1}–{Math.min(pageStart + TIMELINE_PAGE_SIZE, filteredCues.length)} / {filteredCues.length} คิว</span>
                      <div className="flex items-center gap-3">
                        {[
                          { label: 'ก่อนหน้า', offset: -1, disabled: pageIndex === 0 },
                          { label: 'ถัดไป', offset: 1, disabled: pageIndex === lastPage },
                        ].map(({ label, offset, disabled }) => (
                          <button
                            key={label}
                            type="button"
                            disabled={disabled || Boolean(activeEdit || activeNewComposer)}
                            onClick={() => {
                              setTimelinePage({ key: pageKey, index: pageIndex + offset });
                              timelineListRef.current?.scrollTo({ top: 0 });
                            }}
                            className="rounded-md px-2 py-1 font-semibold enabled:cursor-pointer enabled:hover:text-[#FF7A00] disabled:opacity-35"
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </nav>
                  )}
                </div>
                <p className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A]">
                  คลิกข้อความเพื่อแก้ในแถว · Enter ยืนยัน · Shift+Enter ขึ้นบรรทัดใหม่ · Esc ยกเลิก · กด &quot;บันทึก&quot; ด้านบนเพื่อบันทึกลงระบบ
                </p>
              </div>
            )}
          </div>
        )}
      </section>

      {/* AI Re-Transcribe Card */}
      {canGenerateSubtitles && onDispatchAudioSubtitles && (
        <SubtitleGenerationCard
          audioStatus={audioStatus}
          subtitleStatus={subtitleStatus}
          isRunningWorkflow={isAiRunning}
          canGenerate={canGenerateSubtitles}
          workerDetail={workerDetail}
          customPrompt={customPrompt}
          setCustomPrompt={setCustomPrompt}
          onRun={handleTriggerAi}
        />
      )}
    </div>
  );
}

'use client';

import { useState, useRef, useMemo } from 'react';
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
} from 'lucide-react';
import SubtitleGenerationCard from '@/components/SubtitleGenerationCard';
import {
  parseSrtCues,
  cuesToSrt,
  convertSrtToVtt,
  formatMsToSrtTimestamp,
} from '@/lib/subtitleUtils';

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
  const [customPrompt, setCustomPrompt] = useState('');
  const [isDispatchingAi, setIsDispatchingAi] = useState(false);
  const [statusNotice, setStatusNotice] = useState('');
  const replaceInputRef = useRef(null);
  const newTrackInputRef = useRef(null);

  const safeIdx = selectedIdx >= 0 && selectedIdx < tracks.length ? selectedIdx : 0;
  const activeTrack = tracks[safeIdx] || null;
  const activeSrt = activeTrack?.srt || '';

  const parsedCues = useMemo(() => {
    if (!activeSrt) return [];
    return parseSrtCues(activeSrt);
  }, [activeSrt]);

  const updateTrackAt = (index, updater) => {
    const next = tracks.map((t, i) => (i === index ? { ...t, ...updater } : t));
    onChangeTracks(next);
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
              const cueCount = parseSrtCues(track.srt || '').length;
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
                  onClick={() => setViewMode('editor')}
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
                  <span>ดูตัวอย่างไทม์ไลน์ ({parsedCues.length})</span>
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
              <div className="max-h-96 overflow-y-auto rounded-xl border border-[#EFECE6] dark:border-white/10 bg-[#F4F0E8]/60 dark:bg-[#121212] divide-y divide-[#EFECE6] dark:divide-white/5">
                {parsedCues.length === 0 ? (
                  <div className="p-6 text-center text-xs text-[#8C857B] dark:text-[#9A9A9A]">
                    ไม่พบประโยคที่เวลาถูกต้องในแทร็กนี้
                  </div>
                ) : (
                  parsedCues.map((cue, cIdx) => (
                    <div key={cIdx} className="px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-start gap-2 text-xs">
                      <span className="font-mono text-[11px] text-[#FF7A00] shrink-0 sm:w-48">
                        #{cIdx + 1} • {formatMsToSrtTimestamp(cue.startMs).slice(0, 8)} →{' '}
                        {formatMsToSrtTimestamp(cue.endMs).slice(0, 8)}
                      </span>
                      <span className="text-[#212529] dark:text-[#E4E4E7] whitespace-pre-wrap leading-relaxed">
                        {cue.text}
                      </span>
                    </div>
                  ))
                )}
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

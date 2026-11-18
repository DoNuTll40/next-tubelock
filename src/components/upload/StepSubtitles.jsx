'use client';

import { useState, useRef } from 'react';
import {
  FileText,
  CheckCircle2,
  Trash2,
} from 'lucide-react';

export default function StepSubtitles({
  subtitleMode,
  setSubtitleMode,
  manualSubtitleFile,
  setManualSubtitleFile,
  customPrompt,
  setCustomPrompt,
  generatedSubtitleSrt,
  subtitleTracks = [],
  onAddLog,
}) {
  const [previewTrackId, setPreviewTrackId] = useState('th');
  const fileInputRef = useRef(null);

  const handleFileDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleManualFile(file);
  };

  const handleManualFile = async (file) => {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext !== 'srt' && ext !== 'vtt') {
      alert('กรุณาเลือกไฟล์นามสกุล .srt หรือ .vtt เท่านั้น');
      return;
    }
    let textContent = '';
    try {
      textContent = await file.text();
    } catch (_) {}

    setManualSubtitleFile({
      name: file.name,
      size: (file.size / 1024).toFixed(1) + ' KB',
      ext,
      textContent,
      file,
    });
    if (onAddLog) onAddLog(`แนบไฟล์คำบรรยายด้วยตนเอง: ${file.name}`);
  };

  return (
    <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
      <div>
        <h2 className="text-base font-bold text-[#212529] dark:text-[#F1F1F1]">
          02 ถอดเสียงและซับไตเติล
        </h2>
        <p className="text-xs sm:text-sm text-[#6C655D] dark:text-[#AAAAAA] mt-0.5">
          ระบบสร้างซับเมื่ออัปโหลดเสร็จ เลือกขอซับ AI หรือนำเข้าไฟล์ซับของคุณเองได้ที่นี่
        </p>
      </div>

      {/* Mode Switcher */}
      <div className="grid grid-cols-3 p-1 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 gap-1">
        <button
          type="button"
          onClick={() => setSubtitleMode('auto')}
          aria-pressed={subtitleMode === 'auto'}
          className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer ${
            subtitleMode === 'auto'
              ? 'bg-white dark:bg-[#181818] text-[#212529] dark:text-[#F1F1F1] shadow-2xs'
              : 'text-[#6C655D] dark:text-[#9A9A9A] hover:text-[#212529] dark:hover:text-[#F1F1F1]'
          }`}
        >
          แปลอัตโนมัติ
        </button>
        <button
          type="button"
          onClick={() => setSubtitleMode('requested-ai')}
          aria-pressed={subtitleMode === 'requested-ai'}
          className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer ${
            subtitleMode === 'requested-ai'
              ? 'bg-white dark:bg-[#181818] text-[#212529] dark:text-[#F1F1F1] shadow-2xs'
              : 'text-[#6C655D] dark:text-[#9A9A9A] hover:text-[#212529] dark:hover:text-[#F1F1F1]'
          }`}
        >
          ขอสร้างซับด้วย AI
        </button>
        <button
          type="button"
          onClick={() => setSubtitleMode('manual')}
          aria-pressed={subtitleMode === 'manual'}
          className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer ${
            subtitleMode === 'manual'
              ? 'bg-white dark:bg-[#181818] text-[#212529] dark:text-[#F1F1F1] shadow-2xs'
              : 'text-[#6C655D] dark:text-[#9A9A9A] hover:text-[#212529] dark:hover:text-[#F1F1F1]'
          }`}
        >
          อัปโหลดไฟล์ .SRT / .VTT เอง
        </button>
      </div>

      {/* Mode A: Manual Upload */}
      {subtitleMode === 'manual' && (
        <div className="space-y-3">
          {!manualSubtitleFile ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border border-dashed border-[#DFD9CE] dark:border-white/20 hover:border-[#FF7A00] rounded-xl p-8 text-center cursor-pointer transition bg-[#F4F0E8]/60 dark:bg-[#222222]/50"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".srt,.vtt"
                className="hidden"
                onChange={(e) => handleManualFile(e.target.files?.[0])}
              />
              <div className="text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
                ลากไฟล์คำบรรยายมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์
              </div>
              <div className="text-xs text-[#8C857B] dark:text-[#9A9A9A] mt-1">
                รองรับมาตรฐาน SubRip (.srt) และ WebVTT (.vtt) — หรือข้ามขั้นตอนนี้ได้
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 rounded-xl">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/15 flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-[#212529] dark:text-[#F1F1F1] truncate">
                    {manualSubtitleFile.name}
                  </div>
                  <div className="text-xs text-[#8C857B] dark:text-[#9A9A9A] font-mono">
                    {manualSubtitleFile.size} • พร้อมผูกกับวิดีโอ
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setManualSubtitleFile(null)}
                className="p-2 rounded-lg bg-white dark:bg-[#181818] hover:bg-rose-500/10 text-[#8C857B] hover:text-rose-500 border border-[#EFECE6] dark:border-white/10 transition cursor-pointer"
                title="ลบไฟล์นี้"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mode B: AI Transcription */}
      {subtitleMode === 'requested-ai' && (
        <label className="block space-y-2 text-sm">
          <span>คำสั่งเพิ่มเติมให้ AI (ไม่บังคับ)</span>
          <input
            type="text"
            value={customPrompt}
            onChange={(event) => setCustomPrompt(event.target.value)}
            className="w-full rounded-xl border border-black/10 dark:border-white/10 bg-transparent px-3 py-2"
          />
          <span className="block text-xs text-[#6C655D] dark:text-[#AAAAAA]">ระบบจะสร้างซับเมื่ออัปโหลดเสร็จ และแสดงป้าย «แปลโดย AI»</span>
        </label>
      )}
      {(generatedSubtitleSrt || subtitleTracks.length > 0) && (() => {
        const activeTrack =
          subtitleTracks.find((t) => t.id === previewTrackId) ||
          subtitleTracks[0] ||
          null;
        const previewText = activeTrack?.srt || generatedSubtitleSrt || '';
        return (
          <div className="p-4 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-emerald-500/30 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                <span>
                  ซับไตเติลที่ AI ถอดเสียงสำเร็จ
                  {subtitleTracks.length > 1 ? ` (${subtitleTracks.length} แทร็ก)` : ''}
                </span>
              </div>
              {subtitleTracks.length > 1 && (
                <div className="inline-flex p-0.5 rounded-lg bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 gap-0.5">
                  {subtitleTracks.map((track, idx) => (
                    <button
                      key={track.id || idx}
                      type="button"
                      onClick={() => setPreviewTrackId(track.id)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                        activeTrack?.id === track.id
                          ? 'bg-[#FF7A00] text-white'
                          : 'text-[#6C655D] dark:text-[#9A9A9A] hover:text-[#212529] dark:hover:text-[#F1F1F1]'
                      }`}
                    >
                      {idx + 1}. {track.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <pre className="text-xs text-[#212529] dark:text-[#CCCCCC] font-mono whitespace-pre-wrap bg-white dark:bg-[#181818] p-3 rounded-lg border border-[#EFECE6] dark:border-white/10 max-h-60 overflow-y-auto">
              {previewText}
            </pre>
          </div>
        );
      })()}
    </div>
  );
}

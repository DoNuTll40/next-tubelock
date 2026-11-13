'use client';

import { useState, useRef } from 'react';
import {
  FileText,
  CheckCircle2,
  Loader2,
  Trash2,
} from 'lucide-react';
import { SUBTITLE_UNIFIED_SYSTEM_PROMPT } from '@/lib/subtitlePrompts';

export default function StepSubtitles({
  subtitleMode,
  setSubtitleMode,
  manualSubtitleFile,
  setManualSubtitleFile,
  selectedModel,
  customPrompt,
  setCustomPrompt,
  isRawUploaded,
  isUploading,
  uploadPercent = 0,
  audioStatus,
  subtitleStatus,
  generatedSubtitleSrt,
  subtitleTracks = [],
  onDispatchAudioSubtitles,
  onAddLog,
}) {
  const [isDispatching, setIsDispatching] = useState(false);
  const [previewTrackId, setPreviewTrackId] = useState('th');
  const isDispatchingRef = useRef(false);
  const fileInputRef = useRef(null);

  const isRunningWorkflow =
    isDispatching || audioStatus === 'extracting' || subtitleStatus === 'processing';
  const isSubtitleReady = subtitleStatus === 'ready';
  const canStartAiGeneration = Boolean(isRawUploaded) && !isRunningWorkflow && !isDispatching;

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

  const handleRunAiSubtitles = async () => {
    if (isDispatchingRef.current || isRunningWorkflow || !canStartAiGeneration || !onDispatchAudioSubtitles) return;
    isDispatchingRef.current = true;
    setIsDispatching(true);
    try {
      await onDispatchAudioSubtitles();
    } finally {
      isDispatchingRef.current = false;
      setIsDispatching(false);
    }
  };

  return (
    <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
      <div>
        <h2 className="text-base font-bold text-[#212529] dark:text-[#F1F1F1]">
          02 ถอดเสียงและซับไตเติล
        </h2>
        <p className="text-xs sm:text-sm text-[#6C655D] dark:text-[#AAAAAA] mt-0.5">
          เลือกให้ AI ถอดเสียงจากวิดีโอ หรืออัปโหลดไฟล์ซับไตเติล (.SRT / .VTT) ของคุณเอง
        </p>
      </div>

      {/* Mode Switcher */}
      <div className="grid grid-cols-2 p-1 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 gap-1">
        <button
          type="button"
          onClick={() => setSubtitleMode('ai')}
          className={`py-2 px-3 rounded-lg text-xs sm:text-sm font-semibold transition cursor-pointer ${
            subtitleMode === 'ai'
              ? 'bg-white dark:bg-[#181818] text-[#212529] dark:text-[#F1F1F1] shadow-2xs'
              : 'text-[#6C655D] dark:text-[#9A9A9A] hover:text-[#212529] dark:hover:text-[#F1F1F1]'
          }`}
        >
          ให้ AI ถอดเสียงอัตโนมัติ
        </button>
        <button
          type="button"
          onClick={() => setSubtitleMode('manual')}
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
      {subtitleMode === 'ai' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
                  {isSubtitleReady
                    ? 'ถอดเสียงและสร้างซับไตเติลสำเร็จแล้ว'
                    : isRunningWorkflow
                    ? 'กำลังสกัดเสียงและสร้างซับไตเติลด้วย AI...'
                    : isRawUploaded
                    ? 'พร้อมสั่ง AI ถอดเสียงทันที'
                    : `กำลังอัปโหลดไฟล์วิดีโอ (${uploadPercent}%)`}
                </div>
                <div className="text-xs text-[#6C655D] dark:text-[#9A9A9A] mt-0.5">
                  {isSubtitleReady
                    ? 'บันทึกไฟล์คำบรรยาย .SRT / .VTT เรียบร้อย'
                    : isRunningWorkflow
                    ? `กำลังประมวลผลด้วย ${selectedModel || 'Gemini AI'} กรุณารอสักครู่`
                    : 'กดปุ่มด้านล่างเพื่อถอดเสียงทันที หรือข้ามไปให้ระบบรันอัตโนมัติตอนกดเผยแพร่ใน Step 4'}
                </div>
              </div>

              <span
                className={`text-[11px] px-2.5 py-1 rounded-full font-semibold shrink-0 ${
                  isSubtitleReady
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                    : isRunningWorkflow || isUploading
                    ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
                    : 'bg-white dark:bg-[#181818] text-[#8C857B] dark:text-[#9A9A9A] border border-[#EFECE6] dark:border-white/10'
                }`}
              >
                {isSubtitleReady
                  ? 'เสร็จแล้ว'
                  : isRunningWorkflow
                  ? 'กำลังทำ'
                  : isRawUploaded
                  ? 'รอคำสั่ง'
                  : `${uploadPercent}%`}
              </span>
            </div>

            {/* Default Unified Auto System Prompt Preview (No choices — single-click auto flow) */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">
                  Prompt ตั้งต้นของระบบ
                </span>
                <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#FF7A00]/10 text-[#FF7A00] font-semibold border border-[#FF7A00]/25">
                  อัตโนมัติ: ไทย 1 ภาษา • ต่างประเทศ 2 ภาษา
                </span>
              </div>
              <pre className="text-[11px] leading-relaxed text-[#6C655D] dark:text-[#AAAAAA] font-mono whitespace-pre-wrap bg-white dark:bg-[#181818] p-3 rounded-xl border border-[#EFECE6] dark:border-white/10 max-h-44 overflow-y-auto">
                {SUBTITLE_UNIFIED_SYSTEM_PROMPT}
              </pre>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1] block">
                คำสั่งเพิ่มเติมให้ AI (ไม่บังคับ)
              </label>
              <input
                type="text"
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="เช่น เน้นคำศัพท์เทคนิคภาษาอังกฤษทับศัพท์, ถอดเนื้อเพลง หรือปรับสำนวนคำแปล"
                className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 focus:border-[#FF7A00] focus:ring-3 focus:ring-[#FF7A00]/15 text-[#212529] dark:text-[#F1F1F1] placeholder-[#8C857B] dark:placeholder-[#71717A] text-xs sm:text-sm outline-none transition"
              />
            </div>

            <button
              type="button"
              onClick={handleRunAiSubtitles}
              disabled={!canStartAiGeneration}
              className={`w-full py-2.5 px-4 rounded-xl font-semibold text-xs sm:text-sm transition flex items-center justify-center gap-2 ${
                canStartAiGeneration
                  ? 'bg-[#FF7A00] hover:bg-[#E86E00] text-white cursor-pointer'
                  : 'bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 text-[#8C857B] dark:text-[#666666] cursor-not-allowed'
              }`}
            >
              {isRunningWorkflow && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>
                {isRunningWorkflow
                  ? 'กำลังถอดเสียงและสร้างซับไตเติล...'
                  : isSubtitleReady
                  ? 'สั่ง AI ถอดเสียงใหม่อีกครั้ง'
                  : 'เริ่มถอดเสียงและสร้างซับไตเติลด้วย AI'}
              </span>
            </button>
          </div>

          {/* Preview Generated Subtitles from DB */}
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
      )}
    </div>
  );
}

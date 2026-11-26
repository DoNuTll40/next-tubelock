'use client';

import { useId, useState, useRef } from 'react';
import {
  FileText,
  CheckCircle2,
  Trash2,
} from 'lucide-react';
import VideoLanguagePicker from '@/components/upload/VideoLanguagePicker';
import { AnimatedTabs, AnimatedTabPanel } from '@/components/ui/AnimatedTabs';
import { getVideoLanguage } from '@/lib/videoLanguages';

const SUBTITLE_MODES = [
  { id: 'auto', label: 'แปลอัตโนมัติ' },
  { id: 'requested-ai', label: 'ขอสร้างซับด้วย AI' },
  { id: 'manual', label: 'อัปโหลดไฟล์ .SRT / .VTT เอง' },
];

export default function StepSubtitles({
  sourceLanguage = '',
  setSourceLanguage,
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
  const modeTabsId = useId();
  const previewTabsId = useId();
  const previewTabs = subtitleTracks.map((track, index) => ({
    id: String(track.id || `track-${index}`),
    label: `${index + 1}. ${track.label}`,
  }));
  const activeTrackIndex = Math.max(0, previewTabs.findIndex((tab) => tab.id === previewTrackId));
  const activePreviewTab = previewTabs[activeTrackIndex]?.id;
  const previewText = subtitleTracks[activeTrackIndex]?.srt || generatedSubtitleSrt || '';
  const showPreviewTabs = previewTabs.length > 1;

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
          เลือกภาษาเสียงพูดตั้งต้นเพื่อให้ AI ถอดเสียงตรงภาษา หรืออัปโหลดไฟล์ซับของคุณเอง
        </p>
      </div>

      {/* Mandatory Source Spoken Language Picker (synced with Step 1) */}
      <VideoLanguagePicker
        value={sourceLanguage}
        onChange={(val) => setSourceLanguage && setSourceLanguage(val)}
        required
        compact
      />

      <AnimatedTabs
        id={modeTabsId}
        tabs={SUBTITLE_MODES}
        value={subtitleMode}
        onChange={setSubtitleMode}
        label="วิธีสร้างซับไตเติล"
        variant="pill"
        fullWidth
        className="rounded-xl border border-[#EFECE6] bg-[#F4F0E8] p-1 dark:border-white/10 dark:bg-[#222222]"
      />

      <AnimatedTabPanel id={modeTabsId} value={subtitleMode}>
        {subtitleMode === 'auto' && (
          <p className="text-xs text-[#6C655D] dark:text-[#AAAAAA]">
            {getVideoLanguage(sourceLanguage)?.isNone
              ? 'ข้ามการสร้างซับอัตโนมัติตามการตั้งค่า «ไม่มีเสียงพูด»'
              : 'ระบบจะใช้ภาษาเสียงพูดที่เลือกเพื่อสร้างซับอัตโนมัติหลังอัปโหลด'}
          </p>
        )}
        {subtitleMode === 'manual' && (
          !manualSubtitleFile ? (
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
          )
        )}

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
      </AnimatedTabPanel>

      {(generatedSubtitleSrt || subtitleTracks.length > 0) && (
        <div className="p-4 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-emerald-500/30 space-y-2.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              <span>
                ซับไตเติลที่ AI ถอดเสียงสำเร็จ
                {showPreviewTabs ? ` (${subtitleTracks.length} แทร็ก)` : ''}
              </span>
            </div>
            {showPreviewTabs && (
              <AnimatedTabs
                id={previewTabsId}
                tabs={previewTabs}
                value={activePreviewTab}
                onChange={setPreviewTrackId}
                label="แทร็กซับไตเติลตัวอย่าง"
                variant="pill"
                className="max-w-full"
              />
            )}
          </div>
          <AnimatedTabPanel id={previewTabsId} value={activePreviewTab} behavior={showPreviewTabs ? 'tabs' : 'filter'}>
            <pre className="text-xs text-[#212529] dark:text-[#CCCCCC] font-mono whitespace-pre-wrap bg-white dark:bg-[#181818] p-3 rounded-lg border border-[#EFECE6] dark:border-white/10 max-h-60 overflow-y-auto">
              {previewText}
            </pre>
          </AnimatedTabPanel>
        </div>
      )}
    </div>
  );
}

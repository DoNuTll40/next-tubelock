'use client';

import { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  Cpu,
  CheckCircle2,
  Loader2,
  Trash2,
  Terminal,
  Volume2,
  Bot,
  Info,
  ShieldCheck,
  XCircle,
} from 'lucide-react';

const DEFAULT_SYSTEM_PROMPT = `คุณคือผู้เชี่ยวชาญการสร้างไฟล์คำบรรยาย (.SRT) 
- สร้างไทม์โค้ดในรูปแบบ 00:00:00,000 --> 00:00:00,000
- แยกวรรคตอนให้เป็นธรรมชาติ ความยาวไม่เกิน 2 บรรทัดต่อช่วงเวลา
- สะกดคำภาษาไทยให้ถูกต้องตามหลักไวยากรณ์และบริบท`;

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
  audioStatus, // 'waiting' | 'extracting' | 'ready' | 'failed'
  subtitleStatus, // 'waiting' | 'processing' | 'ready' | 'failed'
  generatedSubtitleSrt,
  onDispatchAudioSubtitles,
  onAddLog,
  isCancelling = false,
  onCancelUpload = null,
}) {
  const [isDispatching, setIsDispatching] = useState(false);
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
    <div className="space-y-6">
      {/* Mode Selector Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setSubtitleMode('manual')}
          className={`flex items-start gap-3.5 p-4 rounded-2xl border text-left transition cursor-pointer ${
            subtitleMode === 'manual'
              ? 'bg-[#181818] border-[#f97316] ring-1 ring-[#f97316]/40 shadow-lg'
              : 'bg-[#141414] border-[#262626] hover:border-[#383838]'
          }`}
        >
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              subtitleMode === 'manual'
                ? 'bg-[#f97316] text-white'
                : 'bg-[#222222] text-[#A1A1AA]'
            }`}
          >
            <UploadCloud className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-[#F1F1F1] flex items-center gap-2">
              โหมด A: อัปโหลดไฟล์ซับไตเติลเอง (หรือข้าม)
            </div>
            <div className="text-xs text-[#8C857B] mt-0.5">
              รองรับ .srt หรือ .vtt แนบไฟล์ได้ทันทีโดยไม่ต้องรัน AI
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setSubtitleMode('ai')}
          className={`flex items-start gap-3.5 p-4 rounded-2xl border text-left transition cursor-pointer ${
            subtitleMode === 'ai'
              ? 'bg-[#181818] border-[#f97316] ring-1 ring-[#f97316]/40 shadow-lg'
              : 'bg-[#141414] border-[#262626] hover:border-[#383838]'
          }`}
        >
          <div
            className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              subtitleMode === 'ai'
                ? 'bg-[#f97316] text-white'
                : 'bg-[#222222] text-[#A1A1AA]'
            }`}
          >
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-[#F1F1F1] flex items-center gap-2">
              โหมด B: ถอดเสียง & สร้างซับด้วย AI (GitHub Actions #1)
            </div>
            <div className="text-xs text-[#8C857B] mt-0.5">
              ดึงวิดีโอจาก OneDrive มาสกัดเสียงแล้วส่งให้ Gemini AI สร้างซับอัตโนมัติ (ใช้ AI Key จาก .env)
            </div>
          </div>
        </button>
      </div>

      {/* Mode A: Manual Upload */}
      {subtitleMode === 'manual' && (
        <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6 shadow-lg space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#F1F1F1] flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#f97316]" />
              แนบไฟล์คำบรรยาย (.SRT หรือ .VTT)
            </h3>
            <span className="text-xs text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40 font-mono">
              พร้อมใช้งานทันที (Optional)
            </span>
          </div>

          {!manualSubtitleFile ? (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#333333] hover:border-[#f97316] rounded-xl p-8 text-center cursor-pointer transition bg-[#0a0a0a]/50 hover:bg-[#121212]"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".srt,.vtt"
                className="hidden"
                onChange={(e) => handleManualFile(e.target.files?.[0])}
              />
              <UploadCloud className="w-10 h-10 text-[#71717A] mx-auto mb-3" />
              <div className="text-sm font-medium text-[#F1F1F1]">
                ลากไฟล์คำบรรยายมาวางที่นี่ หรือคลิกเพื่อเลือกไฟล์
              </div>
              <div className="text-xs text-[#71717A] mt-1">
                รองรับมาตรฐาน SubRip (.srt) และ WebVTT (.vtt) — หรือข้ามขั้นตอนนี้ได้
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between p-4 bg-[#0a0a0a] border border-[#2e2e2e] rounded-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-950/50 border border-emerald-800/40 flex items-center justify-center text-emerald-400">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-sm font-medium text-[#F1F1F1]">
                    {manualSubtitleFile.name}
                  </div>
                  <div className="text-xs text-[#71717A] font-mono">
                    ขนาด: {manualSubtitleFile.size} • พร้อมผูกกับวิดีโอ
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setManualSubtitleFile(null)}
                className="p-2 rounded-lg bg-[#222222] hover:bg-rose-950/50 text-[#A1A1AA] hover:text-rose-400 border border-[#333333] transition cursor-pointer"
                title="ลบไฟล์นี้"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {/* Mode B: GitHub Actions #1 (Extract Audio + Gemini AI Subtitles) */}
      {subtitleMode === 'ai' && (
        <div className="space-y-5">
          {/* Env API Key & Model Banner */}
          <div className="p-4 rounded-2xl bg-emerald-950/20 border border-emerald-800/40 flex items-start gap-3.5">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs text-emerald-200/90 leading-relaxed">
              <span className="font-semibold text-emerald-400">เชื่อมต่อ AI Key และรุ่นโมเดลผ่านระบบ (.env) เรียบร้อย:</span>{' '}
              ระบบดึงค่า <strong>GEMINI_API_KEY</strong> และ <strong>GEMINI_MODEL_NAME</strong> จากไฟล์ <code>.env</code> ของเซิร์ฟเวอร์และ GitHub Actions โดยอัตโนมัติ (สามารถเปลี่ยนชื่อรุ่นโมเดลได้ที่ตัวแปร <code>GEMINI_MODEL_NAME</code> ใน <code>.env</code> ได้ทันที)
            </div>
          </div>

          {/* OneDrive & Audio Extraction Status Card */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-lg space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#F1F1F1] flex items-center gap-2">
                <Volume2 className="w-4 h-4 text-[#f97316]" />
                สถานะ GitHub Action #1: ดึงวิดีโอจาก OneDrive & ถอดไฟล์เสียง
              </h3>
              <span className="text-[11px] font-mono text-[#71717A]">
                extract-audio-subtitles.yml
              </span>
            </div>

            <div
              className={`p-4 rounded-xl border flex items-center justify-between gap-4 transition-all ${
                isSubtitleReady
                  ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-400'
                  : isRunningWorkflow
                  ? 'bg-amber-950/20 border-amber-800/40 text-amber-300'
                  : isRawUploaded
                  ? 'bg-[#181818] border-emerald-800/30 text-[#F1F1F1]'
                  : 'bg-[#181818] border-[#2e2e2e] text-[#A1A1AA]'
              }`}
            >
              <div className="flex items-center gap-3">
                {isSubtitleReady ? (
                  <div className="w-9 h-9 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
                    <CheckCircle2 className="w-5 h-5" />
                  </div>
                ) : isRunningWorkflow || isUploading ? (
                  <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-[#222222] border border-[#333333] flex items-center justify-center text-[#f97316] shrink-0">
                    <Cpu className="w-5 h-5" />
                  </div>
                )}
                <div>
                  <div className="text-xs sm:text-sm font-medium text-[#F1F1F1]">
                    {isSubtitleReady
                      ? 'ถอดเสียงและสร้างไฟล์คำบรรยาย AI (.SRT / .VTT) สำเร็จแล้ว!'
                      : isRunningWorkflow
                      ? 'GitHub Actions กำลังดึงวิดีโอจาก OneDrive มาสกัดเสียงและส่งให้ AI ทำซับ...'
                      : isRawUploaded
                      ? 'อัปโหลดวิดีโอขึ้น OneDrive ครบ 100% แล้ว พร้อมสั่งรัน GitHub Action ถอดเสียง'
                      : `กำลังอัปโหลดวิดีโอขึ้น OneDrive อัตโนมัติ (${uploadPercent}%)...`}
                  </div>
                  <div className="text-xs text-[#71717A] mt-0.5">
                    {isSubtitleReady
                      ? 'ไฟล์ซับไตเติลถูกบันทึกลงฐานข้อมูลและอัปโหลดขึ้น OneDrive เรียบร้อย'
                      : isRunningWorkflow
                      ? 'กำลังรัน FFmpeg สกัดเสียง -> ส่ง Gemini AI -> แปลงเป็น .SRT และ .VTT'
                      : 'เมื่อวิดีโอขึ้น OneDrive เสร็จ สามารถกดปุ่มด้านล่างเพื่อรันแยกทันที หรือให้รันอัตโนมัติตอนกดเผยแพร่ได้'}
                  </div>
                </div>
              </div>

              <div className="shrink-0 text-right">
                <span
                  className={`text-xs px-2.5 py-1 rounded-full font-mono font-medium border ${
                    isSubtitleReady
                      ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50'
                      : isRunningWorkflow
                      ? 'bg-amber-950/50 text-amber-400 border-amber-800/40'
                      : isRawUploaded
                      ? 'bg-sky-950/50 text-sky-400 border-sky-800/40'
                      : 'bg-amber-950/50 text-amber-400 border-amber-800/40'
                  }`}
                >
                  {isSubtitleReady
                    ? 'SUB READY'
                    : isRunningWorkflow
                    ? 'PROCESSING'
                    : isRawUploaded
                    ? 'ONEDRIVE READY'
                    : `UPLOADING ${uploadPercent}%`}
                </span>
              </div>
            </div>
          </div>

          {/* Prompts & Trigger Section */}
          <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-lg space-y-4">
            <h3 className="text-sm font-semibold text-[#F1F1F1] flex items-center gap-2">
              <Terminal className="w-4 h-4 text-[#f97316]" />
              การปรับแต่งคำสั่งถอดเสียง (Prompt Engineering)
            </h3>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-[#A1A1AA] flex items-center gap-1.5">
                  System Prompt ตั้งต้น (คุมฟอร์แมตเวลาและโครงสร้าง)
                </label>
                <span className="text-[10px] px-1.5 py-0.5 bg-[#222222] text-[#8C857B] rounded font-mono">
                  READ ONLY
                </span>
              </div>
              <textarea
                readOnly
                rows={3}
                value={DEFAULT_SYSTEM_PROMPT}
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0a0a0a] border border-[#222222] text-[#888888] text-xs font-mono outline-none cursor-not-allowed resize-none"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-[#A1A1AA] block mb-1.5">
                Custom Prompt เพิ่มเติม (Optional)
              </label>
              <textarea
                rows={2}
                value={customPrompt}
                onChange={(e) => setCustomPrompt(e.target.value)}
                placeholder="เช่น เน้นคำศัพท์เทคนิคคอมพิวเตอร์, ถอดเนื้อเพลง, แปลเป็นภาษาไทย ฯลฯ"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#0a0a0a] border border-[#2e2e2e] focus:border-[#f97316] text-[#F1F1F1] placeholder-[#555555] text-xs outline-none resize-none transition"
              />
            </div>

            {/* Dispatch Workflow #1 Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleRunAiSubtitles}
                disabled={!canStartAiGeneration}
                className={`w-full py-3 rounded-xl font-semibold text-sm transition flex items-center justify-center gap-2 shadow-lg ${
                  canStartAiGeneration
                    ? 'bg-gradient-to-r from-[#ea580c] to-[#f97316] text-white hover:brightness-110 cursor-pointer shadow-[#ea580c]/20'
                    : 'bg-[#1e1e1e] border border-[#2c2c2c] text-[#666666] cursor-not-allowed'
                }`}
              >
                {isRunningWorkflow ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>GitHub Actions กำลังถอดไฟล์เสียงและส่งให้ {selectedModel} ทำซับ...</span>
                  </>
                ) : (
                  <>
                    <Bot className="w-4 h-4" />
                    <span>
                      {isSubtitleReady
                        ? 'สั่งรัน GitHub Action ถอดไฟล์เสียงและสร้างซับไตเติลใหม่อีกครั้ง'
                        : 'สั่งรัน GitHub Action #1 ถอดไฟล์เสียงและสร้างซับด้วย AI ทันที'}
                    </span>
                  </>
                )}
              </button>

              {!isRawUploaded && (
                <div className="text-[11px] text-center text-amber-400/90 mt-2 flex items-center justify-center gap-1.5">
                  <Info className="w-3.5 h-3.5" />
                  <span>
                    กรุณารออัปโหลดวิดีโอขึ้น OneDrive ให้เสร็จก่อน ({uploadPercent}%) หรือข้ามไปกดยืนยันใน Step 4 เพื่อให้ระบบรันอัตโนมัติ
                  </span>
                </div>
              )}

              {/* Cancel Upload Button */}
              {onCancelUpload && (
                <div className="pt-2">
                  <button
                    type="button"
                    disabled={isCancelling}
                    onClick={onCancelUpload}
                    className="w-full py-2.5 rounded-xl bg-rose-950/25 hover:bg-rose-900/40 text-rose-300 hover:text-white border border-rose-800/40 text-xs font-semibold transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {isCancelling ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>กำลังยกเลิกการอัปโหลดและลบไฟล์ออกจาก OneDrive...</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-rose-400" />
                        <span>ยกเลิกการอัปโหลดขึ้น OneDrive และลบวิดีโอนี้ (กรณีเลือกไฟล์ผิด)</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Preview Generated Subtitles from DB */}
            {generatedSubtitleSrt && (
              <div className="p-4 rounded-xl bg-[#0a0a0a] border border-emerald-800/40 text-xs space-y-2 mt-3">
                <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" />
                  ซับไตเติลที่ AI ถอดเสียงสำเร็จ (บันทึกใน DB & OneDrive แล้ว):
                </div>
                <pre className="text-[#AAAAAA] font-mono whitespace-pre-wrap bg-[#141414] p-3 rounded-lg border border-[#262626] max-h-60 overflow-y-auto">
                  {generatedSubtitleSrt}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

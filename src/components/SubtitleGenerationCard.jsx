'use client';

import { useId, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { SUBTITLE_TRANSCRIPTION_PROMPT, SUBTITLE_THAI_TRANSLATE_PROMPT } from '@/lib/subtitlePrompts';

const PROMPTS = [
  { id: 'original', label: 'ถอดเสียงต้นฉบับ', text: SUBTITLE_TRANSCRIPTION_PROMPT },
  { id: 'thai', label: 'แปลไทย', text: SUBTITLE_THAI_TRANSLATE_PROMPT },
];

export default function SubtitleGenerationCard({
  audioStatus,
  subtitleStatus,
  isRunningWorkflow,
  canGenerate,
  isUploading = false,
  uploadPercent = 0,
  selectedModel,
  workerDetail,
  idleDetail = 'ใช้ไฟล์เสียงที่มีอยู่ หรือสกัดเสียงจากวิดีโอบน OneDrive ก่อนเริ่มถอดซับ',
  customPrompt,
  setCustomPrompt,
  onRun,
}) {
  const promptId = useId();
  const [activePrompt, setActivePrompt] = useState(PROMPTS[0]);
  const isSubtitleReady = subtitleStatus === 'ready' && !isRunningWorkflow;
  const canStartAiGeneration = canGenerate && !isRunningWorkflow;

  return (
    <div className="p-4 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
            {isSubtitleReady
              ? 'ถอดเสียงและสร้างซับไตเติลสำเร็จแล้ว'
              : isRunningWorkflow
              ? 'กำลังสกัดเสียงและสร้างซับไตเติลด้วย AI...'
              : canGenerate
              ? 'พร้อมสั่ง AI ถอดเสียงทันที'
              : `กำลังอัปโหลดไฟล์วิดีโอ (${uploadPercent}%)`}
          </div>
          <div className="text-xs text-[#6C655D] dark:text-[#9A9A9A] mt-0.5 break-words">
            {isSubtitleReady
              ? 'บันทึกไฟล์คำบรรยาย .SRT / .VTT เรียบร้อย'
              : isRunningWorkflow
              ? workerDetail || `กำลังประมวลผลด้วย ${selectedModel || 'Gemini AI'} กรุณารอสักครู่`
              : subtitleStatus === 'failed' || audioStatus === 'failed'
              ? workerDetail || 'เกิดข้อผิดพลาดในการสร้างซับ — กดปุ่มด้านล่างเพื่อลองใหม่อีกครั้ง'
              : idleDetail}
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
            : canGenerate
            ? 'รอคำสั่ง'
            : `${uploadPercent}%`}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">
            Prompt ตั้งต้นของระบบ
          </span>
          <span className="text-[11px] px-2.5 py-0.5 rounded-full bg-[#FF7A00]/10 text-[#FF7A00] font-semibold border border-[#FF7A00]/25">
            อัตโนมัติ: ไทย 1 ภาษา • ต่างประเทศ 2 ภาษา
          </span>
        </div>
        <div role="group" aria-label="เลือกดู Prompt ตั้งต้น" className="flex flex-wrap gap-1.5">
          {PROMPTS.map((prompt) => (
            <button
              key={prompt.id}
              type="button"
              aria-pressed={activePrompt.id === prompt.id}
              onClick={() => setActivePrompt(prompt)}
              className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                activePrompt.id === prompt.id
                  ? 'border-[#FF7A00]/45 bg-[#FF7A00]/10 text-[#A54B00] dark:text-[#FF9A39]'
                  : 'border-[#EFECE6] bg-white text-[#6C655D] hover:text-[#A54B00] dark:border-white/10 dark:bg-[#181818] dark:text-[#AAAAAA] dark:hover:text-[#FF9A39]'
              }`}
            >
              {prompt.label}
            </button>
          ))}
        </div>
        <pre key={activePrompt.id} className="text-[11px] leading-relaxed text-[#6C655D] dark:text-[#AAAAAA] font-mono whitespace-pre-wrap bg-white dark:bg-[#181818] p-3 rounded-xl border border-[#EFECE6] dark:border-white/10 max-h-44 overflow-y-auto">
          {activePrompt.text}
        </pre>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={promptId} className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1] block">
          คำสั่งเพิ่มเติมให้ AI (ไม่บังคับ)
        </label>
        <input
          id={promptId}
          type="text"
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder="เช่น เน้นคำศัพท์เทคนิคภาษาอังกฤษทับศัพท์, ถอดเนื้อเพลง หรือปรับสำนวนคำแปล"
          className="w-full px-3.5 py-2.5 rounded-xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 focus:border-[#FF7A00] focus:ring-3 focus:ring-[#FF7A00]/15 text-[#212529] dark:text-[#F1F1F1] placeholder-[#8C857B] dark:placeholder-[#71717A] text-xs sm:text-sm outline-none transition"
        />
      </div>

      <button
        type="button"
        onClick={onRun}
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
  );
}

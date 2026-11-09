'use client';

import Link from 'next/link';
import {
  Rocket,
  CheckCircle2,
  AlertCircle,
  FileText,
  Subtitles,
  ShieldAlert,
  Loader2,
  ExternalLink,
  CloudUpload,
  XCircle,
  Volume2,
} from 'lucide-react';
import { encodeVideoSlug } from '@/lib/videoUtils';

export default function StepPublish({
  title,
  category,
  tags,
  contentRating,
  subtitleMode,
  manualSubtitleFile,
  chunkSizeMB,
  onSelectChunkSize,
  isUploading,
  isRawUploaded,
  uploadPercent = 0,
  isCancelling,
  onCancelUpload,
  currentStatus,
  transcodeProgress,
  completedVideo,
  onStartPipeline,
  errorMsg,
}) {
  const hasTitle = Boolean(title && title.trim().length > 0);
  const hasRating = Boolean(contentRating);
  const isReadyToPublish =
    hasTitle &&
    hasRating &&
    isRawUploaded &&
    !isUploading &&
    currentStatus !== 'PROCESSING' &&
    currentStatus !== 'TRANSCODING';

  // Subtitle summary text
  const subtitleSummary = manualSubtitleFile
    ? `แนบไฟล์ตนเอง: ${manualSubtitleFile.name}`
    : subtitleMode === 'ai'
    ? 'ถอดไฟล์เสียง & สร้างซับอัตโนมัติผ่าน AI (GitHub Action #1)'
    : 'ไม่ระบุซับไตเติล (สามารถสั่งรันภายหลังได้)';

  // Category label
  const categoryLabels = {
    general: 'ทั่วไป (General)',
    shorts: 'วิดีโอสั้น (Shorts)',
    cinema: 'ภาพยนตร์ / ซีรีส์ (Cinema)',
    music: 'เพลง / ดนตรี (Music)',
    entertainment: 'บันเทิง / วาไรตี้',
    gaming: 'เกม (Gaming)',
    tech: 'เทคโนโลยี / ไอที',
    education: 'การศึกษา / สาระ',
  };

  const ratingLabelMap = {
    all: 'ALL (ทั่วไป • AI ตรวจสอบยืนยัน)',
    '13+': '13+ (วัยรุ่น • AI ตรวจสอบยืนยัน)',
    '18+': '18+ (ผู้ใหญ่ • AI ตรวจสอบยืนยัน)',
    mature: 'RESTRICTED (จำกัดเฉพาะ • AI ตรวจสอบยืนยัน)',
    auto: 'AI AUTO (ให้ AI ตรวจสอบ Sprite Sheet และเลือกเรตให้อัตโนมัติ)',
  };

  return (
    <div className="space-y-6">
      {/* Readiness Checklist Card */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-lg space-y-3.5">
        <h3 className="text-sm font-semibold text-[#F1F1F1] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#f97316]" />
          รายการตรวจสอบความพร้อมก่อน Deploy & หั่น HLS (Readiness Checklist)
        </h3>

        <div className="space-y-2">
          {/* Item 0: OneDrive Raw Upload Prerequisite */}
          <div
            className={`flex items-center justify-between p-3 rounded-xl border text-xs sm:text-sm ${
              isRawUploaded
                ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-400'
                : 'bg-amber-950/20 border-amber-800/40 text-amber-300'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {isRawUploaded ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <Loader2 className="w-4 h-4 shrink-0 text-amber-400 animate-spin" />
              )}
              <span>
                1. อัปโหลดวิดีโอต้นฉบับขึ้น OneDrive เพื่อให้ GitHub Actions ดึงข้อมูล{' '}
                <span className="text-[#f97316]">*</span>
              </span>
            </div>
            <span className="font-mono text-xs">
              {isRawUploaded ? 'UPLOADED 100%' : `UPLOADING ${uploadPercent}%`}
            </span>
          </div>

          {/* Item 1: Title & Rating (Required) */}
          <div
            className={`flex items-center justify-between p-3 rounded-xl border text-xs sm:text-sm ${
              hasTitle && hasRating
                ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-400'
                : 'bg-amber-950/20 border-amber-800/40 text-amber-300'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {hasTitle && hasRating ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" />
              )}
              <span>
                2. ข้อมูลพื้นฐานครบถ้วน (ชื่อวิดีโอ & การตั้งค่าเรตเนื้อหา){' '}
                <span className="text-[#f97316]">*</span>
              </span>
            </div>
            <span className="font-mono text-xs">
              {hasTitle && hasRating ? 'COMPLETED' : 'INCOMPLETE'}
            </span>
          </div>

          {/* Item 2: Subtitle Status (Action #1) */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-[#262626] bg-[#0d0d0d] text-xs sm:text-sm text-[#A1A1AA]">
            <div className="flex items-center gap-2.5">
              <Subtitles className="w-4 h-4 shrink-0 text-[#f97316]" />
              <span>GitHub Action #1 (ซับไตเติล): {subtitleSummary}</span>
            </div>
            <span className="font-mono text-xs text-emerald-400">
              {subtitleMode === 'ai' ? 'AI WORKFLOW' : 'READY'}
            </span>
          </div>

          {/* Item 3: Content Rating Status (Action #2) */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-[#262626] bg-[#0d0d0d] text-xs sm:text-sm text-[#A1A1AA]">
            <div className="flex items-center gap-2.5">
              <ShieldAlert className="w-4 h-4 shrink-0 text-[#f97316]" />
              <span>
                GitHub Action #2 (Sprite Grid & เรตติ้ง):{' '}
                {ratingLabelMap[contentRating] || contentRating}
              </span>
            </div>
            <span className="font-mono text-xs text-emerald-400">AI VERIFY</span>
          </div>

          {/* Item 4: HLS Audio Continuity (Action #3) */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-[#262626] bg-[#0d0d0d] text-xs sm:text-sm text-[#A1A1AA]">
            <div className="flex items-center gap-2.5">
              <Volume2 className="w-4 h-4 shrink-0 text-[#f97316]" />
              <span>
                GitHub Action #3 (หั่น HLS): ล็อกคุณภาพเสียง AAC 192kbps (48kHz Stereo) เท่ากันทุกความชัด
              </span>
            </div>
            <span className="font-mono text-xs text-emerald-400">UNIFORM AUDIO</span>
          </div>
        </div>
      </div>

      {/* Summary Details Review */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-lg space-y-3">
        <h3 className="text-sm font-semibold text-[#F1F1F1] flex items-center gap-2">
          <FileText className="w-4 h-4 text-[#f97316]" />
          สรุปการตั้งค่า (Configuration Overview)
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 bg-[#0a0a0a] rounded-xl border border-[#222222]">
            <span className="text-[#71717A] block mb-1">ชื่อวิดีโอ (Title)</span>
            <span className="font-medium text-[#F1F1F1] line-clamp-1">
              {title || '(ยังไม่ได้ระบุ)'}
            </span>
          </div>

          <div className="p-3 bg-[#0a0a0a] rounded-xl border border-[#222222]">
            <span className="text-[#71717A] block mb-1">หมวดหมู่ (Category)</span>
            <span className="font-medium text-[#F1F1F1]">
              {categoryLabels[category] || category}
            </span>
          </div>

          <div className="p-3 bg-[#0a0a0a] rounded-xl border border-[#222222]">
            <span className="text-[#71717A] block mb-1">แท็กที่ระบุ (Tags)</span>
            <span className="font-medium text-[#F1F1F1]">
              {tags.length > 0 ? tags.map((t) => `#${t}`).join(' ') : 'ไม่มีแท็ก'}
            </span>
          </div>

          <div className="p-3 bg-[#0a0a0a] rounded-xl border border-[#222222]">
            <span className="text-[#71717A] block mb-1">ขนาดก้อน OneDrive Chunk</span>
            <div className="flex items-center gap-1.5 mt-0.5">
              {[10, 20, 50].map((sz) => (
                <button
                  key={sz}
                  type="button"
                  disabled={isUploading}
                  onClick={() => onSelectChunkSize(sz)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono border transition cursor-pointer ${
                    chunkSizeMB === sz
                      ? 'bg-[#f97316] text-white border-[#f97316]'
                      : 'bg-[#181818] border-[#333333] text-[#A1A1AA] hover:text-[#F1F1F1]'
                  }`}
                >
                  {sz}MB
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Completion Banner if Transcoded */}
      {completedVideo && (
        <div className="p-5 rounded-2xl bg-gradient-to-r from-emerald-950/40 via-emerald-900/20 to-transparent border border-emerald-800/50 shadow-xl space-y-3">
          <div className="flex items-center gap-2.5 text-emerald-400 font-semibold text-sm">
            <CheckCircle2 className="w-5 h-5" />
            <span>วิดีโอแปลงไฟล์และพร้อมรับชมแล้ว! (Video Ready)</span>
          </div>
          <p className="text-xs text-[#A1A1AA]">
            ไฟล์ HLS Multi-bitrate (เสียงคุณภาพเดียวกันทุกความชัด) ถูกบันทึกและเชื่อมต่อลงฐานข้อมูลสำเร็จ พร้อมสตรีมมิ่งผ่าน Player ได้ทันที
          </p>
          <div className="pt-1">
            <Link
              href={`/watch/${encodeVideoSlug(completedVideo.id, completedVideo.category)}`}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-900/30 transition"
            >
              <span>เปิดดูวิดีโอทันที (Watch Video)</span>
              <ExternalLink className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}

      {/* Primary Action Button + Cancel Upload Button */}
      <div className="space-y-3 pt-2">
        <button
          type="button"
          onClick={onStartPipeline}
          disabled={!isReadyToPublish}
          className={`w-full py-4 rounded-2xl font-bold text-sm sm:text-base transition-all duration-200 flex items-center justify-center gap-2.5 shadow-xl cursor-pointer ${
            isReadyToPublish
              ? 'bg-gradient-to-r from-[#ea580c] via-[#f97316] to-[#ea580c] text-white hover:brightness-110 active:scale-[0.99] shadow-[#ea580c]/25'
              : 'bg-[#181818] border border-[#2c2c2c] text-[#555555] cursor-not-allowed'
          }`}
        >
          {isUploading ? (
            <>
              <CloudUpload className="w-5 h-5 animate-bounce" />
              <span>กำลังอัปโหลดวิดีโอขึ้น OneDrive ({uploadPercent}%)... รอให้ครบ 100% เพื่อกด Deploy</span>
            </>
          ) : currentStatus === 'PROCESSING' || currentStatus === 'TRANSCODING' ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>กำลังรัน GitHub Actions แปลงไฟล์ HLS Multi-bitrate ({transcodeProgress}%)...</span>
            </>
          ) : (
            <>
              <Rocket className="w-5 h-5" />
              <span>ยืนยันการตั้งค่าและสั่งรัน GitHub Actions แปลงไฟล์ HLS ทันที</span>
            </>
          )}
        </button>

        {/* Cancel Upload to OneDrive Button */}
        {onCancelUpload && (
          <button
            type="button"
            disabled={isCancelling}
            onClick={onCancelUpload}
            className="w-full py-2.5 rounded-xl bg-rose-950/30 hover:bg-rose-900/50 text-rose-300 border border-rose-800/40 text-xs font-semibold transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isCancelling ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>กำลังยกเลิกการอัปโหลดและลบไฟล์ออกจาก OneDrive...</span>
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4" />
                <span>ยกเลิกการอัปโหลดขึ้น OneDrive และลบวิดีโอนี้ (กรณีเลือกไฟล์ผิด)</span>
              </>
            )}
          </button>
        )}

        {!isReadyToPublish && !currentStatus && (
          <div className="text-xs text-center text-[#71717A] flex items-center justify-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
            <span>
              {!isRawUploaded && `กำลังอัปโหลดวิดีโอขึ้น OneDrive (${uploadPercent}%) — ต้องอัปโหลดให้เสร็จก่อนจึงจะ Deploy ได้ `}
              {!hasTitle && '• กรุณากรอกชื่อวิดีโอใน Step 1 '}
              {!hasRating && '• กรุณาเลือกเรตเนื้อหาใน Step 3'}
            </span>
          </div>
        )}

        {errorMsg && (
          <div className="p-3 bg-rose-950/40 border border-rose-800/40 rounded-xl text-xs text-rose-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>{errorMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
}

'use client';

import Link from 'next/link';
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  ExternalLink,
  Globe,
  Link2,
  Lock,
} from 'lucide-react';
import Select from '@/components/ui/Select';
import { encodeVideoSlug } from '@/lib/videoUtils';
import { getVideoLanguage } from '@/lib/videoLanguages';
import {
  VISIBILITY_OPTIONS,
  normalizeVideoVisibility,
  getVisibilityMeta,
} from '@/lib/videoVisibility';

export default function StepPublish({
  title,
  sourceLanguage = '',
  category,
  tags,
  contentRating,
  visibility = 'public',
  setVisibility,
  subtitleMode,
  manualSubtitleFile,
  isUploading,
  isRawUploaded,
  uploadPercent = 0,
  currentStatus,
  transcodeProgress,
  completedVideo,
  isStartingPipeline = false,
  errorMsg,
  ratingCheckStatus,
  stageDetail = '',
  workerDetail = '',
}) {
  const hasTitle = Boolean(title && title.trim().length > 0);
  const selectedLang = getVideoLanguage(sourceLanguage);
  const hasSourceLanguage = Boolean(selectedLang);
  const hasRating = Boolean(contentRating);

  // Subtitle summary text
  const subtitleSummary = subtitleMode === 'manual' && manualSubtitleFile
    ? `แนบไฟล์เอง: ${manualSubtitleFile.name}`
    : selectedLang?.isNone
    ? 'ข้ามการสร้างซับอัตโนมัติ (ไม่มีเสียงพูด)'
    : subtitleMode === 'requested-ai'
    ? `แปลโดย AI${selectedLang ? ` (${selectedLang.shortLabel})` : ''}`
    : selectedLang?.isThai
    ? 'ถอดซับไทยต้นฉบับเมื่ออัปโหลดเสร็จ'
    : `ถอดเสียงและแปลไทยอัตโนมัติ${selectedLang ? ` (${selectedLang.shortLabel} → ไทย)` : ''}`;

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
    all: 'ทั่วไป (ALL)',
    '13+': '13 ปีขึ้นไป (13+)',
    '18+': 'ผู้ใหญ่ (18+)',
    mature: 'จำกัดเฉพาะ (Restricted)',
    auto: 'ให้ AI จัดเรตอัตโนมัติ',
  };

  const isRatingVerified =
    ratingCheckStatus === 'VERIFIED_MATCH' || ratingCheckStatus === 'AI_AUTO_SELECTED';

  return (
    <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
      <div>
        <h2 className="text-base font-bold text-[#212529] dark:text-[#F1F1F1]">
          04 ตรวจสอบและเผยแพร่
        </h2>
        <p className="text-xs sm:text-sm text-[#6C655D] dark:text-[#AAAAAA] mt-0.5">
          ตรวจสอบข้อมูลทั้งหมดก่อนกดเผยแพร่ที่ปุ่มด้านล่าง
        </p>
      </div>

      {errorMsg && (
        <div role="alert" className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs sm:text-sm text-rose-700 dark:text-rose-400">
          {errorMsg}
        </div>
      )}

      {/* Checklist */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 text-xs sm:text-sm">
          <span className="font-medium text-[#212529] dark:text-[#F1F1F1]">
            1. ไฟล์ต้นฉบับบนคลาวด์
          </span>
          <span
            className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold shrink-0 ${
              isRawUploaded
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
            }`}
          >
            {isRawUploaded ? 'พร้อมแล้ว (100%)' : `กำลังอัปโหลด (${uploadPercent}%)`}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 text-xs sm:text-sm">
          <span className="font-medium text-[#212529] dark:text-[#F1F1F1]">
            2. ข้อมูลพื้นฐาน &amp; ชื่อวิดีโอ
          </span>
          <span
            className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold shrink-0 ${
              hasTitle
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
            }`}
          >
            {hasTitle ? 'ครบถ้วน' : 'ยังไม่มีชื่อวิดีโอ'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 text-xs sm:text-sm">
          <span className="font-medium text-[#212529] dark:text-[#F1F1F1]">
            3. ภาษาเสียงพูดหลัก: {selectedLang ? selectedLang.label : 'ยังไม่ระบุ'}
          </span>
          <span
            className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold shrink-0 ${
              hasSourceLanguage
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
            }`}
          >
            {hasSourceLanguage ? selectedLang.shortLabel : 'บังคับเลือก'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 text-xs sm:text-sm">
          <span className="font-medium text-[#212529] dark:text-[#F1F1F1]">
            4. ซับไตเติล: {subtitleSummary}
          </span>
          <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-white dark:bg-[#181818] text-[#6C655D] dark:text-[#AAAAAA] border border-[#EFECE6] dark:border-white/10 shrink-0">
            {manualSubtitleFile ? 'พร้อมแล้ว' : selectedLang?.isNone ? 'ข้าม' : 'รันอัตโนมัติ'}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 text-xs sm:text-sm">
          <span className="font-medium text-[#212529] dark:text-[#F1F1F1]">
            5. เรตเนื้อหา: {ratingLabelMap[contentRating] || contentRating || 'ยังไม่ระบุ'}
          </span>
          <span
            className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold shrink-0 ${
              isRatingVerified
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : 'bg-[#FF7A00]/10 text-[#FF7A00]'
            }`}
          >
            {isRatingVerified ? 'AI จัดเรตแล้ว' : 'AI ตรวจหลังหั่น HLS'}
          </span>
        </div>
      </div>

      {/* Visibility Selector */}
      {setVisibility && (() => {
        const currentVisibility = normalizeVideoVisibility(visibility);
        const currentMeta = getVisibilityMeta(currentVisibility);
        const VisibilityIcon =
          currentVisibility === 'private' ? Lock : currentVisibility === 'unlisted' ? Link2 : Globe;
        const visibilitySelectOptions = VISIBILITY_OPTIONS.map((opt) => ({
          value: opt.value,
          label: opt.label,
          desc: opt.description,
          icon: opt.value === 'private' ? Lock : opt.value === 'unlisted' ? Link2 : Globe,
        }));

        return (
          <div className="p-3.5 sm:p-4 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs sm:text-sm font-bold text-[#212529] dark:text-[#F1F1F1] flex items-center gap-1.5">
                <VisibilityIcon className="w-4 h-4 text-[#FF7A00]" />
                <span>ระดับการแสดงผล (Visibility)</span>
              </span>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-[#FF7A00]/10 text-[#FF7A00] shrink-0">
                {currentMeta.label}
              </span>
            </div>
            <Select
              options={visibilitySelectOptions}
              value={currentVisibility}
              onChange={(val) => setVisibility(val)}
              placeholder="เลือกระดับการแสดงผล..."
              disabled={Boolean(completedVideo) || isStartingPipeline}
              className="w-full"
            />
            <p className="text-[11px] text-[#6C655D] dark:text-[#9A9A9A] leading-relaxed">
              {currentMeta.description}
            </p>
          </div>
        );
      })()}

      {/* Configuration Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
        <div className="p-3 bg-[#F4F0E8] dark:bg-[#222222] rounded-xl border border-[#EFECE6] dark:border-white/10">
          <span className="text-[#8C857B] dark:text-[#9A9A9A] block mb-1">ชื่อวิดีโอ</span>
          <span className="font-semibold text-[#212529] dark:text-[#F1F1F1] line-clamp-1">
            {title || '(ยังไม่ได้ระบุ)'}
          </span>
        </div>

        <div className="p-3 bg-[#F4F0E8] dark:bg-[#222222] rounded-xl border border-[#EFECE6] dark:border-white/10">
          <span className="text-[#8C857B] dark:text-[#9A9A9A] block mb-1">หมวดหมู่</span>
          <span className="font-semibold text-[#212529] dark:text-[#F1F1F1]">
            {categoryLabels[category] || category}
          </span>
        </div>

        <div className="p-3 bg-[#F4F0E8] dark:bg-[#222222] rounded-xl border border-[#EFECE6] dark:border-white/10">
          <span className="text-[#8C857B] dark:text-[#9A9A9A] block mb-1">แท็ก</span>
          <span className="font-semibold text-[#212529] dark:text-[#F1F1F1] line-clamp-1">
            {tags.length > 0 ? tags.map((t) => `#${t}`).join(' ') : 'ไม่มีแท็ก'}
          </span>
        </div>
      </div>

      {/* Live Transcoding Status Banner */}
      {(isStartingPipeline ||
        currentStatus === 'PROCESSING' ||
        currentStatus === 'TRANSCODING' ||
        currentStatus === 'QUEUED') && !completedVideo && (
        <div className="p-4 rounded-xl bg-[#FF7A00]/10 border border-[#FF7A00]/30 space-y-1.5">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
            <Loader2 className="w-4 h-4 text-[#FF7A00] animate-spin shrink-0" />
            <span>
              กำลังแปลงสตรีม HLS และตรวจสอบอัตโนมัติ ({transcodeProgress}%)...
            </span>
          </div>
          {(workerDetail || stageDetail) && (
            <div className="pl-6.5 text-xs font-mono text-[#6C655D] dark:text-[#CCCCCC] break-words">
              {workerDetail || stageDetail}
            </div>
          )}
        </div>
      )}

      {/* Completion Banner */}
      {completedVideo && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
          <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-bold text-sm">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>วิดีโอเผยแพร่และพร้อมรับชมแล้ว</span>
          </div>
          <p className="text-xs text-[#6C655D] dark:text-[#CCCCCC]">
            แปลงสตรีมวิดีโอหลายความละเอียดเสร็จสมบูรณ์ สามารถเปิดดูได้ทันที
          </p>
          <Link
            href={`/watch/${encodeVideoSlug(completedVideo.id, completedVideo.category) || completedVideo.slug || completedVideo.id || ''}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
          >
            <span>เปิดดูวิดีโอทันที</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Missing Prerequisites Hint */}
      {(!hasTitle || !hasSourceLanguage || !hasRating || !isRawUploaded || isUploading) && !currentStatus && (
        <div className="text-xs text-[#6C655D] dark:text-[#9A9A9A] flex items-center gap-1.5">
          <AlertCircle className="w-4 h-4 text-[#FF7A00] shrink-0" />
          <span>
            {!isRawUploaded && `กำลังรออัปโหลดไฟล์เสร็จ (${uploadPercent}%) `}
            {!hasTitle && '• กรุณากรอกชื่อวิดีโอใน Step 1 '}
            {!hasSourceLanguage && '• กรุณาเลือกภาษาเสียงพูดหลักของวิดีโอใน Step 1 หรือ Step 2 '}
            {!hasRating && '• กรุณาเลือกเรตเนื้อหาใน Step 3'}
          </span>
        </div>
      )}
    </div>
  );
}

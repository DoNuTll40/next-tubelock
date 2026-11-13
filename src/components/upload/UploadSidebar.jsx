'use client';

import { useState } from 'react';
import {
  Film,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export default function UploadSidebar({
  file,
  fileDetails,
  thumbnailUrl,
  currentStatus,
  transcodeProgress,
  stageDetail,
  uploadStats,
  isUploading,
  isRawUploaded,
  audioStatus,
  subtitleStatus,
  spriteSheetStatus,
  ratingCheckStatus,
  contentRating,
  thumbnailStatus = 'waiting',
  runnerSpecs,
}) {
  const [showTechDetails, setShowTechDetails] = useState(false);

  // Overall readiness bar
  const getOverallProgress = () => {
    if (currentStatus === 'READY') return 100;
    if (currentStatus === 'TRANSCODING') return Math.max(70, Math.min(99, 60 + Math.round((transcodeProgress || 0) * 0.4)));
    if (!isRawUploaded) return Math.max(5, Math.round((uploadStats?.percent || 0) * 0.4));
    let pct = 50;
    if (subtitleStatus === 'ready') pct += 25;
    if (ratingCheckStatus === 'VERIFIED_MATCH' || ratingCheckStatus === 'AI_AUTO_SELECTED') pct += 25;
    return pct;
  };

  // Task 1: Subtitle
  const getSubBadge = () => {
    if (subtitleStatus === 'ready') return { label: 'เสร็จแล้ว', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', desc: 'สร้างซับ .SRT / .VTT สำเร็จ' };
    if (subtitleStatus === 'processing' || audioStatus === 'extracting') return { label: 'กำลังทำ', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', desc: 'กำลังสกัดเสียงและสร้างซับ...' };
    if (audioStatus === 'failed' || subtitleStatus === 'failed') return { label: 'ไม่สำเร็จ', cls: 'bg-rose-500/15 text-rose-700 dark:text-rose-400', desc: 'ลองสั่งใหม่อีกครั้งใน Step 2' };
    return { label: 'รอสั่งงาน', cls: 'bg-white dark:bg-[#181818] text-[#8C857B] dark:text-[#9A9A9A] border border-[#EFECE6] dark:border-white/10', desc: 'สั่งงานได้ที่ Step 2 หรือรันตอนเผยแพร่' };
  };

  // Task 2: Rating & HLS verification
  const getRatingBadge = () => {
    if (ratingCheckStatus === 'AI_AUTO_SELECTED') return { label: 'AI จัดเรตแล้ว', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', desc: 'AI ประเมินและตั้งเรตให้อัตโนมัติแล้ว' };
    if (ratingCheckStatus === 'VERIFIED_MATCH') return { label: 'ตรวจสอบแล้ว', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', desc: 'AI ตรวจยืนยันเรตตรงตามที่เลือก' };
    if (ratingCheckStatus === 'MISMATCH_WARNING') return { label: 'แจ้งเตือนเรต', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', desc: 'ผลตรวจต่างจากที่เลือก — ตรวจดูใน Step 3' };
    if (spriteSheetStatus === 'generating' || ratingCheckStatus === 'analyzing') return { label: 'กำลังจัดเรต', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', desc: 'กำลังสร้างภาพและวิเคราะห์เรต...' };
    return {
      label: contentRating === 'auto' ? 'รอ AI จัดเรต' : 'ตรวจหลัง HLS',
      cls: 'bg-[#FF7A00]/10 text-[#FF7A00]',
      desc: contentRating === 'auto' ? 'กด "ให้ AI จัดเรต" ใน Step 3 หรือรอตอนเผยแพร่' : 'เลือกเอง — AI จะตรวจหลังหั่น HLS เสร็จ',
    };
  };

  // Task 3: HLS Stream
  const getHlsBadge = () => {
    if (currentStatus === 'READY') return { label: 'พร้อมเล่น', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400', desc: 'สตรีมหลายความละเอียดพร้อมใช้งาน' };
    if (currentStatus === 'TRANSCODING') return { label: `${transcodeProgress}%`, cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', desc: `กำลังแปลงสตรีม HLS (${transcodeProgress}%)` };
    if (currentStatus === 'PROCESSING' || currentStatus === 'QUEUED') return { label: 'กำลังเตรียม', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', desc: 'กำลังเตรียมประมวลผลบนคลาวด์...' };
    return { label: 'รอเผยแพร่', cls: 'bg-white dark:bg-[#181818] text-[#8C857B] dark:text-[#9A9A9A] border border-[#EFECE6] dark:border-white/10', desc: 'เริ่มหั่นไฟล์เมื่อกดยืนยันใน Step 4' };
  };

  const overallPct = getOverallProgress();
  const subInfo = getSubBadge();
  const ratingInfo = getRatingBadge();
  const hlsInfo = getHlsBadge();

  return (
    <div className="space-y-4 lg:sticky lg:top-28">
      <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-4 sm:p-5 shadow-xs space-y-4">
        {/* Video Preview */}
        <div className="aspect-video rounded-xl overflow-hidden bg-[#212529] dark:bg-[#0d0d0d] relative flex items-center justify-center border border-[#EFECE6] dark:border-white/10">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt="ตัวอย่างวิดีโอ"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-[#8C857B]">
              <Film className="w-10 h-10 stroke-[1.4] mb-1.5" />
              <span className="text-xs">
                {thumbnailStatus === 'generating' ? 'กำลังสร้างภาพตัวอย่าง 3 ช่วง...' : 'รอสร้างภาพตัวอย่าง'}
              </span>
            </div>
          )}

          <div className="absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded-md bg-black/70 text-[11px] font-mono text-white">
            {fileDetails.resolution || 'Auto'}
          </div>
          <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md bg-black/75 text-[11px] font-mono text-white">
            {fileDetails.durationFormatted || '0:00'}
          </div>
        </div>

        {/* File Name */}
        <div>
          <div className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1] truncate">
            {fileDetails.name || file?.name || 'วิดีโอต้นทาง'}
          </div>
          <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] mt-0.5 flex items-center justify-between font-mono">
            <span>{fileDetails.sizeFormatted}</span>
            <span>{fileDetails.codec}</span>
          </div>
        </div>

        {/* Overall Readiness Progress */}
        <div>
          <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
            <span className="text-[#212529] dark:text-[#F1F1F1]">ความคืบหน้าบนคลาวด์</span>
            <span className="text-[#FF7A00] font-mono">{overallPct}%</span>
          </div>
          <div className="w-full h-2 rounded-full bg-[#F4F0E8] dark:bg-[#222222] overflow-hidden">
            <div
              className="h-full bg-[#FF7A00] transition-all duration-300 rounded-full"
              style={{ width: `${overallPct}%` }}
            />
          </div>
          {isUploading && (
            <div className="text-[11px] text-[#6C655D] dark:text-[#AAAAAA] mt-1.5">
              กำลังอัปโหลด {uploadStats.percent}% • ก้อนที่ {uploadStats.currentChunk}/{uploadStats.totalChunks} ({uploadStats.speedMBs} MB/s)
            </div>
          )}
        </div>

        {/* Clean Status List */}
        <div className="space-y-2">
          <div className="p-2.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">
                1. ไฟล์ต้นฉบับบนคลาวด์
              </div>
              <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] truncate">
                {isRawUploaded ? 'พร้อมประมวลผลต่อ' : stageDetail || `กำลังอัปโหลด (${uploadStats.percent}%)`}
              </div>
            </div>
            <span
              className={`text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${
                isRawUploaded
                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-400'
              }`}
            >
              {isRawUploaded ? 'พร้อมแล้ว' : `${uploadStats.percent}%`}
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">
                2. ถอดเสียงและซับไตเติล
              </div>
              <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] truncate">
                {subInfo.desc}
              </div>
            </div>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${subInfo.cls}`}>
              {subInfo.label}
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">
                3. เรตติ้งเนื้อหา
              </div>
              <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] truncate">
                {ratingInfo.desc}
              </div>
            </div>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${ratingInfo.cls}`}>
              {ratingInfo.label}
            </span>
          </div>

          <div className="p-2.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">
                4. แปลงสตรีม HLS
              </div>
              <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] truncate">
                {hlsInfo.desc}
              </div>
            </div>
            <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${hlsInfo.cls}`}>
              {hlsInfo.label}
            </span>
          </div>
        </div>

        {/* Collapsible Technical Specs Drawer */}
        <button
          type="button"
          onClick={() => setShowTechDetails(!showTechDetails)}
          className="w-full py-2 px-3 rounded-xl border border-dashed border-[#DFD9CE] dark:border-white/15 text-[11px] text-[#8C857B] dark:text-[#9A9A9A] hover:text-[#212529] dark:hover:text-[#F1F1F1] transition flex items-center justify-between cursor-pointer"
        >
          <span>ข้อมูลไฟล์และรายละเอียดเทคนิค</span>
          {showTechDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showTechDetails && (
          <div className="p-3 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 text-[11px] space-y-1.5 font-mono text-[#6C655D] dark:text-[#AAAAAA]">
            <div className="flex justify-between">
              <span>ขนาดไฟล์</span>
              <span className="text-[#212529] dark:text-[#F1F1F1]">{fileDetails.sizeFormatted}</span>
            </div>
            <div className="flex justify-between">
              <span>ความละเอียด / FPS</span>
              <span className="text-[#212529] dark:text-[#F1F1F1]">
                {fileDetails.resolution} • {fileDetails.fps} fps
              </span>
            </div>
            <div className="flex justify-between">
              <span>สัดส่วน / บิตเรต</span>
              <span className="text-[#212529] dark:text-[#F1F1F1]">
                {fileDetails.aspectRatio} • {fileDetails.approxBitrate}
              </span>
            </div>
            <div className="flex justify-between">
              <span>โคเดก / เสียง</span>
              <span className="text-[#212529] dark:text-[#F1F1F1]">
                {fileDetails.codec} • AAC 192kbps
              </span>
            </div>
            {runnerSpecs && (
              <div className="pt-1 border-t border-[#EFECE6] dark:border-white/10">
                Worker: {runnerSpecs.cpuModel} ({runnerSpecs.cpuCores} Cores)
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

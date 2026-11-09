'use client';

import { useState } from 'react';
import {
  Film,
  Layers,
  Cpu,
  CheckCircle2,
  Loader2,
  Volume2,
  Grid,
  SlidersHorizontal,
  CloudUpload,
  XCircle,
  ShieldCheck,
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
  isCancelling,
  onCancelUpload,
  audioStatus,
  setAudioStatus,
  subtitleStatus,
  spriteSheetStatus,
  setSpriteSheetStatus,
  ratingCheckStatus,
  runnerSpecs,
}) {
  const [showSimControls, setShowSimControls] = useState(false);

  // 1. Audio & AI Subtitle label
  const getAudioSubLabel = () => {
    if (subtitleStatus === 'ready') return 'ถอดเสียง & สร้างซับไตเติล AI สำเร็จ';
    if (subtitleStatus === 'processing' || audioStatus === 'extracting') {
      return 'กำลังดึงวิดีโอสกัดเสียง & ส่ง AI ทำซับ...';
    }
    if (audioStatus === 'ready') return 'สกัดไฟล์เสียงสำเร็จ (พร้อมทำซับ)';
    if (audioStatus === 'failed' || subtitleStatus === 'failed') return 'ประมวลผลซับไตเติลไม่สำเร็จ';
    return isRawUploaded ? 'พร้อมดึงวิดีโอจาก OneDrive' : 'รออัปโหลด OneDrive เสร็จ';
  };

  // 2. Sprite Sheet & Content Rating label
  const getSpriteRatingLabel = () => {
    if (ratingCheckStatus === 'VERIFIED_MATCH') return 'AI ตรวจสอบเรตติ้งตรงกับที่เลือก ✓';
    if (ratingCheckStatus === 'AI_AUTO_SELECTED') return 'AI ประเมินและเลือกเรตติ้งให้อัตโนมัติ ✓';
    if (ratingCheckStatus === 'MISMATCH_WARNING') return 'คำเตือน: เรตติ้งที่เลือกต่างจากผลตรวจ AI';
    if (spriteSheetStatus === 'generating' || ratingCheckStatus === 'analyzing') {
      return 'กำลังสร้าง Sprite Grid & ส่ง AI ตรวจเรต...';
    }
    if (spriteSheetStatus === 'ready') return 'สร้าง Sprite Sheet Grid 5x5 สำเร็จ';
    return isRawUploaded ? 'พร้อมสร้าง Sprite Grid ตรวจสอบเรต' : 'รออัปโหลด OneDrive เสร็จ';
  };

  // 3. HLS Multi-bitrate Transcode label
  const getTranscodeLabel = () => {
    if (currentStatus === 'READY') return 'หั่น HLS ครบทุกความละเอียด (เสียง 192kbps เท่ากัน)';
    if (currentStatus === 'TRANSCODING') return `กำลังหั่น HLS Multi-bitrate (${transcodeProgress}%)`;
    if (currentStatus === 'PROCESSING') return 'กำลังเตรียม GitHub Actions Runner...';
    if (currentStatus === 'QUEUED') return 'อยู่ในคิวรอแปลงไฟล์ HLS';
    return 'รอกดยืนยันเผยแพร่ใน Step 4';
  };

  return (
    <div className="space-y-5 sticky top-20">
      {/* 1. Video Preview & Immediate OneDrive Upload Card */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden shadow-xl">
        <div className="aspect-video bg-[#0d0d0d] relative flex items-center justify-center overflow-hidden">
          {thumbnailUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={thumbnailUrl}
              alt="Video Preview"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-[#555555]">
              <Film className="w-12 h-12 stroke-[1.2] mb-2" />
              <span className="text-xs">รอสร้าง Thumbnail ตัวอย่าง</span>
            </div>
          )}

          {/* Badge overlays */}
          <div className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[10px] font-mono text-[#E4E4E7] border border-white/10">
            {fileDetails.resolution || 'Auto'}
          </div>

          <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-[11px] font-mono text-white font-medium">
            {fileDetails.durationFormatted || '0:00'}
          </div>
        </div>

        {/* File summary bar */}
        <div className="p-3.5 bg-[#121212] border-t border-[#222222] space-y-3">
          <div>
            <div className="text-xs font-medium text-[#F1F1F1] truncate">
              {fileDetails.name || file?.name || 'วิดีโอต้นทาง'}
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#71717A] mt-1 font-mono">
              <span>{fileDetails.sizeFormatted}</span>
              <span>{fileDetails.codec}</span>
            </div>
          </div>

          {/* Immediate OneDrive Upload Status Box */}
          <div className="p-3 rounded-xl bg-[#0a0a0a] border border-[#262626] space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-[#F1F1F1] flex items-center gap-1.5">
                {isUploading ? (
                  <Loader2 className="w-3.5 h-3.5 text-[#f97316] animate-spin" />
                ) : isRawUploaded ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                ) : (
                  <CloudUpload className="w-3.5 h-3.5 text-[#A1A1AA]" />
                )}
                <span>
                  {isUploading
                    ? `กำลังอัปโหลดขึ้น OneDrive (${uploadStats.percent}%)`
                    : isRawUploaded
                    ? 'อัปโหลดขึ้น OneDrive สำเร็จ 100%'
                    : 'เตรียมอัปโหลดขึ้น OneDrive...'}
                </span>
              </span>
              <span className="font-mono text-[10px] text-[#8C857B]">
                {isUploading ? `${uploadStats.speedMBs} MB/s` : isRawUploaded ? 'READY ON CLOUD' : ''}
              </span>
            </div>

            {/* Progress Bar */}
            <div className="w-full h-2 rounded-full bg-[#1c1c1c] overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  isRawUploaded
                    ? 'bg-emerald-500'
                    : 'bg-gradient-to-r from-[#ea580c] to-[#f97316]'
                }`}
                style={{ width: `${isRawUploaded ? 100 : uploadStats.percent || 0}%` }}
              />
            </div>

            <div className="text-[11px] text-[#71717A] leading-relaxed">
              {isUploading
                ? `ก้อนที่ ${uploadStats.currentChunk}/${uploadStats.totalChunks} • เหลือเวลา ~${uploadStats.etaSeconds} วินาที`
                : isRawUploaded
                ? 'ไฟล์ต้นฉบับอยู่บน OneDrive แล้ว GitHub Actions สามารถดึงไปทำซับไตเติล, สร้าง Sprite Sheet และหั่น HLS ได้ทันที'
                : stageDetail || 'ระบบจะอัปโหลดไฟล์ขึ้น OneDrive อัตโนมัติเมื่อเลือกวิดีโอ'}
            </div>

            {/* Cancel Upload to OneDrive Button */}
            {onCancelUpload && (
              <button
                type="button"
                disabled={isCancelling}
                onClick={onCancelUpload}
                className="w-full py-2 px-3 rounded-lg bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 hover:text-white border border-rose-800/50 text-xs font-semibold transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>กำลังยกเลิกและลบไฟล์จาก OneDrive...</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3.5 h-3.5" />
                    <span>
                      {isUploading
                        ? 'ยกเลิกการอัปโหลดขึ้น OneDrive ทันที'
                        : 'ยกเลิกและลบวิดีโอนี้จาก OneDrive'}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 2. 3 Separate GitHub Actions Workflows Status Card */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl p-4 shadow-xl space-y-3.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#f97316]" />
            <h3 className="text-xs sm:text-sm font-semibold text-[#F1F1F1]">
              3 GitHub Actions แยกอิสระ
            </h3>
          </div>

          {/* Simulation Toggle Button */}
          <button
            type="button"
            onClick={() => setShowSimControls(!showSimControls)}
            className="text-[10px] px-2 py-0.5 rounded-md bg-[#222222] hover:bg-[#2c2c2c] text-[#A1A1AA] hover:text-[#f97316] border border-[#333333] transition flex items-center gap-1 cursor-pointer"
            title="จำลองสถานะ GitHub Actions เพื่อทดสอบเงื่อนไขในแต่ละ Step"
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>จำลอง State</span>
          </button>
        </div>

        {/* Dev Simulation Toolbar (collapsible) */}
        {showSimControls && (
          <div className="p-2.5 bg-[#0a0a0a] border border-[#333333] rounded-xl space-y-2 text-[11px]">
            <div className="text-[10px] text-[#8C857B] font-mono">
              [DEV] สลับสถานะ GitHub Actions เพื่อทดสอบปุ่มปลดล็อก:
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#A1A1AA]">Action #1 (Audio & Sub):</span>
              <button
                type="button"
                onClick={() => setAudioStatus(audioStatus === 'ready' ? 'waiting' : 'ready')}
                className={`px-2 py-0.5 rounded font-mono border text-[10px] cursor-pointer ${
                  audioStatus === 'ready'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                    : 'bg-amber-950 text-amber-300 border-amber-700'
                }`}
              >
                {audioStatus === 'ready' ? 'READY (คลิกเพื่อเปลี่ยน)' : 'WAITING (คลิกเพื่อเปลี่ยน)'}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#A1A1AA]">Action #2 (Sprite & Rating):</span>
              <button
                type="button"
                onClick={() => setSpriteSheetStatus(spriteSheetStatus === 'ready' ? 'waiting' : 'ready')}
                className={`px-2 py-0.5 rounded font-mono border text-[10px] cursor-pointer ${
                  spriteSheetStatus === 'ready'
                    ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                    : 'bg-amber-950 text-amber-300 border-amber-700'
                }`}
              >
                {spriteSheetStatus === 'ready' ? 'READY (คลิกเพื่อเปลี่ยน)' : 'WAITING (คลิกเพื่อเปลี่ยน)'}
              </button>
            </div>
          </div>
        )}

        {/* 3 Separate GitHub Actions Items */}
        <div className="space-y-2.5 text-xs">
          {/* Action 1: Extract Audio & AI Subtitles */}
          <div className="p-2.5 bg-[#0a0a0a] rounded-xl border border-[#222222] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Volume2 className="w-4 h-4 text-[#f97316] shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-[#F1F1F1] truncate">
                  1. ถอดไฟล์เสียง & AI ทำซับไตเติล
                </div>
                <div className="text-[10px] text-[#71717A] truncate">{getAudioSubLabel()}</div>
              </div>
            </div>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-mono border shrink-0 ${
                subtitleStatus === 'ready' || audioStatus === 'ready'
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/40'
                  : audioStatus === 'extracting' || subtitleStatus === 'processing'
                  ? 'bg-amber-950/60 text-amber-400 border-amber-800/40'
                  : 'bg-[#1e1e1e] text-[#71717A] border-[#333333]'
              }`}
            >
              {subtitleStatus === 'ready'
                ? 'SUB READY'
                : audioStatus === 'ready'
                ? 'AUDIO READY'
                : audioStatus === 'extracting' || subtitleStatus === 'processing'
                ? 'RUNNING'
                : isRawUploaded
                ? 'STANDBY'
                : 'WAITING'}
            </span>
          </div>

          {/* Action 2: Detailed Sprite Sheet Grid & Content Rating AI */}
          <div className="p-2.5 bg-[#0a0a0a] rounded-xl border border-[#222222] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Grid className="w-4 h-4 text-[#f97316] shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-[#F1F1F1] truncate">
                  2. Sprite Sheet Grid & AI ตรวจเรตเนื้อหา
                </div>
                <div className="text-[10px] text-[#71717A] truncate">{getSpriteRatingLabel()}</div>
              </div>
            </div>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-mono border shrink-0 ${
                ratingCheckStatus === 'VERIFIED_MATCH' ||
                ratingCheckStatus === 'AI_AUTO_SELECTED' ||
                spriteSheetStatus === 'ready'
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/40'
                  : ratingCheckStatus === 'MISMATCH_WARNING'
                  ? 'bg-rose-950/60 text-rose-400 border-rose-800/40'
                  : spriteSheetStatus === 'generating' || ratingCheckStatus === 'analyzing'
                  ? 'bg-amber-950/60 text-amber-400 border-amber-800/40'
                  : 'bg-[#1e1e1e] text-[#71717A] border-[#333333]'
              }`}
            >
              {ratingCheckStatus === 'VERIFIED_MATCH'
                ? 'VERIFIED'
                : ratingCheckStatus === 'AI_AUTO_SELECTED'
                ? 'AUTO RATED'
                : ratingCheckStatus === 'MISMATCH_WARNING'
                ? 'MISMATCH'
                : spriteSheetStatus === 'ready'
                ? 'READY'
                : spriteSheetStatus === 'generating' || ratingCheckStatus === 'analyzing'
                ? 'RUNNING'
                : isRawUploaded
                ? 'STANDBY'
                : 'WAITING'}
            </span>
          </div>

          {/* Action 3: HLS Multi-bitrate Transcode (Uniform Audio) */}
          <div className="p-2.5 bg-[#0a0a0a] rounded-xl border border-[#222222] flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <Layers className="w-4 h-4 text-[#f97316] shrink-0" />
              <div className="min-w-0">
                <div className="font-medium text-[#F1F1F1] truncate">
                  3. หั่น HLS (เสียงคุณภาพเดียวกันทุกความชัด)
                </div>
                <div className="text-[10px] text-[#71717A] truncate">{getTranscodeLabel()}</div>
              </div>
            </div>
            <span
              className={`text-[10px] px-2 py-0.5 rounded font-mono border shrink-0 ${
                currentStatus === 'READY'
                  ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/40'
                  : currentStatus === 'TRANSCODING' || currentStatus === 'PROCESSING'
                  ? 'bg-amber-950/60 text-amber-400 border-amber-800/40'
                  : 'bg-[#1e1e1e] text-[#71717A] border-[#333333]'
              }`}
            >
              {currentStatus === 'READY'
                ? 'READY'
                : currentStatus === 'TRANSCODING'
                ? `${transcodeProgress}%`
                : currentStatus || 'IDLE'}
            </span>
          </div>
        </div>

        {/* Audio Continuity Guarantee Badge */}
        <div className="p-2.5 rounded-xl bg-emerald-950/20 border border-emerald-800/30 flex items-center gap-2 text-[11px] text-emerald-300">
          <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>ล็อกคุณภาพเสียง AAC 192kbps (48kHz Stereo) เท่ากันทุกความละเอียด เปลี่ยนความชัดไม่สะดุด</span>
        </div>

        {/* Runner Specs if available */}
        {runnerSpecs && (
          <div className="p-2 bg-[#0d0d0d] rounded-lg border border-[#222222] text-[10px] text-[#71717A] font-mono">
            Worker: {runnerSpecs.cpuModel} ({runnerSpecs.cpuCores} Cores) • RAM: {runnerSpecs.totalRamGb}
          </div>
        )}
      </div>

      {/* 3. Detailed File Metadata */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl p-4 shadow-xl space-y-2.5">
        <h4 className="text-xs font-semibold text-[#A1A1AA] uppercase tracking-wider font-mono">
          ข้อมูลไฟล์ต้นฉบับ (Source Specs)
        </h4>
        <div className="divide-y divide-[#222222] text-xs">
          <div className="py-1.5 flex justify-between">
            <span className="text-[#71717A]">ขนาดไฟล์</span>
            <span className="font-mono text-[#F1F1F1]">{fileDetails.sizeFormatted}</span>
          </div>
          <div className="py-1.5 flex justify-between">
            <span className="text-[#71717A]">ความละเอียด</span>
            <span className="font-mono text-[#F1F1F1]">{fileDetails.resolution}</span>
          </div>
          <div className="py-1.5 flex justify-between">
            <span className="text-[#71717A]">สัดส่วนภาพ</span>
            <span className="font-mono text-[#F1F1F1]">{fileDetails.aspectRatio}</span>
          </div>
          <div className="py-1.5 flex justify-between">
            <span className="text-[#71717A]">ความยาว</span>
            <span className="font-mono text-[#F1F1F1]">{fileDetails.durationFormatted}</span>
          </div>
          <div className="py-1.5 flex justify-between">
            <span className="text-[#71717A]">บิตเรต</span>
            <span className="font-mono text-[#F1F1F1]">{fileDetails.approxBitrate}</span>
          </div>
          <div className="py-1.5 flex justify-between">
            <span className="text-[#71717A]">เฟรมเรต</span>
            <span className="font-mono text-[#F1F1F1]">{fileDetails.fps} fps</span>
          </div>
          <div className="py-1.5 flex justify-between">
            <span className="text-[#71717A]">โคเดก</span>
            <span className="font-mono text-[#F1F1F1]">{fileDetails.codec}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

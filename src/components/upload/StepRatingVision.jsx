'use client';

import { useState, useRef } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

const CONTENT_RATINGS = [
  {
    id: 'all',
    label: 'ทั่วไป',
    badge: 'G / ALL',
    desc: 'เหมาะสำหรับผู้ชมทุกวัย ไม่มีเนื้อหารุนแรงหรือคำหยาบ',
  },
  {
    id: '13+',
    label: '13 ปีขึ้นไป',
    badge: '13+',
    desc: 'อาจมีคำพูดหรือฉากที่เหมาะกับผู้ชมวัยรุ่นขึ้นไป',
  },
  {
    id: '18+',
    label: 'ผู้ใหญ่ 18+',
    badge: '18+',
    desc: 'มีเนื้อหาที่ต้องใช้วิจารณญาณหรือฉากรุนแรง',
  },
  {
    id: 'mature',
    label: 'จำกัดเฉพาะ',
    badge: 'RESTRICTED',
    desc: 'จำกัดการรับชมเฉพาะบัญชีที่ได้รับอนุญาต',
  },
];

function formatThaiModerationText(text) {
  if (!text) return '';
  return String(text)
    .replace(/กิจรรม/g, 'กิจกรรม')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export default function StepRatingVision({
  contentRating,
  setContentRating,
  isRawUploaded,
  uploadPercent = 0,
  spriteSheetStatus, // 'waiting' | 'generating' | 'ready' | 'failed'
  spritePreviewUrl,
  ratingCheckStatus, // 'pending' | 'analyzing' | 'VERIFIED_MATCH' | 'MISMATCH_WARNING' | 'AI_AUTO_SELECTED'
  visionResult,
  onDispatchSpriteRating,
  onApplyRecommendation,
  workerDetail = '',
}) {
  const [isDispatching, setIsDispatching] = useState(false);
  const isDispatchingRef = useRef(false);

  const isSpriteReady = spriteSheetStatus === 'ready';
  const isVisionAnalyzing =
    isDispatching || spriteSheetStatus === 'generating' || ratingCheckStatus === 'analyzing';
  const canTriggerAiRating = Boolean(isRawUploaded) && !isVisionAnalyzing && !isDispatching;

  const isAiSelected =
    contentRating === 'auto' || ratingCheckStatus === 'AI_AUTO_SELECTED';

  const selectedManualInfo = CONTENT_RATINGS.find((r) => r.id === contentRating);

  // Single AI Rating trigger: lets AI analyze frames & assign rating
  const handleRunAiRating = async () => {
    if (isDispatchingRef.current || isVisionAnalyzing || !canTriggerAiRating || !onDispatchSpriteRating) return;
    isDispatchingRef.current = true;
    setIsDispatching(true);
    setContentRating('auto');
    try {
      await onDispatchSpriteRating({
        userRating: 'auto',
        autoApply: true,
      });
    } finally {
      isDispatchingRef.current = false;
      setIsDispatching(false);
    }
  };

  const handleApplyResult = () => {
    if (!visionResult) return;
    setContentRating(visionResult.suggestedRating || 'all');
    if (onApplyRecommendation) {
      onApplyRecommendation(visionResult);
    }
  };

  return (
    <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
      {/* Header + Single "ให้ AI จัดเรต" Button */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-[#212529] dark:text-[#F1F1F1]">
            03 จัดเรตเนื้อหาวิดีโอ
          </h2>
          <p className="text-xs sm:text-sm text-[#6C655D] dark:text-[#AAAAAA] mt-0.5">
            เลือกระดับความเหมาะสมด้วยตนเอง หรือกดปุ่มให้ AI วิเคราะห์และจัดเรตให้
          </p>
        </div>

        <button
          type="button"
          onClick={handleRunAiRating}
          disabled={!canTriggerAiRating}
          title={!isRawUploaded ? `รออัปโหลดไฟล์เสร็จ (${uploadPercent}%) เพื่อสั่ง AI จัดเรตทันที` : 'ให้ AI วิเคราะห์ภาพและจัดเรตให้'}
          className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition border shrink-0 flex items-center justify-center gap-2 ${
            canTriggerAiRating
              ? 'bg-[#FF7A00]/10 border-[#FF7A00]/35 text-[#FF7A00] hover:bg-[#FF7A00] hover:text-white cursor-pointer'
              : 'bg-[#F4F0E8] dark:bg-[#222222] border-[#EFECE6] dark:border-white/10 text-[#8C857B] dark:text-[#666666] cursor-not-allowed'
          }`}
        >
          {isVisionAnalyzing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span>
            {isVisionAnalyzing
              ? 'AI กำลังจัดเรต...'
              : ratingCheckStatus === 'AI_AUTO_SELECTED'
              ? 'ให้ AI จัดเรตใหม่'
              : 'ให้ AI จัดเรต'}
          </span>
        </button>
      </div>

      {isVisionAnalyzing && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-mono text-amber-800 dark:text-amber-300 flex items-center gap-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FF7A00] shrink-0" />
          <span className="break-words">{workerDetail || 'กำลังสร้าง Sprite Grid 5x5 และส่งให้ Gemini Vision วิเคราะห์...'}</span>
        </div>
      )}

      {(ratingCheckStatus === 'failed' || spriteSheetStatus === 'failed') && !isVisionAnalyzing && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400">
          {workerDetail || 'การตรวจสอบเรตเนื้อหาล้มเหลว — สามารถกด "ให้ AI จัดเรต" ด้านบนเพื่อลองใหม่อีกครั้ง'}
        </div>
      )}

      {/* 4 Manual Rating Cards */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
            เลือกระดับความเหมาะสมด้วยตนเอง
          </span>
          <span
            className={`text-[11px] px-2.5 py-0.5 rounded-full font-semibold ${
              ratingCheckStatus === 'AI_AUTO_SELECTED'
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'
                : isVisionAnalyzing || contentRating === 'auto'
                ? 'bg-[#FF7A00]/10 text-[#FF7A00]'
                : 'bg-[#F4F0E8] dark:bg-[#222222] text-[#6C655D] dark:text-[#AAAAAA]'
            }`}
          >
            {ratingCheckStatus === 'AI_AUTO_SELECTED'
              ? 'จัดเรตโดย AI'
              : isVisionAnalyzing
              ? 'AI กำลังวิเคราะห์'
              : contentRating === 'auto'
              ? 'ให้ AI จัดเรต'
              : 'เลือกเอง'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {CONTENT_RATINGS.map((item) => {
            const isSelected = contentRating === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setContentRating(item.id)}
                className={`p-3.5 rounded-xl border text-left transition cursor-pointer ${
                  isSelected
                    ? 'bg-[#FF7A00]/10 border-[#FF7A00]'
                    : 'bg-[#F4F0E8] dark:bg-[#222222] border-[#EFECE6] dark:border-white/10 hover:border-[#D5CFC5] dark:hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs sm:text-sm font-bold text-[#212529] dark:text-[#F1F1F1]">
                    {item.label}
                  </span>
                  <span
                    className={`text-[11px] px-2 py-0.5 rounded-md font-bold border ${
                      isSelected
                        ? 'bg-[#FF7A00] border-[#FF7A00] text-white'
                        : 'bg-white dark:bg-[#181818] border-[#EFECE6] dark:border-white/10 text-[#6C655D] dark:text-[#AAAAAA]'
                    }`}
                  >
                    {item.badge}
                  </span>
                </div>
                <p className="text-xs text-[#6C655D] dark:text-[#9A9A9A] leading-relaxed">
                  {item.desc}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Reassuring Policy Note: Manual pick -> AI checks automatically after HLS splits */}
      {!isAiSelected && !visionResult && (
        <div className="p-3.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 text-xs sm:text-[13px] text-[#6C655D] dark:text-[#CCCCCC] leading-relaxed">
          <strong className="text-[#212529] dark:text-[#F1F1F1]">หากคุณเลือกเรตเอง:</strong>{' '}
          ไม่จำเป็นต้องกดสแกนตอนนี้ ระบบจะให้ AI ตรวจสอบความถูกต้องกับเรต{' '}
          <strong className="text-[#212529] dark:text-[#F1F1F1]">
            &ldquo;{selectedManualInfo?.label || contentRating}&rdquo;
          </strong>{' '}
          ให้อัตโนมัติหลังจากหั่นไฟล์ HLS เสร็จเรียบร้อย
        </div>
      )}

      {contentRating === 'auto' && !visionResult && !isVisionAnalyzing && (
        <div className="p-3.5 rounded-xl bg-[#FF7A00]/10 border border-[#FF7A00]/30 text-xs sm:text-[13px] text-[#212529] dark:text-[#F1F1F1] leading-relaxed">
          ตั้งค่าให้ AI ประเมินและจัดเรตให้อัตโนมัติเรียบร้อย — กดปุ่ม{' '}
          <strong>&ldquo;ให้ AI จัดเรต&rdquo;</strong> เพื่อวิเคราะห์ทันที หรือรอให้ระบบจัดให้เมื่อกดเผยแพร่
        </div>
      )}

      {/* Sprite Sheet + AI Result (only shown when already scanned or AI has returned a result) */}
      {(isSpriteReady || visionResult) && (
        <div className="space-y-3 pt-1">
          {spritePreviewUrl && (
            <div className="rounded-xl overflow-hidden border border-[#EFECE6] dark:border-white/10 bg-[#F4F0E8] dark:bg-[#141414]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={spritePreviewUrl}
                alt="ภาพตัวอย่าง 25 เฟรม"
                className="w-full h-auto block"
              />
            </div>
          )}

          {visionResult && (
            <div
              className={`p-4 rounded-xl border space-y-3 ${
                visionResult.verificationStatus === 'MISMATCH_WARNING'
                  ? 'bg-amber-500/10 border-amber-500/30'
                  : 'bg-emerald-500/10 border-emerald-500/30'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="font-semibold text-xs sm:text-sm flex items-center gap-2">
                  {visionResult.verificationStatus === 'MISMATCH_WARNING' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  )}
                  <span
                    className={
                      visionResult.verificationStatus === 'MISMATCH_WARNING'
                        ? 'text-amber-800 dark:text-amber-300'
                        : 'text-emerald-700 dark:text-emerald-400'
                    }
                  >
                    ผลประเมินจาก AI: แนะนำเรต &ldquo;
                    {visionResult.suggestedRatingLabel || visionResult.suggestedRating}&rdquo;
                  </span>
                </div>

                {contentRating !== visionResult.suggestedRating && (
                  <button
                    type="button"
                    onClick={handleApplyResult}
                    className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition cursor-pointer shrink-0"
                  >
                    ใช้เรตที่ AI แนะนำ
                  </button>
                )}
              </div>

              {visionResult.comparisonNote && (
                <p
                  lang="th"
                  className="text-xs text-[#212529] dark:text-[#E4E4E7] leading-relaxed [word-break:normal] [overflow-wrap:break-word]"
                >
                  {formatThaiModerationText(visionResult.comparisonNote)}
                </p>
              )}

              {Array.isArray(visionResult.safetyScores) && visionResult.safetyScores.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {visionResult.safetyScores.map((s, idx) => {
                    const statusStr = String(s.status || '').toUpperCase();
                    const isHigh = statusStr.includes('HIGH');
                    const isMed =
                      statusStr.includes('MED') ||
                      statusStr.includes('CAUTION') ||
                      statusStr.includes('LOW');
                    const colorClass = isHigh
                      ? 'text-rose-600 dark:text-rose-400 font-bold'
                      : isMed
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400';

                    return (
                      <div
                        key={idx}
                        className="p-2 rounded-lg bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10"
                      >
                        <div className="text-[10px] text-[#8C857B] dark:text-[#9A9A9A]">{s.name}</div>
                        <div className={`text-xs font-mono font-medium ${colorClass}`}>{s.status}</div>
                      </div>
                    );
                  })}
                </div>
              )}

              {visionResult.summary && (
                <p
                  lang="th"
                  className="text-xs leading-relaxed text-[#6C655D] dark:text-[#CCCCCC] bg-white dark:bg-[#181818] p-3 rounded-lg border border-[#EFECE6] dark:border-white/10 [word-break:normal] [overflow-wrap:break-word]"
                >
                  {formatThaiModerationText(visionResult.summary)}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

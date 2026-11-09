'use client';

import { useState } from 'react';
import {
  ShieldAlert,
  Search,
  Lock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Scan,
  Grid,
  Sparkles,
  Info,
  Check,
  Bot,
} from 'lucide-react';

const CONTENT_RATINGS = [
  {
    id: 'all',
    label: 'ทั่วไป (All Ages)',
    desc: 'ไม่มีเนื้อหารุนแรง เพศ หรือถ้อยคำหยาบคาย เหมาะสำหรับผู้ชมทุกวัย (AI จะตรวจสอบยืนยันกับภาพ Sprite Sheet)',
    badge: 'ALL',
    badgeColor: 'text-emerald-400 bg-emerald-950/40 border-emerald-800/40',
  },
  {
    id: '13+',
    label: 'วัยรุ่น (13+)',
    desc: 'อาจมีคำหยาบคายเล็กน้อย การต่อสู้แนวแฟนตาซี หรือมุกตลกเฉพาะกลุ่ม (AI จะตรวจสอบยืนยันกับภาพ Sprite Sheet)',
    badge: '13+',
    badgeColor: 'text-sky-400 bg-sky-950/40 border-sky-800/40',
  },
  {
    id: '18+',
    label: 'ผู้ใหญ่ (18+)',
    desc: 'มีภาพหรือเนื้อหาที่ต้องใช้วิจารณญาณ ฉากความรุนแรง หรือพฤติกรรมเสี่ยง (AI จะตรวจสอบยืนยันกับภาพ Sprite Sheet)',
    badge: '18+',
    badgeColor: 'text-amber-400 bg-amber-950/40 border-amber-800/40',
  },
  {
    id: 'mature',
    label: 'เนื้อหาจำกัดเฉพาะ (Restricted / Mature)',
    desc: 'เนื้อหาเกี่ยวกับความรุนแรงสูง การใช้ภาษาที่ไม่เหมาะสม หรือเนื้อหาต้องห้าม (AI จะตรวจสอบยืนยันกับภาพ Sprite Sheet)',
    badge: 'RESTRICTED',
    badgeColor: 'text-rose-400 bg-rose-950/40 border-rose-800/40',
  },
  {
    id: 'auto',
    label: 'ให้ AI ตรวจสอบและกำหนดเรตเนื้อหาเอง (Auto AI Inspection)',
    desc: 'ไม่ต้องเลือกเอง — ระบบจะดึงวิดีโอมาสร้าง Sprite Sheet Grid 25 เฟรมโดยละเอียดแล้วส่งให้ AI ประเมินและตั้งค่าเรตให้อัตโนมัติ',
    badge: 'AI AUTO',
    badgeColor: 'text-purple-300 bg-purple-950/50 border-purple-700/50',
  },
];

export default function StepRatingVision({
  contentRating,
  setContentRating,
  isRawUploaded,
  uploadPercent = 0,
  spriteSheetStatus, // 'waiting' | 'generating' | 'ready' | 'failed'
  spritePreviewUrl,
  ratingCheckStatus, // 'pending' | 'analyzing' | 'VERIFIED_MATCH' | 'MISMATCH_WARNING' | 'AI_AUTO_SELECTED'
  visionResult,
  thumbnailUrl,
  onDispatchSpriteRating,
  onApplyRecommendation,
}) {
  const [isDispatching, setIsDispatching] = useState(false);

  const isSpriteReady = spriteSheetStatus === 'ready';
  const isVisionAnalyzing =
    isDispatching || spriteSheetStatus === 'generating' || ratingCheckStatus === 'analyzing';
  const canTriggerWorkflow = Boolean(isRawUploaded) && !isVisionAnalyzing;

  const handleRunVisionAnalysis = async (autoApplyFlag = contentRating === 'auto') => {
    if (!canTriggerWorkflow || !onDispatchSpriteRating) return;
    setIsDispatching(true);
    try {
      await onDispatchSpriteRating({
        userRating: contentRating || 'auto',
        autoApply: autoApplyFlag,
      });
    } finally {
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
    <div className="space-y-6">
      {/* Content Rating Selection Section */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-[#F1F1F1] flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[#f97316]" />
              การประเมินเรตเนื้อหาวิดีโอ (Content Rating & AI Verification) <span className="text-[#f97316]">*</span>
            </h3>
            <p className="text-xs text-[#71717A] mt-1">
              เลือกเรตเนื้อหาเพื่อให้ AI ตรวจสอบความถูกต้องหลังประมวลผล หรือเลือกให้ AI ประเมินและจัดเรตให้อัตโนมัติโดยไม่ต้องเลือกเอง
            </p>
          </div>
          <span className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-950/50 text-emerald-400 border border-emerald-800/40 font-mono shrink-0">
            ENV AI KEY READY
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {CONTENT_RATINGS.map((item) => {
            const isSelected = contentRating === item.id;
            const isAutoCard = item.id === 'auto';
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setContentRating(item.id)}
                className={`flex flex-col justify-between p-4 rounded-xl border text-left transition cursor-pointer ${
                  isAutoCard ? 'sm:col-span-2' : ''
                } ${
                  isSelected
                    ? 'bg-[#1a1a1a] border-[#f97316] ring-1 ring-[#f97316]/50 shadow-md shadow-[#ea580c]/10'
                    : 'bg-[#111111] border-[#262626] hover:border-[#383838]'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium text-[#F1F1F1] flex items-center gap-2">
                      {isAutoCard && <Bot className="w-4 h-4 text-[#f97316]" />}
                      {item.label}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-mono border ${item.badgeColor}`}>
                      {item.badge}
                    </span>
                  </div>
                  <p className="text-xs text-[#8C857B] leading-relaxed">
                    {item.desc}
                  </p>
                </div>

                <div className="mt-3 flex items-center gap-1.5 text-xs">
                  <div
                    className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                      isSelected
                        ? 'border-[#f97316] bg-[#f97316] text-white'
                        : 'border-[#444444] bg-[#1a1a1a]'
                    }`}
                  >
                    {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </div>
                  <span className={isSelected ? 'text-[#f97316] font-medium' : 'text-[#71717A]'}>
                    {isSelected
                      ? isAutoCard
                        ? 'ตั้งค่าให้ AI ตรวจสอบและกำหนดเรตให้อัตโนมัติ'
                        : 'เลือกเรตนี้ (AI จะตรวจสอบยืนยันกับภาพ Sprite Sheet)'
                      : 'คลิกเพื่อเลือก'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detailed Sprite Sheet Grid & Vision AI Section (GitHub Action #2) */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#F1F1F1] flex items-center gap-2">
              <Scan className="w-4 h-4 text-[#f97316]" />
              GitHub Action #2: Detailed Sprite Sheet Grid & AI Content Rating
            </h3>
            <p className="text-xs text-[#71717A] mt-0.5">
              ดึงวิดีโอจาก OneDrive มาสร้างภาพ Sprite Sheet Grid 5x5 (25 เฟรมละเอียดพร้อม Timestamp) ส่งให้ Gemini Vision ตรวจสอบเรตเนื้อหา
            </p>
          </div>

          <span
            className={`text-xs px-2.5 py-1 rounded-full font-mono font-medium border shrink-0 ${
              isSpriteReady
                ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50'
                : isVisionAnalyzing
                ? 'bg-amber-950/50 text-amber-400 border-amber-800/40'
                : 'bg-[#1c1c1c] text-[#A1A1AA] border-[#333333]'
            }`}
          >
            {isSpriteReady
              ? 'SPRITE GRID READY'
              : isVisionAnalyzing
              ? 'GENERATING & ANALYZING...'
              : isRawUploaded
              ? 'ONEDRIVE READY'
              : `UPLOADING ${uploadPercent}%`}
          </span>
        </div>

        {/* Sprite Sheet Preview Area */}
        <div className="rounded-xl border border-[#262626] bg-[#0a0a0a] p-4">
          <div className="flex items-center justify-between mb-3 text-xs text-[#71717A]">
            <span className="flex items-center gap-1.5 font-mono">
              <Grid className="w-3.5 h-3.5 text-[#f97316]" />
              Detailed Sprite Sheet Grid (5x5 • 25 เฟรมครอบคลุมทั้งคลิป)
            </span>
            <span>320x180 ต่อเฟรม (1600x900 Grid)</span>
          </div>

          {!isSpriteReady ? (
            <div className="w-full h-44 rounded-lg bg-[#141414] border border-[#222222] flex flex-col items-center justify-center text-center p-6 space-y-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                {isVisionAnalyzing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Grid className="w-5 h-5" />
                )}
              </div>
              <div>
                <div className="text-xs sm:text-sm font-medium text-[#F1F1F1]">
                  {isVisionAnalyzing
                    ? 'GitHub Action #2 กำลังดึงวิดีโอมาสร้าง Sprite Sheet 25 เฟรม และส่งให้ AI ตรวจเรตเนื้อหา...'
                    : isRawUploaded
                    ? 'ไฟล์วิดีโออยู่บน OneDrive พร้อมแล้ว กดปุ่มด้านล่างเพื่อให้ AI สร้าง Sprite Sheet ตรวจสอบทันที หรือรันอัตโนมัติเมื่อเผยแพร่'
                    : `กำลังรออัปโหลดวิดีโอขึ้น OneDrive (${uploadPercent}%)...`}
                </div>
                <div className="text-xs text-[#71717A] mt-1">
                  ระบบจะส่งภาพ Sprite Sheet Grid พร้อมเกณฑ์ Content Rating ไปให้ Gemini Vision ตรวจสอบกับเรตที่เลือก
                </div>
              </div>
            </div>
          ) : spritePreviewUrl ? (
            <div className="relative rounded-lg overflow-hidden border border-[#333333] bg-[#0d0d0d]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={spritePreviewUrl}
                alt="Detailed Sprite Sheet Grid 5x5"
                className="w-full max-h-80 object-contain mx-auto"
              />
              <div className="p-2.5 bg-black/80 border-t border-[#262626] flex items-center justify-between text-xs">
                <span className="text-emerald-400 font-mono flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Sprite Sheet Grid 5x5 (25 เฟรม) สร้างสำเร็จจากวิดีโอจริง
                </span>
                <span className="text-[11px] text-[#A1A1AA] font-mono">sprite-content-rating.yml</span>
              </div>
            </div>
          ) : (
            <div className="relative group overflow-hidden rounded-lg border border-[#333333] bg-[#121212]">
              <div className="grid grid-cols-5 gap-1 p-2 bg-[#0d0d0d]">
                {Array.from({ length: 15 }).map((_, i) => (
                  <div
                    key={i}
                    className="aspect-video bg-[#1a1a1a] rounded overflow-hidden relative flex items-center justify-center border border-[#222222]"
                  >
                    {thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumbnailUrl}
                        alt="frame"
                        className="w-full h-full object-cover opacity-80"
                      />
                    ) : (
                      <span className="text-[9px] font-mono text-[#555555]">
                        F{i + 1}
                      </span>
                    )}
                    <span className="absolute bottom-0.5 right-0.5 text-[8px] bg-black/75 px-1 rounded text-zinc-400 font-mono">
                      {`#${i + 1}`}
                    </span>
                  </div>
                ))}
              </div>
              <div className="p-2.5 bg-black/80 border-t border-[#262626] text-xs text-emerald-400 font-mono flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Sprite Sheet พร้อมสำหรับการสแกน Vision AI
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons to trigger Workflow #2 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
          <button
            type="button"
            onClick={() => handleRunVisionAnalysis(contentRating === 'auto')}
            disabled={!canTriggerWorkflow}
            className={`py-3 px-4 rounded-xl font-semibold text-xs sm:text-sm transition flex items-center justify-center gap-2 border shadow-lg ${
              canTriggerWorkflow
                ? 'bg-gradient-to-r from-[#ea580c] to-[#f97316] border-[#f97316] text-white hover:brightness-110 cursor-pointer shadow-[#ea580c]/20'
                : 'bg-[#181818] border-[#2c2c2c] text-[#666666] cursor-not-allowed'
            }`}
          >
            {isVisionAnalyzing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>กำลังสร้าง Sprite Grid & ส่ง AI ตรวจสอบ...</span>
              </>
            ) : (
              <>
                <Search className="w-4 h-4" />
                <span>
                  {contentRating === 'auto'
                    ? 'สั่ง AI สร้าง Sprite Sheet & เลือกเรตเนื้อหาให้อัตโนมัติ'
                    : `สั่ง AI สร้าง Sprite Sheet & ตรวจสอบกับเรต "${contentRating.toUpperCase()}"`}
                </span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setContentRating('auto');
              handleRunVisionAnalysis(true);
            }}
            disabled={!canTriggerWorkflow}
            className={`py-3 px-4 rounded-xl font-semibold text-xs sm:text-sm transition flex items-center justify-center gap-2 border ${
              canTriggerWorkflow
                ? 'bg-[#1c1c1c] hover:bg-[#262626] border-purple-700/50 text-purple-300 cursor-pointer'
                : 'bg-[#181818] border-[#2c2c2c] text-[#666666] cursor-not-allowed'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>ให้ AI ตรวจสอบและตั้งเรตให้อัตโนมัติ (ไม่เลือกเอง)</span>
          </button>
        </div>

        {!isRawUploaded && (
          <div className="text-[11px] text-center text-amber-400/90 flex items-center justify-center gap-1.5">
            <Info className="w-3.5 h-3.5" />
            <span>
              รออัปโหลดวิดีโอขึ้น OneDrive ให้เสร็จก่อน ({uploadPercent}%) เพื่อสั่งรันทันที หรือกดยืนยันใน Step 4 เพื่อให้ AI ตรวจสอบให้อัตโนมัติหลังแปลงไฟล์
            </span>
          </div>
        )}

        {/* Vision Result & Rating Comparison Card */}
        {visionResult && (
          <div
            className={`p-4 rounded-xl bg-[#0a0a0a] border space-y-3 mt-3 ${
              visionResult.verificationStatus === 'MISMATCH_WARNING'
                ? 'border-amber-700/60'
                : 'border-emerald-800/50'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="font-semibold text-xs sm:text-sm flex items-center gap-2">
                {visionResult.verificationStatus === 'MISMATCH_WARNING' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
                <span
                  className={
                    visionResult.verificationStatus === 'MISMATCH_WARNING'
                      ? 'text-amber-300'
                      : 'text-emerald-400'
                  }
                >
                  ผลการตรวจสอบ Sprite Sheet Grid จาก Gemini Vision AI: แนะนำเรต &ldquo;
                  {visionResult.suggestedRatingLabel || visionResult.suggestedRating}&rdquo;
                </span>
              </div>

              {contentRating !== visionResult.suggestedRating && (
                <button
                  type="button"
                  onClick={handleApplyResult}
                  className="text-xs px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium transition cursor-pointer shrink-0"
                >
                  เปลี่ยนมาใช้เรตที่ AI แนะนำ ({String(visionResult.suggestedRating || '').toUpperCase()})
                </button>
              )}
            </div>

            {visionResult.comparisonNote && (
              <div
                className={`p-2.5 rounded-lg text-xs border ${
                  visionResult.verificationStatus === 'MISMATCH_WARNING'
                    ? 'bg-amber-950/30 border-amber-800/40 text-amber-200'
                    : 'bg-emerald-950/20 border-emerald-800/30 text-emerald-200'
                }`}
              >
                {visionResult.comparisonNote}
              </div>
            )}

            {Array.isArray(visionResult.safetyScores) && visionResult.safetyScores.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
                {visionResult.safetyScores.map((s, idx) => (
                  <div key={idx} className="p-2 rounded bg-[#141414] border border-[#222222]">
                    <div className="text-[10px] text-[#71717A]">{s.name}</div>
                    <div className="text-xs font-mono text-emerald-400 font-medium">{s.status}</div>
                  </div>
                ))}
              </div>
            )}

            {visionResult.summary && (
              <p className="text-xs text-[#A1A1AA] bg-[#141414] p-2.5 rounded-lg border border-[#262626]">
                {visionResult.summary}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

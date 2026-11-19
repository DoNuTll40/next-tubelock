'use client';

import { Languages, CheckCircle2, AlertCircle } from 'lucide-react';
import Select from '@/components/ui/Select';
import {
  QUICK_PICK_VIDEO_LANGUAGES,
  VIDEO_LANGUAGE_SELECT_OPTIONS,
  getVideoLanguage,
} from '@/lib/videoLanguages';

export default function VideoLanguagePicker({
  value = '',
  onChange,
  required = true,
  compact = false,
  disabled = false,
}) {
  const selected = getVideoLanguage(value);
  const isMissing = required && !selected;

  return (
    <div
      className={`rounded-xl border transition ${
        compact ? 'p-3.5 space-y-2.5' : 'p-4 space-y-3'
      } ${
        isMissing
          ? 'bg-[#FFF8F0] dark:bg-[#231B14] border-[#FF7A00]/45'
          : 'bg-[#F4F0E8] dark:bg-[#222222] border-[#EFECE6] dark:border-white/10'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Languages
            className={`w-4 h-4 shrink-0 ${
              isMissing ? 'text-[#FF7A00]' : 'text-[#6C655D] dark:text-[#AAAAAA]'
            }`}
          />
          <label className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
            ภาษาเสียงพูดหลักของวิดีโอ{' '}
            {required && <span className="text-[#FF7A00]">*</span>}
          </label>
        </div>

        {selected ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-3 h-3" />
            <span>{selected.shortLabel}</span>
          </span>
        ) : required ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#FF7A00]/15 text-[#FF7A00]">
            <AlertCircle className="w-3 h-3" />
            <span>บังคับเลือก</span>
          </span>
        ) : null}
      </div>

      <p className="text-[11px] text-[#6C655D] dark:text-[#9A9A9A] leading-relaxed">
        {selected?.isNone
          ? 'ระบบจะข้ามการสร้างซับไตเติลอัตโนมัติด้วย AI (ยังสามารถอัปโหลดไฟล์ .SRT/.VTT เองได้)'
          : selected?.isThai
            ? 'ระบบจะถอดเสียงเป็นภาษาไทยโดยตรง ไม่แปลซ้ำ และไม่สับสนเป็นภาษาอื่น'
            : selected
              ? `ระบบจะถอดซับต้นฉบับเป็นภาษา${selected.shortLabel}ตรงตามเสียง แล้วแปลเป็นไทยอัตโนมัติ`
              : 'กรุณาระบุภาษาเสียงพูดหลักของวิดีโอ เพื่อให้ AI ถอดเสียงตรงภาษาและไม่แปลผิด'}
      </p>

      {/* Quick-pick language pills */}
      <div className="flex flex-wrap gap-1.5">
        {QUICK_PICK_VIDEO_LANGUAGES.map((lang) => {
          const isSelected = selected?.code === lang.code;
          return (
            <button
              key={lang.code}
              type="button"
              disabled={disabled}
              aria-pressed={isSelected}
              onClick={() => onChange?.(lang.code)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                isSelected
                  ? 'bg-[#FF7A00] border-[#FF7A00] text-white shadow-2xs'
                  : 'bg-white dark:bg-[#181818] border-[#EFECE6] dark:border-white/10 text-[#212529] dark:text-[#E4E4E7] hover:border-[#FF7A00]/60 hover:text-[#FF7A00]'
              }`}
            >
              {lang.shortLabel}
            </button>
          );
        })}
      </div>

      {/* Full language dropdown */}
      <Select
        options={VIDEO_LANGUAGE_SELECT_OPTIONS}
        value={selected?.code || ''}
        onChange={(val) => onChange?.(val)}
        placeholder="เลือกภาษาเสียงพูดหลักของวิดีโอ (ทั้งหมด)..."
        disabled={disabled}
        className="w-full"
      />
    </div>
  );
}

'use client';

import { useId } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { Check, ChevronDown, Maximize, Play, RectangleHorizontal, Volume2, VolumeX } from 'lucide-react';
import SettingCard from '@/components/ui/SettingCard';
import SettingRow from '@/components/ui/SettingRow';

const FIT_OPTIONS = [
  { value: 'fit', title: 'พอดีเฟรม', description: 'แสดงภาพครบทุกส่วน', icon: RectangleHorizontal },
  { value: 'fill', title: 'เต็มพื้นที่', description: 'ขยายและครอปภาพให้เต็มกรอบ', icon: Maximize },
];
const selectionSpring = { type: 'spring', stiffness: 430, damping: 34 };

function PlayerPreview({ fill }) {
  return (
    <span aria-hidden="true" className="relative flex h-24 items-center justify-center overflow-hidden rounded-lg border border-black/10 bg-[#E4DED5] sm:h-32 dark:border-white/10 dark:bg-[#111111]">
      <svg viewBox="0 0 400 180" preserveAspectRatio={fill ? 'xMidYMid slice' : 'xMidYMid meet'} className="h-full w-full shrink-0">
        <rect width="400" height="180" className="fill-[#EDE4D6] dark:fill-[#393530]" />
        <circle cx="300" cy="40" r="18" className="fill-[#FFB66E] dark:fill-[#BF8552]" />
        <path d="M-20 180 100 25 230 180Z" className="fill-[#C5B8A6] dark:fill-[#706354]" />
        <path d="m62 74 38-49 44 53-32-13-18 13-13-15Z" className="fill-[#F8F3EB] dark:fill-[#B8AD9F]" />
        <path d="M150 180 280 60 420 180Z" className="fill-[#A79D8D] dark:fill-[#514C43]" />
        <path d="M-20 155Q90 104 220 164T430 140V200H-20Z" className="fill-[#8D9C8E] dark:fill-[#343E36]" />
      </svg>
      <span className="absolute inset-0 grid place-items-center"><span className="grid size-7 place-items-center rounded-full bg-black/30 text-white sm:size-8"><Play className="size-3.5 fill-current" /></span></span>
      <span className="absolute inset-x-2 bottom-2 flex items-center gap-1.5 rounded bg-black/35 px-2 py-1 sm:inset-x-3 sm:bottom-2.5">
        <span className="h-0.5 w-1/4 rounded-full bg-[#FF963D]" /><span className="h-0.5 flex-1 rounded-full bg-white/40" /><Maximize className="size-2.5 text-white/80" />
      </span>
    </span>
  );
}

function FitChoices({ value, onChange }) {
  const groupId = useId();
  const reduceMotion = useReducedMotion();
  return (
    <fieldset className="min-w-0 p-3 sm:p-5">
      <legend className="sr-only">ขนาดภาพในตัวเล่น</legend>
      <LayoutGroup id={groupId}>
        <div className="isolate grid grid-cols-2 gap-2 sm:gap-3">
          {FIT_OPTIONS.map(({ value: option, title, description, icon: Icon }) => {
            const selected = value === option;
            return (
              <label key={option} className="relative block min-w-0 cursor-pointer">
                <input type="radio" name={groupId} value={option} checked={selected} onChange={() => onChange(option)} className="peer sr-only" aria-describedby={`${groupId}-${option}`} />
                <span className={`flex h-full flex-col gap-3 rounded-xl border border-[#E8E2D9] p-2 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#FF7A00] motion-reduce:transition-none sm:p-2.5 dark:border-white/10 ${selected ? 'bg-[#FFF8F0] dark:bg-[#28211B]' : 'bg-[#FCFAF7] hover:border-[#BEB3A4] dark:bg-[#1E1E1E] dark:hover:border-white/30'}`}>
                  {selected && <motion.span aria-hidden="true" layoutId={reduceMotion ? undefined : 'fit-outline'} transition={{ layout: selectionSpring }} className="pointer-events-none absolute inset-0 z-10 rounded-xl border border-[#C55700] shadow-[0_0_18px_#FF7A001C] dark:border-[#FF963D] dark:shadow-[0_0_18px_#FF7A0026]" />}
                  <PlayerPreview fill={option === 'fill'} />
                  <span className="flex items-center gap-2 px-1">
                    <Icon aria-hidden="true" className="hidden size-4 shrink-0 text-[#756C62] sm:block dark:text-[#AEAAA4]" />
                    <span className="min-w-0 flex-1 text-xs font-semibold text-[#212529] sm:text-sm dark:text-[#F1F1F1]">{title}</span>
                    <span aria-hidden="true" className={`grid size-4 shrink-0 place-items-center rounded-full border sm:size-5 ${selected ? 'border-[#B34E00] bg-[#B34E00] text-white dark:border-[#FF963D] dark:bg-[#FF963D] dark:text-[#231305]' : 'border-[#D3CABE] dark:border-white/20'}`}>{selected && <Check className="size-3 sm:size-3.5" strokeWidth={2.5} />}</span>
                  </span>
                  <span id={`${groupId}-${option}`} className="-mt-2 px-1 pb-1 text-[11px] leading-relaxed text-[#8C857B] dark:text-[#888888]">{description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </LayoutGroup>
    </fieldset>
  );
}

function PreferenceSelect({ label, value, options, onChange }) {
  return (
    <span className="relative inline-flex">
      <select aria-label={label} value={value} onChange={event => onChange(Number(event.target.value))} className="min-h-9 min-w-32 cursor-pointer appearance-none rounded-lg border border-[#E8E2D9] bg-[#F5F2EB] py-2 pr-9 pl-3 text-xs font-semibold text-[#212529] outline-offset-2 focus-visible:outline-2 focus-visible:outline-[#FF7A00] dark:border-white/10 dark:bg-[#252525] dark:text-[#F1F1F1]">
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-3.5 -translate-y-1/2 text-[#8C857B] dark:text-[#AAAAAA]" />
    </span>
  );
}

function PlayerToggle({ title, description, checked, onChange }) {
  const id = useId();
  return (
    <SettingRow className="flex-row! items-center!" title={<label htmlFor={id} className="cursor-pointer">{title}</label>} description={<span id={`${id}-description`}>{description}</span>}>
      <label className="relative grid min-h-11 cursor-pointer place-items-center">
        <input id={id} type="checkbox" role="switch" aria-label={title} aria-describedby={`${id}-description`} checked={checked} onChange={event => onChange(event.target.checked)} className="peer sr-only" />
        <span aria-hidden="true" className="relative h-6 w-11 rounded-full bg-[#E5E0D8] transition-colors before:absolute before:top-0.5 before:left-0.5 before:size-5 before:rounded-full before:bg-white before:shadow-md before:transition-transform peer-checked:bg-[#FF7A00] peer-checked:before:translate-x-5 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#FF7A00] motion-reduce:transition-none motion-reduce:before:transition-none dark:bg-white/20" />
      </label>
    </SettingRow>
  );
}

export default function PlayerSection({ defaultSpeed, setDefaultSpeed, defaultFit, setDefaultFit, seekStep, setSeekStep, volume, setVolume, autoplay, setAutoplay, autoStats, setAutoStats, showHeading = true }) {
  const volumeId = useId();
  const percent = Math.round(volume * 100);
  return (
    <div className="flex min-w-0 flex-col gap-6 px-4 pb-5">
      {showHeading && <header className="border-b border-[#EFECE6] pb-3 dark:border-white/10">
        <h2 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1]">การเล่นและตัวเล่น</h2>
        <p className="mt-1 text-xs text-[#8C857B] dark:text-[#888888]">ตั้งค่าภาพ เสียง และการควบคุมเมื่อเปิดวิดีโอ</p>
      </header>}

      <SettingCard title="ขนาดภาพในตัวเล่น">
        <FitChoices value={defaultFit} onChange={setDefaultFit} />
      </SettingCard>

      <SettingCard title="การควบคุมการเล่น">
        <SettingRow title="ความเร็วเริ่มต้น" description="ใช้ความเร็วนี้เมื่อเริ่มเล่นวิดีโอ">
          <PreferenceSelect label="ความเร็วเริ่มต้น" value={defaultSpeed} onChange={setDefaultSpeed} options={[.75, 1, 1.25, 1.5, 2].map(value => ({ value, label: value === 1 ? 'ปกติ (1×)' : `${value}×` }))} />
        </SettingRow>
        <SettingRow title={<label htmlFor={volumeId}>ระดับเสียงเริ่มต้น</label>} description="กำหนดระดับเสียงเมื่อเปิดวิดีโอ">
          <span className="flex min-h-9 w-56 max-w-full items-center gap-3 text-[#8C857B] dark:text-[#AAAAAA]">
            <VolumeX aria-hidden="true" className="size-4 shrink-0" />
            <input id={volumeId} type="range" min="0" max="1" step="0.05" value={volume} aria-valuetext={`${percent}%`} onChange={event => setVolume(Number(event.target.value))} style={{ background: `linear-gradient(to right, currentColor ${percent}%, #88888840 ${percent}%)` }} className="h-1 w-full min-w-0 cursor-pointer appearance-none rounded-full text-[#C55700] outline-offset-8 focus-visible:outline-2 focus-visible:outline-[#FF7A00] dark:text-[#FF963D] [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-current [&::-moz-range-thumb]:size-3.5 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-current" />
            <Volume2 aria-hidden="true" className="size-4 shrink-0" />
            <output htmlFor={volumeId} className="w-9 shrink-0 text-right text-xs font-semibold text-[#212529] tabular-nums dark:text-[#F1F1F1]">{percent}%</output>
          </span>
        </SettingRow>
        <SettingRow title="แตะสองครั้งเพื่อข้าม" description="ระยะเวลาที่เลื่อนเมื่อแตะด้านซ้ายหรือขวาของวิดีโอ">
          <PreferenceSelect label="แตะสองครั้งเพื่อข้าม" value={seekStep} onChange={setSeekStep} options={[5, 10, 15, 30].map(value => ({ value, label: `${value} วินาที` }))} />
        </SettingRow>
      </SettingCard>

      <SettingCard title="การเล่นอัตโนมัติและสถิติ">
        <PlayerToggle title="เล่นคลิปถัดไปอัตโนมัติ" description="เริ่มวิดีโอถัดไปเมื่อคลิปปัจจุบันจบ" checked={autoplay} onChange={setAutoplay} />
        <PlayerToggle title="แสดงสถิติเครื่องเล่น" description="แสดง FPS บิตเรต โคเดก และบัฟเฟอร์ขณะเล่น" checked={autoStats} onChange={setAutoStats} />
      </SettingCard>
    </div>
  );
}

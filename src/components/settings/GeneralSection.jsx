'use client';

import { useId } from 'react';
import { LayoutGroup, motion, useReducedMotion } from 'framer-motion';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import SettingCard from '@/components/ui/SettingCard';
import SettingRow from '@/components/ui/SettingRow';

const THEME_OPTIONS = [
  { id: 'light', title: 'สว่าง', icon: Sun },
  { id: 'dark', title: 'มืด', icon: Moon },
  { id: 'auto', title: 'ตามระบบ', icon: Monitor },
];

const selectionSpring = { type: 'spring', stiffness: 430, damping: 34 };

function PreviewWindow({ dark = false }) {
  const panel = dark ? 'bg-[#262626]' : 'bg-white';
  const line = dark ? 'bg-[#414141]' : 'bg-[#DBD4C9]';

  return (
    <span className={`flex min-w-0 flex-1 flex-col overflow-hidden ${dark ? 'bg-[#151515]' : 'bg-[#F7F3EB]'}`}>
      <span className={`flex h-4 shrink-0 items-center justify-between gap-1 px-1.5 sm:h-6 sm:gap-2 sm:px-2.5 ${panel}`}>
        <span className="h-1.5 w-2 shrink-0 rounded-sm bg-[#FF7A00] sm:h-2.5 sm:w-3.5" />
        <span className={`h-1.5 w-2/5 rounded-full ${line}`} />
        <span className={`hidden size-2 shrink-0 rounded-full sm:block ${line}`} />
      </span>
      <span className="flex min-h-0 flex-1 gap-2 p-1.5 sm:p-2.5">
        <span className={`hidden w-1/4 max-w-12 shrink-0 space-y-1.5 rounded-md p-1.5 sm:block ${panel}`}>
          <span className="block h-1 w-full rounded-full bg-[#FF7A00]/75" />
          <span className={`block h-1 w-4/5 rounded-full ${line}`} />
          <span className={`block h-1 w-3/5 rounded-full ${line}`} />
        </span>
        <span className="grid min-w-0 flex-1 grid-cols-2 gap-1 sm:gap-1.5">
          {[0, 1].map((index) => (
            <span key={index} className="flex min-w-0 flex-col gap-1">
              <span className={`min-h-3 flex-1 rounded-md ${dark ? 'bg-[#373737]' : 'bg-[#E8DED0]'}`} />
              <span className={`h-1 w-4/5 rounded-full ${line}`} />
              <span className={`h-1 w-1/2 rounded-full ${line}`} />
            </span>
          ))}
        </span>
      </span>
    </span>
  );
}

export default function GeneralSection({ onThemeChange, showHeading = true } = {}) {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const groupId = useId();
  const reduceMotion = useReducedMotion();

  return (
    <div className="flex flex-col gap-6 animate-fadeIn px-4">
      {showHeading && (
        <div className="border-b border-[#EFECE6] pb-3 dark:border-white/10">
          <h2 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1]">การแสดงผลและธีม</h2>
        </div>
      )}

      <SettingCard title="ธีม">
        <fieldset className="min-w-0 p-3 sm:p-5">
          <legend className="sr-only">เลือกธีม TubeLock</legend>
          <LayoutGroup id={groupId}>
            <div className="isolate grid grid-cols-3 gap-2 sm:gap-3">
              {THEME_OPTIONS.map(({ id, title, icon: Icon }) => {
                const selected = theme === id;
                return (
                  <label key={id} className="relative block min-w-0 cursor-pointer">
                    <input
                      type="radio"
                      name={groupId}
                      value={id}
                      checked={selected}
                      onChange={(event) => {
                        const bounds = event.currentTarget.closest('label')?.getBoundingClientRect();
                        const origin = bounds && {
                          x: bounds.left + bounds.width / 2,
                          y: bounds.top + bounds.height / 2,
                        };
                        setTheme(id, { origin });
                        onThemeChange?.(id);
                      }}
                      aria-describedby={id === 'auto' ? `${groupId}-auto-description` : undefined}
                      className="peer sr-only"
                    />
                    <span className={`flex h-full flex-col gap-2 rounded-xl border border-[#E8E2D9] p-1.5 transition-colors peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-[#FF7A00] motion-reduce:transition-none sm:gap-3 sm:p-2.5 dark:border-white/10 ${selected
                      ? 'bg-[#FFF8F0] dark:bg-[#28211B]'
                      : 'bg-[#FCFAF7] hover:border-[#BEB3A4] dark:bg-[#1E1E1E] dark:hover:border-white/30'
                      }`}>
                      {selected && (
                        <motion.span
                          aria-hidden="true"
                          layoutId={reduceMotion ? undefined : 'theme-outline'}
                          transition={{ layout: selectionSpring }}
                          className="pointer-events-none absolute inset-0 z-10 rounded-xl border border-[#C55700] shadow-[0_0_18px_#FF7A001C] motion-reduce:transform-none! dark:border-[#FF963D] dark:shadow-[0_0_18px_#FF7A0026]"
                        />
                      )}
                      <span aria-hidden="true" className="relative flex h-14 overflow-hidden rounded-md border border-black/10 sm:h-24 sm:rounded-lg dark:border-white/10">
                        {id === 'auto' ? (
                          <>
                            <PreviewWindow />
                            <span className="w-px shrink-0 bg-[#80786F]" />
                            <PreviewWindow dark />
                          </>
                        ) : (
                          <PreviewWindow dark={id === 'dark'} />
                        )}
                        {!reduceMotion && (
                          <motion.span
                            initial={false}
                            animate={selected
                              ? { x: ['-120%', '240%'], opacity: [0, 0.72, 0] }
                              : { x: '-120%', opacity: 0 }}
                            transition={{ duration: selected ? 0.55 : 0, ease: 'easeOut' }}
                            className="pointer-events-none absolute inset-y-0 -left-1/4 w-3/5 motion-reduce:hidden"
                          >
                            <span className="block h-full w-full -skew-x-12 bg-gradient-to-r from-transparent via-[#FFDAB0]/80 to-transparent" />
                          </motion.span>
                        )}
                      </span>
                      <span className="flex min-h-6 items-center justify-center gap-2 pb-0.5 text-center sm:justify-start sm:px-1 sm:text-left">
                        <Icon aria-hidden="true" className="hidden size-4 shrink-0 text-[#756C62] sm:block dark:text-[#AEAAA4]" />
                        <span className="text-xs font-semibold text-[#212529] sm:flex-1 sm:text-sm dark:text-[#F1F1F1]">{title}</span>
                        {selected && (
                          <motion.span
                            aria-hidden="true"
                            layoutId={reduceMotion ? undefined : 'theme-check'}
                            transition={{ layout: selectionSpring }}
                            className="absolute top-2 right-2 z-20 grid size-4 shrink-0 place-items-center rounded-full bg-[#B34E00] text-white motion-reduce:transform-none! sm:relative sm:inset-auto sm:size-5 dark:bg-[#FF963D] dark:text-[#231305]"
                          >
                            <Check className="size-3 sm:size-3.5" strokeWidth={2.5} />
                          </motion.span>
                        )}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </LayoutGroup>
          <p id={`${groupId}-auto-description`} aria-live="polite" className="mt-3 text-xs leading-relaxed text-[#6F665D] dark:text-[#B7B0A8]">
            {theme === 'auto' ? (
              <>ตามธีมของอุปกรณ์ · ตอนนี้แสดง <strong className="font-semibold text-[#3A352F] dark:text-[#F1F1F1]">{resolvedTheme === 'dark' ? 'โหมดมืด' : 'โหมดสว่าง'}</strong></>
            ) : 'เลือก “ตามระบบ” เพื่อให้ธีมเปลี่ยนตามอุปกรณ์'}
          </p>
        </fieldset>
      </SettingCard>

      <SettingCard title="ภาษาและภูมิภาค">
        <SettingRow title="ภาษาของระบบ" description="ภาษาที่แสดงผลในเมนูและคำแนะนำการใช้งาน">
          <span className="rounded-lg border border-[#EFECE6] bg-[#F5F2EB] px-2.5 py-1 text-xs font-bold text-[#212529] dark:border-white/10 dark:bg-white/5 dark:text-[#F1F1F1]">
            ภาษาไทย (TH)
          </span>
        </SettingRow>
      </SettingCard>
    </div>
  );
}

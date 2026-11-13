'use client';

import { Check } from 'lucide-react';

const STEPS = [
  { id: 1, label: 'รายละเอียด' },
  { id: 2, label: 'ซับไตเติล & AI' },
  { id: 3, label: 'เรตติ้ง' },
  { id: 4, label: 'ตรวจสอบ & เผยแพร่' },
];

export default function StepIndicator({ activeStep, setActiveStep, stepStatus = {} }) {
  return (
    <div className="w-full">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        {STEPS.map((step) => {
          const isActive = activeStep === step.id;
          const info = stepStatus[step.id] || {};
          const isCompleted = Boolean(info.completed);
          const statusText =
            info.statusText ||
            (isActive ? 'กำลังดูขั้นตอนนี้' : isCompleted ? 'เสร็จแล้ว' : 'รอดำเนินการ');

          return (
            <button
              key={step.id}
              type="button"
              onClick={() => setActiveStep(step.id)}
              className={`relative flex items-center gap-3 px-3.5 py-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                isActive
                  ? 'bg-white dark:bg-[#181818] border-[#FF7A00] ring-3 ring-[#FF7A00]/15'
                  : isCompleted
                  ? 'bg-white dark:bg-[#181818] border-emerald-500/35 hover:border-emerald-500/60'
                  : 'bg-white dark:bg-[#181818] border-[#EFECE6] dark:border-white/10 hover:border-[#D5CFC5] dark:hover:border-white/20'
              }`}
            >
              <div
                className={`w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  isActive
                    ? 'bg-[#FF7A00] text-white'
                    : isCompleted
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'bg-[#F4F0E8] dark:bg-[#222222] text-[#8C857B] dark:text-[#9A9A9A]'
                }`}
              >
                {isCompleted && !isActive ? (
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                ) : (
                  step.id
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div
                  className={`text-xs sm:text-[13px] font-semibold truncate ${
                    isActive
                      ? 'text-[#212529] dark:text-[#F1F1F1]'
                      : 'text-[#212529] dark:text-[#E4E4E7]'
                  }`}
                >
                  {step.label}
                </div>
                <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] truncate mt-0.5">
                  {statusText}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

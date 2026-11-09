'use client';

import { Check, FileText, Subtitles, ShieldAlert, Rocket } from 'lucide-react';

const STEPS = [
  { id: 1, label: 'รายละเอียด', sublabel: 'Details', icon: FileText },
  { id: 2, label: 'คำบรรยาย & AI', sublabel: 'Subtitles & AI', icon: Subtitles },
  { id: 3, label: 'เรตเนื้อหา & Vision', sublabel: 'Rating & Vision', icon: ShieldAlert },
  { id: 4, label: 'สรุปและเผยแพร่', sublabel: 'Summary & Publish', icon: Rocket },
];

export default function StepIndicator({ activeStep, setActiveStep, stepStatus = {} }) {
  return (
    <div className="w-full bg-[#141414] border border-[#262626] rounded-2xl p-2.5 sm:p-4 mb-6 shadow-xl">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
        {STEPS.map((step) => {
          const Icon = step.icon;
          const isActive = activeStep === step.id;
          const isCompleted = stepStatus[step.id]?.completed;
          const isOptional = stepStatus[step.id]?.optional;

          return (
            <button
              key={step.id}
              type="button"
              onClick={() => setActiveStep(step.id)}
              className={`relative flex items-center gap-3 p-3 rounded-xl transition-all duration-200 text-left cursor-pointer group ${
                isActive
                  ? 'bg-gradient-to-r from-[#ea580c]/15 to-[#f97316]/10 border border-[#f97316]/50 shadow-lg shadow-[#ea580c]/10'
                  : 'bg-[#181818]/60 hover:bg-[#1f1f1f] border border-[#262626] hover:border-[#383838]'
              }`}
            >
              {/* Step Number / Icon Badge */}
              <div
                className={`w-9 h-9 shrink-0 rounded-lg flex items-center justify-center font-semibold text-xs transition-colors ${
                  isActive
                    ? 'bg-[#f97316] text-white shadow-md shadow-[#f97316]/30'
                    : isCompleted
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                    : 'bg-[#262626] text-[#A1A1AA] group-hover:text-[#F1F1F1] group-hover:bg-[#333333]'
                }`}
              >
                {isCompleted && !isActive ? (
                  <Check className="w-4 h-4 stroke-[2.5]" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
              </div>

              {/* Step Text */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-mono text-[#71717A]">
                    0{step.id}
                  </span>
                  {isOptional && !isCompleted && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-[#262626] text-[#A1A1AA] font-mono">
                      OPT
                    </span>
                  )}
                  {isCompleted && (
                    <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/60 text-emerald-400 font-mono border border-emerald-800/40">
                      OK
                    </span>
                  )}
                </div>
                <div
                  className={`text-xs sm:text-sm font-medium truncate ${
                    isActive
                      ? 'text-[#f97316] font-semibold'
                      : 'text-[#E4E4E7] group-hover:text-white'
                  }`}
                >
                  {step.label}
                </div>
              </div>

              {/* Active Indicator Underline for mobile/desktop */}
              {isActive && (
                <div className="absolute -bottom-1 left-3 right-3 h-[2px] bg-gradient-to-r from-[#ea580c] to-[#f97316] rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

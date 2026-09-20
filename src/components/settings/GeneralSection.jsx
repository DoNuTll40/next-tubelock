'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import SettingCard from '@/components/ui/SettingCard';
import SettingRow from '@/components/ui/SettingRow';
import { Sun, Moon, Monitor, CheckCircle2, Sparkles, ShieldCheck } from 'lucide-react';

const THEME_OPTIONS = [
  {
    id: 'light',
    title: 'โหมดสว่าง (Light)',
    subtitle: 'สว่าง สดใส สบายตา',
    desc: 'โทนสีครีมเอกลักษณ์ของ TubeLock เหมาะกับสภาพแวดล้อมที่มีแสงสว่าง',
    icon: Sun,
    bgPreview: 'bg-[#FBF9F5]',
    borderPreview: 'border-[#EFECE6]',
    textPreview: 'text-[#212529]',
    subTextPreview: 'text-[#8C857B]',
    chipBg: 'bg-[#EFECE6]',
  },
  {
    id: 'dark',
    title: 'โหมดมืด (Dark)',
    subtitle: 'มืดสนิท ถนอมสายตา',
    desc: 'พื้นหลังสีดำเข้มแบบ YouTube OLED (#0F0F0F) ช่วยประหยัดแบตเตอรี่',
    icon: Moon,
    bgPreview: 'bg-[#0F0F0F]',
    borderPreview: 'border-white/10',
    textPreview: 'text-[#F1F1F1]',
    subTextPreview: 'text-[#888888]',
    chipBg: 'bg-[#222222]',
  },
  {
    id: 'auto',
    title: 'ตามระบบ (Auto)',
    subtitle: 'ปรับตามอุปกรณ์อัตโนมัติ',
    desc: 'สลับระหว่างโหมดมืดและสว่างตามการตั้งค่าของ Windows / macOS / มือถือ',
    icon: Monitor,
    bgPreview: 'bg-gradient-to-r from-[#FBF9F5] to-[#0F0F0F]',
    borderPreview: 'border-[#FF7A00]/30',
    textPreview: 'text-[#FF7A00]',
    subTextPreview: 'text-[#8C857B]',
    chipBg: 'bg-[#FF7A00]/10',
  },
];

export default function GeneralSection() {
  const { theme, resolvedTheme, setTheme } = useTheme();

  return (
    <div className="flex flex-col gap-6 animate-fadeIn">
      {/* Header */}
      <div className="pb-2 border-b border-[#EFECE6] dark:border-white/10">
        <div className="flex items-center gap-2.5">
          <h2 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1]">การตั้งค่าทั่วไป</h2>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[#FF7A00]/10 text-[#FF7A00] border border-[#FF7A00]/20">
            ระบบ
          </span>
        </div>
        <p className="text-xs text-[#8C857B] dark:text-[#AAAAAA] mt-1">
          ปรับแต่งธีมการแสดงผล รูปลักษณ์ และการควบคุมระบบพื้นฐานของ TubeLock
        </p>
      </div>

      {/* Theme Selection Section */}
      <SettingCard
        title="ธีมและรูปลักษณ์ (Theme Appearance)"
        subtitle="ระบบจะตรวจเช็คธีมทันทีก่อนเรนเดอร์หน้าเว็บ (Zero FOUC) เพื่อป้องกันหน้าจอกะพริบ"
      >
        <div className="p-4 sm:p-5 flex flex-col gap-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            {THEME_OPTIONS.map((opt) => {
              const isSelected = theme === opt.id;
              const Icon = opt.icon;

              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setTheme(opt.id)}
                  className={`relative flex flex-col rounded-2xl p-4 text-left transition-all duration-200 cursor-pointer border ${
                    isSelected
                      ? 'border-[#FF7A00] bg-[#FFF8F2] dark:bg-[#FF7A00]/10 shadow-[0_4px_16px_rgba(255,122,0,0.18)] ring-2 ring-[#FF7A00]/30'
                      : 'border-[#EFECE6] dark:border-white/10 bg-white dark:bg-[#181818] hover:border-[#D5CFC5] dark:hover:border-white/20 hover:shadow-xs'
                  }`}
                >
                  {/* Top: Icon & Checkmark */}
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${
                        isSelected
                          ? 'bg-[#FF7A00] text-white shadow-xs'
                          : 'bg-[#F5F2EB] dark:bg-white/5 text-[#8C857B] dark:text-[#AAAAAA]'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                    </div>

                    {isSelected && (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-[#FF7A00] bg-white dark:bg-[#0F0F0F] px-2 py-0.5 rounded-full shadow-2xs border border-[#FF7A00]/30">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        เลือกอยู่
                      </span>
                    )}
                  </div>

                  {/* Visual Preview Box */}
                  <div className={`w-full h-16 rounded-xl border mb-3 overflow-hidden p-2 flex flex-col justify-between ${opt.bgPreview} ${opt.borderPreview}`}>
                    <div className="flex items-center justify-between">
                      <div className="w-4 h-1.5 rounded-full bg-[#FF7A00]" />
                      <div className={`w-2 h-2 rounded-full ${opt.chipBg}`} />
                    </div>
                    <div className="space-y-1">
                      <div className={`w-2/3 h-1.5 rounded-full ${opt.chipBg}`} />
                      <div className={`w-1/2 h-1.5 rounded-full ${opt.chipBg} opacity-60`} />
                    </div>
                  </div>

                  {/* Title & Description */}
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-[#212529] dark:text-[#F1F1F1] flex items-center gap-1.5">
                      {opt.title}
                    </span>
                    <span className="text-[11px] font-medium text-[#FF7A00] mt-0.5">
                      {opt.subtitle}
                    </span>
                    <p className="text-[11px] text-[#8C857B] dark:text-[#888888] mt-1.5 leading-relaxed">
                      {opt.desc}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>

          {/* Dynamic Active Theme Status Banner */}
          <div className="mt-2 p-3.5 rounded-xl bg-[#FBF9F5] dark:bg-white/5 border border-[#EFECE6] dark:border-white/10 flex items-center justify-between text-xs">
            <div className="flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-[#FF7A00] shrink-0" />
              <span className="text-[#3A352F] dark:text-[#CCCCCC]">
                สถานะการแสดงผลปัจจุบัน:
                <strong className="text-[#FF7A00] ml-1.5">
                  {resolvedTheme === 'dark' ? 'โหมดมืด (Dark Mode)' : 'โหมดสว่าง (Light Mode)'}
                </strong>
                {theme === 'auto' && (
                  <span className="text-[#8C857B] dark:text-[#888888] text-[11px] ml-1">
                    (ตรวจจับจากระบบ OS)
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              <span>ตรวจเช็คก่อน Render (No Flash)</span>
            </div>
          </div>
        </div>
      </SettingCard>

      {/* System Preferences Card */}
      <SettingCard title="พารามิเตอร์และการนำทาง">
        <SettingRow
          title="ทางลัดหน้าตั้งค่า (Direct URL Tab)"
          description="สามารถเข้าถึงแท็บนี้โดยตรงผ่าน URL: /settings?general ได้ตลอดเวลา"
        >
          <code className="px-2.5 py-1 rounded-lg bg-[#F5F2EB] dark:bg-white/5 text-[#FF7A00] font-mono text-[11px] font-bold border border-[#EFECE6] dark:border-white/10">
            /settings?general
          </code>
        </SettingRow>

        <SettingRow
          title="ภาษาของระบบ (Interface Language)"
          description="ภาษาที่แสดงผลในเมนูและคำแนะนำการใช้งาน"
        >
          <span className="text-xs font-bold text-[#212529] dark:text-[#F1F1F1] px-2.5 py-1 rounded-lg bg-[#F5F2EB] dark:bg-white/5 border border-[#EFECE6] dark:border-white/10">
            ภาษาไทย (TH)
          </span>
        </SettingRow>
      </SettingCard>
    </div>
  );
}

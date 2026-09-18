'use client';

import React from 'react';
import SettingCard from '@/components/ui/SettingCard';
import SettingRow from '@/components/ui/SettingRow';
import Select from '@/components/ui/Select';
import { User, ChevronRight, Check } from 'lucide-react';

const FALLBACK_OPTIONS = [
  { label: 'Mystery Person (เงาสีเทา)', value: 'mp' },
  { label: 'Identicon (ลายเรขาคณิต)', value: 'identicon' },
  { label: 'Retro (ภาพ 8-bit)', value: 'retro' },
  { label: 'RoboHash (หุ่นยนต์)', value: 'robohash' },
];

export default function AccountSection({
  gravatarEmail,
  setGravatarEmail,
  gravatarHash,
  fallbackAvatar,
  setFallbackAvatar,
  openActionSheet,
}) {
  return (
    <div className="flex flex-col gap-6 animate-fadeIn">
      {/* YouTube Account Header (Screenshot 4) */}
      <div className="pb-2 border-b border-[#EFECE6]">
        <h2 className="text-xl font-bold text-[#212529]">บัญชีและโปรไฟล์</h2>
        <p className="text-xs text-[#8C857B] mt-1">
          เลือกลักษณะการแสดงตัวและสิ่งที่คุณเห็นใน TubeLock
        </p>
        <span className="inline-block mt-1 text-xs font-medium text-[#FF7A00]">
          {gravatarEmail || 'ยังไม่ได้ระบุอีเมล'}
        </span>
      </div>

      {/* Profile Overview Card */}
      <div className="bg-white rounded-2xl border border-[#EFECE6] p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-[#FBF9F5] border-2 border-[#EFECE6] shrink-0 shadow-inner">
            <img
              src={gravatarHash ? `https://www.gravatar.com/avatar/${gravatarHash}?d=${fallbackAvatar}&s=160` : `https://www.gravatar.com/avatar/?d=${fallbackAvatar}&s=160`}
              alt="Preview"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold text-[#212529]">ภาพโปรไฟล์ของคุณ</span>
            <span className="text-xs text-[#8C857B] font-mono truncate mt-0.5">
              {gravatarHash ? `SHA-256: ${gravatarHash.substring(0, 20)}...` : 'ยังไม่มีอีเมลผูกไว้'}
            </span>
            <span className="text-[11px] text-emerald-600 font-semibold mt-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              ซิงก์ภาพสากลจาก Gravatar
            </span>
          </div>
        </div>
      </div>

      {/* Account Settings Card */}
      <SettingCard title="การตั้งค่าโปรไฟล์" subtitle="ข้อมูลสำหรับเชื่อมต่อ Gravatar อัตโนมัติ">
        {/* Gravatar Email Row */}
        <div className="p-4 sm:p-5 flex flex-col gap-2">
          <label className="text-xs font-bold text-[#212529]">Gravatar Email</label>
          <input
            type="email"
            value={gravatarEmail}
            onChange={(e) => setGravatarEmail(e.target.value)}
            onBlur={() => {
              localStorage.setItem('pt_gravatar_email', gravatarEmail.trim());
              window.dispatchEvent(new Event('storage'));
            }}
            placeholder="name@example.com"
            className="w-full px-4 py-2.5 bg-[#FBF9F5] hover:bg-white focus:bg-white border border-[#E5DFD5] hover:border-[#D5CFC5] focus:border-[#FF7A00] focus:ring-3 focus:ring-[#FF7A00]/15 rounded-xl text-xs text-[#212529] transition-all outline-none"
          />
          <span className="text-[11px] text-[#8C857B]">
            เมื่อระบุอีเมล ระบบจะแปลงเป็น SHA-256 Hash เพื่อดึงรูปโปรไฟล์มาแสดงบน Navbar และมุมขวาบน
          </span>
        </div>

        {/* Fallback Selector Row */}
        <SettingRow
          title="รูปแบบภาพสำรอง (Fallback Style)"
          description="ภาพกราฟิกที่จะแสดงอัตโนมัติหากอีเมลที่ระบุไม่มีบัญชี Gravatar"
        >
          {/* Desktop Custom Dropdown */}
          <div className="hidden sm:block">
            <Select
              options={FALLBACK_OPTIONS}
              value={fallbackAvatar}
              onChange={(val) => {
                setFallbackAvatar(val);
                localStorage.setItem('pt_fallback_avatar', val);
                window.dispatchEvent(new Event('storage'));
              }}
            />
          </div>

          {/* Mobile Sheet Trigger */}
          <button
            type="button"
            onClick={() =>
              openActionSheet({
                title: 'รูปแบบภาพสำรอง (Fallback)',
                current: fallbackAvatar,
                options: FALLBACK_OPTIONS,
                onSelect: (val) => {
                  setFallbackAvatar(val);
                  localStorage.setItem('pt_fallback_avatar', val);
                  window.dispatchEvent(new Event('storage'));
                },
              })
            }
            className="sm:hidden flex items-center gap-1 text-xs font-semibold text-[#FF7A00]"
          >
            <span>{FALLBACK_OPTIONS.find((o) => o.value === fallbackAvatar)?.label || fallbackAvatar}</span>
            <ChevronRight className="w-4 h-4 text-[#8C857B]" />
          </button>
        </SettingRow>
      </SettingCard>
    </div>
  );
}

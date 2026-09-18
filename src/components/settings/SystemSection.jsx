'use client';

import React from 'react';
import SettingCard from '@/components/ui/SettingCard';
import SettingRow from '@/components/ui/SettingRow';
import { Trash2, AlertTriangle } from 'lucide-react';

export default function SystemSection({ handleClearHistory, handleFactoryReset }) {
  return (
    <div className="flex flex-col gap-6 animate-fadeIn">
      <div className="pb-2 border-b border-[#EFECE6]">
        <h2 className="text-xl font-bold text-[#212529]">ข้อมูลและความเป็นส่วนตัว</h2>
        <p className="text-xs text-[#8C857B] mt-1">
          จัดการประวัติการรับชม ตำแหน่งเวลาที่ค้างไว้ และแคชของระบบ
        </p>
      </div>

      <SettingCard title="การจัดการข้อมูลแคช">
        <SettingRow
          title="ล้างประวัติการรับชม (Clear Watch History)"
          description="รีเซ็ตตำแหน่งเวลาดูค้างไว้ของทุกวิดีโอในเครื่อง ให้เริ่มเล่นใหม่ตั้งแต่ 00:00"
          onClick={handleClearHistory}
          isClickable={true}
        >
          <button
            type="button"
            onClick={handleClearHistory}
            className="px-3.5 py-1.5 rounded-xl bg-[#F5F2EB] hover:bg-[#EFECE6] text-[#212529] text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#8C857B]" />
            <span>ล้างประวัติ</span>
          </button>
        </SettingRow>

        <SettingRow
          title="รีเซ็ตระบบทั้งหมด (Factory Reset)"
          description="ล้างโทเค็นการเข้าถึง OneDrive ข้อมูล Gravatar และการตั้งค่าทั้งหมดในเบราว์เซอร์นี้"
          onClick={handleFactoryReset}
          isClickable={true}
        >
          <button
            type="button"
            onClick={handleFactoryReset}
            className="px-3.5 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 border border-rose-200"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
            <span>รีเซ็ตระบบ</span>
          </button>
        </SettingRow>
      </SettingCard>
    </div>
  );
}

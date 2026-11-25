'use client';

import React from 'react';
import { savePosterPreference } from '@/lib/posterPreference';
import { useSession } from '@/context/SessionContext';
import SettingCard from '@/components/ui/SettingCard';
import SettingRow from '@/components/ui/SettingRow';
import Switch from '@/components/ui/Switch';
import { Trash2, AlertTriangle, ShieldAlert } from 'lucide-react';

export default function SystemSection({
  allow18Plus,
  setAllow18Plus,
  handleClearHistory,
  handleFactoryReset,
}) {
  const isLoggedIn = Boolean(useSession());

  const [local18Plus, setLocal18Plus] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem('tubelock_allow_18plus') === '1';
    } catch {
      return false;
    }
  });

  const current18Plus = allow18Plus !== undefined ? allow18Plus : local18Plus;

  const handle18PlusChange = (checked) => {
    if (!isLoggedIn) return;
    if (setAllow18Plus) {
      setAllow18Plus(checked);
    } else {
      setLocal18Plus(checked);
    }
    try {
      savePosterPreference(checked);
    } catch (_) { }
  };

  return (
    <div className="flex flex-col gap-6 animate-fadeIn px-4">
      <div className="pb-2 border-b border-[#EFECE6] dark:border-white/10">
        <h2 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1]">ความเป็นส่วนตัวและความปลอดภัย</h2>
        <p className="text-xs text-[#8C857B] dark:text-[#AAAAAA] mt-1">
          ควบคุมการแสดงผลเนื้อหาจำกัดอายุ 18+ จัดการประวัติการรับชม และข้อมูลแคชในเครื่อง
        </p>
      </div>

      {/* Content Safety & 18+ Filter Card */}
      <SettingCard
        title="ความปลอดภัยและการควบคุมเนื้อหา (Content Safety)"
        subtitle="จัดการการแสดงภาพปกวิดีโอที่มีเรตติ้ง 18+ หรือเนื้อหาเฉพาะผู้ใหญ่"
      >
        <SettingRow
          title="แสดงภาพปกเนื้อหา 18+ และหมวดผู้ใหญ่ (Adult Content Display)"
          description={isLoggedIn
            ? 'เปิดเพื่อแสดงภาพปกจริงของคลิป 18+ โดยอัตโนมัติในทุกหน้า ซิงก์กับบัญชีของคุณอัตโนมัติและปิดไว้โดยค่าเริ่มต้น'
            : 'เข้าสู่ระบบก่อนจึงจะสามารถเปิดแสดงภาพปกเนื้อหา 18+ หรือกดดูภาพปกบนการ์ดวิดีโอได้'}
        >
          <Switch
            checked={isLoggedIn && current18Plus}
            onChange={handle18PlusChange}
            disabled={!isLoggedIn}
          />
        </SettingRow>

        <div className="p-3.5 bg-[#FFF8F2] dark:bg-[#FF7A00]/10 border-t border-[#EFECE6] dark:border-white/10 flex items-start gap-2.5 text-xs">
          <ShieldAlert className="w-4 h-4 text-[#FF7A00] shrink-0 mt-0.5" />
          <span className="text-[#8C857B] dark:text-[#CCCCCC] leading-relaxed">
            {isLoggedIn
              ? 'เมื่อปิด ระบบจะแสดงหน้ากากจำกัดอายุ 18+ คุณยังเลือกกดดูภาพปกจริงเป็นรายคลิปได้จากการ์ดวิดีโอ'
              : 'ผู้ชมที่ยังไม่ได้เข้าสู่ระบบจะเห็นเฉพาะหน้ากากจำกัดอายุ 18+ และไม่สามารถกดแสดงภาพปกจริงได้'}
          </span>
        </div>
      </SettingCard>

      {/* Cache & Local History Management */}
      <SettingCard title="ประวัติการรับชมและข้อมูลแคชในเครื่อง">
        <SettingRow
          title="ล้างจุดเล่นค้างในเครื่อง (Clear Local Resume)"
          description="รีเซ็ตตำแหน่งเวลาดูค้างไว้ของทุกวิดีโอในเบราว์เซอร์นี้ ให้เริ่มเล่นใหม่ตั้งแต่ 00:00"
          onClick={handleClearHistory}
          isClickable={true}
        >
          <button
            type="button"
            onClick={handleClearHistory}
            className="px-3.5 py-1.5 rounded-xl bg-[#F5F2EB] dark:bg-white/10 hover:bg-[#EFECE6] dark:hover:bg-white/15 text-[#212529] dark:text-[#F1F1F1] text-xs font-semibold transition cursor-pointer flex items-center gap-1.5"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#8C857B] dark:text-[#AAAAAA]" />
            <span>ล้างประวัติ</span>
          </button>
        </SettingRow>

        <SettingRow
          title="รีเซ็ตการตั้งค่าทั้งหมด (Factory Reset)"
          description="ล้างแคชและการตั้งค่าทั้งหมดที่บันทึกไว้ในเบราว์เซอร์นี้กลับสู่ค่าเริ่มต้น"
          onClick={handleFactoryReset}
          isClickable={true}
        >
          <button
            type="button"
            onClick={handleFactoryReset}
            className="px-3.5 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 border border-rose-200 dark:border-rose-900/50"
          >
            <AlertTriangle className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" />
            <span>รีเซ็ตระบบ</span>
          </button>
        </SettingRow>
      </SettingCard>
    </div>
  );
}

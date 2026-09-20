'use client';

import React from 'react';
import SettingCard from '@/components/ui/SettingCard';
import SettingRow from '@/components/ui/SettingRow';
import Switch from '@/components/ui/Switch';
import { HardDrive, Cloud, Info } from 'lucide-react';

export default function StorageSection({
  targetFolder,
  setTargetFolder,
  scanSubfolders,
  setScanSubfolders,
  videoCount,
  totalSizeGB,
}) {
  return (
    <div className="flex flex-col gap-6 animate-fadeIn">
      <div className="pb-2 border-b border-[#EFECE6] dark:border-white/10">
        <h2 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1]">พื้นที่จัดเก็บและ OneDrive</h2>
        <p className="text-xs text-[#8C857B] dark:text-[#AAAAAA] mt-1">
          ตั้งค่าโฟลเดอร์หลักสำหรับจัดเก็บไฟล์ HLS, สแกนโฟลเดอร์ย่อย และสรุปสถานะคลังสื่อ
        </p>
      </div>

      {/* Overview Stat Card */}
      <div className="p-5 rounded-2xl bg-[#FFF4EB] dark:bg-[#FF7A00]/10 border border-[#FF7A00]/20 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-xl bg-[#FF7A00] text-white flex items-center justify-center shadow-md">
            <HardDrive className="w-6 h-6" />
          </div>
          <div>
            <div className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1]">คลังสื่อวิดีโอในระบบ</div>
            <div className="text-xs text-[#8C857B] dark:text-[#AAAAAA] mt-0.5">เชื่อมต่อผ่าน Neon Serverless PostgreSQL</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-base font-extrabold text-[#FF7A00] font-mono">{videoCount} คลิป</div>
          <div className="text-xs text-[#8C857B] dark:text-[#AAAAAA] font-mono font-medium">{totalSizeGB} GB รวม</div>
        </div>
      </div>

      <SettingCard title="การเชื่อมต่อ OneDrive Cloud">
        <div className="p-4 sm:p-5 flex flex-col gap-2">
          <label className="text-xs font-bold text-[#212529] dark:text-[#F1F1F1]">Target Root Folder บน OneDrive</label>
          <input
            type="text"
            value={targetFolder}
            onChange={(e) => setTargetFolder(e.target.value)}
            placeholder="/Videos"
            className="w-full px-4 py-2.5 bg-[#FBF9F5] dark:bg-[#141414] border border-[#EFECE6] dark:border-white/10 rounded-xl text-xs font-mono text-[#212529] dark:text-[#F1F1F1] focus:outline-none focus:border-[#FF7A00]"
          />
          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">
            ระบบจะสแกนหาโฟลเดอร์ที่มีไฟล์ Master Playlist (<code className="px-1 py-0.5 rounded bg-[#F5F2EB] dark:bg-white/10">.m3u8</code>) และ Segments (<code className="px-1 py-0.5 rounded bg-[#F5F2EB] dark:bg-white/10">.ts</code>) เพื่อนำมาสตรีม
          </span>
        </div>

        <SettingRow
          title="สแกนโฟลเดอร์ย่อยลึก (Recursive Subfolders)"
          description="ค้นหาไฟล์วิดีโอที่อยู่ลึกลงไปในไดเรกทอรีย่อยทั้งหมด"
        >
          <Switch
            checked={scanSubfolders}
            onChange={() => setScanSubfolders(!scanSubfolders)}
          />
        </SettingRow>
      </SettingCard>
    </div>
  );
}

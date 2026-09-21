'use client';

import React from 'react';
import { Sliders, User, PlayCircle, Folder, Database, LifeBuoy } from 'lucide-react';

export const SETTING_TABS = [
  { id: 'general', label: 'ทั่วไปและธีม', icon: Sliders, desc: 'ธีมมืด/สว่าง และลักษณะทั่วไป' },
  { id: 'account', label: 'บัญชีและโปรไฟล์', icon: User, desc: 'Gravatar และการยืนยันตัวตน' },
  { id: 'player', label: 'การเล่นและตัวเล่น', icon: PlayCircle, desc: 'ความเร็ว, สัดส่วน และ HUD' },
  { id: 'onedrive', label: 'พื้นที่จัดเก็บ OneDrive', icon: Folder, desc: 'โฟลเดอร์สื่อ และขนาดคลัง' },
  { id: 'system', label: 'ข้อมูลและความเป็นส่วนตัว', icon: Database, desc: 'ประวัติรับชม และแคชระบบ' },
  { id: 'support', label: 'ช่วยเหลือและติดต่อ', icon: LifeBuoy, desc: 'FAQ, รายงานปัญหา และเวอร์ชัน' },
];

export default function SettingsSidebar({ activeTab, onSelectTab }) {
  return (
    <nav className="w-64 shrink-0 flex flex-col gap-1 select-none">
      <div className="px-3 pb-3 mb-1 border-b border-[#EFECE6] dark:border-white/10">
        <h1 className="text-xl font-black text-[#212529] dark:text-[#F1F1F1] tracking-tight">การตั้งค่า</h1>
        <p className="text-[11px] text-[#8C857B] dark:text-[#AAAAAA] mt-0.5">จัดการระบบ TubeLock Studio</p>
      </div>

      <div className="flex flex-col gap-1">
        {SETTING_TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-xs font-semibold transition-all text-left cursor-pointer ${
                isActive
                  ? 'bg-[#FFF2E5] dark:bg-[#FF7A00]/15 text-[#FF7A00] font-bold shadow-2xs border-l-3 border-[#FF7A00]'
                  : 'text-[#3A352F] dark:text-[#CCCCCC] hover:bg-[#EFECE6] dark:hover:bg-white/5'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#FF7A00]' : 'text-[#8C857B] dark:text-[#888888]'}`} />
              <div className="flex flex-col min-w-0">
                <span className="truncate leading-none">{tab.label}</span>
                <span className={`text-[10px] mt-1 font-normal truncate ${isActive ? 'text-[#D96800] dark:text-[#FF9D42]' : 'text-[#8C857B] dark:text-[#888888]'}`}>
                  {tab.desc}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

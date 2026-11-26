'use client';

import { LayoutGroup } from 'framer-motion';
import { Sliders, User, AtSign, PlayCircle, Folder, ShieldCheck, LifeBuoy } from 'lucide-react';
import { AnimatedTabIndicator } from '@/components/ui/AnimatedTabs';

export const SETTING_GROUPS = [
  {
    id: 'account-group',
    label: 'บัญชีและช่อง',
    tabs: [
      { id: 'account', label: 'บัญชีและความปลอดภัย', icon: User, desc: 'OAuth และอุปกรณ์ที่เข้าสู่ระบบ' },
      { id: 'channel', label: 'ช่องของฉัน (@handle)', icon: AtSign, desc: 'ตั้งชื่อ @handle, Bio และแบนเนอร์' },
    ],
  },
  {
    id: 'experience-group',
    label: 'การรับชมและตัวเล่น',
    tabs: [
      { id: 'general', label: 'การแสดงผลและธีม', icon: Sliders, desc: 'ธีมมืด/สว่าง และภาษา' },
      { id: 'player', label: 'การเล่นและตัวเล่น', icon: PlayCircle, desc: 'ความเร็ว, สัดส่วน, เสียง และ HUD' },
    ],
  },
  {
    id: 'privacy-storage-group',
    label: 'ความเป็นส่วนตัวและคลัง',
    tabs: [
      { id: 'system', label: 'ความเป็นส่วนตัวและความปลอดภัย', icon: ShieldCheck, desc: 'เนื้อหา 18+, ประวัติ และแคช' },
      { id: 'onedrive', label: 'พื้นที่จัดเก็บ OneDrive', icon: Folder, desc: 'ความจุคลาวด์ และคลัง HLS' },
    ],
  },
  {
    id: 'about-group',
    label: 'เกี่ยวกับระบบ',
    tabs: [
      { id: 'support', label: 'เกี่ยวกับและช่วยเหลือ', icon: LifeBuoy, desc: 'FAQ, Patch Notes และเวอร์ชัน' },
    ],
  },
];

export const SETTING_TABS = SETTING_GROUPS.flatMap((g) => g.tabs);

export default function SettingsSidebar({ id, activeTab, onSelectTab }) {
  return (
    <nav aria-label="การตั้งค่า" className="w-64 shrink-0 flex flex-col gap-3 select-none">
      <div className="px-3 pb-3 border-b border-[#EFECE6] dark:border-white/10">
        <h1 className="text-xl font-black text-[#212529] dark:text-[#F1F1F1] tracking-tight">การตั้งค่า</h1>
        <p className="text-[11px] text-[#8C857B] dark:text-[#AAAAAA] mt-0.5">จัดการระบบ TubeLock</p>
      </div>

      <LayoutGroup id={id}>
        <div className="isolate flex flex-col gap-4">
          {SETTING_GROUPS.map((group) => (
            <div key={group.id} className="flex flex-col gap-1">
              <span className="px-3 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-[#8C857B] dark:text-[#777777]">
                {group.label}
              </span>
              {group.tabs.map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-current={isActive ? 'page' : undefined}
                    onClick={() => onSelectTab(tab.id)}
                    className={`relative w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-colors text-left cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C55700] motion-reduce:transition-none dark:focus-visible:outline-[#FF963D] ${isActive
                      ? 'text-[#873D00] dark:text-[#FFC28B]'
                      : 'text-[#3A352F] dark:text-[#CCCCCC] hover:bg-[#EFECE6] dark:hover:bg-white/5'
                      }`}
                  >
                    {isActive && <AnimatedTabIndicator variant="sidebar" />}
                    <Icon aria-hidden="true" className={`relative z-10 w-4 h-4 shrink-0 ${isActive ? 'text-[#C55700] dark:text-[#FF963D]' : 'text-[#8C857B] dark:text-[#888888]'}`} />
                    <span className="relative z-10 flex flex-col min-w-0">
                      <span className="truncate leading-none">{tab.label}</span>
                      <span className={`text-[10px] mt-1 font-normal truncate ${isActive ? 'text-[#A54B00] dark:text-[#FFB26F]' : 'text-[#8C857B] dark:text-[#888888]'}`}>
                        {tab.desc}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </LayoutGroup>
    </nav>
  );
}

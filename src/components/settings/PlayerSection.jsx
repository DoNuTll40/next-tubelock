'use client';

import React from 'react';
import SettingCard from '@/components/ui/SettingCard';
import SettingRow from '@/components/ui/SettingRow';
import SegmentedControl from '@/components/ui/SegmentedControl';
import Switch from '@/components/ui/Switch';
import { Volume2, ChevronRight } from 'lucide-react';

const SPEED_OPTIONS = [
  { label: '0.75x', value: 0.75 },
  { label: '1.0x', value: 1.0 },
  { label: '1.25x', value: 1.25 },
  { label: '1.5x', value: 1.5 },
  { label: '2.0x', value: 2.0 },
];

const FIT_OPTIONS = [
  { label: 'Fit (ภาพเต็มเฟรม)', value: 'fit' },
  { label: 'Fill (เต็มจอ ครอปข้าง)', value: 'fill' },
];

const SEEK_OPTIONS = [
  { label: '5s', value: 5 },
  { label: '10s', value: 10 },
  { label: '15s', value: 15 },
  { label: '30s', value: 30 },
];

export default function PlayerSection({
  defaultSpeed,
  setDefaultSpeed,
  defaultFit,
  setDefaultFit,
  seekStep,
  setSeekStep,
  volume,
  setVolume,
  autoplay,
  setAutoplay,
  autoStats,
  setAutoStats,
  openActionSheet,
}) {
  return (
    <div className="flex flex-col gap-6 animate-fadeIn px-4">
      <div className="pb-2 border-b border-[#EFECE6] dark:border-white/10">
        <h2 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1]">การเล่นและตัวเล่นวิดีโอ</h2>
        <p className="text-xs text-[#8C857B] dark:text-[#AAAAAA] mt-1">
          กำหนดค่าเริ่มต้นสำหรับเครื่องเล่น HLS, การข้ามเวลา, ระดับเสียง และสถิติ
        </p>
      </div>

      <SettingCard title="พฤติกรรมเริ่มต้นของเครื่องเล่น">
        {/* Playback Speed */}
        <SettingRow
          title="ความเร็วในการเล่นเริ่มต้น (Default Speed)"
          description="ความเร็วที่ตั้งไว้เมื่อเริ่มเปิดคลิปวิดีโอใหม่"
        >
          <div className="hidden sm:block">
            <SegmentedControl
              options={SPEED_OPTIONS}
              value={defaultSpeed}
              onChange={setDefaultSpeed}
            />
          </div>
          <button
            type="button"
            onClick={() =>
              openActionSheet({
                title: 'ความเร็วในการเล่นเริ่มต้น',
                current: defaultSpeed,
                options: SPEED_OPTIONS,
                onSelect: setDefaultSpeed,
              })
            }
            className="sm:hidden flex items-center gap-1 text-xs font-semibold text-[#FF7A00] cursor-pointer"
          >
            <span>{defaultSpeed}x</span>
            <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#AAAAAA]" />
          </button>
        </SettingRow>

        {/* Fit Mode */}
        <SettingRow
          title="สัดส่วนวิดีโอเริ่มต้น (Default Fit)"
          description="การปรับขนาดภาพบนหน้าจอ ให้พอดีเฟรมหรือขยายเต็มจอ"
        >
          <div className="hidden sm:block">
            <SegmentedControl
              options={FIT_OPTIONS}
              value={defaultFit}
              onChange={setDefaultFit}
            />
          </div>
          <button
            type="button"
            onClick={() =>
              openActionSheet({
                title: 'สัดส่วนวิดีโอเริ่มต้น',
                current: defaultFit,
                options: FIT_OPTIONS,
                onSelect: setDefaultFit,
              })
            }
            className="sm:hidden flex items-center gap-1 text-xs font-semibold text-[#FF7A00] cursor-pointer"
          >
            <span>{defaultFit === 'fit' ? 'Fit' : 'Fill'}</span>
            <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#AAAAAA]" />
          </button>
        </SettingRow>

        {/* Seek Step */}
        <SettingRow
          title="แตะสองครั้งเพื่อข้ามเวลา (Seek Step)"
          description="ระยะเวลาที่กระโดดข้ามไปข้างหน้าหรือถอยหลัง"
        >
          <div className="hidden sm:block">
            <SegmentedControl
              options={SEEK_OPTIONS}
              value={seekStep}
              onChange={setSeekStep}
            />
          </div>
          <button
            type="button"
            onClick={() =>
              openActionSheet({
                title: 'แตะสองครั้งเพื่อข้ามเวลา',
                current: seekStep,
                options: SEEK_OPTIONS,
                onSelect: setSeekStep,
              })
            }
            className="sm:hidden flex items-center gap-1 text-xs font-semibold text-[#FF7A00] cursor-pointer"
          >
            <span>{seekStep} วินาที</span>
            <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#AAAAAA]" />
          </button>
        </SettingRow>

        {/* Volume Slider */}
        <div className="p-4 sm:p-5 flex flex-col gap-2">
          <div className="flex justify-between items-center text-xs">
            <span className="font-semibold text-[#212529] dark:text-[#F1F1F1] flex items-center gap-1.5">
              <Volume2 className="w-4 h-4 text-[#FF7A00]" /> ระดับเสียงเริ่มต้น (Volume)
            </span>
            <span className="font-mono font-bold text-[#FF7A00]">{Math.round(volume * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            className="w-full accent-[#FF7A00] cursor-pointer mt-1"
          />
        </div>

        {/* Autoplay */}
        <SettingRow
          title="เล่นอัตโนมัติ (Autoplay Next)"
          description="เล่นคลิปถัดไปทันทีเมื่อวิดีโอปัจจุบันจบลง"
        >
          <Switch
            checked={autoplay}
            onChange={() => setAutoplay(!autoplay)}
          />
        </SettingRow>

        {/* Stats for Nerds */}
        <SettingRow
          title="สถิติสำหรับเด็กเนิร์ด (Stats HUD)"
          description="เปิดแผงข้อมูลเทคนิคแสดง FPS, Bitrate, Codec และ Buffer Health ค้างไว้เสมอ"
        >
          <Switch
            checked={autoStats}
            onChange={() => setAutoStats(!autoStats)}
          />
        </SettingRow>
      </SettingCard>
    </div>
  );
}

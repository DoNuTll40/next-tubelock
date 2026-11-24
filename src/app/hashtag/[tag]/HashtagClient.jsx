'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Hash, Film, Compass } from 'lucide-react';
import VideoCard from '@/components/VideoCard';

function isShortVideo(video) {
  if (!video) return false;
  if (String(video.category || '').toLowerCase() === 'shorts') return true;
  if (Array.isArray(video.tags) && video.tags.some((t) => String(t).toLowerCase() === 'shorts')) return true;
  const dur = Number(video.duration || 0);
  return dur > 0 && dur <= 60;
}

export default function HashtagClient({ tag, initialVideos = [], channelCount = 0 }) {
  const [activeTab, setActiveTab] = useState('all'); // 'all' | 'shorts'

  const shortsCount = useMemo(
    () => initialVideos.filter(isShortVideo).length,
    [initialVideos]
  );

  const visibleVideos = useMemo(() => {
    if (activeTab === 'shorts') {
      return initialVideos.filter(isShortVideo);
    }
    return initialVideos;
  }, [initialVideos, activeTab]);

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#0F0F0F] text-[#0F0F0F] dark:text-[#F1F1F1] pb-24">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 pt-6 sm:pt-8 space-y-6">
        {/* YouTube-Style Hashtag Header */}
        <header className="space-y-2 border-b border-[#EFECE6] dark:border-white/10 pb-0">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[#FF7A00]/15 border border-[#FF7A00]/30 flex items-center justify-center text-[#FF7A00] shrink-0">
              <Hash className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight truncate">
                #{tag}
              </h1>
              <p className="text-xs sm:text-sm text-[#606060] dark:text-[#AAAAAA] mt-0.5">
                วิดีโอ {initialVideos.length.toLocaleString('th-TH')} รายการ
                {channelCount > 0 ? ` • ${channelCount.toLocaleString('th-TH')} ช่อง` : ''}
              </p>
            </div>
          </div>

          {/* Tabs: ทั้งหมด | Shorts */}
          <div className="flex items-center gap-6 pt-3 select-none">
            {[
              { id: 'all', label: 'ทั้งหมด', count: initialVideos.length },
              { id: 'shorts', label: 'Shorts', count: shortsCount },
            ].map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative pb-3 text-sm font-bold transition cursor-pointer inline-flex items-center gap-1.5 ${
                    active
                      ? 'text-[#0F0F0F] dark:text-[#F1F1F1]'
                      : 'text-[#606060] dark:text-[#AAAAAA] hover:text-[#0F0F0F] dark:hover:text-[#F1F1F1]'
                  }`}
                >
                  <span>{tab.label}</span>
                  {tab.count > 0 && (
                    <span className="text-[11px] font-semibold text-[#8C857B] dark:text-[#888888]">
                      {tab.count}
                    </span>
                  )}
                  {active && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2.5px] rounded-full bg-[#0F0F0F] dark:bg-[#F1F1F1]" />
                  )}
                </button>
              );
            })}
          </div>
        </header>

        {/* Videos Grid */}
        {visibleVideos.length === 0 ? (
          <div className="rounded-3xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 p-10 text-center max-w-lg mx-auto my-12 space-y-3 shadow-xs">
            <div className="w-12 h-12 mx-auto rounded-2xl bg-[#FF7A00]/10 flex items-center justify-center text-[#FF7A00]">
              <Film className="w-6 h-6" />
            </div>
            <h2 className="text-base font-bold">
              {activeTab === 'shorts'
                ? `ยังไม่มีวิดีโอ Shorts ในแฮชแท็ก #${tag}`
                : `ยังไม่พบวิดีโอสาธารณะในแฮชแท็ก #${tag}`}
            </h2>
            <p className="text-xs sm:text-sm text-[#606060] dark:text-[#AAAAAA]">
              ลองสำรวจวิดีโออื่นบนหน้าแรก หรือเพิ่มแท็ก #{tag} ให้วิดีโอของคุณใน TubeLock Studio
            </p>
            <div className="pt-2">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FF7A00] hover:bg-[#E56E00] text-white text-xs font-bold transition"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>กลับหน้าแรก</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 items-start gap-y-4 -mx-2 sm:-mx-2.5">
            {visibleVideos.map((video) => (
              <VideoCard key={video.id} video={video} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

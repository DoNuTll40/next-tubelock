'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BellRing,
  Film,
  ListVideo,
  Info,
  SlidersHorizontal,
  Calendar,
  Eye,
  UploadCloud,
  Loader2,
} from 'lucide-react';
import VideoCard from '@/components/VideoCard';
import PlaylistCard from '@/components/playlist/PlaylistCard';
import { useSession } from '@/context/SessionContext';

function formatThaiJoinDate(iso) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return '-';
  }
}

export default function ChannelClient({ channel, initialVideos = [], initialPlaylists = [] }) {
  const router = useRouter();
  const { session } = useSession();

  const [activeTab, setActiveTab] = useState('videos'); // 'videos' | 'playlists' | 'about'
  const [sortBy, setSortBy] = useState('latest'); // 'latest' | 'popular'
  const [isSubscribed, setIsSubscribed] = useState(Boolean(channel?.isSubscribed));
  const [subscriberCount, setSubscriberCount] = useState(Number(channel?.subscriberCount || 0));
  const [isTogglingSub, setIsTogglingSub] = useState(false);
  const [avatarError, setAvatarError] = useState(false);

  const isOwner = Boolean(
    channel?.isOwner || (session?.id != null && Number(session.id) === Number(channel?.id))
  );

  const sortedVideos = useMemo(() => {
    const list = [...initialVideos];
    if (sortBy === 'popular') {
      list.sort((a, b) => (Number(b.views_count) || 0) - (Number(a.views_count) || 0));
    } else {
      list.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    }
    return list;
  }, [initialVideos, sortBy]);

  const handleToggleSubscribe = async () => {
    if (!session?.id) {
      const from = typeof window !== 'undefined' ? window.location.pathname : '/';
      router.push(`/login?from=${encodeURIComponent(from)}`);
      return;
    }
    if (isOwner || isTogglingSub) return;

    const prevSub = isSubscribed;
    const prevCount = subscriberCount;
    setIsSubscribed(!prevSub);
    setSubscriberCount(Math.max(0, prevCount + (prevSub ? -1 : 1)));
    setIsTogglingSub(true);

    try {
      const res = await fetch(`/api/channels/${encodeURIComponent(channel.handle)}/subscribe`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        setIsSubscribed(prevSub);
        setSubscriberCount(prevCount);
      } else {
        setIsSubscribed(Boolean(data.subscribed));
        setSubscriberCount(Number(data.subscriberCount ?? prevCount));
      }
    } catch {
      setIsSubscribed(prevSub);
      setSubscriberCount(prevCount);
    } finally {
      setIsTogglingSub(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#0F0F0F] text-[#0F0F0F] dark:text-[#F1F1F1] pb-24">
      <div className="max-w-[1440px] mx-auto px-3 sm:px-6 lg:px-8 pt-5 sm:pt-7 space-y-6">
        {/* Channel Banner (only shown when channel has a custom banner, like YouTube) */}
        {channel?.bannerUrl && (
          <div className="relative w-full h-32 sm:h-48 lg:h-56 rounded-2xl sm:rounded-3xl overflow-hidden bg-[#1A1614] border border-[#EFECE6] dark:border-white/10">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={channel.bannerUrl}
              alt={`${channel.name} banner`}
              className="w-full h-full object-cover"
              referrerPolicy="no-referrer"
            />
          </div>
        )}

        {/* Channel Header Info */}
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 px-1">
          {/* Avatar */}
          <div className="shrink-0">
            {channel?.picture && !avatarError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={channel.picture}
                alt={channel.name}
                onError={() => setAvatarError(true)}
                className="w-20 h-20 sm:w-28 sm:h-28 rounded-full object-cover ring-2 ring-[#EFECE6] dark:ring-white/15 shadow-md"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-20 h-20 sm:w-28 sm:h-28 rounded-full bg-gradient-to-tr from-[#FF7A00] to-[#FF9E40] flex items-center justify-center text-white text-3xl sm:text-4xl font-extrabold shadow-md">
                {(channel?.name || channel?.handle || 'T').charAt(0).toUpperCase()}
              </div>
            )}
          </div>

          {/* Meta & CTA */}
          <div className="flex-1 min-w-0 space-y-1.5">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight truncate">
              {channel?.name}
            </h1>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs sm:text-sm text-[#606060] dark:text-[#AAAAAA]">
              <span className="font-semibold text-[#0F0F0F] dark:text-[#E5E5E5]">
                @{channel?.handle}
              </span>
              <span>•</span>
              <span>
                {subscriberCount > 0
                  ? `ผู้ติดตาม ${subscriberCount.toLocaleString('th-TH')} คน`
                  : 'ยังไม่มีผู้ติดตาม'}
              </span>
              <span>•</span>
              <span>วิดีโอ {initialVideos.length.toLocaleString('th-TH')} รายการ</span>
            </div>

            {channel?.bio && (
              <p className="text-xs sm:text-sm text-[#606060] dark:text-[#AAAAAA] line-clamp-2 max-w-2xl pt-0.5">
                {channel.bio}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              {isOwner ? (
                <>
                  <Link
                    href="/settings?channel"
                    className="px-4 py-2 rounded-full bg-[#EFECE6] dark:bg-white/10 hover:bg-[#E5E0D8] dark:hover:bg-white/15 text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 transition"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                    <span>ปรับแต่งช่อง</span>
                  </Link>
                  <Link
                    href="/videos"
                    className="px-4 py-2 rounded-full bg-[#EFECE6] dark:bg-white/10 hover:bg-[#E5E0D8] dark:hover:bg-white/15 text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 transition"
                  >
                    <Film className="w-4 h-4" />
                    <span>จัดการวิดีโอ</span>
                  </Link>
                </>
              ) : (
                <button
                  type="button"
                  disabled={isTogglingSub}
                  onClick={handleToggleSubscribe}
                  className={`px-5 py-2 rounded-full text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 transition active:scale-95 cursor-pointer shadow-xs ${
                    isSubscribed
                      ? 'bg-[#EFECE6] dark:bg-[#272727] hover:bg-[#E5E0D8] dark:hover:bg-[#333333] text-[#0F0F0F] dark:text-[#F1F1F1]'
                      : 'bg-[#0F0F0F] dark:bg-[#F1F1F1] hover:bg-[#272727] dark:hover:bg-[#E0E0E0] text-white dark:text-[#0F0F0F]'
                  }`}
                >
                  {isTogglingSub ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isSubscribed ? (
                    <BellRing className="w-4 h-4" />
                  ) : (
                    <Bell className="w-4 h-4" />
                  )}
                  <span>{isSubscribed ? 'ติดตามแล้ว' : 'ติดตาม'}</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Channel Navigation Tabs */}
        <div className="flex items-center gap-6 border-b border-[#EFECE6] dark:border-white/10 select-none overflow-x-auto scrollbar-none">
          {[
            { id: 'videos', label: 'วิดีโอ', icon: Film },
            { id: 'playlists', label: 'เพลย์ลิสต์', icon: ListVideo },
            { id: 'about', label: 'เกี่ยวกับ', icon: Info },
          ].map((tab) => {
            const active = activeTab === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative pb-3 text-sm font-bold transition cursor-pointer inline-flex items-center gap-1.5 shrink-0 ${
                  active
                    ? 'text-[#0F0F0F] dark:text-[#F1F1F1]'
                    : 'text-[#606060] dark:text-[#AAAAAA] hover:text-[#0F0F0F] dark:hover:text-[#F1F1F1]'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
                {active && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2.5px] rounded-full bg-[#0F0F0F] dark:bg-[#F1F1F1]" />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab 1: Videos */}
        {activeTab === 'videos' && (
          <div className="space-y-4">
            {initialVideos.length > 0 && (
              <div className="flex items-center gap-2 select-none">
                {[
                  { id: 'latest', label: 'ล่าสุด' },
                  { id: 'popular', label: 'ยอดนิยม' },
                ].map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSortBy(opt.id)}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                      sortBy === opt.id
                        ? 'bg-[#0F0F0F] dark:bg-[#F1F1F1] text-white dark:text-[#0F0F0F]'
                        : 'bg-[#0000000a] dark:bg-white/10 hover:bg-[#00000014] dark:hover:bg-white/15 text-[#0F0F0F] dark:text-[#F1F1F1]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}

            {sortedVideos.length === 0 ? (
              <div className="rounded-3xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 p-10 text-center max-w-md mx-auto my-8 space-y-3">
                <div className="w-12 h-12 mx-auto rounded-2xl bg-[#FF7A00]/10 flex items-center justify-center text-[#FF7A00]">
                  <Film className="w-6 h-6" />
                </div>
                <h2 className="text-base font-bold">ยังไม่มีวิดีโอสาธารณะในช่องนี้</h2>
                {isOwner && (
                  <Link
                    href="/upload"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-[#FF7A00] hover:bg-[#E56E00] text-white text-xs font-bold transition"
                  >
                    <UploadCloud className="w-4 h-4" />
                    <span>อัปโหลดวิดีโอแรกของคุณ</span>
                  </Link>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 items-start gap-y-4 -mx-2 sm:-mx-2.5">
                {sortedVideos.map((video) => (
                  <VideoCard key={video.id} video={video} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Playlists */}
        {activeTab === 'playlists' && (
          <div>
            {initialPlaylists.length === 0 ? (
              <div className="rounded-3xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 p-10 text-center max-w-md mx-auto my-8 space-y-2">
                <ListVideo className="w-8 h-8 mx-auto text-[#8C857B]" />
                <h2 className="text-base font-bold">ยังไม่มีเพลย์ลิสต์สาธารณะ</h2>
                <p className="text-xs text-[#606060] dark:text-[#AAAAAA]">
                  เพลย์ลิสต์ที่ตั้งค่าเป็นสาธารณะของช่องนี้จะแสดงที่นี่
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 items-start gap-6">
                {initialPlaylists.map((pl) => (
                  <PlaylistCard
                    key={pl.id}
                    playlist={pl}
                    onCopyLink={(playlist) => {
                      if (typeof window !== 'undefined') {
                        navigator.clipboard?.writeText(
                          `${window.location.origin}/playlist/${encodeURIComponent(playlist.route_key)}`
                        );
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 3: About */}
        {activeTab === 'about' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 rounded-2xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 p-6 space-y-3">
              <h2 className="text-base font-bold">คำอธิบายช่อง</h2>
              <p className="text-sm text-[#4A4540] dark:text-[#CCCCCC] whitespace-pre-wrap leading-relaxed">
                {channel?.bio || 'เจ้าของช่องยังไม่ได้เพิ่มคำอธิบายช่อง'}
              </p>
            </div>
            <div className="rounded-2xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 p-6 space-y-4">
              <h2 className="text-base font-bold">สถิติของช่อง</h2>
              <div className="space-y-3 text-sm text-[#4A4540] dark:text-[#CCCCCC]">
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-[#FF7A00] shrink-0" />
                  <span>เข้าร่วมเมื่อ {formatThaiJoinDate(channel?.createdAt)}</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Eye className="w-4 h-4 text-[#FF7A00] shrink-0" />
                  <span>ยอดรับชมรวม {Number(channel?.totalViews || 0).toLocaleString('th-TH')} ครั้ง</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Film className="w-4 h-4 text-[#FF7A00] shrink-0" />
                  <span>วิดีโอสาธารณะ {initialVideos.length.toLocaleString('th-TH')} รายการ</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

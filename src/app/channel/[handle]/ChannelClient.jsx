'use client';

import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Bell,
  BellRing,
  Film,
  ListVideo,
  Info,
  Calendar,
  Eye,
  UploadCloud,
  Loader2,
  ExternalLink,
  Link2,
  Copy,
  Check,
  Users,
} from 'lucide-react';
import ChannelProfileHeader, { ChannelLinkIcon, ChannelOwnerActions, extractBioLinks } from '@/components/channel/ChannelProfileHeader';
import ChannelAboutDialog, { renderBioWithLinks } from '@/components/channel/ChannelAboutDialog';
import VideoCard from '@/components/VideoCard';
import PlaylistCard from '@/components/playlist/PlaylistCard';
import { AnimatedTabPanel, AnimatedTabs } from '@/components/ui/AnimatedTabs';
import { useSession } from '@/context/SessionContext';

const CHANNEL_TABS = [
  { id: 'videos', label: 'วิดีโอ', icon: <Film aria-hidden="true" className="size-4 shrink-0" /> },
  { id: 'playlists', label: 'เพลย์ลิสต์', icon: <ListVideo aria-hidden="true" className="size-4 shrink-0" /> },
  { id: 'about', label: 'เกี่ยวกับ', icon: <Info aria-hidden="true" className="size-4 shrink-0" /> },
];

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
  const tabsId = useId();
  const [sortBy, setSortBy] = useState('latest'); // 'latest' | 'popular'
  const [isSubscribed, setIsSubscribed] = useState(Boolean(channel?.isSubscribed));
  const [subscriberCount, setSubscriberCount] = useState(Number(channel?.subscriberCount || 0));
  const [isTogglingSub, setIsTogglingSub] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [copiedChannelUrl, setCopiedChannelUrl] = useState(false);

  const bioLinks = useMemo(() => extractBioLinks(channel?.bio), [channel?.bio]);

  const handleCopyChannelUrl = () => {
    if (typeof window === 'undefined' || !channel?.handle) return;
    navigator.clipboard?.writeText(`${window.location.origin}/@${channel.handle}`);
    setCopiedChannelUrl(true);
    setTimeout(() => setCopiedChannelUrl(false), 2000);
  };

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
        <ChannelProfileHeader
          channel={channel}
          subscriberCount={subscriberCount}
          videoCount={initialVideos.length}
          bioLinks={bioLinks}
          onShowAbout={() => setShowAboutModal(true)}
          actions={isOwner ? <ChannelOwnerActions /> : (
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
        />

        <AnimatedTabs
          id={tabsId}
          tabs={CHANNEL_TABS}
          value={activeTab}
          onChange={setActiveTab}
          label="หน้าช่อง"
        />

        <AnimatedTabPanel
          id={tabsId}
          value={activeTab}
          className={activeTab === 'about' ? 'grid grid-cols-1 lg:grid-cols-3 gap-6' : 'space-y-4'}
        >
          {/* Tab 1: Videos */}
          {activeTab === 'videos' && (
            <>
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
            </>
          )}

          {/* Tab 2: Playlists */}
          {activeTab === 'playlists' && (
            <>
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
            </>
          )}

          {/* Tab 3: About */}
          {activeTab === 'about' && (
            <>
              <div className="lg:col-span-2 space-y-6">
                <div className="rounded-2xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 p-6 space-y-3">
                  <h2 className="text-base font-bold">คำอธิบายช่อง</h2>
                  <p className="text-sm text-[#4A4540] dark:text-[#CCCCCC] whitespace-pre-wrap leading-relaxed">
                    {channel?.bio ? renderBioWithLinks(channel.bio) : 'เจ้าของช่องยังไม่ได้เพิ่มคำอธิบายช่อง'}
                  </p>
                </div>

                {bioLinks.length > 0 && (
                  <div className="rounded-2xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 p-6 space-y-3.5">
                    <h2 className="text-base font-bold">ลิงก์ของช่อง</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {bioLinks.map((lnk) => (
                        <a
                          key={lnk.href}
                          href={lnk.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 p-3 rounded-xl bg-[#FBF9F5] dark:bg-white/5 hover:bg-[#F4F0E8] dark:hover:bg-white/10 border border-[#EFECE6] dark:border-white/10 transition group"
                        >
                          <div className="w-9 h-9 rounded-lg bg-white dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 flex items-center justify-center shrink-0">
                            <ChannelLinkIcon hostname={lnk.hostname} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold text-[#0F0F0F] dark:text-[#F1F1F1] group-hover:text-[#FF7A00] transition truncate">
                              {lnk.label}
                            </div>
                            <div className="text-[11px] text-[#606060] dark:text-[#AAAAAA] truncate">
                              {lnk.displayUrl}
                            </div>
                          </div>
                          <ExternalLink className="w-3.5 h-3.5 text-[#8C857B] shrink-0 opacity-60 group-hover:opacity-100" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 p-6 space-y-4 h-fit">
                <h2 className="text-base font-bold">ข้อมูลช่อง</h2>
                <div className="space-y-3 text-sm text-[#4A4540] dark:text-[#CCCCCC]">
                  <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#FBF9F5] dark:bg-white/5 border border-[#EFECE6] dark:border-white/10">
                    <div className="flex items-center gap-2 min-w-0">
                      <Link2 className="w-4 h-4 text-[#FF7A00] shrink-0" />
                      <span className="text-xs font-mono truncate">/@{channel?.handle}</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyChannelUrl}
                      className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-[#606060] dark:text-[#AAAAAA] cursor-pointer shrink-0"
                      title="คัดลอกลิงก์ช่อง"
                    >
                      {copiedChannelUrl ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Users className="w-4 h-4 text-[#FF7A00] shrink-0" />
                    <span>ผู้ติดตาม {subscriberCount.toLocaleString('th-TH')} คน</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Film className="w-4 h-4 text-[#FF7A00] shrink-0" />
                    <span>วิดีโอสาธารณะ {initialVideos.length.toLocaleString('th-TH')} รายการ</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Eye className="w-4 h-4 text-[#FF7A00] shrink-0" />
                    <span>ยอดรับชมรวม {Number(channel?.totalViews || 0).toLocaleString('th-TH')} ครั้ง</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <Calendar className="w-4 h-4 text-[#FF7A00] shrink-0" />
                    <span>เข้าร่วมเมื่อ {formatThaiJoinDate(channel?.createdAt)}</span>
                  </div>
                </div>
              </div>
            </>
          )}
        </AnimatedTabPanel>
      </div>

      {showAboutModal && (
        <ChannelAboutDialog channel={channel} bioLinks={bioLinks} onClose={() => setShowAboutModal(false)}>
            <div className="space-y-2.5 pt-2 border-t border-[#EFECE6] dark:border-white/10">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[#8C857B] dark:text-[#888888]">
                ข้อมูลเพิ่มเติม
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-[#4A4540] dark:text-[#CCCCCC]">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-[#FF7A00] shrink-0" />
                  <span>ผู้ติดตาม {subscriberCount.toLocaleString('th-TH')} คน</span>
                </div>
                <div className="flex items-center gap-2">
                  <Film className="w-4 h-4 text-[#FF7A00] shrink-0" />
                  <span>วิดีโอ {initialVideos.length.toLocaleString('th-TH')} รายการ</span>
                </div>
                <div className="flex items-center gap-2">
                  <Eye className="w-4 h-4 text-[#FF7A00] shrink-0" />
                  <span>ยอดดูรวม {Number(channel?.totalViews || 0).toLocaleString('th-TH')} ครั้ง</span>
                </div>
                <div className="flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-[#FF7A00] shrink-0" />
                  <span>เข้าร่วม {formatThaiJoinDate(channel?.createdAt)}</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-[#FBF9F5] dark:bg-white/5 border border-[#EFECE6] dark:border-white/10 mt-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Link2 className="w-4 h-4 text-[#FF7A00] shrink-0" />
                  <span className="text-xs font-mono truncate">/@{channel?.handle}</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyChannelUrl}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#FF7A00]/10 hover:bg-[#FF7A00]/20 text-[#FF7A00] text-[11px] font-bold cursor-pointer shrink-0 transition"
                >
                  {copiedChannelUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedChannelUrl ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์'}</span>
                </button>
              </div>
            </div>
        </ChannelAboutDialog>
      )}
    </div>
  );
}

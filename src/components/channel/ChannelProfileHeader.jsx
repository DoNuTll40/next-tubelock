'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Film, SlidersHorizontal } from 'lucide-react';

export const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g;

function getPlatformName(hostname) {
  const h = hostname.replace(/^www\./, '').toLowerCase();
  if (h.includes('github.com')) return 'GitHub';
  if (h.includes('youtube.com') || h.includes('youtu.be')) return 'YouTube';
  if (h.includes('facebook.com') || h.includes('fb.com')) return 'Facebook';
  if (h.includes('instagram.com')) return 'Instagram';
  if (h.includes('tiktok.com')) return 'TikTok';
  if (h === 'x.com' || h.includes('twitter.com')) return 'X (Twitter)';
  if (h.includes('discord.gg') || h.includes('discord.com')) return 'Discord';
  if (h.includes('twitch.tv')) return 'Twitch';
  if (h.includes('line.me')) return 'LINE';
  return h;
}

export function extractBioLinks(bio = '') {
  if (!bio) return [];
  const matches = String(bio).match(URL_REGEX) || [];
  const seen = new Set();
  const links = [];
  for (const raw of matches) {
    const cleanUrl = raw.replace(/[.,;!?)]+$/, '');
    try {
      const parsed = new URL(cleanUrl);
      if (seen.has(parsed.href)) continue;
      seen.add(parsed.href);
      const host = parsed.hostname.replace(/^www\./, '');
      const displayUrl = `${host}${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`;
      links.push({
        href: parsed.href,
        hostname: parsed.hostname,
        label: getPlatformName(parsed.hostname),
        displayUrl,
      });
    } catch {
      // skip invalid url
    }
  }
  return links;
}

export function ChannelLinkIcon({ hostname }) {
  const [failed, setFailed] = useState(false);
  if (!hostname || failed) {
    return <ExternalLink className="w-4 h-4 text-[#FF7A00] shrink-0" />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://a.favicon.im/${encodeURIComponent(hostname)}?throw-error-on-404=true`}
      alt=""
      width={18}
      height={18}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="w-4.5 h-4.5 rounded-sm object-contain shrink-0"
    />
  );
}

export function ChannelOwnerActions({ editHref = '/settings?channel' }) {
  return (
                <>
                  <Link
                    href={editHref}
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
  );
}

export default function ChannelProfileHeader({ channel, subscriberCount, videoCount, bioLinks = extractBioLinks(channel?.bio), onShowAbout, actions, titleAs: Title = 'h1' }) {
  const [failedAvatar, setFailedAvatar] = useState(null);
  const avatarError = failedAvatar === channel?.picture;
  const primaryLink = bioLinks[0] || null;
  return (
    <div className="min-w-0 space-y-6">
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
                onError={() => setFailedAvatar(channel.picture)}
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
            <Title className="text-2xl sm:text-3xl font-extrabold tracking-tight truncate">
              {channel?.name || 'ช่องของคุณ'}
            </Title>
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
              <span>วิดีโอ {videoCount.toLocaleString('th-TH')} รายการ</span>
            </div>

            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 max-w-2xl pt-0.5 text-xs sm:text-sm text-[#606060] dark:text-[#AAAAAA]">
              {channel?.bio ? (
                <span className="line-clamp-1">{channel.bio.replace(URL_REGEX, '').trim() || primaryLink?.displayUrl}</span>
              ) : (
                <span>ดูข้อมูลเพิ่มเติมเกี่ยวกับช่องนี้</span>
              )}
              <button
                type="button"
                onClick={() => onShowAbout()}
                className="font-bold text-[#0F0F0F] dark:text-[#F1F1F1] hover:text-[#FF7A00] transition cursor-pointer shrink-0"
              >
                ...เพิ่มเติม
              </button>
            </div>

            {primaryLink && (
              <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
                <a
                  href={primaryLink.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-[#FF7A00] hover:underline font-semibold"
                >
                  <ChannelLinkIcon hostname={primaryLink.hostname} />
                  <span className="truncate max-w-[240px] sm:max-w-[320px]">{primaryLink.displayUrl}</span>
                </a>
                {bioLinks.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onShowAbout()}
                    className="text-[#606060] dark:text-[#AAAAAA] hover:text-[#0F0F0F] dark:hover:text-[#F1F1F1] font-semibold cursor-pointer"
                  >
                    และอีก {bioLinks.length - 1} ลิงก์
                  </button>
                )}
              </div>
            )}

            {actions && <div className="flex flex-wrap items-center gap-2.5 pt-2">{actions}</div>}
          </div>
        </div>
    </div>
  );
}

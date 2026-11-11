'use client';

import { useState, useMemo } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Clock, Cpu, Film, HardDrive } from 'lucide-react';

/**
 * Parses timestamp string "MM:SS" or "HH:MM:SS" to total seconds
 */
function parseTimestampToSeconds(timeStr) {
  const parts = timeStr.trim().split(':').map((p) => parseInt(p, 10));
  if (parts.some((n) => isNaN(n))) return null;
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return null;
}

const CHANNEL_ALIAS_MAP = {
  'UCSrC9Jb_eUeQkpVn2OfRauw': '@theetrexofficial',
};

/**
 * Recognizes and extracts social media info from URL (TikTok, YouTube, Facebook, Instagram, etc.)
 */
function getSocialLinkInfo(parsed) {
  try {
    const host = parsed.hostname.replace(/^www\./, '');
    const pathname = decodeURIComponent(parsed.pathname);

    // 1. TikTok: tiktok.com/@teerapong_6 or tiktok.com/@username
    if (host.includes('tiktok.com')) {
      const match = pathname.match(/^\/@?([a-zA-Z0-9_.-]+)/);
      const username = match ? match[1] : pathname.replace(/^\//, '');
      return {
        label: username ? `/ ${username}` : '/ tiktok',
      };
    }

    // 2. YouTube: youtube.com/@theetrexofficial, youtube.com/channel/..., youtu.be/...
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      if (pathname.startsWith('/@')) {
        return {
          label: `/ ${pathname.slice(1).split('/')[0]}`,
        };
      }
      if (pathname.includes('/channel/') || pathname.includes('/c/') || pathname.includes('/user/')) {
        const parts = pathname.split('/').filter(Boolean);
        const name = parts[parts.length - 1] || 'channel';
        const alias = CHANNEL_ALIAS_MAP[name];
        const display = alias || (name.startsWith('@') ? name : (name.length > 18 ? `${name.slice(0, 15)}...` : name));
        return {
          label: `/ ${display}`,
        };
      }
      const clean = pathname.replace(/^\//, '').split('/')[0];
      return {
        label: clean ? `/ ${clean}` : '/ youtube',
      };
    }

    // 3. Facebook: facebook.com/theetrexfanpage or fb.com/...
    if (host.includes('facebook.com') || host.includes('fb.com') || host.includes('fb.me')) {
      const clean = pathname.replace(/^\//, '').split('/')[0];
      return {
        label: clean ? `/ ${clean}` : '/ facebook',
      };
    }

    // 4. Instagram: instagram.com/teerapong_6
    if (host.includes('instagram.com')) {
      const clean = pathname.replace(/^\//, '').split('/')[0];
      return {
        label: clean ? `/ ${clean}` : '/ instagram',
      };
    }

    // 5. Twitter / X: twitter.com/username or x.com/username
    if (host === 'twitter.com' || host === 'x.com') {
      const clean = pathname.replace(/^\//, '').split('/')[0];
      return {
        label: clean ? `/ @${clean}` : '/ x',
      };
    }

    // 6. Spotify
    if (host.includes('spotify.com')) {
      return {
        label: '/ spotify',
      };
    }

    // 7. LINE
    if (host.includes('line.me')) {
      return {
        label: '/ line',
      };
    }

    return null;
  } catch {
    return null;
  }
}

function LinkFavicon({ hostname }) {
  const [attempt, setAttempt] = useState(0);
  const isDomain = /^(?:[a-z0-9-]+\.)+[a-z][a-z0-9-]*$/i.test(hostname);

  if (!isDomain || attempt >= 2) {
    return <ExternalLink aria-hidden="true" className="size-3.5 shrink-0 opacity-70" />;
  }

  const alternateHost = hostname.startsWith('www.') ? hostname.slice(4) : `www.${hostname}`;
  const iconHost = attempt === 0 ? hostname : alternateHost;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://a.favicon.im/${encodeURIComponent(iconHost)}?throw-error-on-404=true`}
      alt=""
      width={14}
      height={14}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setAttempt(attempt + 1)}
      className="size-3.5 shrink-0 rounded-sm object-contain"
    />
  );
}

/**
 * Tokenizes plain text into safe React nodes:
 * - Timestamps (e.g. "0:05", "01:23", "1:15:30") -> clickable seek button
 * - Social Pills (TikTok, YouTube, Facebook, Instagram) -> YouTube capsule pills
 * - General URLs -> clean capsule links
 * - Hashtags (e.g. "#TubeLock", "#สตรีมมิ่ง") -> styled hashtag badge
 * - Plain text
 */
function parseDescriptionTokens(text = '', onSeek) {
  if (!text) return null;

  // Unified Regex for:
  // 1. Timestamps: (?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)
  // 2. URLs: https?:\/\/[^\s]+
  // 3. Hashtags: #[a-zA-Z0-9_\u0E00-\u0E7F]+
  const regex = /((?:(?:\d{1,2}):)?[0-5]?\d:[0-5]\d)|(https?:\/\/[^\s]+)|(#[a-zA-Z0-9_\u0E00-\u0E7F]+)/g;

  const elements = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    // Plain text before match
    if (match.index > lastIndex) {
      elements.push(text.slice(lastIndex, match.index));
    }

    const timestamp = match[1];
    const url = match[2];
    const hashtag = match[3];

    if (timestamp) {
      const seconds = parseTimestampToSeconds(timestamp);
      elements.push(
        <button
          key={`ts-${match.index}`}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (seconds !== null && typeof onSeek === 'function') {
              onSeek(seconds);
            }
          }}
          className="inline-flex items-center gap-1 px-1.5 py-0 mx-0.5 h-[20px] rounded bg-[#065FD4]/10 text-[#065FD4] dark:text-[#3EA6FF] hover:bg-[#065FD4]/20 hover:underline font-mono text-[11.5px] font-semibold transition cursor-pointer select-none align-[-2px]"
          title={`กระโดดไปที่ ${timestamp}`}
        >
          <Clock className="w-2.5 h-2.5 inline-block opacity-70" />
          {timestamp}
        </button>
      );
    } else if (url) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        elements.push(url);
        lastIndex = regex.lastIndex;
        continue;
      }

      const hostname = parsed.hostname;
      const social = getSocialLinkInfo(parsed);

      if (social) {
        // YouTube-Style Social Capsule Badge (Pill) - compact & flush with line height
        elements.push(
          <a
            key={`social-${match.index}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 px-2 py-0 mx-1 h-[21px] rounded-full bg-[#0000000a] dark:bg-white/10 hover:bg-[#00000014] dark:hover:bg-white/20 text-[#0F0F0F] dark:text-[#F1F1F1] text-[12px] font-normal transition cursor-pointer select-none align-[-3px]"
            title={url}
          >
            <LinkFavicon key={hostname} hostname={hostname} />
            <span className="font-normal text-[#0F0F0F] dark:text-[#F1F1F1] tracking-tight whitespace-nowrap">
              {social.label}
            </span>
          </a>
        );
      } else {
        // General Clean URL Link
        const displayHost = hostname.replace(/^www\./, '') +
          (parsed.pathname.length > 1 ? parsed.pathname.slice(0, 15) : '');

        elements.push(
          <a
            key={`url-${match.index}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 px-2 py-0 mx-1 h-[21px] rounded-full bg-[#0000000a] dark:bg-white/10 hover:bg-[#00000014] dark:hover:bg-white/20 text-[#065FD4] dark:text-[#3EA6FF] text-[12px] font-normal transition align-[-3px]"
            title={url}
          >
            <LinkFavicon key={hostname} hostname={hostname} />
            <span className="hover:underline truncate max-w-[200px]">{displayHost}</span>
          </a>
        );
      }
    } else if (hashtag) {
      elements.push(
        <span
          key={`tag-${match.index}`}
          onClick={(e) => e.stopPropagation()}
          className="text-[#FF7A00] hover:underline cursor-pointer font-medium mx-0.5"
        >
          {hashtag}
        </span>
      );
    }

    lastIndex = regex.lastIndex;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements;
}

export default function DescriptionBox({
  video,
  viewsDisplay = '0 ครั้ง',
  fileSizeMB = '0',
  formatDuration,
  resBadge = '4K',
  onSeek,
}) {
  const [isOpen, setIsOpen] = useState(false);

  const rawDescription = video?.description || (video ? 'ไม่มีคำอธิบายสำหรับวิดีโอนี้' : '');

  const parsedContent = useMemo(() => {
    return parseDescriptionTokens(rawDescription, onSeek);
  }, [rawDescription, onSeek]);

  // Formatted upload date
  let formattedDate = '';
  if (video?.created_at) {
    try {
      formattedDate = new Date(video.created_at).toLocaleDateString('th-TH', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    } catch (_) { }
  }

  // Handle card click: expand if collapsed, but never toggle if user is selecting/highlighting text
  const handleCardClick = () => {
    if (typeof window !== 'undefined') {
      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) {
        return; // User is selecting text, do not toggle!
      }
    }

    if (!isOpen) {
      setIsOpen(true);
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className={`rounded-2xl p-3.5 sm:p-4 transition-all duration-200 mt-1 border select-text ${isOpen
        ? 'bg-[#00000008] dark:bg-white/10 border-black/10 dark:border-white/10 shadow-xs cursor-default'
        : 'bg-[#00000005] dark:bg-white/5 hover:bg-[#0000000a] dark:hover:bg-white/10 border-black/5 dark:border-white/10 cursor-pointer'
        }`}
    >
      {/* 1. Top Header Row: Views • Date • Badges (Clickable header) */}
      <div
        onClick={() => {
          if (isOpen) setIsOpen(false);
          else setIsOpen(true);
        }}
        className="flex flex-wrap items-center gap-2 text-xs font-bold text-[#0F0F0F] dark:text-[#F1F1F1] pb-1 cursor-pointer select-none"
      >
        <span>{viewsDisplay}</span>
        {formattedDate && (
          <>
            <span className="text-[#8C857B] dark:text-[#AAAAAA]">•</span>
            <span className="text-[#606060] dark:text-[#AAAAAA] font-semibold">{formattedDate}</span>
          </>
        )}
        <span className="text-[#8C857B] dark:text-[#AAAAAA]">•</span>
        <span className="bg-[#FF7A00]/10 text-[#FF7A00] px-2 py-0.5 rounded-md text-[11px] font-bold">
          {resBadge || 'HD'}
        </span>

        <span className="text-[#606060] dark:text-[#888888] font-normal text-[11px] ml-auto">
          {typeof formatDuration === 'function' && video?.duration
            ? `${formatDuration(video.duration)} • `
            : ''}
          {fileSizeMB} MB
        </span>
      </div>

      {/* 2. Interactive Description Content Body - Selectable Text with Default Cursor */}
      <div
        onClick={(e) => {
          // When open, clicking on the text body does NOT close the card so user can select freely
          if (isOpen) e.stopPropagation();
        }}
        className={`text-[13px] sm:text-[14px] leading-[20px] text-[#0F0F0F] dark:text-[#F1F1F1] font-normal whitespace-pre-wrap font-sans select-text cursor-text selection:bg-[#FF7A00]/25 selection:text-[#0F0F0F] dark:selection:text-[#FFFFFF] transition-all duration-300 ${isOpen ? 'block mt-2' : 'line-clamp-2'
          }`}
      >
        {parsedContent}
      </div>

      {/* 3. Expanded Extra Details (Chapters, Technical Specs, Storage) */}
      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-3.5 pt-3 border-t border-black/5 dark:border-white/10 flex flex-col gap-2.5 text-xs text-[#606060] dark:text-[#AAAAAA] select-text"
        >
          {/* Technical Specs Pills */}
          <div className="flex flex-wrap items-center gap-2 select-none">
            <span className="inline-flex items-center gap-1 bg-white/80 dark:bg-white/10 border border-black/5 dark:border-white/10 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#212529] dark:text-[#F1F1F1]">
              <Film className="w-3.5 h-3.5 text-[#FF7A00]" />
              {resBadge || '1080p'}
            </span>

            <span className="inline-flex items-center gap-1 bg-white/80 dark:bg-white/10 border border-black/5 dark:border-white/10 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#212529] dark:text-[#F1F1F1]">
              <Cpu className="w-3.5 h-3.5 text-blue-600" />
              {video?.codec ? video.codec.toUpperCase() : 'H.264'}
            </span>

            {video?.fps && (
              <span className="inline-flex items-center gap-1 bg-white/80 dark:bg-white/10 border border-black/5 dark:border-white/10 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#212529] dark:text-[#F1F1F1]">
                {video.fps} FPS
              </span>
            )}

            {video?.bitrate && (
              <span className="inline-flex items-center gap-1 bg-white/80 dark:bg-white/10 border border-black/5 dark:border-white/10 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#212529] dark:text-[#F1F1F1]">
                {(video.bitrate / 1000000).toFixed(1)} Mbps
              </span>
            )}

            <span className="inline-flex items-center gap-1 bg-white/80 dark:bg-white/10 border border-black/5 dark:border-white/10 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-[#212529] dark:text-[#F1F1F1]">
              <HardDrive className="w-3.5 h-3.5 text-emerald-600" />
              {fileSizeMB} MB
            </span>
          </div>

          {/* Direct File Details / Path */}
          {video?.raw_file_name && (
            <div className="text-[11px] text-[#8C857B] dark:text-[#888888] truncate font-mono select-text">
              ไฟล์ต้นฉบับ: {video.raw_file_name}
            </div>
          )}
        </div>
      )}

      {/* 4. Show More / Show Less Toggle Button */}
      <div className="flex items-center justify-end pt-1 select-none">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen((prev) => !prev);
          }}
          className="text-xs font-bold text-[#0F0F0F] dark:text-[#F1F1F1] hover:text-[#FF7A00] flex items-center gap-1 transition cursor-pointer p-1 rounded-md"
        >
          {isOpen ? (
            <>
              แสดงน้อยลง
              <ChevronUp className="w-3.5 h-3.5" />
            </>
          ) : (
            <>
              ...เพิ่มเติม
              <ChevronDown className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}


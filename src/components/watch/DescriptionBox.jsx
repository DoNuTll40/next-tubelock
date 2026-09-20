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
function getSocialLinkInfo(urlStr) {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase().replace('www.', '');
    const pathname = decodeURIComponent(parsed.pathname);

    // 1. TikTok: tiktok.com/@teerapong_6 or tiktok.com/@username
    if (host.includes('tiktok.com')) {
      const match = pathname.match(/^\/@?([a-zA-Z0-9_.-]+)/);
      const username = match ? match[1] : pathname.replace(/^\//, '');
      return {
        type: 'tiktok',
        label: username ? `/ ${username}` : '/ tiktok',
        url: urlStr,
      };
    }

    // 2. YouTube: youtube.com/@theetrexofficial, youtube.com/channel/..., youtu.be/...
    if (host.includes('youtube.com') || host.includes('youtu.be')) {
      if (pathname.startsWith('/@')) {
        return {
          type: 'youtube',
          label: `/ ${pathname.slice(1).split('/')[0]}`,
          url: urlStr,
        };
      }
      if (pathname.includes('/channel/') || pathname.includes('/c/') || pathname.includes('/user/')) {
        const parts = pathname.split('/').filter(Boolean);
        const name = parts[parts.length - 1] || 'channel';
        const alias = CHANNEL_ALIAS_MAP[name];
        const display = alias || (name.startsWith('@') ? name : (name.length > 18 ? `${name.slice(0, 15)}...` : name));
        return {
          type: 'youtube',
          label: `/ ${display}`,
          url: urlStr,
        };
      }
      const clean = pathname.replace(/^\//, '').split('/')[0];
      return {
        type: 'youtube',
        label: clean ? `/ ${clean}` : '/ youtube',
        url: urlStr,
      };
    }

    // 3. Facebook: facebook.com/theetrexfanpage or fb.com/...
    if (host.includes('facebook.com') || host.includes('fb.com') || host.includes('fb.me')) {
      const clean = pathname.replace(/^\//, '').split('/')[0];
      return {
        type: 'facebook',
        label: clean ? `/ ${clean}` : '/ facebook',
        url: urlStr,
      };
    }

    // 4. Instagram: instagram.com/teerapong_6
    if (host.includes('instagram.com')) {
      const clean = pathname.replace(/^\//, '').split('/')[0];
      return {
        type: 'instagram',
        label: clean ? `/ ${clean}` : '/ instagram',
        url: urlStr,
      };
    }

    // 5. Twitter / X: twitter.com/username or x.com/username
    if (host === 'twitter.com' || host === 'x.com') {
      const clean = pathname.replace(/^\//, '').split('/')[0];
      return {
        type: 'x',
        label: clean ? `/ @${clean}` : '/ x',
        url: urlStr,
      };
    }

    // 6. Spotify
    if (host.includes('spotify.com')) {
      return {
        type: 'spotify',
        label: '/ spotify',
        url: urlStr,
      };
    }

    // 7. LINE
    if (host.includes('line.me')) {
      return {
        type: 'line',
        label: '/ line',
        url: urlStr,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Renders authentic brand SVGs for social platforms
 */
function renderSocialIcon(type) {
  switch (type) {
    case 'tiktok':
      return (
        <span className="w-3.5 h-3.5 rounded-full bg-black flex items-center justify-center shrink-0">
          <svg className="w-2 h-2 fill-white" viewBox="0 0 24 24">
            <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.29 0 .58.04.85.12V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.49 6.33 6.33 0 0 0 1.86-4.49V8.67a8.21 8.21 0 0 0 4.91 1.62V6.85a4.83 4.83 0 0 1-1-.16z" />
          </svg>
        </span>
      );
    case 'youtube':
      return (
        <span className="w-3.5 h-3.5 flex items-center justify-center shrink-0">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
            <rect width="24" height="24" rx="5" fill="#FF0000" />
            <polygon points="9.5,7.5 16.5,12 9.5,16.5" fill="#FFFFFF" />
          </svg>
        </span>
      );
    case 'facebook':
      return (
        <span className="w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="12" fill="#1877F2" />
            <path d="M15 12h-2v7h-3v-7H8.5V9.5H10V7.8C10 6.3 11 5 13.2 5H15v2.4h-1.3c-.7 0-.9.4-.9.9v1.2H15L14.7 12z" fill="#FFFFFF" />
          </svg>
        </span>
      );
    case 'instagram':
      return (
        <span className="w-3.5 h-3.5 rounded-xs flex items-center justify-center shrink-0">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
            <defs>
              <linearGradient id="ig-grad-box" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#fdf497" />
                <stop offset="5%" stopColor="#fdf497" />
                <stop offset="45%" stopColor="#fd5949" />
                <stop offset="60%" stopColor="#d6249f" />
                <stop offset="90%" stopColor="#285AEB" />
              </linearGradient>
            </defs>
            <rect width="24" height="24" rx="6" fill="url(#ig-grad-box)" />
            <rect x="4" y="4" width="16" height="16" rx="4.5" fill="none" stroke="#FFFFFF" strokeWidth="1.8" />
            <circle cx="12" cy="12" r="3.5" fill="none" stroke="#FFFFFF" strokeWidth="1.8" />
            <circle cx="16.5" cy="7.5" r="1" fill="#FFFFFF" />
          </svg>
        </span>
      );
    case 'x':
      return (
        <span className="w-3.5 h-3.5 rounded-full bg-black flex items-center justify-center shrink-0">
          <svg className="w-2 h-2 fill-white" viewBox="0 0 24 24">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </span>
      );
    case 'spotify':
      return (
        <span className="w-3.5 h-3.5 rounded-full bg-[#1DB954] flex items-center justify-center shrink-0">
          <svg className="w-2 h-2 fill-black" viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm4.58 14.42c-.18.3-.56.4-.86.22-2.36-1.44-5.32-1.76-8.82-.96-.34.08-.68-.14-.76-.48-.08-.34.14-.68.48-.76 3.82-.88 7.1-.5 9.74 1.12.3.18.4.56.22.86zm1.22-2.72c-.24.38-.72.5-1.1.26-2.7-1.66-6.82-2.14-10.02-1.18-.42.12-.86-.12-.98-.54-.12-.42.12-.86.54-.98 3.66-1.1 8.2-.58 11.3 1.34.38.24.5.72.26 1.1zm.1-2.82c-3.24-1.92-8.58-2.1-11.68-1.16-.5.16-1.02-.12-1.18-.62-.16-.5.12-1.02.62-1.18 3.56-1.08 9.44-.88 13.16 1.34.46.26.6.84.34 1.3-.26.46-.84.6-1.26.32z" />
          </svg>
        </span>
      );
    case 'line':
      return (
        <span className="w-3.5 h-3.5 rounded-xs flex items-center justify-center shrink-0">
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
            <rect width="24" height="24" rx="5" fill="#06C755" />
            <path d="M19.5 10.5c0-4.1-3.6-7.5-8-7.5s-8 3.4-8 7.5c0 3.7 3.2 6.8 7.6 7.4.3.1.7.2.8.5.1.3.1.6 0 1l-.4 1.4c-.1.4 0 .6.3.5.3-.1 2-1.2 2.8-1.7.4-.3.9-.4 1.3-.4 2.4 0 4.4-1.9 4.6-4.2z" fill="#FFF" />
          </svg>
        </span>
      );
    default:
      return <ExternalLink className="w-3 h-3 opacity-70 shrink-0" />;
  }
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
      const social = getSocialLinkInfo(url);

      if (social) {
        // YouTube-Style Social Capsule Badge (Pill) - compact & flush with line height
        elements.push(
          <a
            key={`social-${match.index}`}
            href={social.url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1.5 px-2 py-0 mx-1 h-[21px] rounded-full bg-[#0000000a] dark:bg-white/10 hover:bg-[#00000014] dark:hover:bg-white/20 text-[#0F0F0F] dark:text-[#F1F1F1] text-[12px] font-normal transition cursor-pointer select-none align-[-3px]"
            title={social.url}
          >
            {renderSocialIcon(social.type)}
            <span className="font-normal text-[#0F0F0F] dark:text-[#F1F1F1] tracking-tight whitespace-nowrap">
              {social.label}
            </span>
          </a>
        );
      } else {
        // General Clean URL Link
        let displayHost = url;
        try {
          const u = new URL(url);
          displayHost = u.hostname.replace('www.', '') + (u.pathname.length > 1 ? u.pathname.slice(0, 15) : '');
        } catch (_) { }

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
            <ExternalLink className="w-3 h-3 opacity-65 shrink-0" />
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

  const rawDescription = video?.description || 'วิดีโอนี้สตรีมตรงผ่าน OneDrive HLS Multi-Bitrate Engine ปรับความละเอียดอัตโนมัติตามความเร็วเน็ตเวิร์ก (ABR Adaptive Streaming)';

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


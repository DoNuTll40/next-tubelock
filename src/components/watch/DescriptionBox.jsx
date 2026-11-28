'use client';

import { memo, useState, useMemo } from 'react';
import Link from 'next/link';
import { ChevronDown, ChevronUp, Cpu, Film, HardDrive, Images } from 'lucide-react';
import { parseDescriptionImages } from '@/lib/descriptionImages.mjs';
import { parseRichDescription } from '@/lib/descriptionDocument.mjs';
import RichDescription from './RichDescription';
import { isMatureVideo } from '@/lib/videoUtils';
import { usePosterPreference } from '@/lib/usePosterPreference';
import DescriptionGallery from './DescriptionGallery';
import DescriptionLinkChip, { parseDescriptionLink } from './DescriptionLinkChip';
import { DescriptionHashtag, DescriptionTimestamp } from './DescriptionInlineTokens';
import { WatchContentAdvisory, WatchHeaderBadges } from './WatchMediaBadges';
import styles from './RichDescription.module.css';

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
        <DescriptionTimestamp key={`ts-${match.index}`} seconds={seconds} label={timestamp} onSeek={onSeek}>
          {timestamp}
        </DescriptionTimestamp>
      );
    } else if (url) {
      const parsed = parseDescriptionLink(url);
      elements.push(parsed
        ? <DescriptionLinkChip key={`url-${match.index}`} href={url} url={parsed} />
        : url);
    } else if (hashtag) {
      elements.push(<DescriptionHashtag key={`tag-${match.index}`}>{hashtag}</DescriptionHashtag>);
    }

    lastIndex = regex.lastIndex;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    elements.push(text.slice(lastIndex));
  }

  return elements;
}

function DescriptionBox({
  video,
  activeVersion = null,
  streamMeta = null,
  viewsDisplay = '0 ครั้ง',
  fileSizeMB = '0',
  formatDuration,
  resBadge = '4K',
  onSeek,
  initialShowAdultPosters = false,
}) {
  const [isOpen, setIsOpen] = useState(false);

  const rawDescription = video?.description || '';
  const richDescription = useMemo(() => parseRichDescription(rawDescription), [rawDescription]);
  const { text, images } = useMemo(() => parseDescriptionImages(rawDescription), [rawDescription]);
  const showAttachmentSummary = !isOpen && images.length > 0;
  const showRichDescription = richDescription && !showAttachmentSummary;
  const descriptionText = (showAttachmentSummary ? text.trim() : text) || (video && images.length === 0 ? 'ไม่มีคำอธิบายสำหรับวิดีโอนี้' : '');
  const hideImagesByDefault = images.length > 0 && isMatureVideo(video);
  const showAdultImages = usePosterPreference(hideImagesByDefault, initialShowAdultPosters);

  const parsedContent = useMemo(() => {
    return parseDescriptionTokens(descriptionText, onSeek);
  }, [descriptionText, onSeek]);

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
        <WatchHeaderBadges
          video={video}
          activeVersion={activeVersion}
          streamMeta={streamMeta}
          fallbackResBadge={resBadge}
        />

        <span className="text-[#606060] dark:text-[#888888] font-normal text-[11px] ml-auto">
          {typeof formatDuration === 'function' && video?.duration
            ? `${formatDuration(video.duration)} • `
            : ''}
          {fileSizeMB} MB
        </span>
      </div>

      {/* 2. Interactive Description Content Body - Selectable Text with Default Cursor */}
      {Array.isArray(video?.tags) && video.tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 pb-1 select-none">
          {(isOpen ? video.tags : video.tags.slice(0, 3)).map((rawTag, idx) => {
            const cleanTag = String(rawTag || '').replace(/^#+/, '').trim();
            if (!cleanTag) return null;
            return (
              <Link
                key={`vtag-${cleanTag}-${idx}`}
                href={`/hashtag/${encodeURIComponent(cleanTag)}`}
                onClick={(e) => e.stopPropagation()}
                className="text-xs font-semibold text-[#FF7A00] hover:underline"
              >
                #{cleanTag}
              </Link>
            );
          })}
        </div>
      )}
      {(parsedContent || showRichDescription) && (
        <div
          onFocusCapture={() => { if (showRichDescription && !isOpen) setIsOpen(true); }}
          onClick={(e) => {
            // When open, clicking on the text body does NOT close the card so user can select freely
            if (isOpen) e.stopPropagation();
          }}
          className={`${styles.typography} select-text cursor-text selection:bg-[#FF7A00]/25 selection:text-[#0F0F0F] dark:selection:text-[#FFFFFF] transition-all duration-300 ${isOpen ? 'block mt-2' : showRichDescription ? 'max-h-80 overflow-hidden' : 'line-clamp-2'
            }`}
        >
          {showRichDescription ? <RichDescription document={richDescription.document} albums={richDescription.albums} expanded={isOpen} concealed={hideImagesByDefault && !showAdultImages} onSeek={onSeek} /> : parsedContent}
        </div>
      )}
      {isOpen && !richDescription && images.length > 0 && (
        <DescriptionGallery
          key={video?.id}
          images={images}
          expanded={isOpen}
          concealed={hideImagesByDefault && !showAdultImages}
        />
      )}

      {/* 3. Expanded Extra Details (Chapters, Technical Specs, Storage) */}
      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="mt-3.5 pt-3 border-t border-black/5 dark:border-white/10 flex flex-col gap-2.5 text-xs text-[#606060] dark:text-[#AAAAAA] select-text"
        >
          <WatchContentAdvisory video={video} />

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
          aria-expanded={isOpen}
          onClick={(e) => {
            e.stopPropagation();
            setIsOpen((prev) => !prev);
          }}
          className={`flex cursor-pointer items-center gap-2 rounded-md p-1 text-xs font-bold text-[#0F0F0F] transition hover:text-[#FF7A00] dark:text-[#F1F1F1] ${showAttachmentSummary ? 'w-full' : ''}`}
        >
          {showAttachmentSummary && (
            <span className="flex items-center gap-1.5 font-semibold text-[#606060] dark:text-[#AAAAAA]">
              <Images aria-hidden="true" className="size-3.5" />
              รูปแนบ ({images.length})
            </span>
          )}
          <span className="ml-auto flex items-center gap-1">
            {isOpen ? 'แสดงน้อยลง' : '...เพิ่มเติม'}
            {isOpen ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </span>
        </button>
      </div>
    </div>
  );
}

export default memo(DescriptionBox);


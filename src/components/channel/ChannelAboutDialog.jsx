'use client';

import { useEffect, useId, useRef } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { ChannelLinkIcon, URL_REGEX } from './ChannelProfileHeader';

export function renderBioWithLinks(bio = '') {
  if (!bio) return null;
  const parts = String(bio).split(URL_REGEX);
  return parts.map((part, idx) => {
    if (/^https?:\/\//i.test(part)) {
      const cleanUrl = part.replace(/[.,;!?)]+$/, '');
      const trailing = part.slice(cleanUrl.length);
      return (
        <span key={`bio-url-${idx}`}>
          <a
            href={cleanUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#FF7A00] hover:underline break-all"
          >
            {cleanUrl}
          </a>
          {trailing}
        </span>
      );
    }
    return <span key={`bio-txt-${idx}`}>{part}</span>;
  });
}

export default function ChannelAboutDialog({       channel, bioLinks, onClose, children }) {
  const dialog = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
      className="m-auto w-[calc(100%_-_1.5rem)] max-w-lg overflow-hidden rounded-2xl border border-[#E8E2D9] bg-white text-[#0F0F0F] shadow-2xl backdrop:bg-black/65 sm:w-[calc(100%_-_2rem)] sm:rounded-[1.5rem] dark:border-white/10 dark:bg-[#181818] dark:text-[#F1F1F1]"
    >
      <div className="flex max-h-[min(82dvh,44rem)] min-h-0 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E8E2D9] px-4 py-3 sm:px-6 dark:border-white/10">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-lg font-extrabold">{channel?.name}</h2>
            {channel?.handle && <p className="text-xs text-[#606060] dark:text-[#AAAAAA]">@{channel.handle}</p>}
          </div>
          <button type="button" aria-label="ปิดรายละเอียดช่อง" onClick={() => dialog.current?.close()}
            className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-full bg-[#F5F2EB] text-[#514942] hover:bg-[#E8E2D9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#FF7A00] dark:bg-white/8 dark:text-[#E5E5E5] dark:hover:bg-white/15">
            <X aria-hidden="true" className="size-5" />
          </button>
        </header>
        <div
          tabIndex={0}
          role="region"
          aria-label="รายละเอียดช่อง"
          className="mx-2 min-h-0 overflow-y-auto overscroll-contain px-2 py-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[#FF7A00] [scrollbar-color:#A69D92_transparent] [scrollbar-width:thin] sm:mx-3 sm:px-3 sm:py-5 dark:[scrollbar-color:#6B625B_transparent]"
        >
          <div className="space-y-5">
      {channel?.bio && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-[#514942] dark:text-[#CCC5BE]">
            คำอธิบาย
          </h3>
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-[#212529] dark:text-[#E5E5E5]">
            {renderBioWithLinks(channel.bio)}
          </p>
        </div>
      )}

      {bioLinks.length > 0 && (
        <div className="space-y-2.5">
          <h3 className="text-sm font-semibold text-[#514942] dark:text-[#CCC5BE]">
            ลิงก์ของช่อง
          </h3>
          <div className="flex flex-col gap-2">
            {bioLinks.map((lnk) => (
              <a
                key={lnk.href}
                href={lnk.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-2.5 rounded-xl bg-[#FBF9F5] dark:bg-white/5 hover:bg-[#F4F0E8] dark:hover:bg-white/10 border border-[#EFECE6] dark:border-white/10 transition group"
              >
                <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#262626] flex items-center justify-center shrink-0">
                  <ChannelLinkIcon hostname={lnk.hostname} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold group-hover:text-[#FF7A00] transition truncate">
                    {lnk.label}
                  </div>
                  <div className="text-[11px] text-[#606060] dark:text-[#AAAAAA] truncate">
                    {lnk.displayUrl}
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-[#8C857B] shrink-0" />
              </a>
            ))}
          </div>
        </div>
      )}

            {children}
          </div>
        </div>
      </div>
    </dialog>
  );
}

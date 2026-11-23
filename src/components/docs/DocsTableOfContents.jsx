'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlignLeft, ArrowUp, Edit3 } from 'lucide-react';

const THAI_SHORT_MONTHS = {
  มกราคม: 'ม.ค.',
  กุมภาพันธ์: 'ก.พ.',
  มีนาคม: 'มี.ค.',
  เมษายน: 'เม.ย.',
  พฤษภาคม: 'พ.ค.',
  มิถุนายน: 'มิ.ย.',
  กรกฎาคม: 'ก.ค.',
  สิงหาคม: 'ส.ค.',
  กันยายน: 'ก.ย.',
  ตุลาคม: 'ต.ค.',
  พฤศจิกายน: 'พ.ย.',
  ธันวาคม: 'ธ.ค.',
};

function shortenThaiDate(raw = '') {
  let out = String(raw || '').trim();
  for (const [full, abbr] of Object.entries(THAI_SHORT_MONTHS)) {
    if (out.includes(full)) {
      out = out.replace(full, abbr);
    }
  }
  return out;
}

function parseReleaseEntry(title) {
  const clean = String(title || '').trim();

  // Pattern 1: "เวอร์ชัน 1.2.8 (Build 1.2.8.20261123 — 23 พฤศจิกายน 2026) — Subtitle..."
  // or "เวอร์ชัน 1.2.7 Patch v2 (Build ... — 19 พฤศจิกายน 2026) — Subtitle..."
  // or "เวอร์ชัน 1.2.0 (ตุลาคม 2026) — Subtitle..."
  const verMatch = clean.match(
    /^เวอร์ชัน\s+([0-9]+(?:\.[0-9]+)*)(?:\s+Patch\s+v?([0-9]+))?(?:\s*\(([^)]+)\))?(?:\s*[—–-]\s*(.+))?$/i
  );
  if (verMatch) {
    const versionCore = verMatch[1];
    const patchNum = verMatch[2];
    const parenInfo = verMatch[3] || '';
    const subtitle = (verMatch[4] || '').trim();

    let dateText = '';
    if (parenInfo) {
      const parts = parenInfo.split(/[—–]/).map((p) => p.trim()).filter(Boolean);
      const dateCandidate = parts.length > 1 ? parts[parts.length - 1] : parts[0];
      if (dateCandidate && !/^build\s+/i.test(dateCandidate)) {
        dateText = shortenThaiDate(dateCandidate);
      }
    }

    return {
      isRelease: true,
      badge: patchNum ? `v${versionCore} p${patchNum}` : `v${versionCore}`,
      date: dateText,
      subtitle,
    };
  }

  // Pattern 2: "17 พฤศจิกายน 2026 — คลังวิดีโอ, หน้าแก้ไข..."
  const dateOnlyMatch = clean.match(
    /^(\d{1,2}\s+(?:มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม)\s+\d{4})\s*[—–-]\s*(.+)$/
  );
  if (dateOnlyMatch) {
    return {
      isRelease: true,
      badge: shortenThaiDate(dateOnlyMatch[1]),
      date: '',
      subtitle: dateOnlyMatch[2].trim(),
    };
  }

  return {
    isRelease: false,
    label: clean,
  };
}

export default function DocsTableOfContents({
  items = [],
  docSlug = '',
  githubEditUrl = '',
}) {
  const isChangelog = docSlug === 'patchnote' || docSlug === 'patchnotes' || docSlug === 'changelog';

  const parsedItems = useMemo(
    () =>
      items.map((item) => ({
        ...item,
        parsed: isChangelog ? parseReleaseEntry(item.title) : { isRelease: false, label: item.title },
      })),
    [items, isChangelog]
  );

  const [activeId, setActiveId] = useState(parsedItems[0]?.id || '');
  const [showBackToTop, setShowBackToTop] = useState(false);
  const navRef = useRef(null);
  const itemRefs = useRef(new Map());

  useEffect(() => {
    if (parsedItems.length === 0) return undefined;

    let rafId = 0;
    const ids = parsedItems.map((it) => it.id);

    const computeActive = () => {
      rafId = 0;
      const scrollY = window.scrollY;
      setShowBackToTop(scrollY > 360);

      // If near the very bottom of the page, activate the last heading
      const nearBottom =
        window.innerHeight + scrollY >= document.documentElement.scrollHeight - 40;
      if (nearBottom) {
        setActiveId(ids[ids.length - 1]);
        return;
      }

      const offset = 112;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top <= offset) {
          current = id;
        } else {
          break;
        }
      }
      setActiveId(current);
    };

    const handleScroll = () => {
      if (!rafId) {
        rafId = window.requestAnimationFrame(computeActive);
      }
    };

    computeActive();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [parsedItems]);

  // Keep the active TOC link visible inside the scrollable sidebar
  useEffect(() => {
    if (!activeId || !navRef.current) return;
    const activeEl = itemRefs.current.get(activeId);
    if (!activeEl) return;
    const navRect = navRef.current.getBoundingClientRect();
    const elRect = activeEl.getBoundingClientRect();
    if (elRect.top < navRect.top + 24 || elRect.bottom > navRect.bottom - 24) {
      activeEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [activeId]);

  const handleJump = (e, id) => {
    e.preventDefault();
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActiveId(id);
      if (typeof window !== 'undefined') {
        window.history.replaceState(null, '', `#${id}`);
      }
    }
  };

  const handleBackToTop = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (parsedItems.length === 0) return null;

  return (
    <aside
      aria-label="สารบัญในหน้านี้"
      className="hidden xl:flex flex-col w-64 shrink-0 sticky top-20 h-[calc(100vh-6rem)] select-none"
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between gap-2 pb-3 mb-1">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#8C857B] dark:text-[#7A7A7A]">
          <AlignLeft className="w-3.5 h-3.5 opacity-80" />
          <span>On this page</span>
        </div>
        <span className="text-[10px] font-mono font-medium px-1.5 py-0.5 rounded-md bg-black/[0.04] dark:bg-white/[0.06] text-[#8C857B] dark:text-[#888888] tabular-nums">
          {parsedItems.length}
        </span>
      </div>

      {/* Scrollable Navigation Rail */}
      <nav
        ref={navRef}
        className="flex-1 min-h-0 overflow-y-auto docs-toc-scroll pr-2.5 py-0.5"
      >
        <ul className="relative flex flex-col gap-0.5 border-l border-[#EFECE6] dark:border-white/[0.08]">
          {parsedItems.map((item, idx) => {
            const isActive = activeId === item.id;
            const { parsed } = item;

            if (parsed.isRelease) {
              const isLatest = isChangelog && idx === 0;
              return (
                <li key={`${item.id}-${idx}`} className="relative">
                  <a
                    ref={(node) => {
                      if (node) itemRefs.current.set(item.id, node);
                      else itemRefs.current.delete(item.id);
                    }}
                    href={`#${item.id}`}
                    onClick={(e) => handleJump(e, item.id)}
                    title={item.title}
                    className={`group relative block pl-3.5 pr-2.5 py-2 rounded-r-lg transition-colors duration-150 ${
                      isActive
                        ? 'bg-[#FF7A00]/[0.08] dark:bg-[#FF7A00]/[0.10]'
                        : 'hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                    }`}
                  >
                    {/* Active Rail Indicator */}
                    <span
                      aria-hidden="true"
                      className={`absolute -left-px top-2 bottom-2 w-[2px] rounded-full transition-opacity duration-150 ${
                        isActive
                          ? 'bg-[#FF7A00] opacity-100'
                          : 'bg-[#8C857B]/40 dark:bg-white/25 opacity-0 group-hover:opacity-100'
                      }`}
                    />

                    <div className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={`font-mono text-[11.5px] font-semibold tracking-tight truncate transition-colors ${
                            isActive
                              ? 'text-[#FF7A00]'
                              : 'text-[#212529] dark:text-[#E2E2E2] group-hover:text-[#FF7A00]'
                          }`}
                        >
                          {parsed.badge}
                        </span>
                        {isLatest && (
                          <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-px rounded-full bg-[#FF7A00]/15 text-[#FF7A00] leading-tight">
                            New
                          </span>
                        )}
                      </span>
                      {parsed.date && (
                        <span className="shrink-0 text-[10px] font-medium text-[#9A9389] dark:text-[#666666] tabular-nums">
                          {parsed.date}
                        </span>
                      )}
                    </div>

                    {parsed.subtitle && (
                      <p
                        className={`mt-0.5 text-[11px] leading-snug truncate transition-colors ${
                          isActive
                            ? 'text-[#4A453E] dark:text-[#CCCCCC]'
                            : 'text-[#8C857B] dark:text-[#787878] group-hover:text-[#4A453E] dark:group-hover:text-[#B5B5B5]'
                        }`}
                      >
                        {parsed.subtitle}
                      </p>
                    )}
                  </a>
                </li>
              );
            }

            return (
              <li key={`${item.id}-${idx}`} className="relative">
                <a
                  ref={(node) => {
                    if (node) itemRefs.current.set(item.id, node);
                    else itemRefs.current.delete(item.id);
                  }}
                  href={`#${item.id}`}
                  onClick={(e) => handleJump(e, item.id)}
                  title={item.title}
                  className={`group relative block pl-3.5 pr-2.5 py-1.5 rounded-r-lg text-[12px] leading-relaxed transition-colors duration-150 ${
                    isActive
                      ? 'text-[#FF7A00] font-semibold bg-[#FF7A00]/[0.07] dark:bg-[#FF7A00]/[0.09]'
                      : 'text-[#666666] dark:text-[#969696] hover:text-[#1F1E1C] dark:hover:text-[#F1F1F1] hover:bg-black/[0.03] dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`absolute -left-px top-1.5 bottom-1.5 w-[2px] rounded-full transition-opacity duration-150 ${
                      isActive
                        ? 'bg-[#FF7A00] opacity-100'
                        : 'bg-[#8C857B]/40 dark:bg-white/25 opacity-0 group-hover:opacity-100'
                    }`}
                  />
                  <span className="line-clamp-2">{parsed.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Pinned Compact Footer Actions */}
      <div className="shrink-0 mt-3 pt-3 border-t border-[#EFECE6] dark:border-white/[0.08] flex flex-col gap-1">
        {showBackToTop && (
          <button
            type="button"
            onClick={handleBackToTop}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11.5px] font-medium text-[#7A746B] dark:text-[#888888] hover:text-[#1F1E1C] dark:hover:text-white hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition cursor-pointer text-left"
          >
            <ArrowUp className="w-3.5 h-3.5 shrink-0" />
            <span>กลับขึ้นด้านบน</span>
          </button>
        )}

        {githubEditUrl && (
          <a
            href={githubEditUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[11.5px] font-medium text-[#7A746B] dark:text-[#888888] hover:text-[#FF7A00] hover:bg-black/[0.03] dark:hover:bg-white/[0.04] transition"
          >
            <Edit3 className="w-3.5 h-3.5 shrink-0" />
            <span>Edit this page on GitHub</span>
          </a>
        )}
      </div>
    </aside>
  );
}

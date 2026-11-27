import React from 'react';
import Link from 'next/link';
import { renderMarkdownDocument } from '@/lib/renderMarkdownDocument';
import { Edit3, ChevronRight, ArrowLeft, ArrowRight, Clock } from 'lucide-react';
import DocsTableOfContents from './DocsTableOfContents';

function formatThaiDate(dateInput) {
  if (!dateInput) return null;
  const str = String(dateInput).trim();
  if (/ตุลาคม|พฤศจิกายน|ธันวาคม|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน/.test(str)) {
    return str;
  }
  try {
    const d = new Date(str);
    if (isNaN(d.getTime())) return str;
    return d.toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return str;
  }
}

export default async function MarkdownDocViewer({
  docSlug,        // e.g. 'policy'
  docPath,        // e.g. 'docs/policy.md'
  markdown = '', // Content already loaded from docs/ by getDocBySlug
  title,          // e.g. 'Privacy Policy'
  category = 'Legal',
  updatedAt = null,
  prevPage = null,
  nextPage = null,
}) {
  const displayDate = formatThaiDate(updatedAt);
  const { html: htmlContent, toc } = renderMarkdownDocument(markdown);

  const githubEditUrl = `https://github.com/DoNuTll40/next-tubelock/blob/main/${docPath}`;

  return (
    <div className="flex gap-10 xl:gap-14 w-full">
      {/* 📄 Center Main Article */}
      <article className="flex-1 min-w-0 w-full flex flex-col gap-6">
        {/* 🧭 Top Breadcrumb & Last Updated */}
        <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-[#EFECE6] dark:border-white/10 text-xs text-[#8C857B] dark:text-[#777777]">
          <div className="flex items-center gap-1.5 font-medium">
            <span>{category}</span>
            <ChevronRight className="w-3.5 h-3.5 opacity-60" />
            <span className="text-[#212529] dark:text-[#F1F1F1] font-semibold">{title}</span>
          </div>
          {displayDate && (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-[#8C857B] dark:text-[#888888]">
              <Clock className="w-3.5 h-3.5 opacity-75" />
              <span>อัปเดตเมื่อ: <span className="text-[#212529] dark:text-[#F1F1F1]">{displayDate}</span></span>
            </div>
          )}
        </div>

        {/* 📖 Rendered Markdown Prose HTML with clean styles */}
        <div
          className="prose-clean text-[#4A453E] dark:text-[#CCCCCC] text-xs sm:text-sm leading-[1.85]
            [&_h1]:text-2xl [&_h1]:sm:text-3xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:text-[#1F1E1C] [&_h1]:dark:text-[#F1F1F1] [&_h1]:mb-3
            [&_h2]:text-base [&_h2]:sm:text-lg [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-[#1F1E1C] [&_h2]:dark:text-[#F1F1F1] [&_h2]:pb-1.5 [&_h2]:border-b [&_h2]:border-[#EFECE6] [&_h2]:dark:border-white/10 [&_h2]:mt-8 [&_h2]:mb-3
            [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-[#1F1E1C] [&_h3]:dark:text-[#F1F1F1] [&_h3]:mt-6 [&_h3]:mb-2
            [&_p]:my-3
            [&_strong]:font-semibold [&_strong]:text-[#1F1E1C] [&_strong]:dark:text-[#F1F1F1]
            [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_ul]:my-3
            [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1.5 [&_ol]:my-3
            [&_li]:my-1
            [&_blockquote]:my-4 [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-2 [&_blockquote]:border-[#FF7A00] [&_blockquote]:bg-[#FF7A00]/[0.07] [&_blockquote]:dark:bg-[#FF7A00]/[0.09]
            [&_blockquote]:px-4 [&_blockquote]:py-3 [&_blockquote]:text-xs [&_blockquote]:sm:text-[13px] [&_blockquote>p:first-child]:mt-0 [&_blockquote>p:last-child]:mb-0
            [&_blockquote_strong]:text-[#9C4300] [&_blockquote_strong]:dark:text-[#FF7A00]
            [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-black/5 [&_code]:dark:bg-white/10 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-[#1F1E1C] [&_code]:dark:text-[#F1F1F1]
            [&_hr]:border-[#EFECE6] [&_hr]:dark:border-white/10 [&_hr]:my-6
            [&_table]:w-full [&_table]:text-left [&_table]:text-xs [&_table]:border-collapse [&_table]:my-4 [&_table]:rounded-lg [&_table]:border [&_table]:border-[#EFECE6] [&_table]:dark:border-white/10
            [&_th]:py-2.5 [&_th]:px-3.5 [&_th]:bg-black/[0.02] [&_th]:dark:bg-white/[0.04] [&_th]:text-[#1F1E1C] [&_th]:dark:text-[#F1F1F1] [&_th]:font-semibold [&_th]:border-b [&_th]:border-[#EFECE6] [&_th]:dark:border-white/10
            [&_td]:py-2.5 [&_td]:px-3.5 [&_td]:border-b [&_td]:border-[#EFECE6] [&_td]:dark:border-white/5
            [&_a]:text-[#FF7A00] [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />

        {/* 🖊️ "Edit this page on GitHub" & "Source / Updated At" section */}
        <div className="pt-6 mt-4 border-t border-[#EFECE6] dark:border-white/10 flex flex-wrap items-center justify-between gap-4">
          <a
            href={githubEditUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-medium text-[#FF7A00] hover:text-[#FF7A00]/80 transition group cursor-pointer"
          >
            <Edit3 className="w-4 h-4 text-[#FF7A00]" />
            <span>Edit this page on GitHub</span>
          </a>

          <div className="flex flex-wrap items-center gap-2.5 text-xs text-[#8C857B] dark:text-[#777777]">
            {displayDate && (
              <span className="inline-flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 opacity-70" />
                <span>อัปเดตเมื่อ: <span className="font-medium text-[#212529] dark:text-[#F1F1F1]">{displayDate}</span></span>
              </span>
            )}
            {displayDate && <span className="opacity-40">•</span>}
            <span>
              Source: <code className="font-mono text-[11px]">{docPath}</code>
            </span>
          </div>
        </div>

        {/* 🧭 Docs Pagination Navigation Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
          {prevPage ? (
            <Link
              href={prevPage.href}
              className="flex flex-col p-4 rounded-lg border border-[#EFECE6] dark:border-white/10 hover:border-[#8C857B] dark:hover:border-white/20 transition group bg-white dark:bg-[#141414]"
            >
              <span className="text-[10px] text-[#8C857B] dark:text-[#777777] flex items-center gap-1 font-semibold uppercase tracking-wider">
                <ArrowLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
                <span>ก่อนหน้า</span>
              </span>
              <span className="text-xs sm:text-sm font-semibold text-[#1F1E1C] dark:text-[#F1F1F1] mt-1">
                {prevPage.title}
              </span>
            </Link>
          ) : <div />}

          {nextPage ? (
            <Link
              href={nextPage.href}
              className="flex flex-col p-4 rounded-lg border border-[#EFECE6] dark:border-white/10 hover:border-[#8C857B] dark:hover:border-white/20 transition group bg-white dark:bg-[#141414] text-right"
            >
              <span className="text-[10px] text-[#8C857B] dark:text-[#777777] flex items-center justify-end gap-1 font-semibold uppercase tracking-wider">
                <span>ถัดไป</span>
                <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
              </span>
              <span className="text-xs sm:text-sm font-semibold text-[#1F1E1C] dark:text-[#F1F1F1] mt-1">
                {nextPage.title}
              </span>
            </Link>
          ) : <div />}
        </div>
      </article>

      {/* 🧭 Right Sidebar: Sleek Interactive Table of Contents with Scrollspy */}
      <DocsTableOfContents
        items={toc}
        docSlug={docSlug}
        githubEditUrl={githubEditUrl}
      />
    </div>
  );
}

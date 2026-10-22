import React from 'react';
import Link from 'next/link';
import fs from 'fs/promises';
import path from 'path';
import { marked } from 'marked';
import { Edit3, ChevronRight, ArrowLeft, ArrowRight } from 'lucide-react';

// Configure marked with GFM (GitHub Flavored Markdown)
marked.setOptions({
  gfm: true,
  breaks: true,
});

export default async function MarkdownDocViewer({
  docSlug,        // e.g. 'policy'
  docPath,        // e.g. 'docs/policy.md'
  title,          // e.g. 'Privacy Policy'
  category = 'Legal',
  prevPage = null,
  nextPage = null,
}) {
  const fullPath = path.join(process.cwd(), docPath);
  let markdown = '';
  try {
    markdown = await fs.readFile(fullPath, 'utf-8');
  } catch (err) {
    markdown = `# Error\n\nCould not load \`${docPath}\`: ${err.message}`;
  }

  // Strip frontmatter metadata (--- ... ---) from display content
  markdown = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  // Extract H2 headings for "On this page" TOC
  const headingRegex = /^##\s+(.+)$/gm;
  const toc = [];
  let match;
  while ((match = headingRegex.exec(markdown)) !== null) {
    const rawTitle = match[1].trim();
    const id = rawTitle
      .toLowerCase()
      .replace(/[^\w\u0E00-\u0E7F]+/g, '-')
      .replace(/^-+|-+$/g, '');
    toc.push({ id, title: rawTitle });
  }

  // Parse Markdown to standard HTML (Use marked default without broken renderer overrides)
  let htmlContent = marked.parse(markdown);

  // Inject id to <h2> tags so TOC anchor links jump directly to sections
  htmlContent = htmlContent.replace(/<h2[^>]*>(.*?)<\/h2>/gi, (fullMatch, headingInner) => {
    const plainText = headingInner.replace(/<[^>]+>/g, '').trim();
    const id = plainText
      .toLowerCase()
      .replace(/[^\w\u0E00-\u0E7F]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return `<h2 id="${id}" class="scroll-mt-20">${headingInner}</h2>`;
  });

  const githubEditUrl = `https://github.com/DoNuTll40/next-tubelock/blob/main/${docPath}`;

  return (
    <div className="flex gap-10 xl:gap-14 w-full">
      {/* 📄 Center Main Article */}
      <article className="flex-1 min-w-0 w-full flex flex-col gap-6">
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
            [&_blockquote]:p-4 [&_blockquote]:rounded-lg [&_blockquote]:bg-black/[0.02] [&_blockquote]:dark:bg-white/[0.03] [&_blockquote]:border-l-2 [&_blockquote]:border-[#8C857B] [&_blockquote]:dark:border-[#666666] [&_blockquote]:my-4 [&_blockquote]:text-xs [&_blockquote]:sm:text-[13px]
            [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-black/5 [&_code]:dark:bg-white/10 [&_code]:font-mono [&_code]:text-[11px] [&_code]:text-[#1F1E1C] [&_code]:dark:text-[#F1F1F1]
            [&_hr]:border-[#EFECE6] [&_hr]:dark:border-white/10 [&_hr]:my-6
            [&_table]:w-full [&_table]:text-left [&_table]:text-xs [&_table]:border-collapse [&_table]:my-4 [&_table]:rounded-lg [&_table]:border [&_table]:border-[#EFECE6] [&_table]:dark:border-white/10
            [&_th]:py-2.5 [&_th]:px-3.5 [&_th]:bg-black/[0.02] [&_th]:dark:bg-white/[0.04] [&_th]:text-[#1F1E1C] [&_th]:dark:text-[#F1F1F1] [&_th]:font-semibold [&_th]:border-b [&_th]:border-[#EFECE6] [&_th]:dark:border-white/10
            [&_td]:py-2.5 [&_td]:px-3.5 [&_td]:border-b [&_td]:border-[#EFECE6] [&_td]:dark:border-white/5
            [&_a]:text-[#ec4899] [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: htmlContent }}
        />

        {/* 🖊️ "Edit this page on GitHub" section (Links directly to the .md file!) */}
        <div className="pt-6 mt-4 border-t border-[#EFECE6] dark:border-white/10 flex flex-wrap items-center justify-between gap-4">
          <a
            href={githubEditUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 text-xs sm:text-sm font-medium text-[#ec4899] hover:text-[#f472b6] transition group cursor-pointer"
          >
            <Edit3 className="w-4 h-4 text-[#ec4899]" />
            <span>Edit this page on GitHub</span>
          </a>

          <span className="text-xs text-[#8C857B] dark:text-[#777777]">
            Source: <code className="font-mono text-[11px]">{docPath}</code>
          </span>
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

      {/* 🧭 Right Sidebar: "On this page" TOC extracted from markdown headings */}
      {toc.length > 0 && (
        <aside className="hidden xl:flex flex-col w-56 shrink-0 sticky top-20 h-[calc(100vh-6rem)] overflow-y-auto no-scrollbar text-xs">
          <span className="font-bold text-[11px] uppercase tracking-wider text-[#8C857B] dark:text-[#777777] mb-3">
            On this page
          </span>
          <ul className="flex flex-col gap-2 border-l border-[#EFECE6] dark:border-white/10 pl-3">
            {toc.map((item, idx) => (
              <li key={idx}>
                <a
                  href={`#${item.id}`}
                  className="text-[#666666] dark:text-[#999999] hover:text-[#1F1E1C] dark:hover:text-white transition-colors block py-0.5 line-clamp-1"
                >
                  {item.title}
                </a>
              </li>
            ))}
          </ul>

          <div className="mt-8 pt-4 border-t border-[#EFECE6] dark:border-white/10 flex flex-col gap-2.5">
            <a
              href={githubEditUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs text-[#ec4899] hover:text-[#f472b6] transition"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit this page on GitHub</span>
            </a>
          </div>
        </aside>
      )}
    </div>
  );
}

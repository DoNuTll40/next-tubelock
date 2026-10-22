'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Menu, X, ExternalLink, ArrowLeft, Lock, FileText,
  HelpCircle, Shield, BookOpen
} from 'lucide-react';

function GitHubIcon({ className = "w-3.5 h-3.5" }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

function getIconForDoc(slug) {
  if (slug === 'faq') return HelpCircle;
  if (slug === 'policy') return Shield;
  if (slug === 'terms') return FileText;
  return BookOpen;
}

export default function TubelockDocsShell({ nav = [], children }) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-[#FBF9F5] dark:bg-[#0F0F0F] text-[#212529] dark:text-[#F1F1F1] transition-colors">
      {/* 🧭 Top Docs Header */}
      <header className="sticky top-0 z-40 w-full h-14 bg-white/80 dark:bg-[#121212]/80 backdrop-blur-md border-b border-[#EFECE6] dark:border-white/10 px-4 sm:px-6 flex items-center justify-between">
        {/* Left: Mobile hamburger + Docs Brand */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 rounded-lg md:hidden text-[#8C857B] hover:text-[#212529] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition"
            aria-label="Toggle docs navigation"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <Link href="/" className="flex items-center gap-2 group">
            <div className="w-7 h-7 rounded-lg bg-[#FF7A00] flex items-center justify-center text-white shadow-2xs">
              <Lock className="w-4 h-4" />
            </div>
            <span className="font-black text-sm tracking-tight text-[#212529] dark:text-[#F1F1F1]">
              TubeLock
            </span>
            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-black/5 dark:bg-white/10 text-[#666666] dark:text-[#AAAAAA] border border-black/10 dark:border-white/10">
              DOCS
            </span>
          </Link>
        </div>

        {/* Right: Actions */}
        <div className="flex items-center gap-3 text-xs">
          <Link
            href="/"
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[#8C857B] dark:text-[#AAAAAA] hover:text-[#212529] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5 transition font-medium"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>กลับสู่ TubeLock</span>
          </Link>

          <a
            href="https://github.com/DoNuTll40/next-tubelock"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0000000a] dark:bg-white/10 hover:bg-[#00000012] dark:hover:bg-white/15 text-[#212529] dark:text-[#F1F1F1] font-semibold transition active:scale-95 shadow-2xs"
          >
            <GitHubIcon className="w-3.5 h-3.5" />
            <span>GitHub</span>
            <ExternalLink className="w-3 h-3 text-[#8C857B] opacity-70" />
          </a>
        </div>
      </header>

      {/* 📑 Docs Shell: Dynamic Sidebar + Content */}
      <div className="flex-1 flex w-full">
        {/* Left Sidebar (Desktop Fixed - Dynamic From docs/*.md) */}
        <aside className="hidden md:flex flex-col w-64 shrink-0 border-r border-[#EFECE6] dark:border-white/10 p-5 sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto no-scrollbar">
          <div className="flex flex-col gap-6">
            {nav.map((group, gIdx) => (
              <div key={gIdx} className="flex flex-col gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#8C857B] dark:text-[#777777] px-2.5">
                  {group.group}
                </span>
                <div className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const Icon = getIconForDoc(item.slug);
                    const isActive = pathname === item.href;
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs transition ${
                          isActive
                            ? 'bg-black/5 dark:bg-white/10 text-[#1F1E1C] dark:text-white font-bold'
                            : 'text-[#666666] dark:text-[#AAAAAA] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[#212529] dark:hover:text-white font-medium'
                        }`}
                      >
                        <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#1F1E1C] dark:text-white' : 'text-[#8C857B] dark:text-[#777777]'}`} />
                        <span className="truncate">{item.title}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Sidebar Footer info */}
          <div className="mt-auto pt-6 border-t border-[#EFECE6] dark:border-white/10 text-[10px] text-[#8C857B] dark:text-[#777777]">
            <p className="font-semibold text-[#5A554E] dark:text-[#999999]">TubeLock Documentation</p>
            <p className="text-[9px] mt-0.5">Auto-synced with docs/*.md</p>
          </div>
        </aside>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          >
            <div
              className="w-72 max-w-[85vw] h-full bg-[#FBF9F5] dark:bg-[#141414] border-r border-[#EFECE6] dark:border-white/10 p-5 flex flex-col gap-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-3 border-b border-[#EFECE6] dark:border-white/10">
                <span className="font-bold text-xs uppercase tracking-wider text-[#8C857B]">
                  เอกสารประกอบระบบ
                </span>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 rounded-lg text-[#8C857B] hover:text-[#212529] dark:hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex flex-col gap-6 overflow-y-auto">
                {nav.map((group, gIdx) => (
                  <div key={gIdx} className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#8C857B] dark:text-[#777777] px-2.5">
                      {group.group}
                    </span>
                    <div className="flex flex-col gap-0.5">
                      {group.items.map((item) => {
                        const Icon = getIconForDoc(item.slug);
                        const isActive = pathname === item.href;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-xs transition ${
                              isActive
                                ? 'bg-black/5 dark:bg-white/10 text-[#1F1E1C] dark:text-white font-bold'
                                : 'text-[#666666] dark:text-[#CCCCCC] hover:bg-black/5 dark:hover:bg-white/5 font-medium'
                            }`}
                          >
                            <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#1F1E1C] dark:text-white' : 'text-[#8C857B]'}`} />
                            <span className="truncate">{item.title}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-auto pt-4 border-t border-[#EFECE6] dark:border-white/10">
                <Link
                  href="/"
                  className="flex items-center gap-2 text-xs font-semibold text-[#8C857B] hover:text-white"
                >
                  <ArrowLeft className="w-4 h-4" />
                  <span>กลับหน้าหลัก TubeLock</span>
                </Link>
              </div>
            </div>
          </div>
        )}

        {/* 📖 Center Main Content */}
        <main className="flex-1 min-w-0 px-6 sm:px-10 lg:px-12 py-8 sm:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}

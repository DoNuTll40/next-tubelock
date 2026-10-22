'use client';

import React from 'react';
import Link from 'next/link';
import SettingCard from '@/components/ui/SettingCard';
import SettingRow from '@/components/ui/SettingRow';
import {
  LifeBuoy, ChevronRight, ExternalLink,
  Bug, MessageSquare, GitBranch, Globe, Info, Zap,
  HelpCircle, Shield, FileText,
} from 'lucide-react';

const APP_VERSION = '1.0.0-beta';

export default function SupportSection() {
  return (
    <div className="flex flex-col gap-6 animate-fadeIn px-4">
      {/* Header */}
      <div className="pb-2 border-b border-[#EFECE6] dark:border-white/10">
        <h2 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1]">ช่วยเหลือและติดต่อ</h2>
        <p className="text-xs text-[#8C857B] dark:text-[#AAAAAA] mt-1">
          ศูนย์ช่วยเหลือ, นโยบายความเป็นส่วนตัว, รายงานปัญหา และข้อมูลเวอร์ชัน
        </p>
      </div>

      {/* App Info Banner */}
      <div className="flex items-center gap-4 p-4 bg-gradient-to-r from-[#FF7A00]/8 to-violet-500/8 dark:from-[#FF7A00]/10 dark:to-violet-500/10 border border-[#FF7A00]/20 dark:border-[#FF7A00]/20 rounded-2xl">
        <div className="w-12 h-12 rounded-2xl bg-[#FF7A00] flex items-center justify-center shadow-[0_4px_12px_rgba(255,122,0,0.3)] shrink-0">
          <Zap className="w-5 h-5 text-white fill-white" />
        </div>
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1]">TubeLock Studio</span>
          <span className="text-[11px] text-[#8C857B] dark:text-[#AAAAAA]">
            Private HLS Streaming Platform
          </span>
          <div className="flex items-center gap-2 mt-1">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#FF7A00]/15 text-[10px] font-bold text-[#FF7A00]">
              v{APP_VERSION}
            </span>
            <span className="text-[10px] text-[#8C857B] dark:text-[#888888]">Next.js · Neon DB · OneDrive HLS</span>
          </div>
        </div>
      </div>

      {/* Help & Standalone Documentation Cards */}
      <SettingCard title="คู่มือและความช่วยเหลือ" subtitle="ศูนย์ช่วยเหลือ นโยบาย และข้อกำหนดการใช้งาน">
        <div className="divide-y divide-[#EFECE6] dark:divide-white/10">
          {/* FAQ Link */}
          <Link
            href="/tubelock/faq"
            className="flex items-center justify-between p-4 sm:p-5 hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#FF7A00]/10 text-[#FF7A00] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1] group-hover:text-[#FF7A00] transition-colors truncate">
                  คำถามที่พบบ่อย (FAQ)
                </span>
                <span className="text-[11px] text-[#8C857B] dark:text-[#AAAAAA] mt-0.5 line-clamp-1">
                  รวมคำตอบเกี่ยวกับการใช้งาน TubeLock, ระบบตัวกลางสตรีม และการแก้ปัญหาทั่วไป
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888] shrink-0 ml-2 group-hover:translate-x-0.5 transition-transform" />
          </Link>

          {/* Privacy Policy Link */}
          <Link
            href="/tubelock/policy"
            className="flex items-center justify-between p-4 sm:p-5 hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <Shield className="w-5 h-5" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1] group-hover:text-emerald-500 transition-colors truncate">
                  นโยบายความเป็นส่วนตัว (Privacy Policy)
                </span>
                <span className="text-[11px] text-[#8C857B] dark:text-[#AAAAAA] mt-0.5 line-clamp-1">
                  OneDrive ตัวกลางจัดเก็บ ไม่เก็บไฟล์คลิปเต็มต้นฉบับ ต้นฉบับอยู่กับเจ้าของงาน 100%
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888] shrink-0 ml-2 group-hover:translate-x-0.5 transition-transform" />
          </Link>

          {/* Terms of Service Link */}
          <Link
            href="/tubelock/terms"
            className="flex items-center justify-between p-4 sm:p-5 hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer group"
          >
            <div className="flex items-center gap-3.5 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-violet-500/10 text-violet-500 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                <FileText className="w-5 h-5" />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1] group-hover:text-violet-500 transition-colors truncate">
                  ข้อกำหนดการใช้งาน (Terms of Service)
                </span>
                <span className="text-[11px] text-[#8C857B] dark:text-[#AAAAAA] mt-0.5 line-clamp-1">
                  เงื่อนไขการใช้งานแพลตฟอร์ม และข้อตกลงการใช้งานส่วนบุคคล
                </span>
              </div>
            </div>
            <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888] shrink-0 ml-2 group-hover:translate-x-0.5 transition-transform" />
          </Link>
        </div>
      </SettingCard>

      {/* Contact / Report Section */}
      <SettingCard title="ติดต่อและรายงาน" subtitle="ช่องทางขอความช่วยเหลือและแจ้งปัญหา">
        <SettingRow
          title="รายงานปัญหา (Report a Bug)"
          description="พบ Bug หรือปัญหาการใช้งาน แจ้งได้ที่ GitHub Issues"
          isClickable
        >
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-1.5 rounded-xl bg-[#F5F2EB] dark:bg-white/10 hover:bg-[#EFECE6] dark:hover:bg-white/15 text-[#212529] dark:text-[#F1F1F1] text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 active:scale-95"
          >
            <Bug className="w-3.5 h-3.5 text-rose-500" />
            <span>GitHub Issues</span>
            <ExternalLink className="w-3 h-3 text-[#8C857B]" />
          </a>
        </SettingRow>

        <SettingRow
          title="ส่งข้อเสนอแนะ (Feedback)"
          description="แนะนำ Feature ใหม่หรือปรับปรุง UI ได้ที่ Discussions"
          isClickable
        >
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-1.5 rounded-xl bg-violet-50 dark:bg-violet-950/40 hover:bg-violet-100 dark:hover:bg-violet-900/40 text-violet-600 dark:text-violet-400 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 border border-violet-200 dark:border-violet-900/50 active:scale-95"
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Discussions</span>
            <ExternalLink className="w-3 h-3 opacity-60" />
          </a>
        </SettingRow>

        <SettingRow
          title="Source Code"
          description="TubeLock เป็น Open Source — ดูและ Contribute ได้บน GitHub"
          isClickable
        >
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="px-3.5 py-1.5 rounded-xl bg-[#F5F2EB] dark:bg-white/10 hover:bg-[#EFECE6] dark:hover:bg-white/15 text-[#212529] dark:text-[#F1F1F1] text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 active:scale-95"
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>GitHub</span>
            <ExternalLink className="w-3 h-3 text-[#8C857B]" />
          </a>
        </SettingRow>
      </SettingCard>

      {/* System Info */}
      <SettingCard title="ข้อมูลระบบ" subtitle="เวอร์ชันและ Environment ที่ใช้งาน">
        <div className="p-4 sm:p-5 flex flex-col gap-2.5">
          {[
            { label: 'App Version', value: `v${APP_VERSION}` },
            { label: 'Framework', value: 'Next.js 16 (App Router)' },
            { label: 'Database', value: 'Neon (PostgreSQL Serverless)' },
            { label: 'Storage', value: 'Microsoft OneDrive via Graph API' },
            { label: 'Auth', value: 'OAuth 2.0 · Google + LINE' },
            { label: 'Streaming', value: 'HLS.js / Native HLS' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center justify-between gap-4">
              <span className="text-[11px] font-medium text-[#8C857B] dark:text-[#888888]">{label}</span>
              <span className="text-[11px] font-mono font-semibold text-[#212529] dark:text-[#F1F1F1] text-right">{value}</span>
            </div>
          ))}
        </div>
      </SettingCard>

      {/* Legal Footer */}
      <div className="flex items-center justify-center gap-4 py-2">
        <Link
          href="/tubelock/policy"
          className="flex items-center gap-1 text-[11px] text-[#8C857B] dark:text-[#888888] hover:text-[#FF7A00] transition"
        >
          <Globe className="w-3 h-3" />
          <span>Privacy Policy</span>
        </Link>
        <span className="text-[#D5CFC5] dark:text-white/20">·</span>
        <Link
          href="/tubelock/terms"
          className="flex items-center gap-1 text-[11px] text-[#8C857B] dark:text-[#888888] hover:text-[#FF7A00] transition"
        >
          <Info className="w-3 h-3" />
          <span>Terms of Service</span>
        </Link>
        <span className="text-[#D5CFC5] dark:text-white/20">·</span>
        <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">© 2026 TubeLock</span>
      </div>
    </div>
  );
}

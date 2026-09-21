'use client';

import React, { useState, useEffect, useCallback } from 'react';
import SettingCard from '@/components/ui/SettingCard';
import SettingRow from '@/components/ui/SettingRow';
import Select from '@/components/ui/Select';
import {
  User, ChevronRight, LogOut, ShieldCheck, Link2,
  Monitor, Smartphone, Tablet, MapPin, Clock,
  RefreshCw, AlertTriangle, Loader2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { formatRelativeTime } from '@/lib/sessionUtils';

const FALLBACK_OPTIONS = [
  { label: 'Mystery Person (เงาสีเทา)', value: 'mp' },
  { label: 'Identicon (ลายเรขาคณิต)', value: 'identicon' },
  { label: 'Retro (ภาพ 8-bit)', value: 'retro' },
  { label: 'RoboHash (หุ่นยนต์)', value: 'robohash' },
];

// ── Icons ──────────────────────────────────────────────────────────────────────
function GoogleIcon({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
    </svg>
  );
}

function LineIcon({ className = 'w-5 h-5' }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="#06C755">
      <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.269 8.846 10.036 9.608.391.084.922.258 1.057.592.121.303.079.778.039 1.085l-.171 1.027c-.053.303-.242 1.186 1.039.646 1.281-.54 6.911-4.069 9.428-6.967 1.739-1.907 2.572-3.843 2.572-5.993z" />
    </svg>
  );
}

function ProviderBadge({ provider }) {
  if (provider === 'google') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/50 text-[11px] font-semibold text-blue-700 dark:text-blue-300">
        <GoogleIcon className="w-3.5 h-3.5" />
        Google Account
      </span>
    );
  }
  if (provider === 'line') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
        <LineIcon className="w-3.5 h-3.5" />
        LINE Account
      </span>
    );
  }
  return null;
}

// ── Device Icon ───────────────────────────────────────────────────────────────
function DeviceIcon({ type, className = 'w-5 h-5' }) {
  if (type === 'mobile') return <Smartphone className={className} />;
  if (type === 'tablet') return <Tablet className={className} />;
  return <Monitor className={className} />;
}

// ── Session Row Card ──────────────────────────────────────────────────────────
function SessionCard({ session, onRevoke, revoking }) {
  const { id, device_type, device_name, os, browser, ip_address, country, city,
    created_at, last_seen_at, is_current } = session;

  return (
    <div className={`relative flex items-start gap-3 p-4 transition-colors ${is_current
        ? 'bg-[#FF7A00]/5 dark:bg-[#FF7A00]/8'
        : 'hover:bg-zinc-50 dark:hover:bg-white/5'
      }`}>
      {/* Device Icon */}
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${is_current
          ? 'bg-[#FF7A00]/15 text-[#FF7A00]'
          : 'bg-[#EFECE6] dark:bg-white/10 text-[#8C857B] dark:text-[#888888]'
        }`}>
        <DeviceIcon type={device_type} className="w-4 h-4" />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1] truncate">
            {device_name || 'Unknown Device'}
          </span>
          {is_current && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-[#FF7A00]/15 text-[10px] font-bold text-[#FF7A00] shrink-0">
              เครื่องนี้
            </span>
          )}
        </div>

        {/* Location + IP */}
        <div className="flex items-center gap-1.5 mt-0.5">
          <MapPin className="w-3 h-3 text-[#8C857B] dark:text-[#888888] shrink-0" />
          <span className="text-[11px] text-[#8C857B] dark:text-[#888888] truncate">
            {[city, country].filter(Boolean).join(', ') || 'ไม่ทราบตำแหน่ง'}
            {ip_address ? ` · ${ip_address}` : ''}
          </span>
        </div>

        {/* Timestamps */}
        <div className="flex items-center gap-3 mt-1">
          <span className="text-[10px] text-[#8C857B] dark:text-[#888888] flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" />
            เข้าสู่ระบบ {formatRelativeTime(created_at)}
          </span>
          {!is_current && last_seen_at && (
            <span className="text-[10px] text-[#8C857B] dark:text-[#888888]">
              · active {formatRelativeTime(last_seen_at)}
            </span>
          )}
        </div>
      </div>

      {/* Revoke button */}
      {!is_current && (
        <button
          type="button"
          onClick={() => onRevoke(id)}
          disabled={revoking === id}
          className="shrink-0 px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 text-[11px] font-semibold transition border border-rose-200 dark:border-rose-900/50 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
        >
          {revoking === id
            ? <Loader2 className="w-3 h-3 animate-spin" />
            : <LogOut className="w-3 h-3" />}
          <span>ออก</span>
        </button>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function AccountSection({
  session,
  gravatarEmail,
  setGravatarEmail,
  gravatarHash,
  fallbackAvatar,
  setFallbackAvatar,
  openActionSheet,
}) {
  const router = useRouter();

  // Sessions state
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revoking, setRevoking] = useState(null); // session id being revoked
  const [revokingAll, setRevokingAll] = useState(false);

  // ── Fetch sessions ──────────────────────────────────────────────
  const fetchSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await fetch('/api/auth/sessions');
      if (!res.ok) return;
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {
      /* ignore */
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) fetchSessions();
  }, [session, fetchSessions]);

  // ── Revoke single session ──────────────────────────────────────
  const handleRevoke = async (sessionId) => {
    setRevoking(sessionId);
    try {
      const res = await fetch('/api/auth/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      if (res.ok) setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch {/* ignore */ } finally {
      setRevoking(null);
    }
  };

  // ── Revoke all other sessions ──────────────────────────────────
  const handleRevokeAll = async () => {
    if (!window.confirm('ออกจากระบบทุกเครื่องยกเว้นเครื่องนี้ใช่หรือไม่?')) return;
    setRevokingAll(true);
    try {
      const res = await fetch('/api/auth/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (res.ok) setSessions((prev) => prev.filter((s) => s.is_current));
    } catch {/* ignore */ } finally {
      setRevokingAll(false);
    }
  };

  // ── Logout current session ─────────────────────────────────────
  const handleLogout = () => {
    if (window.confirm('ต้องการออกจากระบบหรือไม่?')) {
      router.push('/api/auth/logout?from=/login');
    }
  };

  const otherSessions = sessions.filter((s) => !s.is_current);

  return (
    <div className="flex flex-col gap-6 animate-fadeIn px-4">
      {/* ── Header ────────────────────────────────────────────────── */}
      <div className="pb-2 border-b border-[#EFECE6] dark:border-white/10">
        <h2 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1]">บัญชีและโปรไฟล์</h2>
        <p className="text-xs text-[#8C857B] dark:text-[#AAAAAA] mt-1">
          เลือกลักษณะการแสดงตัวและสิ่งที่คุณเห็นใน TubeLock
        </p>
        <span className="inline-block mt-1 text-xs font-medium text-[#FF7A00]">
          {gravatarEmail || 'ยังไม่ได้ระบุอีเมล'}
        </span>
      </div>

      {/* ── ไม่ได้ Login ─────────────────────────────────────────── */}
      {!session && (
        <div className="bg-[#F5F2EB] dark:bg-white/5 border border-dashed border-[#D5CFC5] dark:border-white/15 rounded-2xl p-5 flex flex-col items-center gap-3 text-center">
          <div className="w-10 h-10 rounded-full bg-[#EFECE6] dark:bg-white/10 flex items-center justify-center">
            <Link2 className="w-5 h-5 text-[#8C857B] dark:text-[#888888]" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">ยังไม่ได้เข้าสู่ระบบ</p>
            <p className="text-[11px] text-[#8C857B] dark:text-[#AAAAAA] mt-0.5">เข้าสู่ระบบด้วย Google หรือ LINE เพื่อซิงก์ข้อมูลบัญชี</p>
          </div>
          <a
            href="/login"
            className="px-4 py-2 rounded-xl bg-[#FF7A00] hover:bg-[#E06C00] text-white text-xs font-bold transition active:scale-95 shadow-[0_4px_12px_rgba(255,122,0,0.3)]"
          >
            เข้าสู่ระบบ
          </a>
        </div>
      )}

      {/* ── Social Login Card ─────────────────────────────────────── */}
      {session && (
        <SettingCard title="บัญชีที่เข้าสู่ระบบ" subtitle="ข้อมูลจาก Social Login ที่คุณใช้เข้าระบบ">
          <div className="p-4 sm:p-5 flex flex-col gap-4">
            {/* User Info Row */}
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                <div className="w-14 h-14 rounded-full overflow-hidden bg-[#EFECE6] dark:bg-white/10 border-2 border-[#EFECE6] dark:border-white/15 shadow-inner">
                  {session.picture ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={session.picture} alt={session.name || 'User'} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <User className="w-6 h-6 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                  )}
                </div>
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/15 flex items-center justify-center shadow-xs">
                  {session.provider === 'google' ? <GoogleIcon className="w-3 h-3" /> : <LineIcon className="w-3 h-3" />}
                </div>
              </div>
              <div className="flex flex-col min-w-0 gap-1">
                <span className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1] truncate">{session.name || 'ไม่ระบุชื่อ'}</span>
                {session.email && (
                  <span className="text-[11px] text-[#8C857B] dark:text-[#888888] truncate font-mono">{session.email}</span>
                )}
                <ProviderBadge provider={session.provider} />
              </div>
            </div>

            {/* Auth Security */}
            <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-900/40">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="flex flex-col min-w-0">
                <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">เซสชันนี้ยืนยันตัวตนแล้ว</span>
                <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70">ผ่าน OAuth 2.0 · มีผล 7 วัน</span>
              </div>
            </div>
          </div>

          {/* Logout Row */}
          <div className="border-t border-[#EFECE6] dark:border-white/10">
            <SettingRow
              title="ออกจากระบบ (Sign Out)"
              description="ล้างเซสชันและ Cookie แล้วกลับไปหน้าเข้าสู่ระบบ"
              isClickable
              onClick={handleLogout}
            >
              <button
                type="button"
                onClick={handleLogout}
                className="px-3.5 py-1.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 border border-rose-200 dark:border-rose-900/50 active:scale-95"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>ออกจากระบบ</span>
              </button>
            </SettingRow>
          </div>
        </SettingCard>
      )}

      {/* ── Active Sessions Card ──────────────────────────────────── */}
      {session && (
        <SettingCard
          title={`อุปกรณ์ที่เข้าสู่ระบบ${sessions.length > 0 ? ` (${sessions.length} เครื่อง)` : ''}`}
          subtitle="จัดการ Session ทุกเครื่องของคุณ — สั่ง Logout จากระยะไกลได้"
        >
          {/* Refresh button */}
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">
              {sessionsLoading ? 'กำลังโหลด...' : `${sessions.length} session ที่ active`}
            </span>
            <button
              type="button"
              onClick={fetchSessions}
              disabled={sessionsLoading}
              className="p-1.5 rounded-lg hover:bg-[#EFECE6] dark:hover:bg-white/10 transition cursor-pointer disabled:opacity-50 active:scale-90"
              title="รีเฟรชรายการ"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-[#8C857B] ${sessionsLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Sessions list */}
          <div className="divide-y divide-[#EFECE6] dark:divide-white/10 mt-1">
            {sessionsLoading && sessions.length === 0 ? (
              <div className="flex items-center justify-center gap-2 py-8">
                <Loader2 className="w-4 h-4 animate-spin text-[#8C857B]" />
                <span className="text-xs text-[#8C857B]">กำลังโหลด session...</span>
              </div>
            ) : sessions.length === 0 ? (
              <div className="py-6 text-center text-[11px] text-[#8C857B] dark:text-[#888888]">
                ไม่พบ session ที่ active
              </div>
            ) : (
              sessions.map((s) => (
                <SessionCard
                  key={s.id}
                  session={s}
                  onRevoke={handleRevoke}
                  revoking={revoking}
                />
              ))
            )}
          </div>

          {/* Revoke all button */}
          {otherSessions.length > 0 && (
            <div className="border-t border-[#EFECE6] dark:border-white/10 p-4">
              <button
                type="button"
                onClick={handleRevokeAll}
                disabled={revokingAll}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-rose-600 dark:text-rose-400 text-xs font-semibold transition border border-rose-200 dark:border-rose-900/50 cursor-pointer active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {revokingAll
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <AlertTriangle className="w-3.5 h-3.5" />}
                <span>ออกจากระบบทุกเครื่องอื่น ({otherSessions.length} เครื่อง)</span>
              </button>
            </div>
          )}
        </SettingCard>
      )}

      {/* ── Gravatar Profile Preview ──────────────────────────────── */}
      <div className="bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10 p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full overflow-hidden bg-[#FBF9F5] dark:bg-[#202020] border-2 border-[#EFECE6] dark:border-white/15 shrink-0 shadow-inner">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={gravatarHash
                ? `https://www.gravatar.com/avatar/${gravatarHash}?d=${fallbackAvatar}&s=160`
                : `https://www.gravatar.com/avatar/?d=${fallbackAvatar}&s=160`}
              alt="Gravatar Preview"
              className="w-full h-full object-cover"
            />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1]">ภาพโปรไฟล์ของคุณ</span>
            <span className="text-xs text-[#8C857B] dark:text-[#888888] font-mono truncate mt-0.5">
              {gravatarHash ? `SHA-256: ${gravatarHash.substring(0, 20)}...` : 'ยังไม่มีอีเมลผูกไว้'}
            </span>
            <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              ซิงก์ภาพสากลจาก Gravatar
            </span>
          </div>
        </div>
      </div>

      {/* ── Gravatar Settings Card ──────────────────────────────────── */}
      <SettingCard title="การตั้งค่าโปรไฟล์" subtitle="ข้อมูลสำหรับเชื่อมต่อ Gravatar อัตโนมัติ">
        <div className="p-4 sm:p-5 flex flex-col gap-2">
          <label className="text-xs font-bold text-[#212529] dark:text-[#F1F1F1]">Gravatar Email</label>
          <input
            type="email"
            value={gravatarEmail}
            onChange={(e) => setGravatarEmail(e.target.value)}
            onBlur={() => {
              localStorage.setItem('pt_gravatar_email', gravatarEmail.trim());
              window.dispatchEvent(new Event('storage'));
            }}
            placeholder="name@example.com"
            className="w-full px-4 py-2.5 bg-[#FBF9F5] dark:bg-[#141414] hover:bg-white dark:hover:bg-[#1a1a1a] focus:bg-white dark:focus:bg-[#1a1a1a] border border-[#E5DFD5] dark:border-white/10 hover:border-[#D5CFC5] dark:hover:border-white/20 focus:border-[#FF7A00] focus:ring-3 focus:ring-[#FF7A00]/15 rounded-xl text-xs text-[#212529] dark:text-[#F1F1F1] transition-all outline-none"
          />
          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">
            เมื่อระบุอีเมล ระบบจะแปลงเป็น SHA-256 Hash เพื่อดึงรูปโปรไฟล์มาแสดงบน Navbar และมุมขวาบน
          </span>
        </div>

        <SettingRow
          title="รูปแบบภาพสำรอง (Fallback Style)"
          description="ภาพกราฟิกที่จะแสดงอัตโนมัติหากอีเมลที่ระบุไม่มีบัญชี Gravatar"
        >
          <div className="hidden sm:block">
            <Select
              options={FALLBACK_OPTIONS}
              value={fallbackAvatar}
              onChange={(val) => {
                setFallbackAvatar(val);
                localStorage.setItem('pt_fallback_avatar', val);
                window.dispatchEvent(new Event('storage'));
              }}
            />
          </div>
          <button
            type="button"
            onClick={() => openActionSheet({
              title: 'รูปแบบภาพสำรอง (Fallback)',
              current: fallbackAvatar,
              options: FALLBACK_OPTIONS,
              onSelect: (val) => {
                setFallbackAvatar(val);
                localStorage.setItem('pt_fallback_avatar', val);
                window.dispatchEvent(new Event('storage'));
              },
            })}
            className="sm:hidden flex items-center gap-1 text-xs font-semibold text-[#FF7A00]"
          >
            <span>{FALLBACK_OPTIONS.find((o) => o.value === fallbackAvatar)?.label || fallbackAvatar}</span>
            <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#AAAAAA]" />
          </button>
        </SettingRow>
      </SettingCard>
    </div>
  );
}

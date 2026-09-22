'use client';

import { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, ChevronRight, PlayCircle, Folder,
  Database, Save, CheckCircle, Loader2,
  Sliders, LifeBuoy
} from 'lucide-react';
import { useViewMode } from '@/context/ViewModeContext';
import SettingsSidebar from '@/components/settings/SettingsSidebar';
import GeneralSection from '@/components/settings/GeneralSection';
import AccountSection from '@/components/settings/AccountSection';
import PlayerSection from '@/components/settings/PlayerSection';
import StorageSection from '@/components/settings/StorageSection';
import SystemSection from '@/components/settings/SystemSection';
import SupportSection from '@/components/settings/SupportSection';
import ActionSheetModal from '@/components/settings/ActionSheetModal';

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

const VALID_TABS = ['general', 'account', 'player', 'onedrive', 'system', 'support'];

function parseTabFromParams(searchParams) {
  if (!searchParams) return null;
  for (const tab of VALID_TABS) {
    if (searchParams.has(tab)) return tab;
  }
  const tabParam = searchParams.get('tab');
  if (tabParam && VALID_TABS.includes(tabParam)) return tabParam;
  return null;
}

// ─── Standalone Save Button Component ────────────────────────────────────────
function SaveButton({ saveStatus, isDirty, onSave }) {
  if (saveStatus === 'saving') {
    return (
      <button
        type="button"
        disabled
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#FF7A00]/60 text-white text-xs font-bold cursor-not-allowed select-none"
      >
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>กำลังบันทึก...</span>
      </button>
    );
  }
  if (saveStatus === 'saved') {
    return (
      <button
        type="button"
        disabled
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500 text-white text-xs font-bold cursor-default select-none"
      >
        <CheckCircle className="w-4 h-4" />
        <span>บันทึกแล้ว!</span>
      </button>
    );
  }
  if (saveStatus === 'error') {
    return (
      <button
        type="button"
        onClick={onSave}
        className="flex items-center gap-2 px-4 py-2 rounded-xl bg-red-500 text-white text-xs font-bold cursor-pointer hover:bg-red-600 transition select-none"
      >
        <Save className="w-4 h-4" />
        <span>เกิดข้อผิดพลาด ลองอีกครั้ง</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={!isDirty}
      className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition active:scale-95 select-none ${isDirty
        ? 'bg-[#FF7A00] hover:bg-[#E06C00] text-white shadow-[0_4px_12px_rgba(255,122,0,0.35)] cursor-pointer'
        : 'bg-[#EFECE6] dark:bg-white/10 text-[#8C857B] dark:text-[#666666] cursor-not-allowed'
        }`}
    >
      <Save className="w-4 h-4" />
      <span>บันทึกการตั้งค่า</span>
    </button>
  );
}

// ─── Internal Settings View Component ────────────────────────────────────────
function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDesktop, isMobile } = useViewMode();

  // Tab derived directly from URL query parameters (single source of truth)
  const urlTab = parseTabFromParams(searchParams);
  const desktopTab = urlTab || 'general';
  const subPage = urlTab || null;

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);

  // Settings States
  const [targetFolder, setTargetFolder] = useState('/Videos');
  const [scanSubfolders, setScanSubfolders] = useState(true);
  const [volume, setVolume] = useState(0.8);
  const [autoplay, setAutoplay] = useState(true);
  const [defaultSpeed, setDefaultSpeed] = useState(1);
  const [defaultFit, setDefaultFit] = useState('fit');
  const [seekStep, setSeekStep] = useState(10);
  const [autoStats, setAutoStats] = useState(false);

  // Profile States
  const [gravatarEmail, setGravatarEmail] = useState('');
  const [gravatarHash, setGravatarHash] = useState('');
  const [fallbackAvatar, setFallbackAvatar] = useState('mp');

  // Stats Summary
  const [videoCount, setVideoCount] = useState(0);
  const [totalSizeGB, setTotalSizeGB] = useState('0.00');

  // Save state
  const [isDirty, setIsDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const initialLoaded = useRef(false);

  // Action Sheet (Mobile)
  const [sheet, setSheet] = useState(null);

  // Ensure desktop URL reflects default tab if opened without query parameters
  useEffect(() => {
    if (isDesktop && !urlTab) {
      router.replace('/settings?general', { scroll: false });
    }
  }, [isDesktop, urlTab, router]);

  // Tab change handlers
  const handleDesktopTabChange = (tabId) => {
    router.replace(`/settings?${tabId}`, { scroll: false });
  };

  const handleMobileSelectSubPage = (subId) => {
    router.replace(`/settings?${subId}`, { scroll: false });
  };

  const handleMobileBack = () => {
    router.replace('/settings', { scroll: false });
  };

  const handleEmailChange = (newEmail) => {
    setGravatarEmail(newEmail);
    if (!newEmail.trim()) {
      setGravatarHash('');
    }
  };

  // ─── Load session ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then(({ session: s }) => setSession(s))
      .catch(() => { });
  }, []);

  // ─── Load settings on mount ───────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setLoading(true);

        if (typeof window !== 'undefined') {
          const storedEmail = localStorage.getItem('pt_gravatar_email') || '';
          const storedFallback = localStorage.getItem('pt_fallback_avatar') || 'mp';
          if (isMounted) {
            setGravatarEmail(storedEmail);
            setFallbackAvatar(storedFallback);
            if (storedEmail.trim()) {
              sha256(storedEmail).then((h) => { if (isMounted) setGravatarHash(h); });
            }
          }
        }

        const [settingsRes, videosRes] = await Promise.all([
          fetch('/api/settings').then((r) => r.json()).catch(() => null),
          fetch('/api/videos').then((r) => r.json()).catch(() => null),
        ]);

        if (settingsRes?.success && settingsRes.data && isMounted) {
          const { onedrive_config, player_defaults } = settingsRes.data;
          if (onedrive_config) {
            setTargetFolder(onedrive_config.target_folder || '/Videos');
            setScanSubfolders(onedrive_config.scan_subfolders ?? true);
          }
          if (player_defaults) {
            setVolume(player_defaults.volume ?? 0.8);
            setAutoplay(player_defaults.autoplay ?? true);
            setDefaultSpeed(player_defaults.speed ?? player_defaults.default_speed ?? 1);
            setDefaultFit(player_defaults.fit ?? player_defaults.default_fit ?? 'fit');
            setSeekStep(player_defaults.seekStep ?? player_defaults.seek_step ?? 10);
            setAutoStats(player_defaults.statsForNerds ?? player_defaults.auto_stats ?? false);
          }
        }

        if (videosRes?.success && Array.isArray(videosRes.data) && isMounted) {
          setVideoCount(videosRes.data.length);
          const bytes = videosRes.data.reduce((acc, v) => acc + Number(v.file_size_bytes || 0), 0);
          setTotalSizeGB((bytes / (1024 ** 3)).toFixed(2));
        }
      } catch (err) {
        console.error('Error loading settings:', err);
      } finally {
        if (isMounted) {
          setLoading(false);
          setTimeout(() => { initialLoaded.current = true; }, 150);
        }
      }
    }
    loadData();
    return () => { isMounted = false; };
  }, []);

  // ─── Gravatar hash update ─────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;
    if (gravatarEmail.trim()) {
      sha256(gravatarEmail).then((h) => {
        if (isMounted) setGravatarHash(h);
      });
    }
    return () => { isMounted = false; };
  }, [gravatarEmail]);

  // ─── Track dirty state ────────────────────────────────────────────────────
  useEffect(() => {
    if (initialLoaded.current) {
      setIsDirty(true);
      setSaveStatus('idle');
    }
  }, [
    targetFolder, scanSubfolders,
    volume, autoplay, defaultSpeed, defaultFit, seekStep, autoStats,
    gravatarEmail, fallbackAvatar,
  ]);

  // ─── Save all to Neon ─────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    setSaveStatus('saving');
    try {
      await Promise.all([
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: 'player_defaults',
            value: { volume, autoplay, default_speed: defaultSpeed, default_fit: defaultFit, seek_step: seekStep, auto_stats: autoStats },
          }),
        }),
        fetch('/api/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            key: 'onedrive_config',
            value: { target_folder: targetFolder, scan_subfolders: scanSubfolders },
          }),
        }),
      ]);

      localStorage.setItem('pt_gravatar_email', gravatarEmail.trim());
      localStorage.setItem('pt_fallback_avatar', fallbackAvatar);
      window.dispatchEvent(new Event('storage'));

      setSaveStatus('saved');
      setIsDirty(false);
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err) {
      console.error('Failed to save settings:', err);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 4000);
    }
  }, [volume, autoplay, defaultSpeed, defaultFit, seekStep, autoStats, targetFolder, scanSubfolders, gravatarEmail, fallbackAvatar]);

  // ─── Other actions ────────────────────────────────────────────────────────
  const handleClearHistory = async () => {
    if (window.confirm('คุณต้องการล้างประวัติการดูและตำแหน่งเวลาทั้งหมดใช่หรือไม่?')) {
      alert('ล้างประวัติการรับชมเรียบร้อยแล้ว');
    }
  };

  const handleFactoryReset = () => {
    if (window.confirm('⚠️ ล้างข้อมูลทั้งหมดในเครื่อง คืนค่าเริ่มต้น และออกจากระบบ?')) {
      localStorage.clear();
      sessionStorage.clear();
      router.push('/');
    }
  };

  // ─── Section renderer ─────────────────────────────────────────────────────
  const renderCurrentSection = (tabKey) => {
    switch (tabKey) {
      case 'general':
        return <GeneralSection />;
      case 'account':
        return (
          <AccountSection
            session={session}
            gravatarEmail={gravatarEmail}
            setGravatarEmail={handleEmailChange}
            gravatarHash={gravatarHash}
            fallbackAvatar={fallbackAvatar}
            setFallbackAvatar={setFallbackAvatar}
            openActionSheet={setSheet}
          />
        );
      case 'player':
        return (
          <PlayerSection
            defaultSpeed={defaultSpeed}
            setDefaultSpeed={setDefaultSpeed}
            defaultFit={defaultFit}
            setDefaultFit={setDefaultFit}
            seekStep={seekStep}
            setSeekStep={setSeekStep}
            volume={volume}
            setVolume={setVolume}
            autoplay={autoplay}
            setAutoplay={setAutoplay}
            autoStats={autoStats}
            setAutoStats={setAutoStats}
            openActionSheet={setSheet}
          />
        );
      case 'onedrive':
        return (
          <StorageSection
            targetFolder={targetFolder}
            setTargetFolder={setTargetFolder}
            scanSubfolders={scanSubfolders}
            setScanSubfolders={setScanSubfolders}
            videoCount={videoCount}
            totalSizeGB={totalSizeGB}
          />
        );
      case 'system':
        return (
          <SystemSection
            handleClearHistory={handleClearHistory}
            handleFactoryReset={handleFactoryReset}
          />
        );
      case 'support':
        return <SupportSection />;
      default:
        return <GeneralSection />;
    }
  };

  // ─── Loading Skeleton ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-8 flex flex-col md:flex-row gap-10 animate-pulse select-none">
        <div className="w-64 shrink-0 flex flex-col gap-2">
          <div className="h-6 w-32 bg-[#EFECE6] dark:bg-white/10 rounded-md mb-3" />
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 w-full bg-[#EFECE6] dark:bg-white/10 rounded-xl" />
          ))}
        </div>
        <div className="flex-1 flex flex-col gap-6">
          <div className="h-6 w-48 bg-[#EFECE6] dark:bg-white/10 rounded-md" />
          <div className="h-44 w-full bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10" />
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-7xl mx-auto px-0 sm:px-8 sm:py-8 select-none min-h-[80]">
      <ActionSheetModal sheet={sheet} onClose={() => setSheet(null)} />

      {/* ── DESKTOP ──────────────────────────────────────────────────────────── */}
      {isDesktop && (
        <div className="flex gap-10 items-start">
          {/* Left Sidebar + Save */}
          <div className="sticky top-22 w-64 shrink-0 flex flex-col gap-3">
            <SettingsSidebar activeTab={desktopTab} onSelectTab={handleDesktopTabChange} />
            <div className="px-3 mt-1">
              <SaveButton saveStatus={saveStatus} isDirty={isDirty} onSave={handleSave} />
              {isDirty && saveStatus === 'idle' && (
                <p className="text-[10px] text-[#8C857B] dark:text-[#AAAAAA] mt-2 px-1 leading-relaxed">
                  มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก กด <strong>&ldquo;บันทึก&rdquo;</strong> เพื่อบันทึกไปยัง Neon DB
                </p>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {renderCurrentSection(desktopTab)}
          </div>
        </div>
      )}

      {/* ── MOBILE ───────────────────────────────────────────────────────────── */}
      {isMobile && (
        <div>
          {!subPage ? (
            /* Mobile main menu list */
            <div className="flex flex-col gap-4">
              {/* Header + Save */}
              <div className="sticky top-0 z-10 h-14 flex items-center justify-between py-2 px-4 bg-white dark:bg-[#181818] border-b border-[#EFECE6] dark:border-white/10">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => router.push('/')}
                    className="p-1.5 -ml-1 rounded-full hover:bg-[#EFECE6] dark:hover:bg-white/10 active:scale-90 transition text-[#212529] dark:text-[#F1F1F1] cursor-pointer"
                    title="ย้อนกลับ"
                  >
                    <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
                  </button>
                  <h1 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1] tracking-tight">การตั้งค่า</h1>
                </div>
                <SaveButton saveStatus={saveStatus} isDirty={isDirty} onSave={handleSave} />
              </div>

              <div className='flex flex-col gap-4 px-4 pb-20'>
                {/* ทั่วไปและธีม */}
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-[#8C857B] dark:text-[#AAAAAA] px-3 py-1.5 uppercase tracking-wider">รูปลักษณ์และระบบ</span>
                  <div className="bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10 shadow-xs divide-y divide-[#F5F2EB] dark:divide-white/10 overflow-hidden">
                    <div
                      onClick={() => handleMobileSelectSubPage('general')}
                      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#FF7A00]/10 text-[#FF7A00] flex items-center justify-center shrink-0">
                          <Sliders className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">ทั่วไปและธีม</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">
                            ธีมมืด, สว่าง หรือตามระบบ และพารามิเตอร์ URL
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                  </div>
                </div>

                {/* บัญชีและโปรไฟล์ */}
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-[#8C857B] dark:text-[#AAAAAA] px-3 py-1.5 uppercase tracking-wider">บัญชีและโปรไฟล์</span>
                  <div className="bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10 shadow-xs divide-y divide-[#F5F2EB] dark:divide-white/10 overflow-hidden">
                    <div
                      onClick={() => handleMobileSelectSubPage('account')}
                      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-[#EFECE6] dark:bg-white/10 shrink-0">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={gravatarHash
                              ? `https://www.gravatar.com/avatar/${gravatarHash}?d=${fallbackAvatar}&s=80`
                              : `https://www.gravatar.com/avatar/?d=${fallbackAvatar}&s=80`}
                            alt="User"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">โปรไฟล์และ Gravatar</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888] truncate max-w-[200px]">
                            {gravatarEmail || 'ยังไม่ได้ตั้งค่าอีเมล'}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                  </div>
                </div>

                {/* การเล่น */}
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-[#8C857B] dark:text-[#AAAAAA] px-3 py-1.5 uppercase tracking-wider">การเล่น</span>
                  <div className="bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10 shadow-xs divide-y divide-[#F5F2EB] dark:divide-white/10 overflow-hidden">
                    <div
                      onClick={() => handleMobileSelectSubPage('player')}
                      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <PlayCircle className="w-5 h-5 text-[#FF7A00]" />
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">ทั่วไปและพฤติกรรมตัวเล่น</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">ความเร็ว, สัดส่วนภาพ, ข้ามเวลา และระดับเสียง</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                  </div>
                </div>

                {/* พื้นที่จัดเก็บ */}
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-[#8C857B] dark:text-[#AAAAAA] px-3 py-1.5 uppercase tracking-wider">พื้นที่จัดเก็บและคลาวด์</span>
                  <div className="bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10 shadow-xs divide-y divide-[#F5F2EB] dark:divide-white/10 overflow-hidden">
                    <div
                      onClick={() => handleMobileSelectSubPage('onedrive')}
                      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <Folder className="w-5 h-5 text-blue-500" />
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">OneDrive และโฟลเดอร์สื่อ</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">
                            {targetFolder} ({videoCount} คลิป, {totalSizeGB} GB)
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                  </div>
                </div>

                {/* ข้อมูลและความเป็นส่วนตัว */}
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-[#8C857B] dark:text-[#AAAAAA] px-3 py-1.5 uppercase tracking-wider">ข้อมูลและความเป็นส่วนตัว</span>
                  <div className="bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10 shadow-xs divide-y divide-[#F5F2EB] dark:divide-white/10 overflow-hidden">
                    <div
                      onClick={() => handleMobileSelectSubPage('system')}
                      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <Database className="w-5 h-5 text-emerald-500" />
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">จัดการประวัติและแคชของระบบ</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">ล้างประวัติการดู และการรีเซ็ตข้อมูล</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                  </div>
                </div>

                {/* ช่วยเหลือและติดต่อ */}
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-[#8C857B] dark:text-[#AAAAAA] px-3 py-1.5 uppercase tracking-wider">ช่วยเหลือ</span>
                  <div className="bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10 shadow-xs divide-y divide-[#F5F2EB] dark:divide-white/10 overflow-hidden">
                    <div
                      onClick={() => handleMobileSelectSubPage('support')}
                      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-violet-500/10 text-violet-500 flex items-center justify-center shrink-0">
                          <LifeBuoy className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">ช่วยเหลือและติดต่อ</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">FAQ, รายงานปัญหา และข้อมูลแอป</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Mobile sub-page */
            <div className="flex flex-col gap-4">
              <div className="sticky top-0 z-10 h-14 flex items-center justify-between py-2 px-4 bg-white dark:bg-[#181818] border-b border-[#EFECE6] dark:border-white/10">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleMobileBack}
                    className="p-1.5 -ml-1.5 rounded-full hover:bg-[#EFECE6] dark:hover:bg-white/10 active:scale-90 transition text-[#212529] dark:text-[#F1F1F1] cursor-pointer"
                  >
                    <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
                  </button>
                  <h2 className="text-base font-bold text-[#212529] dark:text-[#F1F1F1]">
                    {subPage === 'general' && 'ทั่วไปและธีม'}
                    {subPage === 'player' && 'ตัวเล่นวิดีโอ'}
                    {subPage === 'onedrive' && 'OneDrive และโฟลเดอร์'}
                    {subPage === 'account' && 'โปรไฟล์และ Gravatar'}
                    {subPage === 'system' && 'จัดการประวัติและแคช'}
                    {subPage === 'support' && 'ช่วยเหลือและติดต่อ'}
                  </h2>
                </div>
                {subPage !== 'system' && subPage !== 'general' && subPage !== 'support' && (
                  <SaveButton saveStatus={saveStatus} isDirty={isDirty} onSave={handleSave} />
                )}
              </div>
              {renderCurrentSection(subPage)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Exported Default Page (Wrapped in Suspense) ─────────────────────────────
export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-8 flex flex-col md:flex-row gap-10 animate-pulse select-none">
          <div className="w-64 shrink-0 flex flex-col gap-2">
            <div className="h-6 w-32 bg-[#EFECE6] dark:bg-white/10 rounded-md mb-3" />
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 w-full bg-[#EFECE6] dark:bg-white/10 rounded-xl" />
            ))}
          </div>
          <div className="flex-1 flex flex-col gap-6">
            <div className="h-6 w-48 bg-[#EFECE6] dark:bg-white/10 rounded-md" />
            <div className="h-44 w-full bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10" />
          </div>
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}

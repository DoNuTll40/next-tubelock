'use client';

import { savePosterPreference, syncPosterPreferenceCookie } from '@/lib/posterPreference';
import { useState, useEffect, useRef, useCallback, useId, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertCircle, ArrowLeft, ChevronRight, PlayCircle, Folder,
  ShieldCheck, CheckCircle, Loader2,
  Sliders, LifeBuoy, AtSign, User
} from 'lucide-react';
import { useViewMode } from '@/context/ViewModeContext';
import { useTheme } from '@/context/ThemeContext';
import SettingsSidebar from '@/components/settings/SettingsSidebar';
import GeneralSection from '@/components/settings/GeneralSection';
import AccountSection from '@/components/settings/AccountSection';
import ChannelSection from '@/components/settings/ChannelSection';
import PlayerSection from '@/components/settings/PlayerSection';
import StorageSection from '@/components/settings/StorageSection';
import SystemSection from '@/components/settings/SystemSection';
import SupportSection from '@/components/settings/SupportSection';
import ActionSheetModal from '@/components/settings/ActionSheetModal';
import { AnimatedTabPanel } from '@/components/ui/AnimatedTabs';

const VALID_TABS = ['account', 'channel', 'general', 'player', 'system', 'onedrive', 'support'];

function parseTabFromParams(searchParams) {
  if (!searchParams) return null;
  for (const tab of VALID_TABS) {
    if (searchParams.has(tab)) return tab;
  }
  const tabParam = searchParams.get('tab');
  if (tabParam && VALID_TABS.includes(tabParam)) return tabParam;
  return null;
}

// ─── Subtle Auto-Save Status Pill ────────────────────────────────────────────
function AutoSaveIndicator({ saveStatus, compact = false }) {
  if (compact) {
    const saving = saveStatus === 'saving';
    const failed = saveStatus === 'error';
    const message = saving ? 'กำลังบันทึก' : failed ? 'ซิงก์ฐานข้อมูลไม่สำเร็จ' : 'บันทึกอัตโนมัติแล้ว';
    const Icon = saving ? Loader2 : failed ? AlertCircle : CheckCircle;
    return (
      <span role="status" className="flex size-8 shrink-0 items-center justify-center">
        {['saving', 'saved', 'error'].includes(saveStatus) && (
          <span title={message} className={`grid size-7 place-items-center rounded-full ${saving
            ? 'bg-[#FF7A00]/10 text-[#A84400] dark:text-[#FFA24D]'
            : failed ? 'bg-rose-500/15 text-rose-700 dark:text-rose-400' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400'}`}>
            <Icon aria-hidden="true" className={`size-4 ${saving ? 'animate-spin' : ''}`} />
            <span className="sr-only">{message}</span>
          </span>
        )}
      </span>
    );
  }
  if (saveStatus === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#FF7A00]/10 text-[#FF7A00] text-[11px] font-semibold select-none">
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>กำลังบันทึก...</span>
      </span>
    );
  }
  if (saveStatus === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[11px] font-semibold select-none">
        <CheckCircle className="w-3 h-3" />
        <span>บันทึกอัตโนมัติแล้ว</span>
      </span>
    );
  }
  if (saveStatus === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400 text-[11px] font-semibold select-none">
        <span>ซิงก์ฐานข้อมูลไม่สำเร็จ</span>
      </span>
    );
  }
  return null;
}

// ─── Internal Settings View Component ────────────────────────────────────────
function SettingsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isDesktop, isMobile } = useViewMode();
  const { setTheme } = useTheme();
  const settingsTabsId = useId();

  // Tab derived directly from URL query parameters (single source of truth)
  const urlTab = parseTabFromParams(searchParams);
  const desktopTab = urlTab || 'general';
  const subPage = urlTab || null;

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState(null);

  // Settings States
  const [volume, setVolume] = useState(0.8);
  const [autoplay, setAutoplay] = useState(true);
  const [defaultSpeed, setDefaultSpeed] = useState(1);
  const [defaultFit, setDefaultFit] = useState('fit');
  const [seekStep, setSeekStep] = useState(10);
  const [autoStats, setAutoStats] = useState(false);
  const [allow18Plus, setAllow18Plus] = useState(false);

  // Stats Summary
  const [videoCount, setVideoCount] = useState(0);
  const [totalSizeGB, setTotalSizeGB] = useState('0.00');

  // Auto-save status indicator
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'error'
  const initialLoaded = useRef(false);
  const dbSyncTimerRef = useRef(null);
  const statusClearTimerRef = useRef(null);
  const sessionRef = useRef(null);

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

  const syncPreferencesToDb = useCallback(async (patch) => {
    if (!sessionRef.current) {
      setSaveStatus('saved');
      clearTimeout(statusClearTimerRef.current);
      statusClearTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2000);
      return;
    }

    setSaveStatus('saving');
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: patch }),
      });
      if (!res.ok) throw new Error('sync failed');
      setSaveStatus('saved');
      clearTimeout(statusClearTimerRef.current);
      statusClearTimerRef.current = setTimeout(() => setSaveStatus('idle'), 2200);
    } catch {
      setSaveStatus('error');
      clearTimeout(statusClearTimerRef.current);
      statusClearTimerRef.current = setTimeout(() => setSaveStatus('idle'), 3500);
    }
  }, []);

  // ─── Load session ─────────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then(({ session: s }) => {
        sessionRef.current = s || null;
        setSession(s);
      })
      .catch(() => { });
  }, []);

  // ─── Load settings on mount (localStorage + Neon DB userPreferences) ──────
  useEffect(() => {
    let isMounted = true;
    async function loadData() {
      try {
        setLoading(true);

        let local18Plus = false;
        let localPlayer = {};
        if (typeof window !== 'undefined') {
          local18Plus = localStorage.getItem('tubelock_allow_18plus') === '1';
          try {
            localPlayer = JSON.parse(localStorage.getItem('tubelock_settings') || '{}') || {};
          } catch {}
          if (isMounted) {
            setAllow18Plus(local18Plus);
          }
        }

        const [settingsRes, videosRes] = await Promise.all([
          fetch('/api/settings').then((r) => r.json()).catch(() => null),
          fetch('/api/videos').then((r) => r.json()).catch(() => null),
        ]);

        if (isMounted) {
          const defaults = settingsRes?.success ? settingsRes.data?.player_defaults : null;
          const userPrefs = settingsRes?.success ? settingsRes.userPreferences : null;

          const resolvedVolume = userPrefs?.volume ?? localPlayer.volume ?? defaults?.volume ?? 0.8;
          const resolvedAutoplay = userPrefs?.autoplay ?? localPlayer.autoplay ?? defaults?.autoplay ?? true;
          const resolvedSpeed = userPrefs?.default_speed ?? localPlayer.default_speed ?? defaults?.speed ?? defaults?.default_speed ?? 1;
          const resolvedFit = userPrefs?.default_fit ?? localPlayer.default_fit ?? defaults?.fit ?? defaults?.default_fit ?? 'fit';
          const resolvedSeek = userPrefs?.seek_step ?? localPlayer.seek_step ?? defaults?.seekStep ?? defaults?.seek_step ?? 10;
          const resolvedStats = userPrefs?.auto_stats ?? localPlayer.auto_stats ?? defaults?.statsForNerds ?? defaults?.auto_stats ?? false;

          setVolume(resolvedVolume);
          setAutoplay(resolvedAutoplay);
          setDefaultSpeed(resolvedSpeed);
          setDefaultFit(resolvedFit);
          setSeekStep(resolvedSeek);
          setAutoStats(resolvedStats);

          if (typeof userPrefs?.allow_18plus === 'boolean') {
            setAllow18Plus(userPrefs.allow_18plus);
            savePosterPreference(userPrefs.allow_18plus);
          }
          if (userPrefs?.theme && ['light', 'dark', 'auto'].includes(userPrefs.theme)) {
            setTheme(userPrefs.theme);
          }

          if (userPrefs && typeof window !== 'undefined') {
            try {
              localStorage.setItem('tubelock_settings', JSON.stringify({
                volume: resolvedVolume,
                autoplay: resolvedAutoplay,
                default_speed: resolvedSpeed,
                default_fit: resolvedFit,
                seek_step: resolvedSeek,
                auto_stats: resolvedStats,
              }));
            } catch {}
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
    return () => {
      isMounted = false;
      clearTimeout(dbSyncTimerRef.current);
      clearTimeout(statusClearTimerRef.current);
    };
  }, [setTheme]);

  // ─── Auto-save player settings to localStorage + debounced Neon DB sync ───
  useEffect(() => {
    if (!initialLoaded.current) return;
    const playerPatch = {
      volume,
      autoplay,
      default_speed: defaultSpeed,
      default_fit: defaultFit,
      seek_step: seekStep,
      auto_stats: autoStats,
    };
    try {
      localStorage.setItem('tubelock_settings', JSON.stringify(playerPatch));
      window.dispatchEvent(new Event('storage'));
    } catch {}

    clearTimeout(dbSyncTimerRef.current);
    dbSyncTimerRef.current = setTimeout(() => {
      void syncPreferencesToDb(playerPatch);
    }, 400);
  }, [volume, autoplay, defaultSpeed, defaultFit, seekStep, autoStats, syncPreferencesToDb]);

  const handleToggle18Plus = useCallback((checked) => {
    setAllow18Plus(checked);
    try {
      savePosterPreference(checked);
    } catch {}
    void syncPreferencesToDb({ allow_18plus: checked });
  }, [syncPreferencesToDb]);

  const handleThemeSync = useCallback((nextTheme) => {
    void syncPreferencesToDb({ theme: nextTheme });
  }, [syncPreferencesToDb]);

  // ─── Other actions ────────────────────────────────────────────────────────
  const handleClearHistory = async () => {
    if (window.confirm('คุณต้องการล้างประวัติการดูและตำแหน่งเวลาทั้งหมดใช่หรือไม่?')) {
      try {
        await fetch('/api/history?all=true', { method: 'DELETE' });
        alert('ล้างประวัติการรับชมเรียบร้อยแล้ว');
      } catch (err) {
        console.error('Failed to clear history:', err);
        alert('เกิดข้อผิดพลาดในการล้างประวัติ');
      }
    }
  };

  const handleFactoryReset = () => {
    if (window.confirm('⚠️ ล้างข้อมูลทั้งหมดในเครื่อง คืนค่าเริ่มต้น และออกจากระบบ?')) {
      localStorage.clear();
      syncPosterPreferenceCookie(false);
      sessionStorage.clear();
      router.push('/');
    }
  };

  // ─── Section renderer ─────────────────────────────────────────────────────
  const renderCurrentSection = (tabKey) => {
    switch (tabKey) {
      case 'general':
        return <GeneralSection onThemeChange={handleThemeSync} showHeading={!isMobile} />;
      case 'account':
        return <AccountSection session={session} />;
      case 'channel':
        return <ChannelSection session={session} showHeading={!isMobile} />;
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
        return <StorageSection />;
      case 'system':
        return (
          <SystemSection
            showHeading={!isMobile}
            allow18Plus={allow18Plus}
            setAllow18Plus={handleToggle18Plus}
            handleClearHistory={handleClearHistory}
            handleFactoryReset={handleFactoryReset}
          />
        );
      case 'support':
        return <SupportSection />;
      default:
        return <GeneralSection onThemeChange={handleThemeSync} showHeading={!isMobile} />;
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
          {/* Left Sidebar + Auto-save status */}
          <div className="sticky top-22 w-64 shrink-0 flex flex-col gap-3">
            <SettingsSidebar id={settingsTabsId} activeTab={desktopTab} onSelectTab={handleDesktopTabChange} />
            {saveStatus !== 'idle' && (
              <div className="px-3 mt-1">
                <AutoSaveIndicator saveStatus={saveStatus} />
              </div>
            )}
          </div>

          {/* Content */}
          <AnimatedTabPanel value={desktopTab} behavior="filter" className="flex-1 min-w-0 [&>.animate-fadeIn]:animate-none!">
            {renderCurrentSection(desktopTab)}
          </AnimatedTabPanel>
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
                <AutoSaveIndicator saveStatus={saveStatus} />
              </div>

              <div className='flex flex-col gap-4 px-4 pb-20'>
                {/* 1. บัญชีและช่อง */}
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-[#8C857B] dark:text-[#AAAAAA] px-3 py-1.5 uppercase tracking-wider">บัญชีและช่อง</span>
                  <div className="bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10 shadow-xs divide-y divide-[#F5F2EB] dark:divide-white/10 overflow-hidden">
                    <div
                      onClick={() => handleMobileSelectSubPage('account')}
                      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full overflow-hidden bg-[#EFECE6] dark:bg-white/10 shrink-0 flex items-center justify-center">
                          {session?.picture ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={session.picture} alt={session.name || 'User'} className="w-full h-full object-cover" />
                          ) : (
                            <User className="w-4 h-4 text-[#8C857B]" />
                          )}
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">บัญชีและความปลอดภัย</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888] truncate max-w-[200px]">
                            {session?.email || session?.name || 'เข้าสู่ระบบและจัดการอุปกรณ์'}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                    <div
                      onClick={() => handleMobileSelectSubPage('channel')}
                      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#FF7A00]/10 text-[#FF7A00] flex items-center justify-center shrink-0">
                          <AtSign className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">ช่องของฉัน (@handle)</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">
                            ตั้งชื่อ @handle, คำอธิบายช่อง และแบนเนอร์
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                  </div>
                </div>

                {/* 2. การรับชมและตัวเล่น */}
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-[#8C857B] dark:text-[#AAAAAA] px-3 py-1.5 uppercase tracking-wider">การรับชมและตัวเล่น</span>
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
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">การแสดงผลและธีม</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">
                            ธีมมืด, สว่าง หรือตามระบบ และภาษา
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                    <div
                      onClick={() => handleMobileSelectSubPage('player')}
                      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-[#FF7A00]/10 text-[#FF7A00] flex items-center justify-center shrink-0">
                          <PlayCircle className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">การเล่นและตัวเล่น</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">ความเร็ว, สัดส่วนภาพ, ข้ามเวลา และระดับเสียง</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                  </div>
                </div>

                {/* 3. ความเป็นส่วนตัวและคลัง */}
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-[#8C857B] dark:text-[#AAAAAA] px-3 py-1.5 uppercase tracking-wider">ความเป็นส่วนตัวและคลัง</span>
                  <div className="bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10 shadow-xs divide-y divide-[#F5F2EB] dark:divide-white/10 overflow-hidden">
                    <div
                      onClick={() => handleMobileSelectSubPage('system')}
                      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">ความเป็นส่วนตัวและความปลอดภัย</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">เนื้อหา 18+, ล้างประวัติ และแคชระบบ</span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                    <div
                      onClick={() => handleMobileSelectSubPage('onedrive')}
                      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-white/5 active:bg-zinc-100 dark:active:bg-white/10 transition cursor-pointer"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-500/10 text-blue-500 flex items-center justify-center shrink-0">
                          <Folder className="w-4 h-4" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">พื้นที่จัดเก็บ OneDrive</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">
                            {videoCount} คลิป · {totalSizeGB} GB
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-[#8C857B] dark:text-[#888888]" />
                    </div>
                  </div>
                </div>

                {/* 4. เกี่ยวกับระบบ */}
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-[#8C857B] dark:text-[#AAAAAA] px-3 py-1.5 uppercase tracking-wider">เกี่ยวกับระบบ</span>
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
                          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1]">เกี่ยวกับและช่วยเหลือ</span>
                          <span className="text-[11px] text-[#8C857B] dark:text-[#888888]">FAQ, Patch Notes และข้อมูลระบบ</span>
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
            <div className="flex flex-col gap-4 motion-reduce:[&>.animate-fadeIn]:animate-none!">
              <header className="sticky top-0 z-10 grid h-14 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-1 border-b border-[#EFECE6] bg-white px-3 dark:border-white/10 dark:bg-[#181818]">
                <button
                  type="button"
                  aria-label="กลับไปหน้าตั้งค่า"
                  onClick={handleMobileBack}
                  className="grid size-11 cursor-pointer place-items-center rounded-full text-[#212529] transition hover:bg-[#EFECE6] focus-visible:outline-2 focus-visible:outline-[#FF7A00] active:scale-90 dark:text-[#F1F1F1] dark:hover:bg-white/10"
                >
                  <ArrowLeft aria-hidden="true" className="size-5 stroke-[2.2]" />
                </button>
                <h2 aria-label={subPage === 'system' ? 'ความเป็นส่วนตัวและความปลอดภัย' : undefined} className="min-w-0 truncate text-center text-sm font-bold text-[#212529] dark:text-[#F1F1F1]">
                    {subPage === 'account' && 'บัญชีและความปลอดภัย'}
                    {subPage === 'channel' && 'ช่องของฉัน'}
                    {subPage === 'general' && 'การแสดงผลและธีม'}
                    {subPage === 'player' && 'การเล่นและตัวเล่น'}
                    {subPage === 'system' && 'ความเป็นส่วนตัว'}
                    {subPage === 'onedrive' && 'พื้นที่จัดเก็บ OneDrive'}
                    {subPage === 'support' && 'เกี่ยวกับและช่วยเหลือ'}
                </h2>
                <div className="flex justify-center">
                  <AutoSaveIndicator saveStatus={saveStatus} compact />
                </div>
              </header>
              {saveStatus === 'error' && (
                <p className="-mt-2 px-4 text-xs text-rose-700 dark:text-rose-400">ซิงก์ฐานข้อมูลไม่สำเร็จ</p>
              )}
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

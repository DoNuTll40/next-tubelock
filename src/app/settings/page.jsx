'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft, ChevronRight, PlayCircle, Folder,
  Database, Monitor, Save, CheckCircle, Loader2
} from 'lucide-react';
import { useViewMode } from '@/context/ViewModeContext';
import SettingsSidebar from '@/components/settings/SettingsSidebar';
import AccountSection from '@/components/settings/AccountSection';
import PlayerSection from '@/components/settings/PlayerSection';
import StorageSection from '@/components/settings/StorageSection';
import SystemSection from '@/components/settings/SystemSection';
import ActionSheetModal from '@/components/settings/ActionSheetModal';

async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
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
          : 'bg-[#EFECE6] text-[#8C857B] cursor-not-allowed'
        }`}
    >
      <Save className="w-4 h-4" />
      <span>บันทึกการตั้งค่า</span>
    </button>
  );
}

// ─── Main Settings Page ───────────────────────────────────────────────────────
export default function SettingsPage() {
  const router = useRouter();
  // ALL HOOKS MUST BE AT TOP LEVEL (Rules of Hooks)
  const { isDesktop, isMobile, setMode } = useViewMode();

  const [subPage, setSubPage] = useState(null);
  const [desktopTab, setDesktopTab] = useState('account');
  const [loading, setLoading] = useState(true);

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
    if (gravatarEmail.trim()) {
      sha256(gravatarEmail).then(setGravatarHash);
    } else {
      setGravatarHash('');
    }
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
      window.location.href = '/';
    }
  };

  // ─── Section renderer ─────────────────────────────────────────────────────
  const renderCurrentSection = (tabKey) => {
    switch (tabKey) {
      case 'account':
        return (
          <AccountSection
            gravatarEmail={gravatarEmail}
            setGravatarEmail={setGravatarEmail}
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
      default:
        return null;
    }
  };

  // ─── Loading Skeleton ─────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 py-8 flex flex-col md:flex-row gap-10 animate-pulse select-none">
        <div className="w-64 shrink-0 flex flex-col gap-2">
          <div className="h-6 w-32 bg-[#EFECE6] rounded-md mb-3" />
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-12 w-full bg-[#EFECE6] rounded-xl" />
          ))}
        </div>
        <div className="flex-1 flex flex-col gap-6">
          <div className="h-6 w-48 bg-[#EFECE6] rounded-md" />
          <div className="h-44 w-full bg-white rounded-2xl border border-[#EFECE6]" />
        </div>
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-6xl mx-auto px-4 sm:px-8 sm:py-8 select-none min-h-[85vh]">
      <ActionSheetModal sheet={sheet} onClose={() => setSheet(null)} />

      {/* ── DESKTOP ──────────────────────────────────────────────────────────── */}
      {isDesktop && (
        <div className="flex gap-10 items-start">
          {/* Left Sidebar + Save */}
          <div className="w-64 shrink-0 flex flex-col gap-3">
            <SettingsSidebar activeTab={desktopTab} onSelectTab={setDesktopTab} />
            <div className="px-3 mt-1">
              <SaveButton saveStatus={saveStatus} isDirty={isDirty} onSave={handleSave} />
              {isDirty && saveStatus === 'idle' && (
                <p className="text-[10px] text-[#8C857B] mt-2 px-1 leading-relaxed">
                  มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก กด <strong>&ldquo;บันทึก&rdquo;</strong> เพื่อบันทึกไปยัง Neon DB
                </p>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 max-w-3xl">
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
              <div className="flex items-center justify-between py-2 px-1">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => router.push('/')}
                    className="p-1.5 -ml-1 rounded-full hover:bg-[#EFECE6] active:scale-90 transition text-[#212529] cursor-pointer"
                    title="ย้อนกลับ"
                  >
                    <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
                  </button>
                  <h1 className="text-xl font-bold text-[#212529] tracking-tight">การตั้งค่า</h1>
                </div>
                <SaveButton saveStatus={saveStatus} isDirty={isDirty} onSave={handleSave} />
              </div>

              {/* บัญชีและโปรไฟล์ */}
              <div className="flex flex-col">
                <span className="text-[11px] font-bold text-[#8C857B] px-3 py-1.5 uppercase tracking-wider">บัญชีและโปรไฟล์</span>
                <div className="bg-white rounded-2xl border border-[#EFECE6] shadow-xs divide-y divide-[#F5F2EB] overflow-hidden">
                  <div
                    onClick={() => setSubPage('account')}
                    className="flex items-center justify-between p-4 hover:bg-zinc-50 active:bg-zinc-100 transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full overflow-hidden bg-[#EFECE6] shrink-0">
                        <img
                          src={gravatarHash
                            ? `https://www.gravatar.com/avatar/${gravatarHash}?d=${fallbackAvatar}&s=80`
                            : `https://www.gravatar.com/avatar/?d=${fallbackAvatar}&s=80`}
                          alt="User"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-[#212529]">โปรไฟล์และ Gravatar</span>
                        <span className="text-[11px] text-[#8C857B] truncate max-w-[200px]">
                          {gravatarEmail || 'ยังไม่ได้ตั้งค่าอีเมล'}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8C857B]" />
                  </div>
                </div>
              </div>

              {/* การเล่น */}
              <div className="flex flex-col">
                <span className="text-[11px] font-bold text-[#8C857B] px-3 py-1.5 uppercase tracking-wider">การเล่น</span>
                <div className="bg-white rounded-2xl border border-[#EFECE6] shadow-xs divide-y divide-[#F5F2EB] overflow-hidden">
                  <div
                    onClick={() => setSubPage('player')}
                    className="flex items-center justify-between p-4 hover:bg-zinc-50 active:bg-zinc-100 transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <PlayCircle className="w-5 h-5 text-[#FF7A00]" />
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-[#212529]">ทั่วไปและพฤติกรรมตัวเล่น</span>
                        <span className="text-[11px] text-[#8C857B]">ความเร็ว, สัดส่วนภาพ, ข้ามเวลา และระดับเสียง</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8C857B]" />
                  </div>
                </div>
              </div>

              {/* พื้นที่จัดเก็บ */}
              <div className="flex flex-col">
                <span className="text-[11px] font-bold text-[#8C857B] px-3 py-1.5 uppercase tracking-wider">พื้นที่จัดเก็บและคลาวด์</span>
                <div className="bg-white rounded-2xl border border-[#EFECE6] shadow-xs divide-y divide-[#F5F2EB] overflow-hidden">
                  <div
                    onClick={() => setSubPage('onedrive')}
                    className="flex items-center justify-between p-4 hover:bg-zinc-50 active:bg-zinc-100 transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <Folder className="w-5 h-5 text-blue-500" />
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-[#212529]">OneDrive และโฟลเดอร์สื่อ</span>
                        <span className="text-[11px] text-[#8C857B]">
                          {targetFolder} ({videoCount} คลิป, {totalSizeGB} GB)
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8C857B]" />
                  </div>
                </div>
              </div>

              {/* ข้อมูลและความเป็นส่วนตัว */}
              <div className="flex flex-col">
                <span className="text-[11px] font-bold text-[#8C857B] px-3 py-1.5 uppercase tracking-wider">ข้อมูลและความเป็นส่วนตัว</span>
                <div className="bg-white rounded-2xl border border-[#EFECE6] shadow-xs divide-y divide-[#F5F2EB] overflow-hidden">
                  <div
                    onClick={() => setSubPage('system')}
                    className="flex items-center justify-between p-4 hover:bg-zinc-50 active:bg-zinc-100 transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <Database className="w-5 h-5 text-emerald-500" />
                      <div className="flex flex-col">
                        <span className="text-xs font-semibold text-[#212529]">จัดการประวัติและแคชของระบบ</span>
                        <span className="text-[11px] text-[#8C857B]">ล้างประวัติการดู และการรีเซ็ตข้อมูล</span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[#8C857B]" />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Mobile sub-page */
            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between py-2 border-b border-[#EFECE6] mb-1">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setSubPage(null)}
                    className="p-1.5 -ml-1.5 rounded-full hover:bg-[#EFECE6] active:scale-90 transition text-[#212529] cursor-pointer"
                  >
                    <ArrowLeft className="w-5 h-5 stroke-[2.2]" />
                  </button>
                  <h2 className="text-base font-bold text-[#212529]">
                    {subPage === 'player' && 'ตัวเล่นวิดีโอ'}
                    {subPage === 'onedrive' && 'OneDrive และโฟลเดอร์'}
                    {subPage === 'account' && 'โปรไฟล์และ Gravatar'}
                    {subPage === 'system' && 'จัดการประวัติและแคช'}
                  </h2>
                </div>
                {subPage !== 'system' && (
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

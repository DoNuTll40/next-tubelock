'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import SettingCard from '@/components/ui/SettingCard';
import { AtSign, CheckCircle2, XCircle, Loader2, ExternalLink, Save } from 'lucide-react';
import { normalizeHandleInput, validateHandleFormat } from '@/lib/channelHandle';

export default function ChannelHandleCard({ session }) {
  const [loading, setLoading] = useState(true);
  const [savedHandle, setSavedHandle] = useState('');
  const [handleInput, setHandleInput] = useState('');
  const [bio, setBio] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');

  // Async server check result keyed by the handle string it checked
  const [remoteCheck, setRemoteCheck] = useState({ forHandle: '', status: 'idle', message: '' });

  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState({ type: '', text: '' });

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetch('/api/user/handle', { cache: 'no-store' })
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data?.profile) return;
        const p = data.profile;
        setSavedHandle(p.handle || '');
        setHandleInput(p.handle || '');
        setBio(p.bio || '');
        setBannerUrl(p.bannerUrl || '');
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const cleanedHandle = useMemo(() => normalizeHandleInput(handleInput), [handleInput]);

  const syncValidation = useMemo(() => {
    if (loading) return { status: 'idle', message: '', needsRemote: false };
    if (!cleanedHandle) {
      return { status: 'invalid', message: 'กรุณาระบุชื่อ @handle', needsRemote: false };
    }
    const fmt = validateHandleFormat(cleanedHandle);
    if (!fmt.valid) {
      return { status: 'invalid', message: fmt.reason, needsRemote: false };
    }
    if (savedHandle && cleanedHandle.toLowerCase() === savedHandle.toLowerCase()) {
      return { status: 'own', message: 'นี่คือ @handle ปัจจุบันของคุณ', needsRemote: false };
    }
    return { status: 'checking', message: 'กำลังตรวจสอบชื่อซ้ำ...', needsRemote: true };
  }, [cleanedHandle, savedHandle, loading]);

  useEffect(() => {
    if (!syncValidation.needsRemote) return undefined;
    let cancelled = false;
    const targetHandle = cleanedHandle;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/user/handle?handle=${encodeURIComponent(targetHandle)}`, {
          cache: 'no-store',
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok || !data?.success) {
          setRemoteCheck({ forHandle: targetHandle, status: 'invalid', message: 'ตรวจสอบไม่สำเร็จ' });
          return;
        }
        if (data.isOwn) {
          setRemoteCheck({ forHandle: targetHandle, status: 'own', message: data.reason });
        } else if (data.available) {
          setRemoteCheck({ forHandle: targetHandle, status: 'available', message: data.reason });
        } else {
          setRemoteCheck({ forHandle: targetHandle, status: 'taken', message: data.reason });
        }
      } catch {
        if (!cancelled) {
          setRemoteCheck({ forHandle: targetHandle, status: 'invalid', message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่สำเร็จ' });
        }
      }
    }, 350);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [cleanedHandle, syncValidation.needsRemote]);

  const checkState = syncValidation.needsRemote
    ? remoteCheck.forHandle === cleanedHandle
      ? { status: remoteCheck.status, message: remoteCheck.message }
      : { status: 'checking', message: 'กำลังตรวจสอบชื่อซ้ำ...' }
    : { status: syncValidation.status, message: syncValidation.message };

  if (!session) return null;

  const canSave =
    !isSaving &&
    !loading &&
    (checkState.status === 'available' || checkState.status === 'own');

  const handleSaveProfile = async (e) => {
    e.preventDefault();
    if (!canSave) return;
    setIsSaving(true);
    setSaveFeedback({ type: '', text: '' });
    try {
      const res = await fetch('/api/user/handle', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          handle: normalizeHandleInput(handleInput),
          bio,
          bannerUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'บันทึกข้อมูลช่องไม่สำเร็จ');
      }
      setSavedHandle(data.profile.handle || '');
      setHandleInput(data.profile.handle || '');
      setBio(data.profile.bio || '');
      setBannerUrl(data.profile.bannerUrl || '');
      setSaveFeedback({ type: 'success', text: 'บันทึกโปรไฟล์ช่องและ @handle เรียบร้อยแล้ว' });
    } catch (err) {
      setSaveFeedback({ type: 'error', text: err.message || 'เกิดข้อผิดพลาด' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SettingCard
      title="โปรไฟล์ช่อง & @handle"
      subtitle="ตั้งชื่อ @handle ประจำช่อง (ตรวจสอบชื่อซ้ำอัตโนมัติ) เพื่อใช้เป็นลิงก์หน้าช่องของคุณ"
    >
      <form onSubmit={handleSaveProfile} className="p-4 sm:p-5 space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-[#8C857B] py-2">
            <Loader2 className="w-4 h-4 animate-spin text-[#FF7A00]" />
            <span>กำลังโหลดข้อมูลช่อง...</span>
          </div>
        ) : (
          <>
            {/* @handle Input */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-bold text-[#212529] dark:text-[#F1F1F1]">
                  ชื่อแฮนเดิล (@handle)
                </label>
                {savedHandle && (
                  <Link
                    href={`/@${encodeURIComponent(savedHandle)}`}
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#FF7A00] hover:underline"
                  >
                    <span>เปิดหน้าช่อง /@{savedHandle}</span>
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                )}
              </div>

              <div className="relative flex items-center">
                <AtSign className="w-4 h-4 text-[#8C857B] absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  value={handleInput}
                  onChange={(e) => setHandleInput(e.target.value.replace(/^@+/, ''))}
                  placeholder="yourname"
                  maxLength={28}
                  className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-[#F5F2EB] dark:bg-white/5 border border-[#EFECE6] dark:border-white/10 focus:border-[#FF7A00] outline-none text-sm font-mono text-[#212529] dark:text-[#F1F1F1] transition"
                />
                <div className="absolute right-3">
                  {checkState.status === 'checking' && (
                    <Loader2 className="w-4 h-4 animate-spin text-[#FF7A00]" />
                  )}
                  {(checkState.status === 'available' || checkState.status === 'own') && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  )}
                  {(checkState.status === 'taken' || checkState.status === 'invalid') && (
                    <XCircle className="w-4 h-4 text-rose-500" />
                  )}
                </div>
              </div>

              {checkState.message && (
                <p
                  className={`text-[11px] font-medium ${
                    checkState.status === 'available' || checkState.status === 'own'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : checkState.status === 'taken' || checkState.status === 'invalid'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-[#8C857B]'
                  }`}
                >
                  {checkState.message}
                </p>
              )}
              <p className="text-[11px] text-[#8C857B] dark:text-[#888888]">
                ลิงก์ช่องของคุณ: <span className="font-mono text-[#212529] dark:text-[#CCCCCC]">/@{normalizeHandleInput(handleInput) || 'yourhandle'}</span>
              </p>
            </div>

            {/* Bio */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#212529] dark:text-[#F1F1F1]">
                คำอธิบายช่อง (Bio)
              </label>
              <textarea
                rows={3}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                maxLength={1000}
                placeholder="แนะนำตัวหรือแนวเนื้อหาของช่องคุณ..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F2EB] dark:bg-white/5 border border-[#EFECE6] dark:border-white/10 focus:border-[#FF7A00] outline-none text-xs sm:text-sm text-[#212529] dark:text-[#F1F1F1] transition resize-none"
              />
            </div>

            {/* Banner URL */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-[#212529] dark:text-[#F1F1F1]">
                ลิงก์ภาพแบนเนอร์ช่อง (ไม่บังคับ)
              </label>
              <input
                type="url"
                value={bannerUrl}
                onChange={(e) => setBannerUrl(e.target.value)}
                placeholder="https://example.com/banner.jpg"
                className="w-full px-3.5 py-2.5 rounded-xl bg-[#F5F2EB] dark:bg-white/5 border border-[#EFECE6] dark:border-white/10 focus:border-[#FF7A00] outline-none text-xs sm:text-sm text-[#212529] dark:text-[#F1F1F1] transition"
              />
            </div>

            {saveFeedback.text && (
              <div
                className={`p-3 rounded-xl text-xs font-semibold border ${
                  saveFeedback.type === 'success'
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-400'
                    : 'bg-rose-500/10 border-rose-500/25 text-rose-700 dark:text-rose-400'
                }`}
              >
                {saveFeedback.text}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={!canSave}
                className="px-4 py-2 rounded-xl bg-[#FF7A00] hover:bg-[#E06C00] text-white text-xs font-bold inline-flex items-center gap-1.5 transition active:scale-95 disabled:opacity-45 disabled:cursor-not-allowed cursor-pointer"
              >
                {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>บันทึกโปรไฟล์ช่อง</span>
              </button>
            </div>
          </>
        )}
      </form>
    </SettingCard>
  );
}

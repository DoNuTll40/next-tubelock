'use client';

import { useId, useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import ChannelProfileHeader, { ChannelOwnerActions, extractBioLinks } from '@/components/channel/ChannelProfileHeader';
import ChannelAboutDialog from '@/components/channel/ChannelAboutDialog';
import { AtSign, Loader2, ExternalLink, Save } from 'lucide-react';
import { normalizeHandleInput, validateHandleFormat } from '@/lib/channelHandle';

export default function ChannelHandleCard({ session }) {
  const fieldId = useId();
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [handleInput, setHandleInput] = useState('');
  const [bio, setBio] = useState('');
  const [bannerUrl, setBannerUrl] = useState('');
  const [profile, setProfile] = useState(null);
  const [showPreviewAbout, setShowPreviewAbout] = useState(false);
  const savedHandle = profile?.handle || '';
  const userId = session?.id;

  // Async server check result keyed by the handle string it checked
  const [remoteCheck, setRemoteCheck] = useState({ forHandle: '', status: 'idle', message: '' });

  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState({ type: '', text: '' });

  useEffect(() => {
    if (userId == null) return;
    let cancelled = false;
    fetch('/api/user/handle', { cache: 'no-store' })
      .then((res) => {
        if (!res.ok) throw new Error('Channel profile unavailable');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (!data?.profile) throw new Error('Channel profile unavailable');
        const p = data.profile;
        setProfile(p);
        setHandleInput(p.handle || '');
        setBio(p.bio || '');
        setBannerUrl(p.bannerUrl || '');
      })
      .catch(() => { if (!cancelled) setLoadFailed(true); })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt, userId]);

  const cleanedHandle = useMemo(() => normalizeHandleInput(handleInput), [handleInput]);

  const syncValidation = useMemo(() => {
    if (loading || loadFailed) return { status: 'idle', message: '', needsRemote: false };
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
  }, [cleanedHandle, savedHandle, loading, loadFailed]);

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

  const draftBanner = bannerUrl.trim();
  let previewBanner = '';
  try {
    if (draftBanner.startsWith('/') || /^https?:\/\//i.test(draftBanner)) {
      const url = new URL(draftBanner, 'https://tubelock.invalid');
      if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) previewBanner = draftBanner;
    }
  } catch { /* Incomplete URL. */ }
  const bannerInvalid = Boolean(draftBanner && !previewBanner);
  const hasChanges = cleanedHandle !== savedHandle || bio.trim() !== (profile?.bio || '') || draftBanner !== (profile?.bannerUrl || '');
  const canSave =
    !isSaving &&
    !loading &&
    !loadFailed &&
    hasChanges &&
    !bannerInvalid &&
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
      setProfile((previous) => ({ ...previous, ...data.profile }));
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

    const fieldClass = 'block w-full rounded-xl border border-[#E8E2D9] bg-[#FBF9F5] px-3.5 py-2.5 text-base text-[#212529] outline-none transition-colors placeholder:text-[#827A6F] focus:border-[#C65B00] focus:ring-2 focus:ring-[#FF7A00]/20 sm:text-sm dark:border-white/10 dark:bg-[#121212] dark:text-[#F1F1F1] dark:placeholder:text-[#9C968F]';
  const surface = 'min-w-0 rounded-2xl border border-[#E8E2D9] bg-white dark:border-white/10 dark:bg-[#181818]';
  const isInvalid = checkState.status === 'invalid' || checkState.status === 'taken';

  if (loading) {
    return (
      <div role="status" className={`flex items-center gap-2.5 p-6 text-sm text-[#6F665D] dark:text-[#B7B0A8] ${surface}`}>
        <Loader2 aria-hidden="true" className="size-4 animate-spin text-[#FF7A00]" />
        กำลังโหลดข้อมูลช่อง…
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className={`flex flex-wrap items-center justify-between gap-3 p-5 text-sm ${surface}`}>
        <p role="alert">โหลดข้อมูลช่องไม่สำเร็จ</p>
        <button type="button" className="min-h-11 rounded-xl border border-current px-4 font-semibold text-[#9F4200] dark:text-[#FF963D]"
          onClick={() => { setLoadFailed(false); setLoading(true); setLoadAttempt((attempt) => attempt + 1); }}>
          ลองอีกครั้ง
        </button>
      </div>
    );
  }

  const previewChannel = { name: profile?.name || session.name || cleanedHandle, picture: profile?.picture || session.picture, handle: cleanedHandle, bio: bio.trim(), bannerUrl: previewBanner };
  const bioLinks = extractBioLinks(previewChannel.bio);

  return (
    <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
      <aside className={`p-4 sm:p-6 ${surface}`} aria-labelledby={`${fieldId}-preview`}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${fieldId}-preview`} className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1]">ตัวอย่างหน้าช่อง</h3>
          {savedHandle && (
            <Link href={`/@${encodeURIComponent(savedHandle)}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#9F4200] hover:underline dark:text-[#FF963D]">
              ดูช่องจริง <ExternalLink aria-hidden="true" className="size-3.5" />
            </Link>
          )}
        </div>
        <ChannelProfileHeader
          channel={previewChannel}
          bioLinks={bioLinks}
          subscriberCount={profile?.subscriberCount ?? 0}
          videoCount={profile?.videoCount ?? 0}
          titleAs="h4"
          onShowAbout={() => setShowPreviewAbout(true)}
          actions={<ChannelOwnerActions editHref={`#${fieldId}-title`} />}
        />
        {showPreviewAbout && (
          <ChannelAboutDialog channel={previewChannel} bioLinks={bioLinks} onClose={() => setShowPreviewAbout(false)} />
        )}
      </aside>

      <form onSubmit={handleSaveProfile} className={surface} aria-labelledby={`${fieldId}-title`}>
        <div className="space-y-5 p-4 sm:space-y-6 sm:p-6">
          <h3 id={`${fieldId}-title`} className="scroll-mt-24 text-base font-bold text-[#212529] dark:text-[#F1F1F1]">ข้อมูลช่อง</h3>

          <div className="space-y-2">
            <label htmlFor={`${fieldId}-handle`} className="block text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
              ชื่อแฮนเดิล
            </label>
            <div className="relative">
              <AtSign aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-[#756C62] dark:text-[#AEAAA4]" />
              <input
                id={`${fieldId}-handle`}
                type="text"
                value={handleInput}
                onChange={(e) => {
                  setHandleInput(e.target.value.replace(/^@+/, ''));
                  setSaveFeedback({ type: '', text: '' });
                }}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                placeholder="yourname"
                maxLength={28}
                disabled={isSaving}
                aria-invalid={isInvalid}
                aria-describedby={`${fieldId}-handle-status`}
                className={`${fieldClass} pl-10 font-mono`}
              />
            </div>
            <p id={`${fieldId}-handle-status`} aria-live="polite" className={`text-xs leading-relaxed ${isInvalid
              ? 'text-rose-700 dark:text-rose-400'
              : checkState.status === 'available'
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-[#6F665D] dark:text-[#B7B0A8]'}`}>
              {checkState.status === 'own' ? 'ใช้เป็นที่อยู่ของหน้าช่อง' : checkState.message}
            </p>
            {savedHandle && !isInvalid && cleanedHandle && cleanedHandle.toLowerCase() !== savedHandle.toLowerCase() && (
              <p className="break-all text-xs text-[#6F665D] dark:text-[#B7B0A8]">เมื่อบันทึก ที่อยู่ช่องจะเปลี่ยนเป็น /@{cleanedHandle}</p>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={`${fieldId}-bio`} className="text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">คำอธิบายช่อง</label>
              <span className="shrink-0 text-xs text-[#6F665D] tabular-nums dark:text-[#B7B0A8]">{bio.length}/1000</span>
            </div>
            <textarea
              id={`${fieldId}-bio`}
              value={bio}
              onChange={(e) => {
                setBio(e.target.value);
                setSaveFeedback({ type: '', text: '' });
              }}
              rows={5}
              maxLength={1000}
              disabled={isSaving}
              placeholder="เล่าสั้น ๆ ว่าช่องนี้เกี่ยวกับอะไร"
              className={`${fieldClass} min-h-32 resize-y leading-relaxed`}
            />
            <p className="text-xs leading-relaxed text-[#6F665D] dark:text-[#B7B0A8]">
              ลิงก์แรกในคำอธิบายจะแสดงใต้หัวช่อง ลิงก์ทั้งหมดจะอยู่ในรายละเอียดช่อง
            </p>
          </div>

          <div className="space-y-2">
            <label htmlFor={`${fieldId}-banner`} className="block text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
              URL ภาพแบนเนอร์ <span className="font-normal text-[#6F665D] dark:text-[#B7B0A8]">· ไม่บังคับ</span>
            </label>
            <input
              id={`${fieldId}-banner`}
              type="text"
              inputMode="url"
              value={bannerUrl}
              maxLength={2000}
              disabled={isSaving}
              aria-invalid={bannerInvalid}
              aria-describedby={bannerInvalid ? `${fieldId}-banner-error` : undefined}
              onChange={(e) => {
                setBannerUrl(e.target.value);
                setSaveFeedback({ type: '', text: '' });
              }}
              placeholder="https://example.com/banner.jpg"
              className={fieldClass}
            />
            {bannerInvalid && <p id={`${fieldId}-banner-error`} className="text-xs text-rose-700 dark:text-rose-400">ใส่ URL รูปภาพที่ขึ้นต้นด้วย https:// หรือ http://</p>}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-[#E8E2D9] p-4 sm:flex-row sm:items-center sm:justify-end sm:px-6 dark:border-white/10">
          <p role="status" className={`text-xs leading-relaxed sm:mr-auto ${saveFeedback.type === 'error' ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
            {saveFeedback.text}
          </p>
          <button
            type="submit"
            disabled={!canSave}
            className="inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#FF7A00] px-4 text-sm font-bold text-[#211205] transition-colors hover:bg-[#FF9333] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C65B00] disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isSaving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <Save aria-hidden="true" className="size-4" />}
            {isSaving ? 'กำลังบันทึก' : 'บันทึกการเปลี่ยนแปลง'}
          </button>
        </div>
      </form>

    </div>
  );
}

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  Cloud,
  Layers,
  Clock,
  RefreshCw,
  HardDrive,
  FolderSync,
  Film,
  Search,
  ArrowUpDown,
  LockKeyhole,
  ExternalLink,
  AlertTriangle,
  Database,
} from 'lucide-react';
import { usePosterPreference } from '@/lib/usePosterPreference';
import { formatThaiRelativeTime } from '@/lib/formatThaiMeta';
import { formatResolutionBadge, RESTRICTED_POSTER } from '@/lib/videoUtils';

function formatStorageSize(rawMB) {
  const mb = Number(rawMB) || 0;
  if (mb >= 1024) {
    return { value: (mb / 1024).toFixed(2), unit: 'GB' };
  }
  return { value: mb.toFixed(1), unit: 'MB' };
}

function formatDuration(sec) {
  const total = Math.max(0, Math.round(Number(sec) || 0));
  if (!total) return '';
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function groupStreamFolders(items = []) {
  const map = new Map();
  for (const folder of items) {
    const match = String(folder.name || '').match(/^(stream_vid_\d+)(?:_v\d+)?$/i);
    const groupKey = match ? match[1].toLowerCase() : String(folder.name || folder.id);
    const sizeNum = Number(folder.sizeMB) || 0;
    const segmentsNum = Number(folder.childCount) || 0;
    const modTime = folder.lastModified ? new Date(folder.lastModified).getTime() : 0;

    const existing = map.get(groupKey);
    if (!existing) {
      map.set(groupKey, {
        ...folder,
        name: match ? match[1] : folder.name,
        totalSizeMB: sizeNum,
        totalSegments: segmentsNum,
        folderCount: 1,
        latestModTime: modTime,
        baseImageUrl: folder.imageUrl,
      });
    } else {
      existing.totalSizeMB += sizeNum;
      existing.totalSegments += segmentsNum;
      existing.folderCount += 1;
      if (modTime > existing.latestModTime) {
        existing.latestModTime = modTime;
        existing.lastModified = folder.lastModified;
      }
      if (match && folder.name.toLowerCase() === match[1].toLowerCase()) {
        existing.baseImageUrl = folder.imageUrl;
      }
      if (!existing.videoTitle && folder.videoTitle) {
        existing.videoTitle = folder.videoTitle;
        existing.videoSlug = folder.videoSlug;
        existing.resolution = folder.resolution;
        existing.duration = folder.duration;
        existing.isMature = folder.isMature;
        existing.status = folder.status;
      }
    }
  }
  return Array.from(map.values()).sort((a, b) => b.latestModTime - a.latestModTime);
}

export default function StorageSection() {
  const allow18Plus = usePosterPreference(true);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('recent'); // 'recent' | 'size'

  const fetchStorageData = async () => {
    try {
      const res = await fetch('/api/onedrive/storage', { cache: 'no-store' });
      const json = await res.json();
      if (json.success) {
        setData(json);
      }
    } catch (err) {
      console.error('Fetch storage failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/onedrive/storage', { cache: 'no-store' });
        const json = await res.json();
        if (active && json.success) {
          setData(json);
        }
      } catch (err) {
        console.error('Fetch storage failed:', err);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    await fetchStorageData();
    setSyncing(false);
  };

  const storage = data?.storage || {
    usedGB: 0,
    totalGB: 1024,
    remainingGB: 0,
    usedPercentage: '0',
    totalHlsGB: 0,
    otherCloudGB: 0,
  };

  const groupedFolders = useMemo(
    () => groupStreamFolders(data?.folders?.items || []),
    [data]
  );

  const myTotalMB = useMemo(
    () => groupedFolders.reduce((sum, f) => sum + (Number(f.totalSizeMB) || 0), 0),
    [groupedFolders]
  );
  const myUsedGB = data?.myStorage?.usedGB ?? myTotalMB / 1024;
  const mySizeDisplay = formatStorageSize(data?.myStorage?.usedMB ?? myTotalMB);
  const totalGB = Math.max(1, Number(storage.totalGB || 1024));
  const usedGB = Number(storage.usedGB || 0);
  const otherCloudGB = Math.max(0, storage.otherCloudGB ?? (usedGB - myUsedGB));

  const myPct = Math.min(100, (myUsedGB / totalGB) * 100);
  const otherPct = Math.min(Math.max(0, 100 - myPct), (otherCloudGB / totalGB) * 100);

  const maxFolderMB = useMemo(
    () => Math.max(1, ...groupedFolders.map((f) => Number(f.totalSizeMB) || 0)),
    [groupedFolders]
  );

  const filteredFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? groupedFolders.filter(
          (f) =>
            String(f.videoTitle || '').toLowerCase().includes(q) ||
            String(f.name || '').toLowerCase().includes(q)
        )
      : groupedFolders;

    if (sortBy === 'size') {
      return [...list].sort((a, b) => b.totalSizeMB - a.totalSizeMB);
    }
    return list;
  }, [groupedFolders, query, sortBy]);

  if (loading) {
    return (
      <div className="flex flex-col gap-6 animate-pulse select-none px-4 sm:px-0">
        <div className="h-7 w-56 bg-[#EFECE6] dark:bg-white/10 rounded-lg" />
        <div className="h-44 w-full bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10" />
          ))}
        </div>
        <div className="h-72 w-full bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 animate-fadeIn px-4 sm:px-0 text-[#212529] dark:text-[#F1F1F1]">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#EFECE6] dark:border-white/10">
        <div>
          <h2 className="text-xl font-bold tracking-tight">พื้นที่จัดเก็บ OneDrive</h2>
          <p className="text-xs text-[#8C857B] dark:text-[#AAAAAA] mt-0.5">
            ภาพรวมความจุคลาวด์ และรายละเอียดขนาดไฟล์วิดีโอ HLS ใน <code className="font-mono text-[#FF7A00]">/streams</code>
          </p>
        </div>

        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-[#1E1E1E] hover:bg-[#F5F2EB] dark:hover:bg-white/10 border border-[#EFECE6] dark:border-white/10 text-xs font-semibold text-[#212529] dark:text-[#F1F1F1] transition cursor-pointer disabled:opacity-60 shadow-2xs"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-[#FF7A00]' : 'text-[#8C857B] dark:text-[#AAAAAA]'}`} />
          <span>{syncing ? 'กำลังอัปเดต...' : 'รีเฟรชข้อมูล'}</span>
        </button>
      </div>

      {/* ── Storage Overview Card ──────────────────────────────────── */}
      <div className="rounded-2xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 p-5 sm:p-6 shadow-xs space-y-5">
        {/* Top Row: Big Usage + Percent Pill */}
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <span className="text-3xl sm:text-4xl font-black font-mono tracking-tight text-[#212529] dark:text-white">
              {Number(storage.usedGB || 0).toFixed(2)}
              <span className="text-base sm:text-lg font-bold text-[#8C857B] dark:text-[#9A9A9A] ml-1.5">GB</span>
            </span>
            <span className="text-xs sm:text-sm text-[#8C857B] dark:text-[#9A9A9A]">
              จากทั้งหมด {Number(storage.totalGB || 0).toLocaleString('th-TH')} GB
            </span>
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#FF7A00]/10 text-[#FF7A00] border border-[#FF7A00]/20 font-mono">
            ใช้ไปแล้ว {storage.usedPercentage}%
          </span>
        </div>

        {/* Segmented Multi-Color Storage Bar */}
        <div className="space-y-2.5">
          <div className="w-full h-3 bg-[#EFECE6] dark:bg-white/10 rounded-full overflow-hidden flex gap-0.5 p-0.5">
            {myPct > 0 && (
              <div
                title={`พื้นที่วิดีโอของฉัน: ${myUsedGB.toFixed(2)} GB`}
                className="h-full bg-[#FF7A00] rounded-l-full transition-all duration-700"
                style={{ width: `${Math.max(myPct, 1.5)}%` }}
              />
            )}
            {otherPct > 0.2 && (
              <div
                title={`ข้อมูลอื่น ๆ บนคลาวด์ (รวมผู้ใช้อื่นและไฟล์ระบบ): ${otherCloudGB.toFixed(2)} GB`}
                className={`h-full bg-sky-500/80 transition-all duration-700 ${myPct <= 0 ? 'rounded-l-full' : ''}`}
                style={{ width: `${Math.max(otherPct, 1)}%` }}
              />
            )}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-[#6C655D] dark:text-[#AAAAAA]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#FF7A00]" />
              <span>วิดีโอของฉัน ({mySizeDisplay.value} {mySizeDisplay.unit})</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500/80" />
              <span>ข้อมูลรวมอื่น ๆ บนคลาวด์ ({otherCloudGB.toFixed(2)} GB)</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#DFD9CE] dark:bg-white/20" />
              <span>พื้นที่ว่าง ({Number(storage.remainingGB || 0).toFixed(2)} GB)</span>
            </span>
          </div>
        </div>

        {/* 3 Compact Stat Tiles: My Usage vs Overall Cloud vs Remaining */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
          <div className="rounded-xl bg-[#FFF8F2] dark:bg-[#FF7A00]/[0.07] border border-[#FF7A00]/20 p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#FF7A00]/15 text-[#FF7A00] flex items-center justify-center shrink-0">
              <FolderSync className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] text-[#8C857B] dark:text-[#AAAAAA] block">พื้นที่วิดีโอของฉัน</span>
              <span className="text-sm font-bold font-mono text-[#212529] dark:text-[#F1F1F1]">
                {mySizeDisplay.value} {mySizeDisplay.unit}
              </span>
              <span className="text-[11px] text-[#8C857B] dark:text-[#888888] ml-1.5">
                · {groupedFolders.length} คลิป
              </span>
            </div>
          </div>

          <div className="rounded-xl bg-[#FAF8F4] dark:bg-white/[0.04] border border-[#EFECE6] dark:border-white/5 p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/12 text-sky-500 flex items-center justify-center shrink-0">
              <Cloud className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] block">ใช้ไปรวมทั้งคลาวด์</span>
              <span className="text-sm font-bold font-mono text-[#212529] dark:text-[#F1F1F1]">
                {usedGB.toFixed(2)} GB
              </span>
              <span className="text-[11px] text-[#8C857B] dark:text-[#888888] ml-1.5">
                · {storage.usedPercentage}%
              </span>
            </div>
          </div>

          <div className="rounded-xl bg-[#FAF8F4] dark:bg-white/[0.04] border border-[#EFECE6] dark:border-white/5 p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/12 text-emerald-500 flex items-center justify-center shrink-0">
              <HardDrive className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <span className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] block">พื้นที่ว่างคงเหลือ</span>
              <span className="text-sm font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {Number(storage.remainingGB || 0).toFixed(2)} GB
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── HLS Cloud Library Section (Own Videos Only) ────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-[#FF7A00]" />
            <h3 className="text-sm font-bold">
              คลังวิดีโอ HLS ของฉัน
              <span className="ml-1.5 text-xs font-semibold text-[#8C857B] dark:text-[#888888]">
                ({filteredFolders.length}{query.trim() ? ` / ${groupedFolders.length}` : ''})
              </span>
            </h3>
          </div>

          {/* Search + Sort Controls */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-56">
              <Search className="w-3.5 h-3.5 text-[#8C857B] dark:text-[#888888] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="ค้นหาชื่อคลิป หรือโฟลเดอร์..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 text-xs text-[#212529] dark:text-[#F1F1F1] placeholder:text-[#8C857B] dark:placeholder:text-[#666666] focus:outline-none focus:border-[#FF7A00]"
              />
            </div>

            <button
              type="button"
              onClick={() => setSortBy((prev) => (prev === 'recent' ? 'size' : 'recent'))}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-[#181818] hover:bg-[#F5F2EB] dark:hover:bg-white/10 border border-[#EFECE6] dark:border-white/10 text-xs font-semibold text-[#6C655D] dark:text-[#CCCCCC] transition cursor-pointer shrink-0"
              title="สลับการเรียงลำดับ"
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-[#FF7A00]" />
              <span>{sortBy === 'size' ? 'ขนาดใหญ่สุด' : 'อัปเดตล่าสุด'}</span>
            </button>
          </div>
        </div>

        {/* Folder List Card */}
        <div className="bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10 divide-y divide-[#F5F2EB] dark:divide-white/5 overflow-hidden shadow-xs">
          {filteredFolders.length === 0 ? (
            <div className="p-10 text-center text-xs text-[#8C857B] dark:text-[#888888]">
              {query.trim() ? 'ไม่พบรายการที่ตรงกับคำค้นหา' : 'ยังไม่มีวิดีโอของคุณบนพื้นที่จัดเก็บ OneDrive'}
            </div>
          ) : (
            filteredFolders.map((folder) => {
              const formattedDate = formatThaiRelativeTime(folder.lastModified) || '-';
              const matchedVidId = folder.videoId || String(folder.name || '').match(/^stream_vid_(\d+)/)?.[1];
              const isMasked = Boolean(folder.isMature) && !allow18Plus;
              const fallbackUrl = folder.baseImageUrl || folder.imageUrl || '';
              const resolvedThumb = isMasked
                ? RESTRICTED_POSTER
                : folder.isMature && allow18Plus && matchedVidId
                  ? `/api/videos/${matchedVidId}/poster`
                  : fallbackUrl;
              const sizeFmt = formatStorageSize(folder.totalSizeMB);
              const sizeRatioPct = Math.max(4, Math.min(100, (folder.totalSizeMB / maxFolderMB) * 100));
              const resBadge = folder.resolution ? formatResolutionBadge(folder.resolution) : '';
              const durationStr = formatDuration(folder.duration);
              const watchHref = folder.videoSlug ? `/watch/${folder.videoSlug}` : null;
              const isOrphan = !folder.videoTitle && Boolean(matchedVidId);

              return (
                <div
                  key={folder.id}
                  className="group flex items-center justify-between gap-3 p-3 sm:p-3.5 hover:bg-[#FAF8F5] dark:hover:bg-white/[0.04] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Thumbnail */}
                    <div className="w-24 sm:w-28 aspect-video rounded-xl bg-[#EFECE6] dark:bg-[#222222] overflow-hidden shrink-0 border border-[#EFECE6] dark:border-white/10 flex items-center justify-center relative shadow-2xs">
                      {resolvedThumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={resolvedThumb}
                          alt={folder.videoTitle || folder.name}
                          onError={(e) => {
                            if (!isMasked && fallbackUrl && e.currentTarget.dataset.fallbackApplied !== '1') {
                              e.currentTarget.dataset.fallbackApplied = '1';
                              e.currentTarget.src = fallbackUrl;
                            }
                          }}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <Film className="w-5 h-5 text-[#8C857B] dark:text-[#666666]" />
                      )}
                      {isMasked && (
                        <span className="absolute left-1 top-1 inline-flex items-center gap-0.5 rounded bg-black/80 px-1.5 py-0.5 text-[9px] font-bold text-white">
                          <LockKeyhole className="w-2.5 h-2.5 text-[#FF9E40]" />
                          18+
                        </span>
                      )}
                      {durationStr && (
                        <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white">
                          {durationStr}
                        </span>
                      )}
                    </div>

                    {/* Title + Metadata */}
                    <div className="flex flex-col min-w-0 flex-1 gap-1">
                      <div className="flex items-center gap-2 min-w-0">
                        {watchHref ? (
                          <Link
                            href={watchHref}
                            prefetch={false}
                            className="text-xs sm:text-sm font-bold text-[#212529] dark:text-[#F1F1F1] hover:text-[#FF7A00] dark:hover:text-[#FF9E40] truncate transition-colors"
                          >
                            {folder.videoTitle}
                          </Link>
                        ) : (
                          <span className="text-xs sm:text-sm font-bold font-mono text-[#212529] dark:text-[#F1F1F1] truncate">
                            {folder.name}
                          </span>
                        )}

                        {resBadge && (
                          <span className="px-1.5 py-0.5 rounded bg-black/[0.06] dark:bg-white/10 text-[10px] font-bold font-mono text-[#6C655D] dark:text-[#CCCCCC] shrink-0">
                            {resBadge}
                          </span>
                        )}
                        {folder.folderCount > 1 && (
                          <span className="px-1.5 py-0.5 rounded bg-[#FF7A00]/15 text-[#FF7A00] text-[10px] font-bold shrink-0">
                            {folder.folderCount} แบบ
                          </span>
                        )}
                        {isOrphan && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 text-[10px] font-semibold shrink-0">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            ไม่พบใน DB
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[#8C857B] dark:text-[#888888]">
                        <code className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#F5F2EB] dark:bg-white/[0.06] text-[#6C655D] dark:text-[#AAAAAA]">
                          /{folder.name}
                        </code>
                        <span className="inline-flex items-center gap-1">
                          <Layers className="w-3 h-3 text-[#FF7A00]" />
                          {folder.totalSegments.toLocaleString('th-TH')} segments
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3 opacity-70" />
                          {formattedDate}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Size + Relative Bar + Open Link */}
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="flex flex-col items-end gap-1 min-w-[76px]">
                      <span className="text-xs sm:text-sm font-bold font-mono text-[#212529] dark:text-[#F1F1F1] tabular-nums">
                        {sizeFmt.value}{' '}
                        <span className="text-[10px] font-semibold text-[#8C857B] dark:text-[#888888]">
                          {sizeFmt.unit}
                        </span>
                      </span>
                      <div className="w-16 h-1 rounded-full bg-[#EFECE6] dark:bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#FF7A00]"
                          style={{ width: `${sizeRatioPct}%` }}
                        />
                      </div>
                    </div>

                    {watchHref && (
                      <Link
                        href={watchHref}
                        prefetch={false}
                        title="เปิดดูวิดีโอ"
                        aria-label={`เปิดดู ${folder.videoTitle}`}
                        className="hidden sm:inline-flex items-center justify-center w-8 h-8 rounded-lg text-[#8C857B] dark:text-[#888888] hover:text-[#FF7A00] hover:bg-[#FF7A00]/10 transition"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </Link>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

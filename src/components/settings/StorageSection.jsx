'use client';

import React, { useState, useEffect } from 'react';
import {
  Cloud,
  Layers,
  Clock,
  RefreshCw,
  HardDrive,
  CheckCircle2,
  FolderSync,
  Film,
} from 'lucide-react';

export default function StorageSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);

  const fetchStorageData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/onedrive/storage');
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
    fetchStorageData();
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    await fetchStorageData();
    setSyncing(false);
  };

  if (loading) {
    return (
      <div className="flex flex-col gap-6 animate-pulse select-none px-4 sm:px-0">
        <div className="h-6 w-52 bg-[#EFECE6] dark:bg-white/10 rounded-md" />
        <div className="h-36 w-full bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10" />
        <div className="h-64 w-full bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10" />
      </div>
    );
  }

  const { storage, folders } = data || {
    storage: { usedGB: 0, totalGB: 1024, remainingGB: 0, usedPercentage: '0' },
    folders: { totalStreams: 0, items: [] },
  };

  return (
    <div className="flex flex-col gap-8 animate-fadeIn px-4 sm:px-0 text-[#212529] dark:text-[#F1F1F1]">
      {/* ── Title Header ───────────────────────────────────────────── */}
      <div className="pb-4 border-b border-[#EFECE6] dark:border-white/10">
        <h2 className="text-xl font-bold tracking-tight">พื้นที่จัดเก็บและ OneDrive</h2>
        <p className="text-xs text-[#8C857B] dark:text-[#AAAAAA] mt-1">
          ตรวจสอบความจุคลาวด์ ติดตามไฟล์สื่อ HLS Multi-Segments (.m3u8 + .ts) และรูปภาพหน้าปก
        </p>
      </div>

      {/* ── Section 1: Quota Storage Usage ─────────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Cloud className="w-5 h-5 text-blue-500" />
            <h3 className="text-sm font-bold">ความจุ Microsoft OneDrive</h3>
          </div>
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F5F2EB] dark:bg-white/5 hover:bg-[#EFECE6] dark:hover:bg-white/10 text-xs font-semibold text-[#8C857B] dark:text-[#AAAAAA] hover:text-[#212529] dark:hover:text-[#F1F1F1] transition cursor-pointer select-none"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin text-[#FF7A00]' : ''}`} />
            <span>รีเฟรชข้อมูล</span>
          </button>
        </div>

        {/* Storage Card */}
        <div className="p-5 rounded-2xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 flex flex-col gap-4 shadow-xs">
          <div className="flex items-end justify-between">
            <div>
              <span className="text-2xl sm:text-3xl font-extrabold font-mono text-[#212529] dark:text-white">
                {storage.usedGB} GB
              </span>
              <span className="text-xs text-[#8C857B] dark:text-[#AAAAAA] ml-2">
                ใช้ไปจาก {storage.totalGB} GB ({storage.usedPercentage}%)
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-500/10 px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-500/20 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>เหลือ {storage.remainingGB} GB</span>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="w-full h-2.5 bg-[#EFECE6] dark:bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 via-[#FF7A00] to-[#FF7A00] rounded-full transition-all duration-700"
              style={{ width: `${Math.max(Number(storage.usedPercentage), 1.5)}%` }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] text-[#8C857B] dark:text-[#888888] border-t border-[#F5F2EB] dark:border-white/5">
            <span>
              Target Folder: <code className="text-[#FF7A00] font-mono bg-[#FFF4EB] dark:bg-[#FF7A00]/10 px-1.5 py-0.5 rounded">/streams</code>
            </span>
            <span>รูปแบบ: Master Playlist (.m3u8) & TS Segments</span>
          </div>
        </div>
      </div>

      {/* ── Section 2: HLS Stream Folders List ──────────────────────── */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FolderSync className="w-5 h-5 text-[#FF7A00]" />
            <h3 className="text-sm font-bold">
              คลังวิดีโอ HLS บนคลาวด์ ({folders.totalStreams} รายการ)
            </h3>
          </div>
        </div>

        <div className="bg-white dark:bg-[#181818] rounded-2xl border border-[#EFECE6] dark:border-white/10 divide-y divide-[#F5F2EB] dark:divide-white/5 overflow-hidden shadow-xs">
          {folders.items.length === 0 ? (
            <div className="p-8 text-center text-xs text-[#8C857B] dark:text-[#888888]">
              ไม่พบโฟลเดอร์วิดีโอใน /streams
            </div>
          ) : (
            folders.items.map((folder) => {
              const formattedDate = new Date(folder.lastModified).toLocaleDateString('th-TH', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <div
                  key={folder.id}
                  className="flex items-center justify-between p-3.5 sm:p-4 hover:bg-[#FAF8F5] dark:hover:bg-white/5 transition"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    {/* Thumbnail หรือ Fallback Poster Icon */}
                    <div className="w-16 h-10 sm:w-20 sm:h-12 rounded-lg bg-[#EFECE6] dark:bg-white/10 overflow-hidden shrink-0 border border-[#EFECE6] dark:border-white/10 flex items-center justify-center relative shadow-2xs">
                      {folder.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={folder.imageUrl}
                          alt={folder.name}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <Film className="w-5 h-5 text-[#8C857B] dark:text-[#666666]" />
                      )}
                    </div>

                    {/* รายละเอียดโฟลเดอร์ */}
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs sm:text-sm font-bold font-mono text-[#212529] dark:text-[#F1F1F1] truncate">
                        {folder.name}
                      </span>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#8C857B] dark:text-[#888888] mt-1">
                        <span className="flex items-center gap-1">
                          <Layers className="w-3 h-3 text-[#FF7A00]" />
                          {folder.childCount} segments
                        </span>
                        <span>•</span>
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-zinc-400" />
                          {formattedDate}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* ขนาดไฟล์ MB */}
                  <div className="flex items-center gap-3 pl-3 shrink-0">
                    <span className="text-xs sm:text-sm font-bold font-mono text-[#212529] dark:text-zinc-200">
                      {folder.sizeMB} <span className="text-[10px] text-[#8C857B] dark:text-[#888888]">MB</span>
                    </span>
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
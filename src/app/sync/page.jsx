'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  RefreshCw, CheckCircle2, AlertCircle, Folder, Film,
  ArrowRight, ShieldCheck, Terminal, CloudCheck, Check
} from 'lucide-react';

export default function SyncPage() {
  const [syncing, setSyncing] = useState(false);
  const [targetFolder, setTargetFolder] = useState('/Videos');
  const [logs, setLogs] = useState([]);
  const [summary, setSummary] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Load configured target folder from DB Settings API
  useEffect(() => {
    async function loadFolderConfig() {
      try {
        const res = await fetch('/api/settings');
        if (res.ok) {
          const json = await res.json();
          const cfg = json.data?.onedrive_config;
          if (cfg?.target_folder) {
            setTargetFolder(cfg.target_folder);
          }
        }
      } catch (err) {
        console.warn('[SyncPage] Using fallback settings:', err);
      }
    }
    loadFolderConfig();
  }, []);

  const addLog = (msg) => {
    const time = new Date().toLocaleTimeString('th-TH');
    setLogs((prev) => [...prev, `[${time}] ${msg}`]);
  };

  const handleStartSync = async () => {
    setSyncing(true);
    setLogs([]);
    setSummary(null);
    setErrorMsg(null);

    try {
      addLog(`กำลังเชื่อมต่อ Microsoft Graph ผ่าน Azure Client Secret...`);
      addLog(`กำลังสแกนโฟลเดอร์ "${targetFolder}" บน OneDrive...`);

      const res = await fetch('/api/videos/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetFolder }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'การซิงก์ข้อมูลล้มเหลว');
      }

      if (Array.isArray(data.logs) && data.logs.length > 0) {
        setLogs((prev) => [...prev, ...data.logs]);
      }

      addLog(`✨ ซิงก์สำเร็จ! นำเข้า/อัปเดตลง Neon DB เรียบร้อย (${data.count} วิดีโอ)`);
      setSummary({ total: data.total || data.count, imported: data.count, videos: data.videos });
    } catch (err) {
      console.error('[Sync Error]:', err);
      setErrorMsg(err.message);
      addLog(`❌ เกิดข้อผิดพลาด: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 flex flex-col gap-6 select-none">
      {/* Header */}
      <div className="pb-3 border-b border-[#EFECE6]">
        <h1 className="text-2xl font-bold text-[#212529] tracking-tight">ซิงก์คลังสื่อ OneDrive</h1>
        <p className="text-xs text-[#8C857B] mt-1">
          ดึงข้อมูลไฟล์วิดีโอและชุด HLS จาก OneDrive เข้าสู่ฐานข้อมูล TubeLock โดยตรงผ่าน Azure Client Secret (ไม่ต้องเข้าสู่ระบบ)
        </p>
      </div>

      {/* Cloud Service Connection Status Card */}
      <div className="bg-white border border-[#EFECE6] rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <ShieldCheck className="w-5 h-5 stroke-[2.2]" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#212529]">Microsoft OneDrive Service Principal</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-700">
                เชื่อมต่อแล้ว
              </span>
            </div>
            <span className="text-[10px] text-emerald-600 font-semibold mt-0.5 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              พร้อมใช้งานผ่าน Azure Client Secret ตลอด 24 ชม. (ไม่ต้องล็อกอินหน้าเว็บ)
            </span>
          </div>
        </div>
      </div>

      {/* Target Path Info Card */}
      <div className="bg-white border border-[#EFECE6] rounded-2xl p-4 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-[#FFF4EB] text-[#FF7A00] rounded-xl shrink-0">
            <Folder className="w-5 h-5 stroke-[2]" />
          </div>
          <div>
            <p className="text-[11px] text-[#8C857B]">โฟลเดอร์ต้นทางตามการตั้งค่า</p>
            <p className="text-sm font-bold text-[#212529] font-mono">{targetFolder}</p>
          </div>
        </div>

        <Link
          href="/settings"
          className="text-xs text-[#FF7A00] hover:text-[#E06C00] font-bold flex items-center gap-1 transition"
        >
          <span>แก้ไขโฟลเดอร์</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Sync Action Area */}
      <div className="bg-white border border-[#EFECE6] rounded-2xl p-7 shadow-xs flex flex-col items-center text-center gap-3.5">
        <div className="w-14 h-14 rounded-2xl bg-[#FFF4EB] flex items-center justify-center text-[#FF7A00] shadow-inner">
          <RefreshCw className={`w-7 h-7 stroke-[2.2] ${syncing ? 'animate-spin' : ''}`} />
        </div>

        <div>
          <h2 className="text-base font-bold text-[#212529]">เริ่มการสแกนและนำเข้าวิดีโอ</h2>
          <p className="text-xs text-[#8C857B] mt-1 max-w-md mx-auto leading-relaxed">
            ระบบจะสแกนโฟลเดอร์ <strong>{targetFolder}</strong> บน OneDrive ของคุณแบบอัตโนมัติ ตรวจจับทั้งไฟล์ MP4 และชุดโฟลเดอร์ HLS (ABR) แล้วบันทึกลงฐานข้อมูล Neon DB ทันที
          </p>
        </div>

        <button
          type="button"
          onClick={handleStartSync}
          disabled={syncing}
          className="mt-2 flex items-center gap-2.5 px-7 py-3 bg-[#FF7A00] hover:bg-[#E06C00] text-white text-xs font-bold rounded-xl transition shadow-[0_4px_12px_rgba(255,122,0,0.3)] active:scale-95 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
          <span>{syncing ? 'กำลังสแกน OneDrive และนำเข้าไฟล์...' : 'เริ่มซิงก์ข้อมูลเดี๋ยวนี้'}</span>
        </button>
      </div>

      {/* Sync Summary Banner */}
      {summary && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-emerald-900 text-xs animate-fadeIn">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
            <div>
              <p className="font-bold text-sm text-emerald-950">
                ซิงก์สำเร็จ! นำเข้าวิดีโอแล้ว {summary.imported} รายการ
              </p>
              <p className="text-[11px] text-emerald-800 mt-0.5">
                พบรายการทั้งหมดใน OneDrive {summary.total} รายการ ข้อมูลพร้อมแสดงผลบนหน้าแรกแล้ว
              </p>
            </div>
          </div>

          <Link
            href="/"
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition shadow-xs shrink-0 flex items-center gap-1.5"
          >
            <span>ไปที่หน้าแรกเพื่อรับชม</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}

      {/* Error Alert */}
      {errorMsg && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-4 flex items-center gap-3 text-red-800 text-xs">
          <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Terminal Log Console */}
      {logs.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 px-1 text-xs font-bold text-[#8C857B]">
            <Terminal className="w-4 h-4 text-[#FF7A00]" />
            <span>บันทึกการทำงานสด (Live Logs)</span>
          </div>
          <div className="bg-[#18181B] border border-white/10 rounded-2xl p-4 font-mono text-[11px] text-zinc-300 flex flex-col gap-1 max-h-64 overflow-y-auto shadow-inner">
            {logs.map((log, index) => (
              <div key={index} className="leading-relaxed whitespace-pre-wrap">{log}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Upload, RefreshCw, CheckCircle2, Play,
  RotateCcw, Trash2, ListOrdered, Clock
} from 'lucide-react';

export default function UploadQueuePage() {
  const [queueItems, setQueueItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState(null);

  // Fetch Queue Data
  const loadQueue = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/videos/queue');
      if (res.ok) {
        const data = await res.json();
        setQueueItems(data.queue || []);
      }
    } catch (err) {
      console.warn('Load queue error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadQueue();
    }, 0);
    const interval = setInterval(loadQueue, 4000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [loadQueue]);

  // Retry Trigger
  const handleRetry = async (vidId, rFileName, vidTitle) => {
    setRetryingId(vidId);
    try {
      const res = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: vidId,
          rawFileName: rFileName,
          title: vidTitle,
        }),
      });
      if (res.ok) {
        loadQueue();
      }
    } catch (err) {
      console.error('Retry error:', err);
    } finally {
      setRetryingId(null);
    }
  };

  // Delete queue item permanently
  const handleDelete = async (id, itemTitle) => {
    if (!confirm(`ต้องการยกเลิกและลบคิว "${itemTitle || '#' + id}" ออกจากระบบถาวรใช่หรือไม่?`)) return;

    setQueueItems((prev) => prev.filter((item) => item.id !== id));
    try {
      await fetch(`/api/videos/${id}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Delete queue error:', err);
    } finally {
      loadQueue();
    }
  };

  // Clear all failed queue items
  const handleClearAllFailed = async () => {
    const failedItems = queueItems.filter((i) => i.status === 'FAILED');
    if (failedItems.length === 0) return;
    if (!confirm(`ต้องการลบคิวที่ล้มเหลวทั้งหมด (${failedItems.length} รายการ) หรือไม่?`)) return;

    setQueueItems((prev) => prev.filter((item) => item.status !== 'FAILED'));
    for (const item of failedItems) {
      try {
        await fetch(`/api/videos/${item.id}`, { method: 'DELETE' });
      } catch (_) {}
    }
    loadQueue();
  };

  const failedCount = queueItems.filter((i) => i.status === 'FAILED').length;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 select-none pb-28 sm:pb-20">
      {/* Top Bar Navigation */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-[#EFECE6] dark:border-white/10 mb-6">
        <div>
          <h1 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1] tracking-tight flex items-center gap-2.5">
            <ListOrdered className="w-5 h-5 text-[#FF7A00]" />
            คิวงานแปลงไฟล์ (Transcode Queue)
          </h1>
          <p className="text-xs text-[#8C857B] dark:text-[#AAAAAA] mt-0.5">
            ติดตามสถานะการประมวลผลวิดีโอบน Cloud แบบเรียลไทม์
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {failedCount > 0 && (
            <button
              type="button"
              onClick={handleClearAllFailed}
              className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 px-3 py-2 rounded-xl border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/30 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition font-medium cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>ล้างที่ล้มเหลว ({failedCount})</span>
            </button>
          )}

          <button
            type="button"
            onClick={loadQueue}
            disabled={loading}
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 text-xs text-[#212529] dark:text-[#F1F1F1] px-3.5 py-2 rounded-xl border border-[#EFECE6] dark:border-white/10 bg-white dark:bg-[#181818] hover:bg-[#FBF9F5] dark:hover:bg-white/5 transition font-medium shadow-2xs cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-[#FF7A00]' : ''}`} />
            <span>รีเฟรช</span>
          </button>

          <Link
            href="/upload"
            className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#FF7A00] hover:bg-[#E56E00] active:scale-[0.99] text-white font-bold text-xs shadow-xs transition cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>อัปโหลดคลิปใหม่</span>
          </Link>
        </div>
      </div>

      {/* Main Queue Content */}
      {queueItems.length === 0 ? (
        <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-12 sm:p-16 flex flex-col items-center justify-center text-center shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mb-3">
            <CheckCircle2 className="w-7 h-7 stroke-[1.75]" />
          </div>
          <h2 className="text-base font-bold text-[#212529] dark:text-[#F1F1F1]">
            ไม่มีคิวงานค้างในขณะนี้
          </h2>
          <p className="text-xs text-[#8C857B] dark:text-[#AAAAAA] mt-1 max-w-sm">
            วิดีโอทั้งหมดผ่านการประมวลผลเสร็จสมบูรณ์แล้ว คุณสามารถเริ่มอัปโหลดไฟล์ใหม่ได้ทันที
          </p>
          <Link
            href="/upload"
            className="mt-5 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF7A00] hover:bg-[#E56E00] text-white font-bold text-xs shadow-xs transition"
          >
            <Upload className="w-4 h-4" />
            <span>อัปโหลดวิดีโอใหม่</span>
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:gap-4">
          {queueItems.map((item) => {
            const isReady = item.status === 'READY';
            const isFailed = item.status === 'FAILED';
            const isProcessing = item.status === 'PROCESSING' || item.status === 'TRANSCODING';

            return (
              <div
                key={item.id}
                className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-4 sm:p-5 shadow-xs flex flex-col gap-3 transition-colors"
              >
                {/* Header Row: Title, Badge, Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1] truncate max-w-full">
                        {item.title}
                      </span>

                      {/* Status Badge */}
                      <span
                        className={`text-[10px] font-bold px-2.5 py-0.5 rounded-md shrink-0 ${
                          isReady
                            ? 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300'
                            : item.status === 'TRANSCODING'
                            ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-300'
                            : item.status === 'PROCESSING'
                            ? 'bg-purple-100 dark:bg-purple-950/40 text-purple-800 dark:text-purple-300'
                            : item.status === 'QUEUED'
                            ? 'bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300'
                            : isFailed
                            ? 'bg-rose-100 dark:bg-rose-950/40 text-rose-800 dark:text-rose-300'
                            : 'bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-300'
                        }`}
                      >
                        {isReady ? 'พร้อมรับชม' : item.status}
                      </span>
                    </div>

                    <p className="text-[11px] text-[#8C857B] dark:text-[#AAAAAA] mt-1 truncate max-w-full break-all">
                      ไฟล์: {item.rawFileName || '-'} • ID: #{item.id}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                    {isReady && (
                      <Link
                        href={`/watch/${item.id}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-semibold transition shadow-xs"
                      >
                        <Play className="w-3.5 h-3.5 fill-white" />
                        <span>เปิดดู</span>
                      </Link>
                    )}

                    {isFailed && (
                      <button
                        type="button"
                        disabled={retryingId === item.id}
                        onClick={() => handleRetry(item.id, item.rawFileName, item.title)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw className={`w-3.5 h-3.5 ${retryingId === item.id ? 'animate-spin' : ''}`} />
                        <span>ลองใหม่</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => handleDelete(item.id, item.title)}
                      title="ยกเลิกและลบคิวนี้"
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40 rounded-xl font-medium transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">ลบคิว</span>
                    </button>
                  </div>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-[#F5F2EB] dark:bg-white/10 h-2 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${
                      isFailed
                        ? 'bg-rose-500'
                        : isReady
                        ? 'bg-emerald-500'
                        : 'bg-[#FF7A00]'
                    }`}
                    style={{ width: `${item.transcodeProgress || 0}%` }}
                  />
                </div>

                {/* Status Detail & Percentage */}
                <div className="flex items-center justify-between text-xs text-[#8C857B] dark:text-[#AAAAAA]">
                  <span className="flex items-center gap-1.5 truncate max-w-[80%]">
                    {isProcessing && <Clock className="w-3.5 h-3.5 text-[#FF7A00] shrink-0 animate-pulse" />}
                    <span className="truncate">{item.stageDetail || 'กำลังดำเนินการ...'}</span>
                  </span>
                  <span className="font-mono font-bold text-[#212529] dark:text-[#F1F1F1] shrink-0">
                    {item.transcodeProgress || 0}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

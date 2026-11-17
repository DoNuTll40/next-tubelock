'use client';

import { Trash2, Loader2 } from 'lucide-react';

/**
 * Shared confirmation dialog for permanently deleting a video from DB and OneDrive.
 */
export default function DeleteVideoModal({
  isOpen,
  onClose,
  onConfirm,
  isDeleting = false,
  deleteError = null,
  videoTitle = '',
}) {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4"
      onClick={(e) => {
        e.stopPropagation();
        if (!isDeleting) onClose();
      }}
    >
      <div
        className="bg-white dark:bg-[#181818] rounded-3xl p-6 max-w-sm w-full shadow-2xl border border-zinc-100 dark:border-white/10 flex flex-col gap-4 text-left"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/50 flex items-center justify-center text-rose-600 dark:text-rose-400 shrink-0">
            <Trash2 className="w-5 h-5" />
          </div>
          <div className="flex flex-col min-w-0">
            <h3 className="text-base font-bold text-[#0F0F0F] dark:text-[#F1F1F1] leading-tight">
              ลบวิดีโอนี้?
            </h3>
            <span className="text-xs text-[#8C857B] dark:text-[#AAAAAA] truncate">{videoTitle}</span>
          </div>
        </div>

        <p className="text-xs text-[#606060] dark:text-[#AAAAAA] leading-relaxed">
          วิดีโอนี้จะถูกลบออกจากฐานข้อมูลและลบไฟล์ทั้งหมดบน{' '}
          <strong className="text-[#0F0F0F] dark:text-[#F1F1F1]">OneDrive ถาวร</strong> โดยไม่สามารถกู้คืนได้
        </p>

        {deleteError && (
          <div className="p-2.5 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 rounded-xl text-xs text-rose-600 dark:text-rose-400 font-medium">
            {deleteError}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            disabled={isDeleting}
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-[#0F0F0F] dark:text-[#F1F1F1] bg-zinc-100 dark:bg-white/10 hover:bg-zinc-200 dark:hover:bg-white/15 disabled:opacity-50 transition cursor-pointer"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={isDeleting}
            onClick={onConfirm}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 disabled:opacity-50 transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-rose-200 dark:shadow-none"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>กำลังลบ...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-3.5 h-3.5" />
                <span>ยืนยันการลบ</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

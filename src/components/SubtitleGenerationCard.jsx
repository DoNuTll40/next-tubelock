'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';

export default function SubtitleGenerationCard({ workerDetail, cancelUrl }) {
  const [cancelState, setCancelState] = useState('idle');
  const [cancelError, setCancelError] = useState('');

  const cancelRun = async () => {
    setCancelState('pending');
    setCancelError('');
    try {
      const response = await fetch(cancelUrl, { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'ยกเลิกงานซับไม่สำเร็จ');
      setCancelState('requested');
    } catch (error) {
      setCancelError(error.message);
      setCancelState('idle');
    }
  };

  return (
    <div className="p-4 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 space-y-3">
      <div role="status" className="flex items-center gap-2 text-sm font-semibold">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        กำลังสร้างซับไตเติล
      </div>
      {workerDetail && <p className="text-xs text-[#6C655D] dark:text-[#9A9A9A]">{workerDetail}</p>}
      {cancelUrl && (
        <button
          type="button"
          onClick={cancelRun}
          disabled={cancelState !== 'idle'}
          className="w-full rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-500/10 disabled:opacity-60 dark:text-red-400"
        >
          {cancelState === 'idle' ? 'ยกเลิกการสร้างซับ' : 'กำลังยกเลิกผ่าน GitHub Actions…'}
        </button>
      )}
      {cancelError && <p role="alert" className="text-xs text-red-500">{cancelError}</p>}
    </div>
  );
}

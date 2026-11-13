'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check, Trash2 } from 'lucide-react';

export default function UploadLogs({ logs = [], logEndRef, onClearLogs }) {
  const [showLogs, setShowLogs] = useState(true);
  const [copied, setCopied] = useState(false);

  const latestLog = logs.length > 0 ? logs[logs.length - 1] : '';

  const handleCopyLogs = () => {
    if (logs.length === 0) return;
    navigator.clipboard.writeText(logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getLogLineClass = (line) => {
    const str = String(line || '');
    if (str.includes('❌')) return 'text-rose-600 dark:text-rose-400 font-medium';
    if (str.includes('⚠️')) return 'text-amber-600 dark:text-amber-400';
    if (str.includes('✅') || str.includes('🎉')) return 'text-emerald-700 dark:text-emerald-400';
    return 'hover:text-[#212529] dark:hover:text-[#F1F1F1]';
  };

  return (
    <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl overflow-hidden shadow-xs">
      {/* Header bar */}
      <div
        onClick={() => setShowLogs(!showLogs)}
        className="flex items-center justify-between px-4 py-3 hover:bg-[#F4F0E8]/60 dark:hover:bg-[#222222]/60 cursor-pointer transition select-none gap-2"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-xs font-semibold text-[#212529] dark:text-[#F1F1F1] shrink-0">
            บันทึกกิจกรรมระบบ
          </span>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#F4F0E8] dark:bg-[#222222] text-[#6C655D] dark:text-[#AAAAAA] border border-[#EFECE6] dark:border-white/10 shrink-0">
            {logs.length} รายการ
          </span>
          {!showLogs && latestLog && (
            <span className="text-[11px] font-mono text-[#8C857B] dark:text-[#9A9A9A] truncate hidden sm:inline">
              {latestLog}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {showLogs && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCopyLogs();
                }}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] text-[#6C655D] dark:text-[#CCCCCC] border border-[#EFECE6] dark:border-white/10 transition flex items-center gap-1 cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</span>
              </button>
              {onClearLogs && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearLogs();
                  }}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-[#F4F0E8] dark:bg-[#222222] hover:bg-rose-500/10 text-[#6C655D] dark:text-[#CCCCCC] hover:text-rose-500 border border-[#EFECE6] dark:border-white/10 transition flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>ล้าง</span>
                </button>
              )}
            </>
          )}
          <span className="p-1 text-[#8C857B]">
            {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </span>
        </div>
      </div>

      {/* Log Console Body */}
      {showLogs && (
        <div className="p-4 bg-[#FBF9F5] dark:bg-[#0F0F0F] border-t border-[#EFECE6] dark:border-white/10 max-h-56 overflow-y-auto font-mono text-xs text-[#6C655D] dark:text-[#9A9A9A] space-y-1.5 leading-relaxed">
          {logs.length === 0 ? (
            <div className="text-center py-4 text-[#8C857B]">ยังไม่มีบันทึกกิจกรรมในขณะนี้</div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className={`transition-colors break-words ${getLogLineClass(log)}`}>
                {log}
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      )}
    </div>
  );
}

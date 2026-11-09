'use client';

import { useState } from 'react';
import { Terminal, ChevronDown, ChevronUp, Copy, Check, Trash2 } from 'lucide-react';

export default function UploadLogs({ logs = [], logEndRef, onClearLogs }) {
  const [showLogs, setShowLogs] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyLogs = () => {
    if (logs.length === 0) return;
    navigator.clipboard.writeText(logs.join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden shadow-xl mt-6">
      {/* Header bar */}
      <div
        onClick={() => setShowLogs(!showLogs)}
        className="flex items-center justify-between p-4 bg-[#121212] hover:bg-[#161616] cursor-pointer transition select-none"
      >
        <div className="flex items-center gap-2.5">
          <Terminal className="w-4 h-4 text-[#f97316]" />
          <span className="text-xs sm:text-sm font-semibold text-[#F1F1F1]">
            บันทึกกิจกรรมระบบ (System Activity Logs)
          </span>
          <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#222222] text-[#A1A1AA] border border-[#333333]">
            {logs.length} รายการ
          </span>
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
                className="text-[11px] px-2 py-1 rounded-md bg-[#222222] hover:bg-[#2c2c2c] text-[#A1A1AA] hover:text-[#F1F1F1] border border-[#333333] transition flex items-center gap-1 cursor-pointer"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? 'คัดลอกแล้ว' : 'คัดลอก Log'}</span>
              </button>
              {onClearLogs && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClearLogs();
                  }}
                  className="text-[11px] px-2 py-1 rounded-md bg-[#222222] hover:bg-rose-950/40 text-[#A1A1AA] hover:text-rose-400 border border-[#333333] transition flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  <span>ล้าง Log</span>
                </button>
              )}
            </>
          )}
          <button
            type="button"
            className="p-1 rounded text-[#71717A] hover:text-[#F1F1F1] transition"
          >
            {showLogs ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Log Console Body */}
      {showLogs && (
        <div className="p-4 bg-[#0a0a0a] border-t border-[#222222] max-h-56 overflow-y-auto font-mono text-xs text-[#8C857B] space-y-1.5 leading-relaxed">
          {logs.length === 0 ? (
            <div className="text-center py-4 text-[#555555]">ยังไม่มีบันทึกกิจกรรมในขณะนี้</div>
          ) : (
            logs.map((log, idx) => (
              <div key={idx} className="hover:text-[#D4D4D8] transition-colors">
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

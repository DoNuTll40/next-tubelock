'use client';

import Link from 'next/link';
import { AtSign } from 'lucide-react';
import ChannelHandleCard from '@/components/settings/ChannelHandleCard';

export default function ChannelSection({ session, showHeading = true }) {
  return (
    <div className="flex flex-col gap-6 animate-fadeIn px-4">
      {showHeading && (
        <h2 className="text-xl font-bold text-[#212529] dark:text-[#F1F1F1]">ช่องของฉัน</h2>
      )}

      {!session ? (
        <div className="bg-[#F5F2EB] dark:bg-white/5 border border-dashed border-[#D5CFC5] dark:border-white/15 rounded-2xl p-6 flex flex-col items-center gap-3 text-center">
          <div className="w-11 h-11 rounded-full bg-[#EFECE6] dark:bg-white/10 flex items-center justify-center text-[#FF7A00]">
            <AtSign className="w-5 h-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">เข้าสู่ระบบเพื่อตั้งค่าช่องของคุณ</p>
            <p className="text-[11px] text-[#8C857B] dark:text-[#AAAAAA] mt-0.5">
              ตั้งชื่อ @handle ประจำตัว และจัดการหน้าช่องสาธารณะได้ทันทีหลังเข้าสู่ระบบ
            </p>
          </div>
          <Link
            href="/login?from=%2Fsettings%3Fchannel"
            className="px-4 py-2 rounded-xl bg-[#FF7A00] hover:bg-[#E06C00] text-white text-xs font-bold transition active:scale-95 shadow-[0_4px_12px_rgba(255,122,0,0.3)]"
          >
            เข้าสู่ระบบ
          </Link>
        </div>
      ) : (
        <ChannelHandleCard key={session.id} session={session} />
      )}
    </div>
  );
}

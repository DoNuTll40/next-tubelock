'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Home, ArrowLeft, VideoOff } from 'lucide-react';

export default function NotFound() {
    const router = useRouter();

    return (
        <main className="flex flex-col items-center justify-center min-h-[calc(100vh-56px)] px-4 text-center select-none bg-[#F9F9F9] dark:bg-[#0F0F0F] text-[#0F0F0F] dark:text-[#F1F1F1] animate-fadeIn transition-colors duration-200">
            {/* Visual Graphic Box */}
            <div className="relative mb-6 flex items-center justify-center">
                {/* Glow Effect สีส้ม TubeLock (#FF7A00) */}
                <div className="absolute w-48 h-48 bg-[#FF7A00]/15 dark:bg-[#FF7A00]/20 rounded-full blur-3xl pointer-events-none" />

                {/* Display Card */}
                <div className="relative w-36 h-36 sm:w-40 sm:h-40 rounded-3xl bg-white dark:bg-[#181818] border border-black/[0.08] dark:border-white/[0.08] flex flex-col items-center justify-center shadow-lg dark:shadow-2xl transition-all duration-300">
                    <div className="p-4 rounded-2xl bg-neutral-100 dark:bg-[#222222] border border-black/[0.04] dark:border-white/[0.06] transition-transform duration-300 hover:scale-105">
                        <VideoOff className="w-12 h-12 sm:w-14 sm:h-14 text-[#FF7A00] stroke-[1.8]" />
                    </div>

                    {/* Badge 404 สไตล์ Tag 4K/2K ของ TubeLock */}
                    <span className="absolute -bottom-2.5 px-3 py-0.5 rounded-full text-[11px] font-bold bg-[#FF7A00] text-white shadow-sm tracking-wider uppercase">
                        ERROR 404
                    </span>
                </div>
            </div>

            {/* Main Title & Description */}
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-900 dark:text-white mb-2">
                หน้านี้ไม่มีอยู่ในระบบ TubeLock
            </h1>
            <p className="text-xs sm:text-sm text-neutral-600 dark:text-[#AAAAAA] max-w-sm mx-auto mb-8 font-normal leading-relaxed">
                ลิงก์ที่คุณเปิดอาจไม่ถูกต้อง วิดีโอนี้อาจถูกลบไปแล้ว หรือกำลังอยู่ระหว่างขั้นตอนการประมวลผลบนคลาวด์
            </p>

            {/* Pill-shaped Action Buttons */}
            <div className="flex items-center justify-center gap-3 w-full max-w-xs">
                {/* ปุ่มย้อนกลับ (รองรับ Light/Dark ชัดเจน) */}
                <button
                    type="button"
                    onClick={() => router.back()}
                    className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-black/[0.06] dark:bg-[#272727] hover:bg-black/[0.12] dark:hover:bg-[#3F3F3F] active:scale-95 text-xs sm:text-sm font-medium transition-all text-neutral-800 dark:text-neutral-100 border border-black/[0.05] dark:border-white/[0.05] cursor-pointer"
                >
                    <ArrowLeft className="w-4 h-4 stroke-[2]" />
                    <span>ย้อนกลับ</span>
                </button>

                {/* ปุ่มหน้าแรก (สีส้ม TubeLock + ตัวหนังสือสีขาวคมชัด) */}
                <Link
                    href="/"
                    className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-full bg-[#FF7A00] hover:bg-[#E66E00] active:scale-95 text-xs sm:text-sm font-semibold text-white transition-all shadow-md shadow-[#FF7A00]/25 cursor-pointer"
                >
                    <Home className="w-4 h-4 text-white stroke-[2]" />
                    <span>หน้าแรก</span>
                </Link>
            </div>

            {/* Footer Hint */}
            <div className="mt-14 text-[11px] text-neutral-400 dark:text-[#717171] flex items-center gap-2 font-normal">
                <span>TubeLock v1.0</span>
                <span>•</span>
                <span>$0 Cost Cloud Streaming</span>
            </div>
        </main>
    );
}
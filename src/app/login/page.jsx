'use client';

import { useSearchParams } from 'next/navigation';

export default function LoginPage() {
    const searchParams = useSearchParams();
    const from = searchParams.get('from') || '/';

    return (
        <div className="min-h-screen w-full relative bg-[#0F0F0F] flex items-center justify-center p-4">
            <div className="max-w-md w-full bg-[#181818] border border-white/10 rounded-3xl p-8 flex flex-col items-center text-center shadow-2xl">
                <div className="w-14 h-14 bg-[#FF7A00]/15 border border-[#FF7A00]/30 rounded-2xl flex items-center justify-center mb-4">
                    <span className="text-2xl font-bold text-[#FF7A00]">TL</span>
                </div>

                <h1 className="text-2xl font-bold text-white mb-2">เข้าสู่ระบบ TubeLock</h1>
                <p className="text-zinc-400 text-sm mb-6">
                    เข้าสู่ระบบเพื่อรับชมและจัดการคลังวิดีโอส่วนตัวของคุณ
                </p>

                <div className="w-full flex flex-col gap-3">
                    {/* ปุ่ม Google */}
                    <a
                        href={`/api/auth/google?from=${encodeURIComponent(from)}`}
                        className="w-full py-3.5 px-4 bg-white hover:bg-zinc-100 text-zinc-900 font-semibold rounded-2xl flex items-center justify-center gap-3 transition-colors shadow-sm"
                    >
                        <svg className="w-5 h-5" viewBox="0 0 24 24">
                            <path
                                fill="#4285F4"
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                            />
                            <path
                                fill="#34A853"
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                            />
                            <path
                                fill="#FBBC05"
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                            />
                            <path
                                fill="#EA4335"
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                            />
                        </svg>
                        <span>ดำเนินการต่อด้วย Google</span>
                    </a>

                    {/* ปุ่ม LINE */}
                    <a
                        href={`/api/auth/line?from=${encodeURIComponent(from)}`}
                        className="w-full py-3.5 px-4 bg-[#06C755] hover:bg-[#05b34c] text-white font-semibold rounded-2xl flex items-center justify-center gap-3 transition-colors shadow-sm"
                    >
                        <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                            <path d="M24 10.304c0-5.369-5.383-9.738-12-9.738-6.616 0-12 4.369-12 9.738 0 4.814 4.269 8.846 10.036 9.608.391.084.922.258 1.057.592.121.303.079.778.039 1.085l-.171 1.027c-.053.303-.242 1.186 1.039.646 1.281-.54 6.911-4.069 9.428-6.967 1.739-1.907 2.572-3.843 2.572-5.993z" />
                        </svg>
                        <span>เข้าสู่ระบบด้วย LINE</span>
                    </a>
                </div>
            </div>
        </div>
    );
}
import WatchDescriptionLab from './WatchDescriptionLab';
import { demoAlbums, demoSingleImage } from './descriptionDemoData';
import Link from 'next/link';

export const metadata = {
  title: 'Watch Description · TubeLock Dev',
  alternates: { canonical: '/dev' },
  robots: { index: false, follow: false },
};

export default function DevPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-7 sm:px-6 sm:pt-10 lg:px-8">
      <header className="mb-6 border-b border-[#E8E2D9] pb-5 sm:mb-8 sm:pb-6 dark:border-white/10">
        <p className="mb-2 text-xs font-bold text-[#9C4300] dark:text-[#FFAB65]">TubeLock Dev</p>
        <h1 className="text-2xl font-bold text-[#211E1A] sm:text-3xl dark:text-[#F1EFEB]">คำอธิบายหน้า Watch</h1>
        <p className="mt-2 text-sm leading-relaxed text-[#645B52] dark:text-[#BEB7AE]">
          เทียบการวางภาพแนบในกล่องคำอธิบาย แล้วลองเปิดรูปใน Lightbox
        </p>
      </header>

      <p className="mb-5"><Link href="/dev/upload-description" className="text-sm font-semibold text-[#B75000] dark:text-[#FFAB65]">ออกแบบการแนบภาพในหน้า Upload →</Link></p>
      <WatchDescriptionLab albums={demoAlbums} singleImage={demoSingleImage} />

      <p className="mt-5 text-xs text-[#645B52] dark:text-[#BEB7AE]">
        ภาพตัวอย่างจาก{' '}
        <a href="https://unsplash.com/s/photos/banff-national-park" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">
          Unsplash
        </a>
      </p>
    </div>
  );
}

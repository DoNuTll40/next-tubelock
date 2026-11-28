import Link from 'next/link';
import UploadDescriptionLab from '../UploadDescriptionLab';
import { demoAlbums } from '../descriptionDemoData';

export const metadata = {
  title: 'Upload Description · TubeLock Dev',
  robots: { index: false, follow: false },
};

export default function UploadDescriptionDesignPage() {
  return <main className="mx-auto max-w-6xl px-4 py-7 sm:px-6 lg:px-8">
    <Link href="/dev" className="text-xs text-[#74695E] dark:text-[#BEB7AE]">← กลับไปออกแบบหน้า Watch</Link>
    <header className="mb-7 mt-5">
      <p className="mb-2 text-xs font-semibold text-[#A54A00] dark:text-[#FFAB65]">TubeLock Dev · Upload</p>
      <h1 className="text-2xl font-bold text-[#211E1A] dark:text-[#F1EFEB]">คำอธิบายแบบ Dialog</h1>
      <p className="mt-2 text-sm text-[#74695E] dark:text-[#BEB7AE]">ลองเปิดตัวแก้ไขจากการ์ดสรุป เหมือนใช้งานในขั้นรายละเอียดวิดีโอ ข้อมูลทดลองอยู่ในหน้านี้ ยังไม่บันทึกหรืออัปโหลดจริง</p>
    </header>
    <UploadDescriptionLab initialAlbums={demoAlbums.map(album => ({ ...album, images: album.images.slice(0, 3) }))} />
    <section aria-label="แนวทางจัดเก็บภาพ" className="mt-8 rounded-2xl border border-black/10 p-5 text-sm dark:border-white/10">
      <h2 className="font-semibold text-[#292520] dark:text-[#F1EFEB]">แผนจัดเก็บ · OneDrive</h2>
      <p className="mt-2 leading-relaxed text-[#756C62] dark:text-[#AAA39B]">เก็บต้นฉบับและภาพย่อแยกตามวิดีโอและอัลบั้ม ใช้ต้นฉบับสำหรับดูภาพเต็มและข้อมูล EXIF ส่วนภาพย่อใช้ในคำอธิบาย ผู้ชมเปิดภาพตามสิทธิ์ของวิดีโอ</p>
      <p className="mt-2 leading-relaxed text-[#756C62] dark:text-[#AAA39B]">ขั้นตอนอัปโหลดจริงจะมีคิวและสถานะรายรูป กดลองใหม่เฉพาะภาพที่ไม่สำเร็จได้ โดยไม่จำกัดจำนวนภาพที่แนบ และตรวจพื้นที่ OneDrive ก่อนอัปโหลด</p>
    </section>
  </main>;
}

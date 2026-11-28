'use client';

import { useId, useState } from 'react';
import { ChevronDown, ChevronRight, Image as ImageIcon } from 'lucide-react';
import BrowserMediaImage from '@/components/BrowserMediaImage';
import { AnimatedTabs } from '@/components/ui/AnimatedTabs';
import ImageLightbox from '@/components/ui/ImageLightbox';
import DescriptionAlbumPreview from '@/components/watch/DescriptionAlbumPreview';

const layoutOptions = [
  { id: 'row', label: 'แถวอัลบั้ม' },
  { id: 'thumbnails', label: 'ภาพย่อทันที' },
];
const deviceOptions = [
  { id: 'desktop', label: 'เดสก์ท็อป' },
  { id: 'mobile', label: 'มือถือ' },
];
const attachmentOptions = [
  { id: 'album', label: 'อัลบั้ม' },
  { id: 'multiple', label: 'หลายอัลบั้ม' },
  { id: 'single', label: 'ภาพเดี่ยว' },
  { id: 'none', label: 'ไม่มีภาพ' },
];
const tags = ['HLS', 'Travel', '1080p'];
const videoDetails = ['1080p', 'H264', '60 FPS', '60.6 Mbps', '6047.1 MB'];

function LabControl({ label, tabs, value, onChange }) {
  return (
    <div className="min-w-0 space-y-1.5">
      <p className="text-xs font-semibold text-[#645B52] dark:text-[#BEB7AE]">{label}</p>
      <AnimatedTabs tabs={tabs} value={value} onChange={onChange} label={label} variant="pill" behavior="filter" />
    </div>
  );
}

function PreviewImage({ src }) {
  const [failed, setFailed] = useState(false);

  return failed ? (
    <ImageIcon aria-hidden="true" className="size-5 text-[#80756C] dark:text-white/60" />
  ) : (
    <BrowserMediaImage
      src={src}
      alt=""
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

function AlbumRow({ images, title, onOpen }) {
  const cover = images[0];

  return (
    <button
      type="button"
      aria-label={images.length === 1 ? 'ดูรูปภาพในคำอธิบาย' : `เปิดอัลบั้ม ${title} (${images.length} รูป)`}
      onClick={() => onOpen(0)}
      className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 rounded-xl border border-black/[.07] bg-white/60 px-2 text-left text-xs font-semibold text-[#332A24] transition-colors hover:border-[#C55700]/40 hover:bg-[#FFF7F0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C55700] dark:border-white/10 dark:bg-white/5 dark:text-[#F1F1F1] dark:hover:border-[#FF963D]/40 dark:hover:bg-white/8 dark:focus-visible:outline-[#FF963D]"
    >
      <span className="relative grid aspect-video w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-[#E8E2D9] dark:bg-white/10">
        <PreviewImage key={cover.src} src={cover.src} />
      </span>
      <span className="min-w-0 flex-1 break-words">{images.length === 1 ? 'รูปภาพแนบ' : `${title} · ${images.length} รูป`}</span>
      <span className="shrink-0 text-[#8E3D00] dark:text-[#FFC28B]">ดูรูป</span>
      <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-[#8E3D00] dark:text-[#FFC28B]" />
    </button>
  );
}

export default function WatchDescriptionLab({ albums, singleImage }) {
  const descriptionId = useId();
  const [layout, setLayout] = useState('thumbnails');
  const [device, setDevice] = useState('desktop');
  const [attachments, setAttachments] = useState('multiple');
  const [isExpanded, setIsExpanded] = useState(false);
  const [openedPhoto, setOpenedPhoto] = useState(null);
  const [albumTitles, setAlbumTitles] = useState(() => Object.fromEntries(albums.map(({ id, title }) => [id, title])));

  const namedAlbums = albums.map((album) => ({ ...album, title: albumTitles[album.id].trim() || 'อัลบั้มไม่มีชื่อ' }));
  let visibleAlbums = namedAlbums;
  if (attachments === 'album') visibleAlbums = namedAlbums.slice(0, 1);
  if (attachments === 'single') visibleAlbums = [{ id: 'single-image', title: 'รูปในคำอธิบาย', images: [singleImage] }];
  if (attachments === 'none') visibleAlbums = [];
  const selectedAlbum = visibleAlbums.find(({ id }) => id === openedPhoto?.albumId);

  return (
    <div className="space-y-4">
      <div className="grid gap-x-5 gap-y-3 rounded-2xl border border-[#E8E2D9] bg-white p-4 sm:grid-cols-2 lg:grid-cols-3 dark:border-white/10 dark:bg-[#181818]">
        <LabControl label="รูปแบบตอนย่อ" tabs={layoutOptions} value={layout} onChange={(next) => {
          setLayout(next);
          setIsExpanded(false);
        }} />
        <LabControl label="ขนาดหน้าจอ" tabs={deviceOptions} value={device} onChange={setDevice} />
        <LabControl label="ภาพแนบ" tabs={attachmentOptions} value={attachments} onChange={(value) => {
          setAttachments(value);
          setOpenedPhoto(null);
        }} />
        {(attachments === 'album' || attachments === 'multiple') && (
          <div className="grid min-w-0 gap-3 border-t border-[#E8E2D9] pt-3 sm:col-span-2 sm:grid-cols-2 lg:col-span-3 dark:border-white/10">
            {(attachments === 'album' ? albums.slice(0, 1) : albums).map(({ id }, index) => (
              <div key={id} className="min-w-0 space-y-1.5">
                <label htmlFor={`${descriptionId}-${id}`} className="text-xs font-semibold text-[#645B52] dark:text-[#BEB7AE]">ชื่ออัลบั้ม {index + 1}</label>
                <input
                  id={`${descriptionId}-${id}`}
                  value={albumTitles[id]}
                  onChange={(event) => setAlbumTitles((current) => ({ ...current, [id]: event.target.value }))}
                  className="w-full rounded-lg border border-[#DAD1C6] bg-[#FBF9F5] px-3 py-2 text-sm text-[#212529] outline-none focus-visible:border-[#C55700] dark:border-white/15 dark:bg-white/5 dark:text-[#F1F1F1] dark:focus-visible:border-[#FF963D]"
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <section
        aria-label="ตัวอย่างการ์ดคำอธิบาย"
        className="rounded-2xl border border-dashed border-[#DAD1C6] bg-[#F5F1EA] p-3 sm:p-6 dark:border-white/15 dark:bg-[#141414]"
      >
        <div className={`@container mx-auto w-full rounded-2xl border border-[#E8E2D9] bg-[#FBF9F5] p-3 transition-[max-width] duration-200 motion-reduce:transition-none dark:border-white/10 dark:bg-[#0F0F0F] ${device === 'mobile' ? 'max-w-[393px]' : 'max-w-[54rem]'}`}>
          <h2 className="mb-3 text-base font-bold text-[#212529] dark:text-[#F1F1F1]">เที่ยวแคนาเดียนร็อกกี</h2>
          <article className="space-y-2.5 rounded-xl border border-black/5 bg-black/[.045] p-3 text-[#212529] dark:border-white/10 dark:bg-white/10 dark:text-[#F1F1F1]">
            <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
              <span>25 ครั้ง</span>
              <span aria-hidden="true" className="text-[#797066] dark:text-white/50">·</span>
              <span className="text-[#645B52] dark:text-white/65">17 ต.ค. 2569</span>
              <span className="rounded-md bg-[#FF7A00]/12 px-1.5 py-0.5 text-[#8E3D00] dark:text-[#FFC28B]">1080p</span>
              <span className="ml-auto text-[#645B52] dark:text-white/65">13:57</span>
            </div>
            <div id={descriptionId} className="space-y-2.5">
              <p className="flex flex-wrap gap-x-2 text-xs font-semibold text-[#8E3D00] dark:text-[#FFAB65]">
                {tags.map((tag) => <span key={tag}>#{tag}</span>)}
              </p>
              <p className={`text-sm leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>
                เส้นทางจากทะเลสาบโมเรนไปยังถนนไอซ์ฟิลด์สพาร์กเวย์ ชมสีของทะเลสาบเมื่อแสงเปลี่ยนระหว่างวัน แล้วแวะจุดชมวิวริมถนนระหว่างทาง
              </p>
              {isExpanded && (
                <p className="text-sm leading-relaxed">ภาพแนบรวมทั้งมุมริมทะเลสาบ วิวจากจุดชมวิว และเส้นทางผ่านป่าสนในเทือกเขาร็อกกี</p>
              )}
              {visibleAlbums.length > 0 && <div className="space-y-5">
                {visibleAlbums.filter(({ images }) => images.length > 0).map(({ id, title, images }) => (
                  isExpanded || layout === 'thumbnails'
                    ? <DescriptionAlbumPreview key={id} title={attachments === 'single' ? undefined : title} images={images} onOpen={(index) => setOpenedPhoto({ albumId: id, index })} showCaption={isExpanded} />
                    : <section key={id} aria-label={title}><AlbumRow title={title} images={images} onOpen={(index) => setOpenedPhoto({ albumId: id, index })} /></section>
                ))}
              </div>}
              {isExpanded && (
                <div className="flex flex-wrap gap-1.5 border-t border-black/10 pt-2.5 dark:border-white/12">
                  {videoDetails.map((detail) => (
                    <span key={detail} className="rounded-lg border border-black/5 bg-white/70 px-2 py-1 text-xs font-semibold dark:border-white/10 dark:bg-white/8">
                      {detail}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                aria-expanded={isExpanded}
                aria-controls={descriptionId}
                onClick={() => setIsExpanded((current) => !current)}
                className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-md px-1.5 text-xs font-bold hover:text-[#8E3D00] focus-visible:outline-2 focus-visible:outline-[#C55700] dark:hover:text-[#FFAB65] dark:focus-visible:outline-[#FF963D]"
              >
                {isExpanded ? 'แสดงน้อยลง' : 'เพิ่มเติม'}
                <ChevronDown aria-hidden="true" className={`size-3.5 ${isExpanded ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </article>
        </div>
      </section>

      {selectedAlbum && (
        <ImageLightbox
          key={selectedAlbum.id}
          slideNavigation
          images={selectedAlbum.images}
          title={selectedAlbum.title}
          startIndex={openedPhoto.index}
          onClose={() => setOpenedPhoto(null)}
        />
      )}
    </div>
  );
}

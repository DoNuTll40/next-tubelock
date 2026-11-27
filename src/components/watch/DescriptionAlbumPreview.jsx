'use client';

import { useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import BrowserMediaImage from '@/components/BrowserMediaImage';

function AlbumImage({ src }) {
  const [failed, setFailed] = useState(false);

  if (failed) return <ImageIcon aria-hidden="true" className="size-5 text-[#80756C] dark:text-white/60" />;

  return (
    <BrowserMediaImage
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  );
}

export default function DescriptionAlbumPreview({ images, title, onOpen, showCaption = false }) {
  if (!images.length) return null;
  const single = images.length === 1;

  return (
    <section aria-label={single ? images[0].alt || 'รูปภาพแนบ' : title || 'รูปในคำอธิบาย'} className="@container min-w-0 space-y-2">
      {title && !single && (
        <div className="flex items-baseline justify-between gap-3">
          <h3 data-description-album-title="" className="min-w-0 break-words text-[length:inherit] font-normal text-[#212529] dark:text-[#F1F1F1]">{title}</h3>
          <span className="shrink-0 text-xs text-[#645B52] dark:text-[#BEB7AE]">{images.length} รูป</span>
        </div>
      )}
      <div className={single ? 'max-w-80' : 'grid grid-cols-2 gap-2 @min-[420px]:grid-cols-3'}>
        {images.slice(0, 3).map(({ src, alt }, index) => (
          <button
            key={`${src}-${index}`}
            type="button"
            aria-label={`เปิดภาพที่ ${index + 1} ${alt || ''}`.trim()}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(index);
            }}
            className={`relative aspect-video w-full cursor-pointer place-items-center overflow-hidden rounded-lg bg-[#E8E2D9] ring-1 ring-transparent transition-shadow hover:ring-[#C55700]/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C55700] motion-reduce:transition-none dark:bg-white/10 dark:hover:ring-[#FF963D]/65 dark:focus-visible:outline-[#FF963D] ${index === 2 ? 'hidden @min-[420px]:grid' : 'grid'}`}
          >
            <AlbumImage key={src} src={src} />
            {index > 0 && images.length > index + 1 && (
              <span aria-hidden="true" className={`absolute inset-0 place-items-center bg-black/55 text-lg font-bold text-white ${index === 1 ? 'grid @min-[420px]:hidden' : 'hidden @min-[420px]:grid'}`}>
                +{images.length - index - 1}
              </span>
            )}
          </button>
        ))}
      </div>
      {single && showCaption && images[0].alt && <p className="text-xs leading-relaxed text-[#645B52] dark:text-[#BEB7AE]">{images[0].alt}</p>}
    </section>
  );
}

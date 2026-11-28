'use client';

import { useId, useMemo, useState } from 'react';
import { ImagePlus, X } from 'lucide-react';
import {
  appendDescriptionImage,
  DESCRIPTION_IMAGE_LIMIT,
  parseDescriptionImages,
  removeDescriptionImage,
} from '@/lib/descriptionImages.mjs';

const inputClass = 'w-full rounded-lg border border-[#E8E1D9] bg-white px-3 py-2 text-sm text-[#212529] outline-none focus:border-[#FF7A00] focus:ring-2 focus:ring-[#FF7A00]/15 dark:border-white/10 dark:bg-[#202020] dark:text-[#F1F1F1]';

export default function DescriptionImagesEditor({ description, onChange }) {
  const editorId = useId();
  const [isAdding, setIsAdding] = useState(false);
  const [src, setSrc] = useState('');
  const [alt, setAlt] = useState('');
  const [error, setError] = useState('');
  const { images } = useMemo(() => parseDescriptionImages(description), [description]);
  const isFull = images.length >= DESCRIPTION_IMAGE_LIMIT;
  const showFields = isAdding && !isFull;

  function addImage() {
    const next = appendDescriptionImage(description, { src, alt });
    if (next === null) {
      setError('กรุณาใช้ลิงก์รูปภาพที่ขึ้นต้นด้วย https://');
      return;
    }
    onChange(next);
    setSrc('');
    setAlt('');
    setError('');
  }

  function handleEnter(event) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    addImage();
  }

  return (
    <div className="space-y-2 rounded-xl border border-[#EFECE6] bg-[#FAF7F2] p-3 dark:border-white/10 dark:bg-[#202020]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[#5E554B] dark:text-[#CCCCCC]">
          ภาพในคำอธิบาย <span className="ml-1 tabular-nums">{images.length}/{DESCRIPTION_IMAGE_LIMIT}</span>
        </span>
        <button
          type="button"
          disabled={isFull}
          aria-expanded={showFields}
          aria-controls={showFields ? editorId : undefined}
          onClick={() => setIsAdding(!isAdding)}
          className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg bg-[#FF7A00]/10 px-2.5 py-1.5 text-xs font-bold text-[#9B4600] transition-colors hover:bg-[#FF7A00]/20 disabled:cursor-default disabled:opacity-50 dark:text-[#FFAB65]"
        >
          <ImagePlus aria-hidden="true" className="size-3.5" />
          แนบภาพจากลิงก์
        </button>
      </div>

      {showFields && (
        <div id={editorId} className="flex flex-col gap-2 border-t border-[#EFECE6] pt-3 dark:border-white/10">
          <div className="grid gap-2 sm:grid-cols-[1.4fr_1fr]">
            <label className="space-y-1 text-xs text-[#5E554B] dark:text-[#CCCCCC]">
              <span>ลิงก์รูปภาพ</span>
              <input
                type="url"
                value={src}
                placeholder="https://example.com/image.jpg"
                onChange={(event) => {
                  setSrc(event.target.value);
                  setError('');
                }}
                onKeyDown={handleEnter}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? `${editorId}-error` : undefined}
                className={inputClass}
              />
            </label>
            <label className="space-y-1 text-xs text-[#5E554B] dark:text-[#CCCCCC]">
              <span>คำบรรยายภาพ (ไม่บังคับ)</span>
              <input
                type="text"
                value={alt}
                onChange={(event) => setAlt(event.target.value)}
                onKeyDown={handleEnter}
                className={inputClass}
              />
            </label>
          </div>
          {error && <p id={`${editorId}-error`} role="alert" className="text-xs text-rose-700 dark:text-rose-300">{error}</p>}
          <button
            type="button"
            onClick={addImage}
            className="self-end cursor-pointer rounded-lg bg-[#B75000] px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-[#9E4500] dark:bg-[#FF8A25] dark:text-[#241307] dark:hover:bg-[#FFA353]"
          >
            เพิ่มภาพ
          </button>
        </div>
      )}

      {images.length > 0 && (
        <ul className="space-y-1.5">
          {images.map(({ src: imageSrc, alt: caption }, index) => (
            <li key={`${imageSrc}-${index}`} className="flex items-center gap-2 rounded-lg bg-white px-2.5 py-1 text-xs text-[#5E554B] dark:bg-white/5 dark:text-[#CCCCCC]">
              <span className="min-w-0 flex-1 truncate" title={imageSrc}>
                {caption || new URL(imageSrc).hostname}
              </span>
              <button
                type="button"
                onClick={() => onChange(removeDescriptionImage(description, index))}
                aria-label={`ลบภาพที่ ${index + 1}`}
                className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-lg hover:bg-rose-500/10 hover:text-rose-700 focus-visible:outline-2 focus-visible:outline-[#FF7A00] dark:hover:text-rose-300"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

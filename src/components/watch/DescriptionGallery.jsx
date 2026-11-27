'use client';

import { useState } from 'react';
import { Images } from 'lucide-react';
import ImageLightbox from '@/components/ui/ImageLightbox';
import DescriptionAlbumPreview from './DescriptionAlbumPreview';

export default function DescriptionGallery({ images = [], albums, title = 'รูปในคำอธิบาย', concealed = false, expanded = false }) {
  const [openedPhoto, setOpenedPhoto] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const groups = (albums || [{ id: 'description-images', title, images }]).filter((album) => album.images.length > 0);
  const imageCount = groups.reduce((total, album) => total + album.images.length, 0);
  const selectedAlbum = groups[openedPhoto?.albumIndex];

  if (!imageCount) return null;

  if (concealed && !revealed) {
    return (
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setRevealed(true);
        }}
        className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-current/15 bg-black/5 px-3 py-2 text-xs font-semibold text-[#514941] hover:bg-black/10 focus-visible:outline-2 focus-visible:outline-[#C55700] dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10"
      >
        <Images aria-hidden="true" className="size-4" />
        แสดงรูปในคำอธิบาย ({imageCount})
      </button>
    );
  }

  return (
    <div className="mt-3 min-w-0 select-none space-y-5">
      {groups.map((album, albumIndex) => (
        <DescriptionAlbumPreview
          key={album.id || albumIndex}
          title={album.title || title}
          images={album.images}
          showCaption={expanded}
          onOpen={(index) => setOpenedPhoto({ albumIndex, index })}
        />
      ))}
      {selectedAlbum && (
        <ImageLightbox
          key={selectedAlbum.id || openedPhoto.albumIndex}
          slideNavigation
          images={selectedAlbum.images}
          title={selectedAlbum.images.length === 1 ? selectedAlbum.images[0].alt || selectedAlbum.images[0].name || 'รูปภาพแนบ' : selectedAlbum.title || title}
          startIndex={openedPhoto.index}
          onClose={() => setOpenedPhoto(null)}
        />
      )}
    </div>
  );
}

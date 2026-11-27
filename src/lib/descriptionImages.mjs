import * as legacy from './descriptionImagesLegacy.mjs';
import { parseRichDescription, serializeDescriptionDocument } from './descriptionDocument.mjs';
export const DESCRIPTION_IMAGE_LIMIT = legacy.DESCRIPTION_IMAGE_LIMIT;

export function parseDescriptionImages(description) {
  const rich = parseRichDescription(description);
  return rich ? { text: rich.text, images: rich.albums.flatMap(album => album.images) } : legacy.parseDescriptionImages(description);
}

export function appendDescriptionImage(description, image) {
  const rich = parseRichDescription(description);
  if (!rich) return legacy.appendDescriptionImage(description, image);
  const id = `image-${Date.now()}`;
  try {
    return serializeDescriptionDocument({
      document: { ...rich.document, content: [...(rich.document.content || []), { type: 'descriptionAlbum', attrs: { albumId: id } }] },
      albums: [...rich.albums, { id, title: '', images: [image] }],
    });
  } catch { return null; }
}

export function removeDescriptionImage(description, imageIndex) {
  const rich = parseRichDescription(description);
  if (!rich) return legacy.removeDescriptionImage(description, imageIndex);
  let offset = 0;
  return serializeDescriptionDocument({ ...rich, albums: rich.albums.map(album => ({ ...album, images: album.images.filter(() => offset++ !== imageIndex) })) });
}

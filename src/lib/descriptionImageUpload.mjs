import { DESCRIPTION_FILE_LIMIT, DESCRIPTION_IMAGE_LIMIT, safeDescriptionImageSource, normalizeDescriptionDocument } from './descriptionDocument.mjs';

export async function uploadDescriptionImage(videoId, file) {
  const form = new FormData();
  form.set('file', file);
  const response = await fetch(`/api/videos/${videoId}/description-images`, { method: 'POST', body: form });
  const result = await response.json();
  if (!response.ok || !result.image) throw new Error(result.error || 'Unable to upload description image');
  return result.image;
}

const stagedFiles = new WeakMap();
export async function stageDescriptionImages({ videoId, document, albums, upload = uploadDescriptionImage }) {
  if (!/^[1-9]\d*$/.test(String(videoId))) throw new Error('A video is required before uploading images');
  if (albums.reduce((sum, album) => sum + album.images.length, 0) > DESCRIPTION_IMAGE_LIMIT) throw new Error('Too many description images');
  for (const album of albums) for (const image of album.images) {
    if (image.file) {
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(image.file.type) || image.file.size < 1 || image.file.size > DESCRIPTION_FILE_LIMIT) throw new Error('Use JPEG, PNG, WebP or GIF images up to 4 MB');
    } else if (!safeDescriptionImageSource(image.src)) throw new Error('Upload local images before saving');
  }
  // Validate document structure/size and existing references before staging any bytes.
  normalizeDescriptionDocument({ document, albums: albums.map(album => ({ ...album, images: album.images.map(image => {
    const { file, ...rest } = image;
    return file ? { ...rest, src: `/api/videos/${videoId}/description-images/${'0'.repeat(64)}.jpg` } : rest;
  }) })) }, { videoId });
  const nextAlbums = [];
  for (const album of albums) {
    const images = [];
    for (const image of album.images) {
      if (!image.file) { images.push({ ...image }); continue; }
      let cache = stagedFiles.get(image.file);
      if (!cache) { cache = new Map(); stagedFiles.set(image.file, cache); }
      let result = cache.get(String(videoId));
      if (!result) { result = await upload(videoId, image.file); cache.set(String(videoId), result); }
      const { file: _file, ...rest } = image;
      images.push({ ...rest, ...result, alt: image.alt || '', name: image.name || image.file.name });
    }
    nextAlbums.push({ ...album, images });
  }
  return normalizeDescriptionDocument({ document, albums: nextAlbums }, { videoId });
}

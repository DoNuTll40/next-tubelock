import { safeDescriptionImageSource, normalizeDescriptionDocument } from './descriptionDocument.mjs';
import { uploadFileDirectToSession } from './uploader.js';

const transferredFiles = new WeakMap();

async function imageUploadRequest(videoId, body) {
  const response = await fetch('/api/videos/' + videoId + '/description-images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const error = new Error(result?.error || 'Unable to upload description image');
    error.status = response.status;
    throw error;
  }
  return result;
}

export async function uploadDescriptionImage(videoId, file) {
  const key = String(videoId);
  const details = { size: file.size, type: file.type, name: file.name };
  let transfers = transferredFiles.get(file);
  if (!transfers) {
    transfers = new Map();
    transferredFiles.set(file, transfers);
  }
  let assetId = transfers.get(key);
  if (!assetId) {
    const session = await imageUploadRequest(videoId, { action: 'session', ...details });
    if (!session.assetId || !session.uploadUrl) throw new Error('Unable to create an image upload session');
    try {
      await uploadFileDirectToSession(file, session.uploadUrl);
    } catch (error) {
      // The last fragment may have arrived even if its response was lost.
      const completed = await imageUploadRequest(videoId, { action: 'complete', ...details, assetId: session.assetId }).catch(() => null);
      if (completed?.image) return completed.image;
      throw error;
    }
    assetId = session.assetId;
    transfers.set(key, assetId);
  }
  const result = await imageUploadRequest(videoId, { action: 'complete', ...details, assetId }).catch(error => {
    if (error.status === 409) transfers.delete(key);
    throw error;
  });
  if (!result.image) throw new Error('Unable to verify description image');
  return result.image;
}

const stagedFiles = new WeakMap();
export async function stageDescriptionImages({ videoId, document, albums, upload = uploadDescriptionImage }) {
  if (!/^[1-9]\d*$/.test(String(videoId))) throw new Error('A video is required before uploading images');
  for (const album of albums) for (const image of album.images) {
    if (image.file) {
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(image.file.type) || image.file.size < 1) throw new Error('Use JPEG, PNG, WebP or GIF images');
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
      if (!result) {
        result = upload(videoId, image.file);
        cache.set(String(videoId), result);
      }
      try {
        result = await result;
      } catch (error) {
        cache.delete(String(videoId));
        throw error;
      }
      const { file: _file, ...rest } = image;
      images.push({ ...rest, ...result, alt: image.alt || '', name: image.name || image.file.name });
    }
    nextAlbums.push({ ...album, images });
  }
  return normalizeDescriptionDocument({ document, albums: nextAlbums }, { videoId });
}

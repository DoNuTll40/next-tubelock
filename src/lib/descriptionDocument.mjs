import { parseDescriptionImages as parseLegacyImages } from './descriptionImagesLegacy.mjs';

// Versioned envelope stored in the existing videos.description TEXT column.
// Only this prefix is interpreted as structured data; ordinary legacy text stays text.
export const DESCRIPTION_PREFIX = 'tubelock-description:v1\n';
export const DESCRIPTION_MAX_BYTES = 262144;
export const DESCRIPTION_TEXT_LIMIT = 50000;
export const DESCRIPTION_IMAGE_LIMIT = 12;
export const DESCRIPTION_FILE_LIMIT = 4 * 1024 * 1024;
export const DESCRIPTION_ASSET_PATTERN = /^\/api\/videos\/([1-9]\d*)\/description-images\/([a-f0-9]{64}\.(?:jpg|png|webp|gif))$/;

function fail(message) { throw new Error(message); }
export function safeDescriptionImageSource(value) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  if (DESCRIPTION_ASSET_PATTERN.test(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !/[\s\\<>\x00-\x1f]/.test(value) ? url.href : null;
  } catch { return null; }
}

function safeLink(value) {
  try { const url = new URL(value); return ['https:', 'http:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null; } catch { return null; }
}

export function descriptionDocumentText(document) {
  if (document.type === 'text') return document.text || '';
  if (document.type === 'hardBreak') return '\n';
  return (document.content || []).map(descriptionDocumentText).join(['doc', 'bulletList', 'orderedList', 'listItem', 'blockquote'].includes(document.type) ? '\n' : '');
}

export function normalizeDescriptionDocument(value, { videoId } = {}) {
  if (!value || value.document?.type !== 'doc' || !Array.isArray(value.albums)) fail('Invalid description document');
  let imageCount = 0;
  const albumIds = new Set();
  const albums = value.albums.map(album => {
    if (!album || typeof album.id !== 'string' || !/^[\w-]{1,80}$/.test(album.id) || albumIds.has(album.id) || !Array.isArray(album.images)) fail('Invalid description album');
    albumIds.add(album.id);
    const images = album.images.map(image => {
      if (++imageCount > DESCRIPTION_IMAGE_LIMIT) fail('Too many description images');
      const src = safeDescriptionImageSource(image?.src);
      if (!src || image.file) fail('Upload description images before saving');
      const asset = DESCRIPTION_ASSET_PATTERN.exec(src);
      if (asset && videoId != null && Number(asset[1]) !== Number(videoId)) fail('Description image belongs to another video');
      const clean = { src, alt: String(image.alt || '').slice(0, 1000), name: String(image.name || '').slice(0, 255) };
      for (const key of ['width', 'height', 'size']) if (Number.isFinite(image[key]) && image[key] > 0) clean[key] = image[key];
      // Keep small JSON metadata, never File/blob objects or arbitrary UI state.
      if (image.metadata && typeof image.metadata === 'object' && JSON.stringify(image.metadata).length <= 16000) clean.metadata = JSON.parse(JSON.stringify(image.metadata));
      return clean;
    });
    return { id: album.id, title: String(album.title || '').slice(0, 255), images };
  });
  let count = 0;
  function node(input, depth = 0) {
    if (++count > 6000 || depth > 24 || !input || typeof input !== 'object') fail('Description document is too complex');
    const type = input.type;
    if (!['doc', 'paragraph', 'heading', 'text', 'bulletList', 'orderedList', 'listItem', 'blockquote', 'codeBlock', 'hardBreak', 'horizontalRule', 'descriptionAlbum'].includes(type)) fail('Unsupported description node');
    const result = { type };
    if (type === 'text') {
      if (typeof input.text !== 'string') fail('Invalid description text');
      result.text = input.text;
      if (input.marks) result.marks = input.marks.map(mark => {
        if (!['bold', 'italic', 'underline', 'strike', 'code', 'link'].includes(mark.type)) fail('Unsupported description mark');
        if (mark.type !== 'link') return { type: mark.type };
        const href = safeLink(mark.attrs?.href);
        if (!href) fail('Invalid description link');
        return { type: 'link', attrs: { href } };
      });
    }
    if (type === 'heading') result.attrs = { level: input.attrs?.level === 3 ? 3 : 2 };
    if (type === 'orderedList') result.attrs = { start: Number.isSafeInteger(input.attrs?.start) && input.attrs.start > 0 ? input.attrs.start : 1 };
    if (type === 'descriptionAlbum') {
      if (!albumIds.has(input.attrs?.albumId)) fail('Description references a missing album');
      result.attrs = { albumId: input.attrs.albumId, kind: albums.find(a => a.id === input.attrs.albumId).images.length === 1 ? 'image' : 'album' };
    }
    if (input.content) {
      if (!Array.isArray(input.content)) fail('Invalid description content');
      result.content = input.content.map(child => node(child, depth + 1));
    }
    return result;
  }
  const document = node(value.document);
  const text = descriptionDocumentText(document);
  if (text.length > DESCRIPTION_TEXT_LIMIT) fail('Description text is too long');
  const normalized = { document, albums, text };
  if (new TextEncoder().encode(JSON.stringify(normalized)).length > DESCRIPTION_MAX_BYTES) fail('Description is too large');
  return normalized;
}

export function serializeDescriptionDocument(value, options) {
  const { document, albums, text } = normalizeDescriptionDocument(value, options);
  return DESCRIPTION_PREFIX + JSON.stringify({ document, albums, text });
}

export function parseRichDescription(value) {
  if (typeof value !== 'string' || !value.startsWith(DESCRIPTION_PREFIX)) return null;
  try {
    if (value.length > DESCRIPTION_MAX_BYTES) return null;
    return normalizeDescriptionDocument(JSON.parse(value.slice(DESCRIPTION_PREFIX.length)));
  } catch { return null; }
}

export function parseDescriptionDocument(value) {
  const rich = parseRichDescription(value);
  if (rich) return rich;
  const { text, images } = parseLegacyImages(value);
  const albums = images.length ? [{ id: 'legacy-images', title: '', images }] : [];
  const content = text.split(/\r\n|\r|\n/).map(line => {
    const parts = [];
    let cursor = 0;
    for (const match of line.matchAll(/https?:\/\/[^\s]+/g)) {
      if (match.index > cursor) parts.push({ type: 'text', text: line.slice(cursor, match.index) });
      const href = safeLink(match[0]);
      parts.push({ type: 'text', text: match[0], ...(href ? { marks: [{ type: 'link', attrs: { href } }] } : {}) });
      cursor = match.index + match[0].length;
    }
    if (cursor < line.length) parts.push({ type: 'text', text: line.slice(cursor) });
    return { type: 'paragraph', ...(parts.length ? { content: parts } : {}) };
  });
  if (images.length) content.push({ type: 'descriptionAlbum', attrs: { albumId: 'legacy-images' } });
  return { document: { type: 'doc', content }, albums, text };
}

export function validateSavedDescription(value, videoId) {
  if (typeof value !== 'string' || new TextEncoder().encode(value).length > DESCRIPTION_MAX_BYTES) fail('Invalid description size');
  if (value.startsWith(DESCRIPTION_PREFIX)) {
    const rich = parseRichDescription(value);
    if (!rich) fail('Invalid rich description');
    if (videoId == null && rich.albums.some(album => album.images.some(image => DESCRIPTION_ASSET_PATTERN.test(image.src)))) fail('A video is required for stored images');
    return serializeDescriptionDocument(rich, { videoId });
  }
  if (/blob:|data:image\//i.test(value)) fail('Temporary image URLs cannot be saved');
  return value;
}

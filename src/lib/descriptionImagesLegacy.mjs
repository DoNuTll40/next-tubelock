export const DESCRIPTION_IMAGE_LIMIT = 50;

const imageLinePattern = /^[ \t]{0,3}!\[((?:\\.|[^\[\]\\])*)\]\([ \t]*(?:<([^<>\s]+)>|([^<>\s]+))[ \t]*\)[ \t]*$/;

function normalizeImageUrl(value) {
  if (typeof value !== 'string') return null;
  const src = value.trim();
  const authority = /^https:\/\/([^/?#]+)/i.exec(src)?.[1];
  if (!authority || authority.includes('@') || /[\s\x00-\x1f\x7f\\<>]/.test(src)) return null;

  try {
    return new URL(src).href;
  } catch {
    return null;
  }
}

function getDescriptionParts(description) {
  const source = typeof description === 'string' ? description : '';
  const lines = source.split(/(\r\n|\r|\n)/);
  const images = [];

  for (let index = 0; index < lines.length && images.length < DESCRIPTION_IMAGE_LIMIT; index += 2) {
    const match = imageLinePattern.exec(lines[index]);
    if (!match) continue;
    const src = normalizeImageUrl(match[2] ?? match[3]);
    if (!src) continue;

    images.push({
      index,
      src,
      alt: match[1].replace(/\\([\[\]\\])/g, '$1').trim(),
    });
  }

  return { lines, images };
}

export function parseDescriptionImages(description) {
  const { lines, images } = getDescriptionParts(description);
  for (const { index } of images) {
    lines[index] = '';
    if (index + 1 < lines.length) lines[index + 1] = '';
  }

  return {
    text: lines.join(''),
    images: images.map(({ src, alt }) => ({ src, alt })),
  };
}

export function appendDescriptionImage(description, { src, alt = '' }) {
  const url = normalizeImageUrl(src);
  if (!url || getDescriptionParts(description).images.length >= DESCRIPTION_IMAGE_LIMIT) return null;

  const source = typeof description === 'string' ? description : '';
  const newline = source.match(/\r\n|\r|\n/)?.[0] || '\n';
  const separator = source && !/[\r\n]$/.test(source) ? newline : '';
  const caption = alt.replace(/[\r\n]+/g, ' ').trim().replace(/[\[\]\\]/g, '\\$&');
  return source + separator + '![' + caption + '](<' + url + '>)';
}

export function removeDescriptionImage(description, imageIndex) {
  const { lines, images } = getDescriptionParts(description);
  const image = images[imageIndex];
  if (image) lines.splice(image.index, 2);
  return lines.join('');
}

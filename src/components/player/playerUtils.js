/**
 * Helper utilities for TubeLock Video Player
 */

import { parseSrtTimestampToMs, parseSrtCues, normalizeSubtitleTimeline } from '../../lib/subtitleUtils.js';

export const formatTime = (time, isDuration = false) => {
  if (isNaN(time) || !time || time < 0) return '00:00';
  const totalSec = isDuration ? Math.round(time) : Math.floor(time);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
};

export const formatTimePair = (cur, dur) => {
  const d = Math.max(0, Number(dur) || 0);
  const totalDurSec = Math.round(d);
  const c = Math.max(0, Number(cur) || 0);
  const currentSec = totalDurSec > 0 ? Math.min(Math.floor(c), totalDurSec) : Math.floor(c);

  const curM = Math.floor(currentSec / 60);
  const curS = currentSec % 60;
  const durM = Math.floor(totalDurSec / 60);
  const durS = totalDurSec % 60;

  return `${curM}:${curS < 10 ? '0' : ''}${curS} / ${durM}:${durS < 10 ? '0' : ''}${durS}`;
};

export const parseResolutionRatio = (resolution) => {
  if (typeof resolution === 'string' && resolution.includes('x')) {
    const parts = resolution.split('x');
    const w = parseFloat(parts[0]);
    const h = parseFloat(parts[1]);
    if (w > 0 && h > 0) {
      return {
        ratio: w / h,
        isVertical: h > w,
      };
    }
  }
  return {
    ratio: 16 / 9,
    isVertical: false,
  };
};

/**
 * Parses a timestamp like "00:01:23,450", "00:01:23.450", or "01:23,450" into seconds (float)
 */
export function parseSubTimestamp(ts) {
  const ms = parseSrtTimestampToMs(ts);
  if (ms !== null) return ms / 1000;
  return parseFloat(String(ts || '').trim().replace(',', '.')) || 0;
}

/**
 * Fault-tolerant SRT / WebVTT parser that works directly on database strings
 * (supports HH:MM:SS,mmm, MM:SS,mmm, inline cues, 1-digit fields, single-\n cues,
 * and normalizes overlapping / runaway durations onto a clean monotonic timeline)
 */
export function parseSubtitleCues(rawText) {
  return normalizeSubtitleTimeline(parseSrtCues(rawText)).map((cue) => ({
    start: cue.startMs / 1000,
    end: cue.endMs / 1000,
    text: cue.text,
  }));
}

/**
 * Find the active cue at playback position `curSec`.
 * Scans sorted cues and selects the latest started cue covering `curSec`
 * so boundary transitions immediately favor the newest spoken line.
 */
export function findActiveSubtitleCue(cues, curSec) {
  if (!Array.isArray(cues) || cues.length === 0) return null;
  let lo = 0;
  let hi = cues.length - 1;
  let candidateIdx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (cues[mid].start <= curSec) {
      candidateIdx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  for (let i = candidateIdx; i >= 0; i--) {
    const cue = cues[i];
    if (curSec <= cue.end) return cue;
    if (curSec - cue.start > 20) break;
  }
  return null;
}

export const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export const ASPECT_OPTIONS = [
  { id: 'fit', label: 'พอดีกับหน้าจอ (Fit)', desc: 'แสดงขนาดจริง มีแถบดำเมื่อจำเป็น' },
  { id: 'crop', label: 'ตัดขอบให้เต็ม (Crop)', desc: 'ซูมเล็กน้อย ตัดแถบดำออกอย่างนุ่มนวล' },
  { id: 'fill', label: 'ยืดเต็มหน้าจอ (Stretch)', desc: 'ขยายยืดเต็มพื้นที่ไม่มีขอบดำ' },
];

// ============================================================================
// 💬 YOUTUBE-STYLE SUBTITLE (CC) CUSTOMIZATION OPTIONS & HELPERS
// ============================================================================
export const DEFAULT_SUBTITLE_STYLE = {
  fontFamily: 'tubelock-system',
  fontColor: 'white',
  fontSize: 100,
  bgColor: 'black',
  bgOpacity: 75,
  windowColor: 'black',
  windowOpacity: 0,
  charEdgeStyle: 'none',
  fontOpacity: 100,
};

export const SUBTITLE_FONT_FAMILIES = [
  { id: 'tubelock-system', label: 'Graphik Thai Loop (ฟอนต์ระบบ)', css: "'Graphik Thai Loop', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" },
  { id: 'mono-sans', label: 'Sans-Serif แบบความกว้างคงที่', css: '"Courier New", Courier, monospace' },
  { id: 'prop-sans', label: 'Sans-Serif แบบปรับไปตามเนื้อที่ที่มี', css: 'Roboto, "Noto Sans Thai", Arial, Helvetica, sans-serif' },
  { id: 'mono-serif', label: 'Serif แบบความกว้างคงที่', css: 'Georgia, "Times New Roman", monospace' },
  { id: 'prop-serif', label: 'Serif แบบปรับไปตามเนื้อที่ที่มี', css: '"Times New Roman", Times, Georgia, serif' },
  { id: 'casual', label: 'ตัวเขียนแบบเป็นกันเอง', css: '"Comic Sans MS", "Chalkboard SE", cursive, sans-serif' },
  { id: 'cursive', label: 'ตัวเขียนติดกัน', css: '"Monotype Corsiva", "Apple Chancery", cursive' },
  { id: 'small-caps', label: 'ตัวพิมพ์เล็กขนาดเท่ากัน', css: 'Arial, Helvetica, sans-serif', smallCaps: true },
];

export const SUBTITLE_COLORS = [
  { id: 'white', label: 'สีขาว', rgb: '255, 255, 255', hex: '#FFFFFF' },
  { id: 'yellow', label: 'สีเหลือง', rgb: '255, 255, 0', hex: '#FFFF00' },
  { id: 'green', label: 'สีเขียว', rgb: '0, 255, 0', hex: '#00FF00' },
  { id: 'cyan', label: 'สีฟ้า', rgb: '0, 255, 255', hex: '#00FFFF' },
  { id: 'blue', label: 'สีน้ำเงิน', rgb: '0, 0, 255', hex: '#0000FF' },
  { id: 'magenta', label: 'สีม่วงแดง', rgb: '255, 0, 255', hex: '#FF00FF' },
  { id: 'red', label: 'สีแดง', rgb: '255, 0, 0', hex: '#FF0000' },
  { id: 'black', label: 'สีดำ', rgb: '8, 8, 8', hex: '#080808' },
];

export const SUBTITLE_FONT_SIZES = [50, 75, 100, 150, 200, 300, 400];

export const SUBTITLE_OPACITIES = [0, 25, 50, 75, 100];

export const SUBTITLE_FONT_OPACITIES = [25, 50, 75, 100];

export const SUBTITLE_EDGE_STYLES = [
  { id: 'none', label: 'ไม่มี' },
  { id: 'drop-shadow', label: 'เงาตกกระทบ' },
  { id: 'raised', label: 'นูน' },
  { id: 'depressed', label: 'บุ๋ม' },
  { id: 'outline', label: 'ขอบเส้น' },
];

export function computeSubtitleStyles(style = DEFAULT_SUBTITLE_STYLE, isMobile = false) {
  const s = { ...DEFAULT_SUBTITLE_STYLE, ...style };
  const fontObj = SUBTITLE_FONT_FAMILIES.find((f) => f.id === s.fontFamily) || SUBTITLE_FONT_FAMILIES[0];
  const fontColorObj = SUBTITLE_COLORS.find((c) => c.id === s.fontColor) || SUBTITLE_COLORS[0];
  const bgColorObj = SUBTITLE_COLORS.find((c) => c.id === s.bgColor) || SUBTITLE_COLORS[7];
  const winColorObj = SUBTITLE_COLORS.find((c) => c.id === s.windowColor) || SUBTITLE_COLORS[7];

  const scale = (Number(s.fontSize) || 100) / 100;
  const basePx = isMobile ? 14 : 20;
  const fontSizePx = Math.max(10, Math.round(basePx * scale));

  const fontAlpha = (Number(s.fontOpacity ?? 100)) / 100;
  const bgAlpha = (Number(s.bgOpacity ?? 75)) / 100;
  const winAlpha = (Number(s.windowOpacity ?? 0)) / 100;

  let textShadow = 'none';
  if (s.charEdgeStyle === 'drop-shadow') {
    textShadow = '2px 2px 3px rgba(0, 0, 0, 0.9)';
  } else if (s.charEdgeStyle === 'raised') {
    textShadow = '-1px -1px 0px rgba(255, 255, 255, 0.7), 1px 1px 2px rgba(0, 0, 0, 0.9)';
  } else if (s.charEdgeStyle === 'depressed') {
    textShadow = '1px 1px 0px rgba(255, 255, 255, 0.7), -1px -1px 2px rgba(0, 0, 0, 0.9)';
  } else if (s.charEdgeStyle === 'outline') {
    textShadow =
      '-1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000, 0px 0px 3px rgba(0,0,0,0.85)';
  }

  return {
    windowStyle: {
      backgroundColor: winAlpha > 0 ? `rgba(${winColorObj.rgb}, ${winAlpha})` : 'transparent',
      padding: winAlpha > 0 ? '6px 10px' : '0px',
      borderRadius: '10px',
    },
    textStyle: {
      display: 'inline-block',
      fontFamily: fontObj.css,
      fontVariant: fontObj.smallCaps ? 'small-caps' : 'normal',
      color: `rgba(${fontColorObj.rgb}, ${fontAlpha})`,
      backgroundColor: bgAlpha > 0 ? `rgba(${bgColorObj.rgb}, ${bgAlpha})` : 'transparent',
      fontSize: `${fontSizePx}px`,
      lineHeight: 1.44,
      textShadow,
      padding: bgAlpha > 0 ? '0.26em 0.62em' : '0px 6px',
      borderRadius: '8px',
      whiteSpace: 'pre-line',
    },
  };
}

/**
 * Normalize multi-line subtitle cue text so stray blank lines do not introduce awkward gaps.
 */
export function normalizeDisplayCueText(text) {
  if (typeof text !== 'string' || !text) return '';
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Compute subtitle overlay offsets so captions remain inside the rendered video picture
 * rather than dropping into letterbox/pillarbox black bars on tall screens.
 */
export function computeSubtitleBoxLayout({
  containerWidth = 0,
  containerHeight = 0,
  videoRatio = 16 / 9,
  aspectMode = 'fit',
  showControls = false,
  isPlaying = false,
  isMobile = false,
} = {}) {
  const defaultSideInset = isMobile ? 12 : 16;
  const controlsClearance = isMobile ? 48 : 56;
  const defaultRestPadding = isMobile ? 12 : 16;
  const controlsVisible = Boolean(showControls || !isPlaying);

  const w = Number(containerWidth) || 0;
  const h = Number(containerHeight) || 0;
  const ratio = Number(videoRatio);

  if (w <= 0 || h <= 0 || !Number.isFinite(ratio) || ratio <= 0 || aspectMode !== 'fit') {
    return {
      bottomPx: controlsVisible ? controlsClearance : defaultRestPadding,
      sideInsetPx: defaultSideInset,
      maxWidthPx: null,
    };
  }

  const containerRatio = w / h;
  let letterboxY = 0;
  let renderedHeight = h;
  let renderedWidth = w;
  let pillarboxX = 0;

  if (ratio > containerRatio + 0.005) {
    renderedHeight = w / ratio;
    letterboxY = Math.max(0, (h - renderedHeight) / 2);
  } else if (containerRatio > ratio + 0.005) {
    renderedWidth = h * ratio;
    pillarboxX = Math.max(0, (w - renderedWidth) / 2);
  }

  const pictureInset = Math.min(defaultRestPadding, Math.max(8, Math.round(renderedHeight * 0.05)));
  const pictureBottomPx = letterboxY + pictureInset;
  const rawBottomPx = controlsVisible
    ? Math.max(controlsClearance, pictureBottomPx)
    : pictureBottomPx;
  const maxSafeBottomPx = Math.max(12, Math.round(h - letterboxY - 40));
  const bottomPx = Math.round(Math.min(rawBottomPx, maxSafeBottomPx));

  const maxWidthPx = pillarboxX > 16
    ? Math.floor(Math.max(renderedWidth * 0.92, Math.min(w - defaultSideInset * 2, 300)))
    : null;

  return {
    bottomPx,
    sideInsetPx: defaultSideInset,
    maxWidthPx,
  };
}

/**
 * Resolve a poster/URL into an absolute URL when an origin is supplied.
 */
function toAbsoluteMediaUrl(url, origin = '') {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed) return '';
  if (/^(https?:|data:|blob:)/i.test(trimmed)) return trimmed;
  const baseOrigin = typeof origin === 'string' ? origin.trim().replace(/\/+$/, '') : '';
  if (!baseOrigin) return trimmed;
  return trimmed.startsWith('/') ? `${baseOrigin}${trimmed}` : `${baseOrigin}/${trimmed}`;
}

/**
 * Infer raster image MIME type for MediaMetadata artwork entries.
 */
function inferMediaArtworkType(url = '') {
  const lower = String(url).trim().toLowerCase();
  if (lower.startsWith('data:')) {
    const match = lower.match(/^data:(image\/[a-z0-9.+-]+)/);
    return match ? match[1] : 'image/jpeg';
  }
  const cleanPath = lower.split(/[?#]/)[0];
  if (cleanPath.endsWith('.png')) return 'image/png';
  if (cleanPath.endsWith('.webp')) return 'image/webp';
  if (cleanPath.endsWith('.avif')) return 'image/avif';
  if (cleanPath.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/**
 * Clean up page-suffix titles for OS media notifications and lockscreen cards.
 */
export function normalizeMediaSessionTitle(title, documentTitle = '') {
  const rawTitle = typeof title === 'string' ? title.trim() : '';
  if (rawTitle) return rawTitle;
  const fallback = typeof documentTitle === 'string'
    ? documentTitle.replace(/\s*-\s*TubeLock$/i, '').trim()
    : '';
  return fallback || 'TubeLock';
}

/**
 * Build browser-safe MediaMetadata artwork descriptors.
 * Uses raster icons when restricted/SVG posters are active (Android cannot decode SVG artwork),
 * and prefers same-origin /api/og JPEGs so redirect/Content-Disposition headers never break artwork.
 */
export function buildMediaSessionArtwork({
  poster = '',
  videoId = null,
  videoSlug = '',
  origin = '',
  keepScrubPreviewOnLoad = false,
} = {}) {
  const fallbackArtwork = [
    { src: toAbsoluteMediaUrl('/images/pwa-512.png', origin), sizes: '512x512', type: 'image/png' },
    { src: toAbsoluteMediaUrl('/images/pwa-192.png', origin), sizes: '192x192', type: 'image/png' },
  ].filter((item) => item.src);

  const trimmedPoster = typeof poster === 'string' ? poster.trim() : '';
  const isSvgPoster = /\.svg(?:[?#].*)?$/i.test(trimmedPoster) || /^data:image\/svg\+xml/i.test(trimmedPoster);

  if (keepScrubPreviewOnLoad || !trimmedPoster || isSvgPoster) {
    return fallbackArtwork;
  }

  if (trimmedPoster.startsWith('blob:') || trimmedPoster.startsWith('/api/videos/')) {
    return [{ src: toAbsoluteMediaUrl(trimmedPoster, origin), type: inferMediaArtworkType(trimmedPoster) }];
  }

  if (trimmedPoster.startsWith('/api/og/')) {
    return [{ src: toAbsoluteMediaUrl(trimmedPoster, origin), sizes: '1200x630', type: 'image/jpeg' }];
  }

  const rawArtworkId = (typeof videoSlug === 'string' && videoSlug.trim() && videoSlug.trim() !== 'undefined')
    ? videoSlug.trim()
    : (videoId !== null && videoId !== undefined && String(videoId).trim() !== '' && String(videoId).trim() !== 'undefined'
      ? String(videoId).trim()
      : '');

  if (rawArtworkId) {
    return [{
      src: toAbsoluteMediaUrl(`/api/og/${encodeURIComponent(rawArtworkId)}.jpg`, origin),
      sizes: '1200x630',
      type: 'image/jpeg',
    }];
  }

  return [{ src: toAbsoluteMediaUrl(trimmedPoster, origin), type: inferMediaArtworkType(trimmedPoster) }];
}

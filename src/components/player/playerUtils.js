/**
 * Helper utilities for TubeLock Video Player
 */

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
  if (!ts) return 0;
  const normalized = String(ts).trim().replace(',', '.');
  const parts = normalized.split(':');
  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return m * 60 + s;
  }
  return parseFloat(normalized) || 0;
}

/**
 * Fault-tolerant SRT / WebVTT parser that works directly on database strings
 * (supports HH:MM:SS,mmm, MM:SS,mmm, single-\n or double-\n\n cues from Gemini AI)
 */
export function parseSubtitleCues(rawText) {
  if (!rawText || typeof rawText !== 'string') return [];
  const cleaned = rawText
    .replace(/^WEBVTT[^\r\n]*/i, '')
    .replace(/\r\n/g, '\n')
    .trim();
  if (!cleaned) return [];

  const timeRangeRegex = /(\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}(?::\d{2})?[,.]\d{1,3})[^\n]*/g;
  const matches = Array.from(cleaned.matchAll(timeRangeRegex));
  if (matches.length === 0) return [];

  const cues = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const start = parseSubTimestamp(match[1]);
    const end = parseSubTimestamp(match[2]);
    const textStart = match.index + match[0].length;
    const textEnd = i + 1 < matches.length ? matches[i + 1].index : cleaned.length;

    let rawCueText = cleaned.slice(textStart, textEnd);
    // Strip trailing cue index number belonging to the next cue (e.g. "\n2\n" or " 2 ")
    if (i + 1 < matches.length) {
      rawCueText = rawCueText.replace(/(?:\n|\s+)\d+\s*$/, '');
    }

    const cueText = rawCueText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .join('\n')
      .trim();

    if (cueText && end >= start) {
      cues.push({ start, end, text: cueText });
    }
  }

  return cues;
}

export const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export const ASPECT_OPTIONS = [
  { id: 'fit', label: 'พอดีกับหน้าจอ (Fit)', desc: 'แสดงขนาดจริง มีแถบดำเมื่อจำเป็น' },
  { id: 'crop', label: 'ตัดขอบให้เต็ม (Crop)', desc: 'ซูมเล็กน้อย ตัดแถบดำออกอย่างนุ่มนวล' },
  { id: 'fill', label: 'ยืดเต็มหน้าจอ (Stretch)', desc: 'ขยายยืดเต็มพื้นที่ไม่มีขอบดำ' },
];

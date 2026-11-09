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
      backgroundColor: `rgba(${winColorObj.rgb}, ${winAlpha})`,
      padding: winAlpha > 0 ? '6px 10px' : '0px',
      borderRadius: '6px',
    },
    textStyle: {
      display: 'inline',
      fontFamily: fontObj.css,
      fontVariant: fontObj.smallCaps ? 'small-caps' : 'normal',
      color: `rgba(${fontColorObj.rgb}, ${fontAlpha})`,
      backgroundColor: `rgba(${bgColorObj.rgb}, ${bgAlpha})`,
      fontSize: `${fontSizePx}px`,
      lineHeight: 1.75,
      textShadow,
      padding: bgAlpha > 0 ? '0.32em 0.55em' : '0px 4px',
      borderRadius: '5px',
      boxDecorationBreak: 'clone',
      WebkitBoxDecorationBreak: 'clone',
    },
  };
}

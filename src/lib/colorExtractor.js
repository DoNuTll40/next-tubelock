/**
 * colorExtractor.js - Client-side Dominant Color Extractor
 * สกัดสีหลัก/สีเด่น (Dominant / Vibrant Color) จากภาพ Thumbnail แบบ YouTube Style
 */

// Memory Cache: ป้องกันการคำนวณซ้ำสำหรับรูปเดิม
const colorCache = new Map();

/**
 * แปลงค่า RGB เป็น HSL
 */
function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h = Math.round(h * 60);
  }

  return {
    h,
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

/**
 * ดึงสีหลักและสร้าง YouTube-style themed hover color
 * @param {HTMLImageElement} imgElement 
 * @returns {{ rgb: string, darkBg: string, lightBg: string }|null}
 */
export function extractDominantColor(imgElement) {
  if (!imgElement || !imgElement.naturalWidth || !imgElement.naturalHeight) {
    return null;
  }

  const src = imgElement.currentSrc || imgElement.src;
  if (colorCache.has(src)) {
    return colorCache.get(src);
  }

  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;

    // ย่อขนาดลงมา 32x32 pixel เพื่อคำนวณเร็วมาก (< 1ms)
    const size = 32;
    canvas.width = size;
    canvas.height = size;
    ctx.drawImage(imgElement, 0, 0, size, size);

    const imgData = ctx.getImageData(0, 0, size, size).data;
    
    let bestColor = null;
    let maxScore = -1;
    let totalR = 0, totalG = 0, totalB = 0, totalCount = 0;

    for (let i = 0; i < imgData.length; i += 4) {
      const r = imgData[i];
      const g = imgData[i + 1];
      const b = imgData[i + 2];
      const a = imgData[i + 3];

      if (a < 128) continue; // ข้ามโปร่งใส

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      const brightness = (r * 299 + g * 587 + b * 114) / 1000;

      totalR += r;
      totalG += g;
      totalB += b;
      totalCount++;

      // ข้ามสีดำสนิทหรือขาวจ้าเกินไป
      if (brightness < 30 || brightness > 235) continue;

      const saturation = max === 0 ? 0 : delta / max;
      // ให้คะแนนความสดของสี
      const score = saturation * 1.6 + (1 - Math.abs(brightness - 128) / 128) * 0.4;

      if (score > maxScore) {
        maxScore = score;
        bestColor = { r, g, b };
      }
    }

    let targetR = 255, targetG = 122, targetB = 0;
    if (bestColor && maxScore > 0.3) {
      targetR = bestColor.r;
      targetG = bestColor.g;
      targetB = bestColor.b;
    } else if (totalCount > 0) {
      targetR = Math.round(totalR / totalCount);
      targetG = Math.round(totalG / totalCount);
      targetB = Math.round(totalB / totalCount);
    }

    // คำนวณสีโทน YouTube (ปรับให้อ่อนนุ่มลงนิดนึง กลมกลืนกับพื้นหลัง)
    const hsl = rgbToHsl(targetR, targetG, targetB);
    const isLowSat = hsl.s < 10;
    const darkSat = isLowSat ? 0 : Math.max(20, Math.min(hsl.s, 30));
    const lightSat = isLowSat ? 0 : Math.max(12, Math.min(hsl.s, 24));

    const darkBg = isLowSat 
      ? 'hsl(0, 0%, 14%)' 
      : `hsl(${hsl.h}, ${darkSat}%, 12.5%)`;

    const lightBg = isLowSat 
      ? 'hsl(0, 0%, 94%)' 
      : `hsl(${hsl.h}, ${lightSat}%, 94%)`;

    const result = {
      rgb: `${targetR}, ${targetG}, ${targetB}`,
      darkBg,
      lightBg,
    };

    colorCache.set(src, result);
    return result;
  } catch (err) {
    return null;
  }
}

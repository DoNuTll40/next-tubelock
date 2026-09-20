/**
 * Helper utilities for TubeLock Video Player
 */

export const formatTime = (time) => {
  if (isNaN(time) || !time || time < 0) return '00:00';
  const m = Math.floor(time / 60);
  const s = Math.floor(time % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
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

export const SPEED_OPTIONS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

export const ASPECT_OPTIONS = [
  { id: 'fit', label: 'พอดีกับหน้าจอ (Fit)', desc: 'แสดงขนาดจริง มีแถบดำเมื่อจำเป็น' },
  { id: 'crop', label: 'ตัดขอบให้เต็ม (Crop)', desc: 'ซูมเล็กน้อย ตัดแถบดำออกอย่างนุ่มนวล' },
  { id: 'fill', label: 'ยืดเต็มหน้าจอ (Stretch)', desc: 'ขยายยืดเต็มพื้นที่ไม่มีขอบดำ' },
];

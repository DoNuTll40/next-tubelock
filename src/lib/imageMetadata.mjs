import exifr from 'exifr';

export async function extractImageMetadata(bytes) {
  return (await exifr.parse(bytes, {
    tiff: true, xmp: true, icc: true, iptc: true, jfif: true, ihdr: true,
    ifd0: true, ifd1: true, exif: true, gps: true, interop: true, makerNote: true, userComment: true,
    mergeOutput: false,
  })) || {};
}

export function metadataText(value) {
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).map(byte => byte.toString(16).padStart(2, '0')).join(' ');
  if (typeof value === 'object' && value !== null) return JSON.stringify(value, (_, item) => ArrayBuffer.isView(item) ? Array.from(item) : item, 2);
  return String(value);
}

export function photoInfoRows(metadata) {
  const tags = { ...metadata.ifd0, ...metadata.exif };
  const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const translations = {
    'Flash did not fire': 'ไม่ใช้แฟลช', 'Flash fired': 'ใช้แฟลช',
    'Normal program': 'อัตโนมัติ', 'Program AE': 'อัตโนมัติ', Manual: 'ปรับเอง',
    'Aperture priority': 'กำหนดรูรับแสง', 'Shutter priority': 'กำหนดความเร็วชัตเตอร์',
    Pattern: 'หลายพื้นที่', 'Multi-segment': 'หลายพื้นที่', Spot: 'เฉพาะจุด',
    'Center-weighted average': 'เฉลี่ยหนักกลาง', Average: 'เฉลี่ยทั้งภาพ',
  };
  const date = tags.DateTimeOriginal || tags.CreateDate;
  const fields = {
    'ยี่ห้อกล้อง': tags.Make, 'รุ่นกล้อง': tags.Model, 'เลนส์': tags.LensModel,
    'ทางยาวโฟกัส': positive(tags.FocalLength) ? `${tags.FocalLength} mm` : null,
    'ความเร็วชัตเตอร์': positive(tags.ExposureTime) ? `${tags.ExposureTime < 1 ? `1/${Math.round(1 / tags.ExposureTime)}` : tags.ExposureTime} s` : null,
    'รูรับแสง': positive(tags.FNumber) ? `f/${tags.FNumber}` : null,
    ISO: positive(tags.ISO) ? String(tags.ISO) : null,
    'แฟลช': typeof tags.Flash === 'number' ? (tags.Flash & 1 ? 'ใช้แฟลช' : 'ไม่ใช้แฟลช') : translations[tags.Flash] || tags.Flash,
    'โหมดถ่ายภาพ': translations[tags.ExposureProgram] || tags.ExposureProgram,
    'การวัดแสง': translations[tags.MeteringMode] || tags.MeteringMode,
    'วันที่ถ่าย': date instanceof Date && !Number.isNaN(date.getTime()) ? date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'medium' }) : typeof date === 'string' ? date : null,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => typeof value === 'string' && value.trim()));
}

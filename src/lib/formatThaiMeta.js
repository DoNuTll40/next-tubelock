import moment from 'moment';
import 'moment/locale/th';

moment.locale('th');

/**
 * Formats view count into compact Thai YouTube-style label
 * e.g. 29 -> "29", 1200 -> "1.2 พัน", 21000 -> "2.1 หมื่น", 140000 -> "1.4 แสน", 3500000 -> "3.5 ล้าน"
 */
export function formatThaiViews(rawCount) {
  const n = Math.max(0, Number(rawCount) || 0);
  if (n >= 1_000_000) {
    const val = (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '');
    return `${val} ล้าน`;
  }
  if (n >= 100_000) {
    const val = (n / 100_000).toFixed(1).replace(/\.0$/, '');
    return `${val} แสน`;
  }
  if (n >= 10_000) {
    const val = (n / 10_000).toFixed(1).replace(/\.0$/, '');
    return `${val} หมื่น`;
  }
  if (n >= 1_000) {
    const val = (n / 1_000).toFixed(1).replace(/\.0$/, '');
    return `${val} พัน`;
  }
  return n.toLocaleString('th-TH');
}

/**
 * Formats a timestamp into concise Thai YouTube-style relative time using moment.js
 * e.g. "เมื่อสักครู่", "5 นาทีที่แล้ว", "2 ชม. ที่แล้ว", "3 วันที่แล้ว", "1 เดือนที่แล้ว"
 */
export function formatThaiRelativeTime(dateInput) {
  if (!dateInput) return '';
  const m = moment(dateInput);
  if (!m.isValid()) return '';

  const diffSeconds = Math.max(0, moment().diff(m, 'seconds'));
  if (diffSeconds < 60) return 'เมื่อสักครู่';

  const raw = m.locale('th').fromNow();
  return raw
    .replace(/^ไม่กี่วินาทีที่แล้ว$/, 'เมื่อสักครู่')
    .replace(/^หนึ่ง\s*/, '1 ')
    .replace(/ชั่วโมงที่แล้ว$/, 'ชม. ที่แล้ว')
    .replace(/ชั่วโมง/, 'ชม. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

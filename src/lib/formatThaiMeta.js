const relativeTime = new Intl.RelativeTimeFormat('th-TH', { numeric: 'always' });
const minuteSeconds = 60;
const hourSeconds = 60 * minuteSeconds;
const daySeconds = 24 * hourSeconds;
const monthSeconds = 30.436875 * daySeconds;

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
 * Formats a timestamp into concise Thai YouTube-style relative time.
 * e.g. "เมื่อสักครู่", "5 นาทีที่แล้ว", "2 ชม. ที่แล้ว", "3 วันที่แล้ว", "1 เดือนที่แล้ว"
 */
export function formatThaiRelativeTime(dateInput) {
  if (!dateInput) return '';
  const timestamp = new Date(dateInput).getTime();
  if (!Number.isFinite(timestamp)) return '';
  const diffSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSeconds < 60) return 'เมื่อสักครู่';

  const minutes = Math.round(diffSeconds / minuteSeconds);
  const hours = Math.round(diffSeconds / hourSeconds);
  const days = Math.round(diffSeconds / daySeconds);
  const months = Math.round(diffSeconds / monthSeconds);
  const [amount, unit] = minutes < 45 ? [minutes, 'minute']
    : hours < 22 ? [hours, 'hour']
      : days < 26 ? [days, 'day']
        : months < 11 ? [Math.max(1, months), 'month']
          : [Math.max(1, Math.round(diffSeconds / (12 * monthSeconds))), 'year'];

  return relativeTime.format(-amount, unit)
    .replace('ที่ผ่านมา', 'ที่แล้ว')
    .replace('ชั่วโมง', 'ชม. ');
}

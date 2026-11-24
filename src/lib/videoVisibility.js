export const VALID_VISIBILITIES = ['public', 'unlisted', 'private'];

export const VISIBILITY_OPTIONS = [
  {
    value: 'public',
    label: 'สาธารณะ',
    shortLabel: 'สาธารณะ',
    description: 'ทุกคนสามารถค้นหาและรับชมวิดีโอนี้ได้',
  },
  {
    value: 'unlisted',
    label: 'ไม่แสดงในรายการ',
    shortLabel: 'ไม่แสดงในรายการ',
    description: 'ทุกคนที่มีลิงก์สามารถรับชมได้ แต่จะไม่แสดงในหน้าแรกหรือผลการค้นหา',
  },
  {
    value: 'private',
    label: 'ส่วนตัว',
    shortLabel: 'ส่วนตัว',
    description: 'เฉพาะคุณเท่านั้นที่สามารถเปิดดูวิดีโอนี้ได้',
  },
];

export function normalizeVideoVisibility(raw, fallback = 'public') {
  const val = String(raw || '').trim().toLowerCase();
  return VALID_VISIBILITIES.includes(val) ? val : fallback;
}

export function getVisibilityMeta(raw) {
  const normalized = normalizeVideoVisibility(raw);
  return VISIBILITY_OPTIONS.find((opt) => opt.value === normalized) || VISIBILITY_OPTIONS[0];
}

export function canViewVideo(video, sessionUserId, isUserAdmin = false) {
  if (!video) return false;
  const vis = normalizeVideoVisibility(video.visibility);
  if (vis !== 'private') return true;
  if (isUserAdmin) return true;
  if (sessionUserId != null && video.user_id != null && Number(sessionUserId) === Number(video.user_id)) {
    return true;
  }
  return false;
}

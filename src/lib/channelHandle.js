export const HANDLE_REGEX = /^[a-zA-Z0-9._-]{3,28}$/;

export const RESERVED_HANDLES = new Set([
  'admin',
  'administrator',
  'api',
  'auth',
  'watch',
  'upload',
  'videos',
  'video',
  'playlists',
  'playlist',
  'hashtag',
  'hashtags',
  'channel',
  'channels',
  'settings',
  'login',
  'logout',
  'results',
  'search',
  'history',
  'shorts',
  'studio',
  'docs',
  'about',
  'support',
  'help',
  'tubelock',
  'system',
  'root',
  'me',
  'user',
  'users',
]);

export function normalizeHandleInput(raw) {
  let str = String(raw || '').trim();
  try {
    str = decodeURIComponent(str);
  } catch {
    // keep raw
  }
  return str.replace(/^@+/, '').trim();
}

export function validateHandleFormat(raw) {
  const handle = normalizeHandleInput(raw);
  if (!handle) {
    return { valid: false, handle: '', reason: 'กรุณาระบุชื่อ @handle' };
  }
  if (handle.length < 3) {
    return { valid: false, handle, reason: 'ต้องมีความยาวอย่างน้อย 3 ตัวอักษร' };
  }
  if (handle.length > 28) {
    return { valid: false, handle, reason: 'ความยาวต้องไม่เกิน 28 ตัวอักษร' };
  }
  if (!HANDLE_REGEX.test(handle)) {
    return {
      valid: false,
      handle,
      reason: 'ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข และเครื่องหมาย . _ - เท่านั้น',
    };
  }
  if (/^[._-]|[._-]$/.test(handle)) {
    return {
      valid: false,
      handle,
      reason: 'ไม่สามารถขึ้นต้นหรือลงท้ายด้วย . _ หรือ - ได้',
    };
  }
  if (RESERVED_HANDLES.has(handle.toLowerCase())) {
    return {
      valid: false,
      handle,
      reason: 'ชื่อนี้ถูกสงวนไว้โดยระบบ กรุณาเลือกชื่ออื่น',
    };
  }
  return { valid: true, handle, reason: '' };
}

export function getChannelHref(handle) {
  const clean = normalizeHandleInput(handle);
  if (!clean) return null;
  return `/@${encodeURIComponent(clean)}`;
}

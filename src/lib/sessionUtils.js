/**
 * Session utility functions for TubeLock multi-device session management
 */

/**
 * Generate a cryptographically secure 64-char hex session token
 * Uses Web Crypto API — works in both Node.js and Edge Runtime
 */
export function generateSessionToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Parse User-Agent string into structured device info
 */
export function parseUserAgent(ua = '') {
  const ual = ua.toLowerCase();

  // ── Device type ───────────────────────────────────────────────
  let device_type = 'desktop';
  if (/mobile|android.*mobile|iphone|ipod|blackberry|windows phone/.test(ual)) {
    device_type = 'mobile';
  } else if (/ipad|android(?!.*mobile)|tablet/.test(ual)) {
    device_type = 'tablet';
  }

  // ── OS ────────────────────────────────────────────────────────
  let os = 'Unknown OS';
  if (/windows nt 10\.0/.test(ual))      os = 'Windows 10/11';
  else if (/windows nt 6\.3/.test(ual))  os = 'Windows 8.1';
  else if (/windows nt 6\.1/.test(ual))  os = 'Windows 7';
  else if (/windows/.test(ual))          os = 'Windows';
  else if (/macintosh|mac os x/.test(ual)) {
    const m = ua.match(/Mac OS X ([\d_]+)/);
    os = m ? `macOS ${m[1].replace(/_/g, '.')}` : 'macOS';
  } else if (/android/.test(ual)) {
    const m = ua.match(/Android ([\d.]+)/);
    os = m ? `Android ${m[1]}` : 'Android';
  } else if (/iphone os|ios/.test(ual)) {
    const m = ua.match(/(?:iPhone OS|iOS) ([\d_]+)/);
    os = m ? `iOS ${m[1].replace(/_/g, '.')}` : 'iOS';
  } else if (/linux/.test(ual)) os = 'Linux';

  // ── Browser ───────────────────────────────────────────────────
  let browser = 'Unknown Browser';
  if (/edg\/|edge\//.test(ual)) {
    const m = ua.match(/Edg(?:e)?\/([\d.]+)/);
    browser = m ? `Edge ${m[1].split('.')[0]}` : 'Edge';
  } else if (/opr\/|opera/.test(ual)) {
    const m = ua.match(/(?:OPR|Opera)\/([\d.]+)/);
    browser = m ? `Opera ${m[1].split('.')[0]}` : 'Opera';
  } else if (/chrome\//.test(ual) && !/chromium/.test(ual)) {
    const m = ua.match(/Chrome\/([\d.]+)/);
    browser = m ? `Chrome ${m[1].split('.')[0]}` : 'Chrome';
  } else if (/firefox\//.test(ual)) {
    const m = ua.match(/Firefox\/([\d.]+)/);
    browser = m ? `Firefox ${m[1].split('.')[0]}` : 'Firefox';
  } else if (/safari\//.test(ual)) {
    const m = ua.match(/Version\/([\d.]+)/);
    browser = m ? `Safari ${m[1].split('.')[0]}` : 'Safari';
  } else if (/msie|trident/.test(ual)) {
    browser = 'Internet Explorer';
  }

  return {
    device_type,
    os,
    browser,
    device_name: `${browser} on ${os}`,
  };
}

/**
 * Fetch geographic info from IP address using ip-api.com (free, no key needed)
 * Non-blocking — returns null on failure or timeout
 */
export async function fetchGeoIP(ip) {
  // Skip private / loopback IPs
  if (
    !ip ||
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.')
  ) {
    return { country: 'Localhost', city: 'Local Network' };
  }

  try {
    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`https://ip-api.com/json/${ip}?fields=country,city,status`, {
      signal: controller.signal,
    });
    clearTimeout(tid);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.status !== 'success') return null;
    return { country: data.country || null, city: data.city || null };
  } catch {
    return null;
  }
}

/**
 * Extract real client IP from request headers (handles proxies & Cloudflare)
 */
export function getRealIP(request) {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    request.headers.get('cf-connecting-ip') ||
    '127.0.0.1'
  );
}

/**
 * Format a date string as Thai relative time (e.g. "2 ชั่วโมงที่แล้ว")
 */
export function formatRelativeTime(dateStr) {
  if (!dateStr) return 'ไม่ทราบ';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);

  if (mins  < 1)  return 'เมื่อกี้';
  if (mins  < 60) return `${mins} นาทีที่แล้ว`;
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  if (days  < 7)  return `${days} วันที่แล้ว`;
  return new Date(dateStr).toLocaleDateString('th-TH');
}

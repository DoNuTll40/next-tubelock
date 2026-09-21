/**
 * Video Utilities: Resolution classification, frame rate, aspect ratio, and codec formatting
 */

/**
 * Format Aspect Ratio according to YouTube & Engineering Spec:
 * Handles standard aspect ratios (16:9, 4:3, 9:16, 1:1, 21:9)
 * and custom pixel aspect ratios without ugly joined strings like '1920:1013'.
 */
export function formatAspectRatio(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return 'Auto';

  const ratio = Number((w / h).toFixed(2));

  if (ratio >= 1.70 && ratio <= 1.85) return '16:9 (Widescreen)';
  if (ratio >= 1.30 && ratio <= 1.37) return '4:3 (Standard)';
  if (ratio >= 0.54 && ratio <= 0.58) return '9:16 (Vertical / Shorts)';
  if (ratio >= 0.95 && ratio <= 1.05) return '1:1 (Square)';
  if (ratio >= 2.30 && ratio <= 2.45) return '21:9 (Cinematic Scope)';

  // Custom aspect ratio: show exact dimensions with computed ratio
  return `${w} x ${h} (${ratio.toFixed(2)}:1)`;
}

/**
 * Detect Resolution Label according to Engineering Spec:
 * Uses max(width, height) and handles client-side hardware decode downscale limit
 * (e.g. 4K AV1/HEVC downscaled to 1920 by HTML5 Video Element).
 */
export function detectResolutionLabel(width = 0, height = 0, options = {}) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  const { fileSize = 0, codec = '' } = options;

  const isLargeFile = fileSize >= 50 * 1024 * 1024;
  const codecLower = String(codec).toLowerCase();
  const isModernCodec = ['av1', 'av01', 'hevc', 'hvc1', 'hev1', 'h.265'].some((c) =>
    codecLower.includes(c)
  );

  if (w > 0 || h > 0) {
    // Client-side decode limit fallback: file is large, modern codec, but browser reported 1920 or lower
    if (isLargeFile && isModernCodec && w <= 1920 && h <= 1080) {
      return '4K (Source ตรวจพบ)';
    }

    if (w >= 3840 || h >= 2160) return '4K (2160p)';
    if (w >= 2560 || h >= 1440) return '2K (1440p)';
    if (w >= 1920 || h >= 1080) return '1080p (Full HD)';
    if (w >= 1280 || h >= 720) return '720p (HD)';
    if (w >= 854 || h >= 480) return '480p (SD)';
    return '360p';
  }

  if (isLargeFile && isModernCodec) {
    return '4K (Source ตรวจพบ)';
  }

  return 'รอผลวิเคราะห์จาก Server';
}

/**
 * Fast inspection of file header (first 128KB) to detect true video codec
 * without needing browser HTML5 video decoder.
 */
export async function detectCodecFromHeader(file) {
  if (!file || typeof file.slice !== 'function') return '';
  try {
    const slice = file.slice(0, 131072);
    const buffer = await slice.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let str = '';
    for (let i = 0; i < bytes.length; i++) {
      const code = bytes[i];
      if (code >= 32 && code <= 126) {
        str += String.fromCharCode(code);
      } else {
        str += ' ';
      }
    }
    const lower = str.toLowerCase();
    if (lower.includes('av01') || lower.includes('av1')) return 'av1';
    if (lower.includes('hvc1') || lower.includes('hev1') || lower.includes('hevc')) return 'hevc';
    if (lower.includes('vp09') || lower.includes('vp9')) return 'vp9';
    if (lower.includes('avc1') || lower.includes('h264')) return 'h264';
    return '';
  } catch {
    return '';
  }
}

/**
 * Classify video resolution into standard brackets:
 * 4K, 2K, 1080p, 720p, 480p, 360p, 240p, 144p
 *
 * Accounts for widescreen / cinematic crop (e.g. 3840x2026 or 3840x1600 is 4K!)
 * as well as vertical formats (e.g. 2160x3840 is 4K!)
 */
export function classifyResolution(width = 0, height = 0, fallbackStr = '') {
  const w = Number(width) || 0;
  const h = Number(height) || 0;

  if (w > 0 || h > 0) {
    const maxDim = Math.max(w, h);
    const minDim = Math.min(w, h) || maxDim;

    // 4K Ultra HD (Standard 3840x2160, Cinema 4096x2160, Widescreen 3840x2026/1600)
    if (maxDim >= 3600 || minDim >= 2000) {
      return '4K';
    }

    // 2K / 1440p Quad HD (Standard 2560x1440, Ultrawide 2560x1080)
    if (maxDim >= 2300 || minDim >= 1350) {
      return '2K';
    }

    // 1080p Full HD (Standard 1920x1080, Cinematic 1920x800)
    if (maxDim >= 1700 || minDim >= 950) {
      return '1080p';
    }

    // 720p HD (Standard 1280x720, Cinematic 1280x536)
    if (maxDim >= 1100 || minDim >= 650) {
      return '720p';
    }

    // 480p SD (Standard 854x480, 720x480, 640x480)
    if (maxDim >= 750 || minDim >= 440) {
      return '480p';
    }

    // 360p (Standard 640x360)
    if (maxDim >= 540 || minDim >= 320) {
      return '360p';
    }

    // 240p (Standard 426x240)
    if (maxDim >= 380 || minDim >= 200) {
      return '240p';
    }

    // 144p
    return '144p';
  }

  // Fallback parsing from existing text like '2026p', '2160p', '1080p', '2K'
  return formatResolutionBadge(fallbackStr);
}

/**
 * Format any stored resolution string into clean display badge
 * e.g. '2026p' -> '4K', '2160p' -> '4K', '1440p' -> '2K'
 */
export function formatResolutionBadge(resStr = '') {
  if (!resStr) return 'HD';
  const str = String(resStr).trim().toUpperCase();

  if (str === '4K' || str === 'UHD' || str.includes('2160')) return '4K';
  if (str === '2K' || str === 'QHD' || str.includes('1440')) return '2K';
  if (str.includes('1080') || str === 'FHD') return '1080p';
  if (str.includes('720') || str === 'HD') return '720p';
  if (str.includes('480')) return '480p';
  if (str.includes('360')) return '360p';
  if (str.includes('240')) return '240p';
  if (str.includes('144')) return '144p';

  // Check numeric value if like '2026p' or '2026'
  const match = str.match(/(\d+)/);
  if (match) {
    const val = parseInt(match[1], 10);
    if (val >= 2000) return '4K';
    if (val >= 1350) return '2K';
    if (val >= 950) return '1080p';
    if (val >= 650) return '720p';
    if (val >= 440) return '480p';
    if (val >= 320) return '360p';
    if (val >= 200) return '240p';
    return '144p';
  }

  return resStr;
}

/**
 * Format HLS quality level with resolution and optional FPS suffix (YouTube style)
 * e.g. (2160, 60) -> { label: '2160p60', badge: '4K', height: 2160 }
 *      (1440, 60) -> { label: '1440p60', badge: 'HD', height: 1440 }
 *      (1080, 60) -> { label: '1080p60', badge: 'HD', height: 1080 }
 *      (720, 60)  -> { label: '720p60', badge: null, height: 720 }
 *      (480, 60)  -> { label: '480p', badge: null, height: 480 }
 *      (360, 30)  -> { label: '360p', badge: null, height: 360 }
 *      (240, 30)  -> { label: '240p', badge: null, height: 240 }
 *      (144, 30)  -> { label: '144p', badge: null, height: 144 }
 */
export function formatQualityLevel(height, fps = null) {
  const h = parseInt(height, 10) || 0;
  const numFps = parseFloat(fps) || 0;
  // YouTube standard: High frame rate (50 or 60) applies to 720p and above
  const isHighFps = numFps >= 48 && h >= 720;
  const fpsSuffix = isHighFps ? `${Math.round(numFps)}` : '';

  let baseRes = `${h}p`;
  let badge = null;

  if (h >= 2000) {
    baseRes = '2160p';
    badge = '4K';
  } else if (h >= 1350) {
    baseRes = '1440p';
    badge = '2K';
  } else if (h >= 950) {
    baseRes = '1080p';
    badge = 'FHD';
  } else if (h >= 650) {
    baseRes = '720p';
    badge = 'HD';
  } else if (h >= 440) {
    baseRes = '480p';
  } else if (h >= 320) {
    baseRes = '360p';
  } else if (h >= 200) {
    baseRes = '240p';
  } else if (h > 0) {
    baseRes = '144p';
  }

  const label = `${baseRes}${fpsSuffix}`;

  return {
    label,
    badge,
    height: h,
    fps: numFps,
    gearBadge: badge,
    fullLabel: badge ? `${label} ${badge}` : label,
  };
}

/**
 * Get gear button badge (4K, 2K, FHD, HD) without FPS
 * e.g. '2160p50' -> '4K', '1440p60' -> '2K', '1080p50' -> 'FHD', '720p60' -> 'HD'
 */
export function getGearBadge(resOrLabel = '') {
  if (!resOrLabel) return null;
  const str = String(resOrLabel).toUpperCase();
  if (str.includes('2160') || str.includes('4K')) return '4K';
  if (str.includes('1440') || str.includes('2K')) return '2K';
  if (str.includes('1080') || str.includes('FHD')) return 'FHD';
  if (str.includes('720') || str.includes('HD')) return 'HD';

  const match = str.match(/(\d+)/);
  if (match) {
    const val = parseInt(match[1], 10);
    if (val >= 2000) return '4K';
    if (val >= 1350) return '2K';
    if (val >= 950) return 'FHD';
    if (val >= 650) return 'HD';
  }
  return null;
}

/**
 * Detect codec name from fourCC or codec string
 */
export function detectCodec(fourCC = '', fallback = 'h264') {
  if (!fourCC) return fallback;
  const f = String(fourCC).toLowerCase().trim();

  if (f.includes('av01') || f.includes('av1')) return 'av1';
  if (f.includes('hvc1') || f.includes('hev1') || f.includes('hevc') || f.includes('h265')) return 'hevc';
  if (f.includes('avc1') || f.includes('h264') || f.includes('x264')) return 'h264';
  if (f.includes('vp09') || f.includes('vp9')) return 'vp9';
  if (f.includes('vp08') || f.includes('vp8')) return 'vp8';
  return f;
}


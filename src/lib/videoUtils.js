/**
 * Video Utilities: Resolution classification, frame rate, and codec formatting
 */

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

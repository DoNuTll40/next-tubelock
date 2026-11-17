import { parseSrtCues, cuesToSrt, convertSrtToVtt } from '@/lib/subtitleUtils';

export const UPLOAD_CATEGORIES = [
  { value: 'general', label: 'ทั่วไป (General)' },
  { value: 'shorts', label: 'วิดีโอสั้น (Shorts)' },
  { value: 'cinema', label: 'ภาพยนตร์ / ซีรีส์ (Cinema)' },
  { value: 'music', label: 'เพลง / ดนตรี (Music)' },
  { value: 'entertainment', label: 'บันเทิง / วาไรตี้' },
  { value: 'gaming', label: 'เกม (Gaming)' },
  { value: 'tech', label: 'เทคโนโลยี / ไอที' },
  { value: 'education', label: 'การศึกษา / สาระ' },
];

export const SUGGESTED_TAGS = [
  'Shorts',
  '4K',
  '1080p',
  'Music',
  'Gaming',
  'HLS',
  'Tech',
  'Vlog',
  'Tutorial',
  'Highlight',
];

export const CONTENT_RATINGS = [
  {
    id: 'all',
    label: 'ทั่วไป',
    badge: 'G / ALL',
    desc: 'เหมาะสำหรับผู้ชมทุกวัย ไม่มีเนื้อหารุนแรงหรือคำหยาบ',
  },
  {
    id: '13+',
    label: '13 ปีขึ้นไป',
    badge: '13+',
    desc: 'อาจมีคำพูดหรือฉากที่เหมาะกับผู้ชมวัยรุ่นขึ้นไป',
  },
  {
    id: '18+',
    label: 'ผู้ใหญ่ 18+',
    badge: '18+',
    desc: 'มีเนื้อหาที่ต้องใช้วิจารณญาณหรือฉากรุนแรง',
  },
  {
    id: 'mature',
    label: 'จำกัดเฉพาะ',
    badge: 'RESTRICTED',
    desc: 'จำกัดการรับชมเฉพาะบัญชีที่ได้รับอนุญาต',
  },
];

export function cleanVideoTitle(rawTitle = '') {
  if (!rawTitle) return '';
  return String(rawTitle)
    .replace(/\.(mp4|mkv|mov|avi|webm|flv|m4v|wmv)$/i, '')
    .replace(/[_\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function formatThumbTime(sec = 0) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

export function resizeThumbnailFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('ไฟล์รูปภาพไม่ถูกต้อง'));
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        if (img.width < img.height) {
          // Format portrait cover onto 16:9 canvas with blurred dark backdrop + sharp centered frame
          const targetW = 960;
          const targetH = 540;
          canvas.width = targetW;
          canvas.height = targetH;

          const bgScale = Math.max(targetW / img.width, targetH / img.height);
          const bgW = img.width * bgScale;
          const bgH = img.height * bgScale;
          ctx.save();
          ctx.filter = 'blur(26px) brightness(0.62) saturate(0.9)';
          ctx.drawImage(img, (targetW - bgW) / 2, (targetH - bgH) / 2, bgW, bgH);
          ctx.restore();

          const fgScale = targetH / img.height;
          const fgW = img.width * fgScale;
          ctx.drawImage(img, (targetW - fgW) / 2, 0, fgW, targetH);
        } else {
          const maxWidth = 960;
          const scale = img.width > maxWidth ? maxWidth / img.width : 1;
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        }

        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Normalize an array of subtitle tracks into clean { id, label, lang, srt, vtt } objects,
 * converting VTT->SRT or SRT->VTT automatically so both formats stay valid and synchronized.
 */
export function normalizeSubtitleTracks(rawTracks, fallbackSrt = '', fallbackVtt = '') {
  let list = [];
  if (Array.isArray(rawTracks)) {
    list = rawTracks;
  } else if (typeof rawTracks === 'string') {
    try {
      const parsed = JSON.parse(rawTracks);
      if (Array.isArray(parsed)) list = parsed;
    } catch (_) {}
  }

  if (list.length === 0 && (fallbackSrt || fallbackVtt)) {
    list = [
      {
        id: 'th',
        label: 'ไทย',
        lang: 'th',
        srt: fallbackSrt || '',
        vtt: fallbackVtt || '',
      },
    ];
  }

  const seenIds = new Set();
  const normalized = [];

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== 'object') continue;

    let rawSrt = typeof item.srt === 'string' ? item.srt.replace(/^\uFEFF/, '').trim() : '';
    let rawVtt = typeof item.vtt === 'string' ? item.vtt.replace(/^\uFEFF/, '').trim() : '';

    if (!rawSrt && rawVtt) {
      const cues = parseSrtCues(rawVtt);
      rawSrt = cues.length > 0 ? cuesToSrt(cues).trim() : rawVtt.replace(/^WEBVTT[^\n]*\n*/i, '').trim();
    }

    if (rawSrt && !rawVtt) {
      rawVtt = convertSrtToVtt(rawSrt);
    } else if (rawSrt) {
      // Regenerate VTT from SRT so edits to SRT immediately reflect in VTT
      rawVtt = convertSrtToVtt(rawSrt);
    }

    if (!rawSrt && !rawVtt) continue;

    let trackId = String(item.id || item.lang || `track_${i + 1}`)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '_')
      .slice(0, 32) || `track_${i + 1}`;
    while (seenIds.has(trackId)) {
      trackId = `${trackId}_${i + 1}`;
    }
    seenIds.add(trackId);

    const lang = String(item.lang || (trackId === 'th' ? 'th' : 'und'))
      .trim()
      .toLowerCase()
      .slice(0, 16) || 'und';
    const label = String(item.label || (trackId === 'th' ? 'ไทย' : `แทร็ก ${i + 1}`))
      .trim()
      .slice(0, 60);

    normalized.push({
      id: trackId,
      label,
      lang,
      srt: rawSrt,
      vtt: rawVtt,
    });
  }

  return normalized;
}

export function formatVideoDuration(seconds = 0) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  return `${m}:${String(rem).padStart(2, '0')}`;
}

export function formatFileSize(bytes = 0) {
  const num = Number(bytes) || 0;
  if (num <= 0) return '-';
  const gb = num / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  const mb = num / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

export function getCategoryLabel(value = 'general') {
  const found = UPLOAD_CATEGORIES.find((c) => c.value === value);
  return found ? found.label : value || 'ทั่วไป';
}

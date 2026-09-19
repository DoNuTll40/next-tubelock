/**
 * Playback Resolver for OneDrive Streams (MP4 and HLS with nested ABR Blob URLs)
 */

async function rewriteSubPlaylistToBlobUrl(subPlaylistUrl, segmentUrlMap) {
  const res = await fetch(subPlaylistUrl);
  if (!res.ok) throw new Error(`ไม่สามารถโหลด Sub-Playlist จาก URL: ${subPlaylistUrl}`);
  const text = await res.text();

  const rewritten = text
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return line;

      const cleanBase = trimmed.replace(/\.ts$/i, '');
      const realSegmentUrl = segmentUrlMap[trimmed] || segmentUrlMap[`${cleanBase}.ts`] || segmentUrlMap[cleanBase];
      return realSegmentUrl || line;
    })
    .join('\n');

  const blob = new Blob([rewritten], { type: 'application/vnd.apple.mpegurl' });
  return URL.createObjectURL(blob);
}

function parseVttTimeToSeconds(timeStr) {
  if (!timeStr) return 0;
  const parts = timeStr.split(':');
  if (parts.length === 3) {
    const [h, m, rest] = parts;
    const [s, ms] = (rest || '').split('.');
    return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms || 0) / 1000;
  }
  if (parts.length === 2) {
    const [m, rest] = parts;
    const [s, ms] = (rest || '').split('.');
    return Number(m) * 60 + Number(s) + Number(ms || 0) / 1000;
  }
  return Number(timeStr) || 0;
}

async function parseSingleVtt(vttUrl, spriteMap, defaultW, defaultH, colsCount) {
  try {
    const res = await fetch(vttUrl);
    if (!res.ok) return null;
    const text = await res.text();

    const cues = [];
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('-->')) {
        const [startStr, endStr] = line.split('-->').map((s) => s.trim());
        const cueMediaLine = lines[i + 1];
        if (!cueMediaLine) continue;

        const [fileName, frag] = cueMediaLine.split('#xywh=');
        if (!frag) continue;
        const [x, y, w, h] = frag.split(',').map(Number);
        const resolvedSpriteUrl = spriteMap[fileName] || fileName;

        cues.push({
          start: parseVttTimeToSeconds(startStr),
          end: parseVttTimeToSeconds(endStr),
          url: resolvedSpriteUrl,
          x,
          y,
          w: w || defaultW,
          h: h || defaultH,
          col: Math.round(x / (w || defaultW)),
          row: Math.round(y / (h || defaultH)),
          cols: colsCount,
        });
      }
    }
    return cues;
  } catch (_) {
    return null;
  }
}

export async function resolveStoryboard(items) {
  if (!Array.isArray(items)) return null;

  let vttDefault = null;
  let vttSD = null;
  let vttHD = null;
  const spriteMap = {};

  for (const item of items) {
    if (!item.downloadUrl) continue;
    const lower = item.name.toLowerCase();
    if (lower === 'thumbnails_hd.vtt') {
      vttHD = item;
    } else if (lower === 'thumbnails_sd.vtt') {
      vttSD = item;
    } else if (lower === 'thumbnails.vtt' || lower.endsWith('.vtt')) {
      vttDefault = item;
    } else if (lower.startsWith('sprite_') && (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.png'))) {
      spriteMap[item.name] = item.downloadUrl;
    }
  }

  const primarySD = vttSD || vttDefault;
  if (!primarySD && !vttHD) return null;

  try {
    const [cuesSD, cuesHD] = await Promise.all([
      primarySD ? parseSingleVtt(primarySD.downloadUrl, spriteMap, 160, 90, 10) : null,
      vttHD ? parseSingleVtt(vttHD.downloadUrl, spriteMap, 320, 180, 5) : null,
    ]);

    const activeCues = cuesSD || cuesHD || [];
    return {
      cues: activeCues, // Default SD
      cuesSD: cuesSD || activeCues,
      cuesHD: cuesHD || null,
      interval: activeCues.length > 1 ? Math.max(1, activeCues[1].start - activeCues[0].start) : 5,
    };
  } catch (err) {
    console.warn('[Storyboard Resolver Warning]:', err.message);
    return null;
  }
}

export async function resolveClientPlaybackSource(sourceData) {
  if (!sourceData) throw new Error('ไม่พบข้อมูล Source');

  // Case 1: Standalone MP4 / Direct stream
  if (sourceData.type === 'mp4' || sourceData.url) {
    return {
      type: 'mp4',
      url: sourceData.url,
      blobUrls: [],
      storyboard: null,
    };
  }

  // Case 2: HLS Stream from OneDrive items
  if (sourceData.type === 'hls' && Array.isArray(sourceData.items)) {
    const items = sourceData.items;
    const storyboard = await resolveStoryboard(items);
    const segmentUrlMap = {};
    const subPlaylistItems = {};
    let masterPlaylistItem = null;
    const createdBlobUrls = [];

    for (const item of items) {
      const downloadUrl = item.downloadUrl;
      if (!downloadUrl) continue;

      const lowerName = item.name.toLowerCase();

      if (lowerName === 'master.m3u8') {
        masterPlaylistItem = item;
      } else if (lowerName.endsWith('.m3u8')) {
        subPlaylistItems[item.name] = item;
      } else if (lowerName.endsWith('.ts')) {
        const baseName = item.name.replace(/\.ts$/i, '');
        segmentUrlMap[item.name] = downloadUrl;
        segmentUrlMap[`${baseName}.ts`] = downloadUrl;
        segmentUrlMap[baseName] = downloadUrl;
      }
    }

    // ABR Multi-Quality Mode with master.m3u8
    if (masterPlaylistItem && masterPlaylistItem.downloadUrl) {
      const subPlaylistBlobUrlMap = {};
      const subPlaylistEntries = Object.entries(subPlaylistItems);

      await Promise.all(
        subPlaylistEntries.map(async ([fileName, item]) => {
          try {
            const blobUrl = await rewriteSubPlaylistToBlobUrl(item.downloadUrl, segmentUrlMap);
            createdBlobUrls.push(blobUrl);
            subPlaylistBlobUrlMap[fileName] = blobUrl;
          } catch (err) {
            console.warn(`[HLS Resolver] ข้าม playlist "${fileName}":`, err);
          }
        })
      );

      const masterRes = await fetch(masterPlaylistItem.downloadUrl);
      if (!masterRes.ok) throw new Error('ดาวน์โหลด master.m3u8 ไม่สำเร็จ');
      const masterText = await masterRes.text();

      const rewrittenMaster = masterText
        .split('\n')
        .map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) return line;
          return subPlaylistBlobUrlMap[trimmed] || line;
        })
        .join('\n');

      const masterBlob = new Blob([rewrittenMaster], { type: 'application/vnd.apple.mpegurl' });
      const masterBlobUrl = URL.createObjectURL(masterBlob);
      createdBlobUrls.push(masterBlobUrl);

      return {
        type: 'hls',
        url: masterBlobUrl,
        blobUrls: createdBlobUrls,
        storyboard,
      };
    }

    // Fallback: Single playlist .m3u8
    const singlePlaylist = Object.values(subPlaylistItems)[0];
    if (!singlePlaylist || !singlePlaylist.downloadUrl) {
      throw new Error('ไม่พบไฟล์ playlist (.m3u8) ในชุดสตรีม HLS');
    }

    const singleBlobUrl = await rewriteSubPlaylistToBlobUrl(singlePlaylist.downloadUrl, segmentUrlMap);
    createdBlobUrls.push(singleBlobUrl);

    return {
      type: 'hls',
      url: singleBlobUrl,
      blobUrls: createdBlobUrls,
      storyboard,
    };
  }

  throw new Error('รูปแบบของแหล่งวิดีโอไม่ถูกต้อง');
}

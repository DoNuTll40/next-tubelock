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

export async function resolveClientPlaybackSource(sourceData) {
  if (!sourceData) throw new Error('ไม่พบข้อมูล Source');

  // Case 1: Standalone MP4 / Direct stream
  if (sourceData.type === 'mp4' || sourceData.url) {
    return {
      type: 'mp4',
      url: sourceData.url,
      blobUrls: [],
    };
  }

  // Case 2: HLS Stream from OneDrive items
  if (sourceData.type === 'hls' && Array.isArray(sourceData.items)) {
    const items = sourceData.items;
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
    };
  }

  throw new Error('รูปแบบของแหล่งวิดีโอไม่ถูกต้อง');
}

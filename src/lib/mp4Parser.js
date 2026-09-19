/**
 * Parse MP4 boxes to extract exact video FPS and codec
 */
export async function parseMp4Metadata(file) {
  try {
    // Read first 8MB
    const headSize = Math.min(file.size, 8 * 1024 * 1024);
    const headBuffer = await file.slice(0, headSize).arrayBuffer();
    let res = parseMoovFromBuffer(new DataView(headBuffer));
    if (res && res.fps) return res;

    // If moov was not in first 8MB, check last 8MB
    if (file.size > 8 * 1024 * 1024) {
      const tailSize = Math.min(file.size, 8 * 1024 * 1024);
      const tailBuffer = await file.slice(file.size - tailSize, file.size).arrayBuffer();
      res = parseMoovFromBuffer(new DataView(tailBuffer));
      if (res && res.fps) return res;
    }
  } catch (err) {
    console.warn('MP4 parse error:', err);
  }
  return null;
}

function parseMoovFromBuffer(view) {
  let offset = 0;
  const len = view.byteLength;

  function findBox(start, end, targetType) {
    let p = start;
    while (p + 8 <= end) {
      let size = view.getUint32(p);
      const type = String.fromCharCode(
        view.getUint8(p + 4),
        view.getUint8(p + 5),
        view.getUint8(p + 6),
        view.getUint8(p + 7)
      );

      if (size === 1 && p + 16 <= end) {
        // 64-bit size
        size = Number(view.getBigUint64(p + 8));
        if (type === targetType) return { start: p + 16, end: p + size, size };
        p += size;
      } else if (size === 0) {
        // Till end of buffer
        if (type === targetType) return { start: p + 8, end, size: end - p };
        break;
      } else if (size >= 8) {
        if (type === targetType) return { start: p + 8, end: Math.min(p + size, end), size };
        p += size;
      } else {
        break;
      }
    }
    return null;
  }

  // Find moov
  const moov = findBox(0, len, 'moov');
  if (!moov) return null;

  // Search trak boxes inside moov
  let trakPos = moov.start;
  while (trakPos < moov.end) {
    const trak = findBox(trakPos, moov.end, 'trak');
    if (!trak) break;

    // Check if this trak is video
    const mdia = findBox(trak.start, trak.end, 'mdia');
    if (mdia) {
      const hdlr = findBox(mdia.start, mdia.end, 'hdlr');
      let isVideo = false;
      if (hdlr && hdlr.start + 12 <= hdlr.end) {
        const handlerType = String.fromCharCode(
          view.getUint8(hdlr.start + 8),
          view.getUint8(hdlr.start + 9),
          view.getUint8(hdlr.start + 10),
          view.getUint8(hdlr.start + 11)
        );
        if (handlerType === 'vide') isVideo = true;
      }

      if (isVideo) {
        // Read mdhd for timescale and duration
        const mdhd = findBox(mdia.start, mdia.end, 'mdhd');
        let timescale = 0;
        let duration = 0;
        if (mdhd) {
          const version = view.getUint8(mdhd.start);
          if (version === 0 && mdhd.start + 24 <= mdhd.end) {
            timescale = view.getUint32(mdhd.start + 12);
            duration = view.getUint32(mdhd.start + 16);
          } else if (version === 1 && mdhd.start + 32 <= mdhd.end) {
            timescale = view.getUint32(mdhd.start + 20);
            duration = Number(view.getBigUint64(mdhd.start + 24));
          }
        }

        // Read minf -> stbl for sample_count
        const minf = findBox(mdia.start, mdia.end, 'minf');
        if (minf) {
          const stbl = findBox(minf.start, minf.end, 'stbl');
          if (stbl) {
            let sampleCount = 0;
            const stsz = findBox(stbl.start, stbl.end, 'stsz');
            if (stsz && stsz.start + 12 <= stsz.end) {
              sampleCount = view.getUint32(stsz.start + 8);
            } else {
              const stts = findBox(stbl.start, stbl.end, 'stts');
              if (stts && stts.start + 8 <= stts.end) {
                const entryCount = view.getUint32(stts.start + 4);
                let ep = stts.start + 8;
                for (let i = 0; i < entryCount && ep + 8 <= stts.end; i++) {
                  sampleCount += view.getUint32(ep);
                  ep += 8;
                }
              }
            }

            if (timescale > 0 && duration > 0 && sampleCount > 0) {
              const durSec = duration / timescale;
              const rawFps = sampleCount / durSec;
              const roundedFps = Math.round(rawFps);
              // Handle common NTSC rates (e.g. 59.94 -> 60, 29.97 -> 30, 23.976 -> 24)
              return {
                fps: roundedFps,
                rawFps,
                durationSec: durSec,
                sampleCount,
              };
            }
          }
        }
      }
    }
    trakPos = trak.end;
  }

  return null;
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * AmbientLight.jsx (Zero-Clipping True Gaussian Halo)
 * - แก้ปัญหาขอบคมทั้ง 4 ด้าน 100% ด้วยการวาง Canvas ไว้เฉพาะพื้นที่กึ่งกลาง แล้วปล่อยให้รัศมี Blur ฟุ้งสลายไปในพื้นที่ว่างรอบๆ เองตามธรรมชาติ
 * - ถอด maskImage ออกทั้งหมด เพื่อไม่ให้เบราว์เซอร์สร้างกรอบสี่เหลี่ยมมาตัดขอบแสงเวลาใช้คู่กับ filter: blur()
 */
export default function AmbientLight({
  videoRef,
  storyboard = null,
  poster = null,
  enabled = true,
  variant = 'halo',
  preferStoryboardOnly = false,
  className = '',
}) {
  const isEnabled = Boolean(enabled);
  const [hasStarted, setHasStarted] = useState(false);
  const [activeLayer, setActiveLayer] = useState(0);

  const canvasRef0 = useRef(null);
  const canvasRef1 = useRef(null);
  const activeLayerRef = useRef(0);
  const lastKeyRef = useRef('');
  const imageCacheRef = useRef(new Map());
  const canUseDirectVideoRef = useRef(true);
  const corsCheckedRef = useRef(false);

  const resolveTile = useCallback((sec, effectivePoster) => {
    const safeSec = Math.max(0, sec || 0);
    const cues = storyboard?.cuesSD || storyboard?.cues || [];
    const spriteMap = storyboard?.spriteMap || {};

    // 1. WebVTT Cues
    if (cues.length > 0) {
      let cue = cues.find((c) => safeSec >= c.start && safeSec < c.end);
      if (!cue) {
        const interval = storyboard?.interval || 5;
        const estIdx = Math.min(cues.length - 1, Math.max(0, Math.floor(safeSec / interval)));
        cue = cues[estIdx] || cues[0];
      }

      if (cue && cue.url) {
        const cols = cue.cols || 10;
        const rows = cue.rows || 10;
        const col = cue.col ?? 0;
        const row = cue.row ?? 0;
        return {
          key: `${cue.url}_${col}_${row}`,
          url: cue.url,
          col,
          row,
          cols,
          rows,
          isSprite: true,
        };
      }
    }

    // 2. Sprite Map 10x10 Fallback
    if (Object.keys(spriteMap).length > 0) {
      const INTERVAL = storyboard?.interval || 5;
      const frameIndex = Math.floor(safeSec / INTERVAL);
      const sheetIndex = Math.floor(frameIndex / 100) + 1;
      const indexInSheet = frameIndex % 100;
      const col = indexInSheet % 10;
      const row = Math.floor(indexInSheet / 10);

      const sheetPadded = String(sheetIndex).padStart(3, '0');
      const resolvedUrl =
        spriteMap[`sprite_sd_${sheetPadded}.jpg`] ||
        spriteMap[`sprite_${sheetPadded}.jpg`] ||
        spriteMap[`sprite_hd_${sheetPadded}.jpg`];

      if (resolvedUrl) {
        return {
          key: `${resolvedUrl}_${col}_${row}`,
          url: resolvedUrl,
          col,
          row,
          cols: 10,
          rows: 10,
          isSprite: true,
        };
      }
    }

    // 3. Poster Thumbnail
    if (effectivePoster) {
      return {
        key: `poster_${effectivePoster}`,
        url: effectivePoster,
        isSprite: false,
      };
    }

    return null;
  }, [storyboard]);

  const loadImage = (url) => {
    if (imageCacheRef.current.has(url)) {
      return Promise.resolve(imageCacheRef.current.get(url));
    }
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        imageCacheRef.current.set(url, img);
        resolve(img);
      };
      img.onerror = () => {
        const fallbackImg = new Image();
        fallbackImg.onload = () => {
          imageCacheRef.current.set(url, fallbackImg);
          resolve(fallbackImg);
        };
        fallbackImg.onerror = reject;
        fallbackImg.src = url;
      };
      img.src = url;
    });
  };

  const drawToNextCanvas = (drawCallback) => {
    const nextIdx = activeLayerRef.current === 0 ? 1 : 0;
    const canvas = nextIdx === 0 ? canvasRef0.current : canvasRef1.current;
    if (!canvas) return false;

    const ctx = canvas.getContext('2d');
    if (!ctx) return false;

    try {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawCallback(ctx, canvas.width, canvas.height);
      activeLayerRef.current = nextIdx;
      setActiveLayer(nextIdx);
      return true;
    } catch (err) {
      return false;
    }
  };

  useEffect(() => {
    if (!isEnabled) return;

    const updateAmbient = async (forceInitial = false) => {
      if (typeof document !== 'undefined' && document.hidden) return;

      const video = videoRef?.current;
      if (!video) return;

      const isPlaying = !video.paused && !video.ended && video.readyState >= 2;
      if (isPlaying || video.currentTime > 0.3) {
        setHasStarted(true);
      }

      // Skip periodic timer redraws when video is paused & already drawn at least once
      if (!forceInitial && lastKeyRef.current && (video.paused || video.ended)) {
        return;
      }

      // 1. ดึงจาก <video> โดยตรงเฉพาะคลิปความละเอียดต่ำกว่า 1080p และไม่ใช่ HDR
      //    สำหรับ 1080p / 2K / 4K / HDR ให้ข้ามไปใช้ Storyboard/Poster แทนเพื่อป้องกัน GPU Readback stall (drop frames)
      //    และรักษา Hardware HDR Overlay บน Windows DX11 / Android SurfaceFlinger ให้ทำงานเต็มประสิทธิภาพ
      const hasStoryboardOrPoster = Boolean(
        (storyboard?.cuesSD && storyboard.cuesSD.length > 0) ||
        (storyboard?.cues && storyboard.cues.length > 0) ||
        (storyboard?.spriteMap && Object.keys(storyboard.spriteMap).length > 0) ||
        poster
      );
      const avoidVideoReadback =
        preferStoryboardOnly ||
        (hasStoryboardOrPoster && (video.videoWidth >= 1920 || video.videoHeight >= 1080));

      if (!avoidVideoReadback && canUseDirectVideoRef.current && video.readyState >= 2 && video.videoWidth > 0) {
        const timeBucket = Math.floor(video.currentTime * 1.2);
        const videoKey = `video_frame_${timeBucket}`;
        if (lastKeyRef.current !== videoKey) {
          const needsCorsCheck = !corsCheckedRef.current;
          const ok = drawToNextCanvas((ctx, w, h) => {
            ctx.drawImage(video, 0, 0, w, h);
            if (needsCorsCheck) {
              ctx.getImageData(0, 0, 1, 1);
            }
          });
          if (ok) {
            corsCheckedRef.current = true;
            lastKeyRef.current = videoKey;
            return;
          } else {
            canUseDirectVideoRef.current = false;
          }
        } else {
          return;
        }
      }

      // 2. ดึงจาก Storyboard / Poster
      const sec = video.currentTime || 0;
      const tile = resolveTile(sec, poster);
      if (!tile || tile.key === lastKeyRef.current) return;

      try {
        const img = await loadImage(tile.url);
        const ok = drawToNextCanvas((ctx, w, h) => {
          if (tile.isSprite) {
            const tileW = img.naturalWidth / tile.cols;
            const tileH = img.naturalHeight / tile.rows;
            const sx = tile.col * tileW;
            const sy = tile.row * tileH;
            const insetX = tileW * 0.03;
            const insetY = tileH * 0.03;
            ctx.drawImage(
              img,
              sx + insetX,
              sy + insetY,
              tileW - insetX * 2,
              tileH - insetY * 2,
              0,
              0,
              w,
              h
            );
          } else {
            ctx.drawImage(img, 0, 0, w, h);
          }
        });

        if (ok) {
          lastKeyRef.current = tile.key;
        }
      } catch (e) {
        // ข้ามหากโหลดรูปไม่สำเร็จ
      }
    };

    updateAmbient(true);
    const timer = setInterval(() => updateAmbient(false), 1500);
    const onVisibilityChange = () => {
      if (!document.hidden) updateAmbient(true);
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const video = videoRef?.current;
    if (video) {
      const onPlayOrSeek = () => {
        setHasStarted(true);
        updateAmbient(true);
      };
      const onLoaded = () => updateAmbient(true);
      video.addEventListener('playing', onPlayOrSeek, { passive: true });
      video.addEventListener('seeked', onPlayOrSeek, { passive: true });
      video.addEventListener('loadeddata', onLoaded, { passive: true });

      return () => {
        clearInterval(timer);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        video.removeEventListener('playing', onPlayOrSeek);
        video.removeEventListener('seeked', onPlayOrSeek);
        video.removeEventListener('loadeddata', onLoaded);
      };
    }

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [isEnabled, videoRef, storyboard, resolveTile, poster, preferStoryboardOnly]);

  if (!isEnabled) return null;

  const isBackdrop = variant === 'backdrop';

  // ปรับขนาดความกว้างและความฟุ้งของแสงตรงนี้ได้เลย!
  const canvasLayerStyle = (isActive) =>
    isBackdrop
      ? {
          filter: 'blur(48px) saturate(1.9) brightness(0.75)',
          transform: 'scale(1.18) translateZ(0)',
          opacity: isActive ? 0.65 : 0,
        }
      : {
          // 1. เพิ่ม blur เป็น 80px ให้แสงกระจายตัวออกไปไกลขึ้นและขอบนุ่มละมุน
          // 2. ปรับ saturate(2.2) ให้สีสดชัดขึ้นเวลาแผ่ออกไปไกลๆ
          filter: 'blur(80px) saturate(2.2) brightness(1)',

          // 3. ขยายขนาดแสง: (กว้างซ้าย-ขวา 1.2 เท่า, พลิกแกน Y ให้สีขอบล่างวิดีโอฟุ้งลงด้านล่าง)
          transform: 'scale(1.2, -1) translateZ(0)',

          // 4. ความเข้มของแสง (0.60 - 0.70 กำลังสวยแบบโรงหนัง)
          opacity: isActive ? 0.65 : 0,
        };

  const canvasClassName = isBackdrop
    ? 'absolute inset-0 h-full w-full transition-opacity duration-[1800ms] ease-in-out will-change-[opacity]'
    : 'absolute inset-2 h-[calc(100%-16px)] w-[calc(100%-16px)] rounded-3xl transition-opacity duration-[1800ms] ease-in-out will-change-[opacity]';

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 z-0 select-none ${isBackdrop ? 'overflow-hidden' : 'overflow-visible'} transition-opacity duration-[2200ms] ease-out ${hasStarted ? 'opacity-100' : 'opacity-0'
        } ${className}`}
    >
      {/* Layer 0 */}
      <canvas
        ref={canvasRef0}
        width={48}
        height={27}
        className={canvasClassName}
        style={canvasLayerStyle(activeLayer === 0)}
      />

      {/* Layer 1 */}
      <canvas
        ref={canvasRef1}
        width={48}
        height={27}
        className={canvasClassName}
        style={canvasLayerStyle(activeLayer === 1)}
      />
    </div>
  );
}
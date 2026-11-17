'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Play, Loader2, X, AlertCircle } from 'lucide-react';
import MiniVideoPlayer from '@/components/MiniVideoPlayer';
import {
  fetchVideoSourceClient,
  resolveClientPlaybackSource,
} from '@/lib/playbackResolver';

function formatClock(sec = 0) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}

/**
 * Compact YouTube Studio-style preview player in the right sidebar of /videos/[id]/edit.
 */
export default function StudioMiniPlayer({
  videoId,
  posterUrl = '',
  title = '',
  duration = 0,
  status = 'READY',
  subtitleTracks = [],
}) {
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [streamUrl, setStreamUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const blobUrlsRef = useRef([]);

  const cleanupBlobUrls = () => {
    for (const u of blobUrlsRef.current) {
      try {
        URL.revokeObjectURL(u);
      } catch (_) {}
    }
    blobUrlsRef.current = [];
  };

  useEffect(() => {
    return () => {
      cleanupBlobUrls();
    };
  }, [videoId]);

  const handleStopPreview = () => {
    cleanupBlobUrls();
    setStreamUrl('');
    setIsPreviewing(false);
    setIsLoading(false);
    setPreviewError('');
  };

  const handleStartPreview = async () => {
    if (!videoId || status !== 'READY') return;
    cleanupBlobUrls();
    setPreviewError('');
    setIsLoading(true);
    setIsPreviewing(true);
    setStreamUrl('');

    try {
      let sourceData = await fetchVideoSourceClient(videoId, {
        forceFresh: true,
        showAdultPreviews: true,
      });
      let resolved;
      try {
        resolved = await resolveClientPlaybackSource(sourceData);
      } catch (_) {
        sourceData = await fetchVideoSourceClient(videoId, {
          forceFresh: true,
          showAdultPreviews: true,
        });
        resolved = await resolveClientPlaybackSource(sourceData);
      }

      if (Array.isArray(resolved.blobUrls) && resolved.blobUrls.length > 0) {
        blobUrlsRef.current = resolved.blobUrls;
      }

      setStreamUrl(resolved.url);
    } catch (err) {
      setPreviewError(err.message || 'โหลดตัวอย่างวิดีโอไม่สำเร็จ');
    } finally {
      setIsLoading(false);
    }
  };

  const liveVideoRecord = useMemo(
    () => ({
      id: videoId,
      title,
      subtitle_tracks: Array.isArray(subtitleTracks) ? subtitleTracks : [],
    }),
    [videoId, title, subtitleTracks]
  );

  const canPlay = status === 'READY';

  return (
    <div className="group/miniwrap relative aspect-video w-full bg-[#121212] rounded-t-2xl overflow-hidden border-b border-[#EFECE6] dark:border-white/10">
      {isPreviewing ? (
        <>
          {streamUrl ? (
            <MiniVideoPlayer
              src={streamUrl}
              poster={posterUrl || undefined}
              title={title}
              defaultAutoplay={true}
              currentVideo={liveVideoRecord}
            />
          ) : (
            <div className="w-full h-full bg-black" />
          )}

          <button
            type="button"
            onClick={handleStopPreview}
            title="ปิดตัวอย่างวิดีโอ"
            className="absolute top-2 right-2 z-40 w-6 h-6 rounded-full bg-black/60 hover:bg-black/90 text-white/90 hover:text-white flex items-center justify-center backdrop-blur-xs border border-white/15 opacity-0 group-hover/miniwrap:opacity-100 focus-visible:opacity-100 cursor-pointer transition-opacity"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          {isLoading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/65">
              <Loader2 className="w-7 h-7 animate-spin text-[#FF7A00]" />
            </div>
          )}

          {previewError && (
            <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2 bg-black/85 px-4 text-center text-xs text-rose-300">
              <AlertCircle className="w-5 h-5 text-rose-400" />
              <span>{previewError}</span>
            </div>
          )}
        </>
      ) : (
        <>
          {posterUrl ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={posterUrl}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover blur-md scale-110 opacity-45 pointer-events-none select-none"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={posterUrl}
                alt={title || 'Video cover'}
                className="relative z-10 w-full h-full object-contain"
              />
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center text-zinc-500 text-xs">
              ไม่มีภาพปก
            </div>
          )}

          {duration > 0 && (
            <span className="absolute bottom-2.5 right-2.5 z-20 px-1.5 py-0.5 rounded bg-black/80 text-white text-[11px] font-mono font-semibold">
              {formatClock(duration)}
            </span>
          )}

          {canPlay ? (
            <button
              type="button"
              onClick={handleStartPreview}
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 hover:bg-black/40 transition group cursor-pointer"
              title="เล่นตัวอย่างวิดีโอ"
            >
              <span className="w-11 h-11 rounded-full bg-black/75 group-hover:bg-[#FF7A00] text-white flex items-center justify-center shadow-lg border border-white/20 transition transform group-hover:scale-105">
                <Play className="w-4.5 h-4.5 fill-current ml-0.5" />
              </span>
            </button>
          ) : (
            <div className="absolute top-2.5 left-2.5 z-20 px-2.5 py-1 rounded-lg bg-amber-500/90 text-white text-[11px] font-bold">
              สถานะ: {status}
            </div>
          )}
        </>
      )}
    </div>
  );
}

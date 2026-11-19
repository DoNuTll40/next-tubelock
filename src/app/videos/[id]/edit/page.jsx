'use client';

import { Suspense, useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Pencil,
  Captions,
  Cpu,
  Save,
  RotateCcw,
  MoreVertical,
  ExternalLink,
  Copy,
  Check,
  Trash2,
  Loader2,
  LockKeyhole,
  AlertTriangle,
  CheckCircle2,
  Film,
  ShieldAlert,
  ListOrdered,
  Layers,
} from 'lucide-react';
import StudioMiniPlayer from '@/components/studio/StudioMiniPlayer';
import StudioDetailsTab from '@/components/studio/StudioDetailsTab';
import StudioSubtitlesTab from '@/components/studio/StudioSubtitlesTab';
import StudioTechTab from '@/components/studio/StudioTechTab';
import StudioVersionsTab from '@/components/studio/StudioVersionsTab';
import DeleteVideoModal from '@/components/DeleteVideoModal';
import { requestPlaylistJson } from '@/components/playlist/PlaylistPicker';
import { invalidateClientVideoCache } from '@/lib/playbackResolver';
import { isRatingEvaluated } from '@/lib/ratingStatus';
import {
  encodeVideoSlug,
  encodeUploadId,
  formatResolutionBadge,
} from '@/lib/videoUtils';
import {
  normalizeSubtitleTracks,
  formatVideoDuration,
  formatFileSize,
  CONTENT_RATINGS,
} from '@/lib/videoEditorUtils';
import { normalizeVideoLanguageCode } from '@/lib/videoLanguages';

function parseTagsField(rawTags) {
  if (Array.isArray(rawTags)) {
    return rawTags.map((t) => String(t).trim()).filter(Boolean).slice(0, 15);
  }
  return String(rawTags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 15);
}

function buildFormSnapshot(video) {
  return {
    title: video.title || '',
    description: video.description || '',
    sourceLanguage: normalizeVideoLanguageCode(video.sourceLanguage || ''),
    category: video.category || 'general',
    tags: parseTagsField(video.tags),
    thumbnailUrl: video.thumbnailUrl || '',
    contentRating: video.contentRating || 'all',
    subtitleTracks: normalizeSubtitleTracks(
      video.subtitleTracks,
      video.subtitleSrt || '',
      video.subtitleVtt || ''
    ),
  };
}

function serializeTracksForDiff(tracks = []) {
  return JSON.stringify(
    tracks.map((t) => ({
      id: t.id || '',
      label: t.label || '',
      lang: t.lang || '',
      srt: (t.srt || '').trim(),
    }))
  );
}

function areSnapshotsEqual(a, b) {
  if (!a || !b) return true;
  if (a.title !== b.title) return false;
  if (a.description !== b.description) return false;
  if (a.sourceLanguage !== b.sourceLanguage) return false;
  if (a.category !== b.category) return false;
  if (a.thumbnailUrl !== b.thumbnailUrl) return false;
  if (a.contentRating !== b.contentRating) return false;
  if (JSON.stringify(a.tags) !== JSON.stringify(b.tags)) return false;
  if (serializeTracksForDiff(a.subtitleTracks) !== serializeTracksForDiff(b.subtitleTracks)) {
    return false;
  }
  return true;
}

function arePlaylistIdsEqual(selectedIds, savedIds) {
  const selected = new Set(selectedIds);
  return selected.size === savedIds.length && savedIds.every((id) => selected.has(id));
}

const VALID_TABS = new Set(['details', 'subtitles', 'versions', 'tech']);

function StudioEditorInner() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawId = Array.isArray(params?.id) ? params.id[0] : params?.id;

  const initialTabParam = searchParams?.get('tab') || '';
  const [tabState, setTabState] = useState({
    value: VALID_TABS.has(initialTabParam) ? initialTabParam : 'details',
    forParam: initialTabParam,
  });

  const qTab = searchParams?.get('tab') || '';
  const activeTab =
    qTab && VALID_TABS.has(qTab) && qTab !== tabState.forParam
      ? qTab
      : tabState.value;

  const [video, setVideo] = useState(null);
  const videoId = video?.id;
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState({ status: 0, message: '' });

  // Editable form fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [sourceLanguage, setSourceLanguage] = useState('');
  const [category, setCategory] = useState('general');
  const [tags, setTags] = useState([]);
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [contentRating, setContentRating] = useState('all');
  const [subtitleTracks, setSubtitleTracks] = useState([]);
  const [playlistState, setPlaylistState] = useState(null);
  const playlistDraft = playlistState?.videoId === videoId ? playlistState : null;
  const loadPlaylistsForVideo = activeTab === 'details' && !playlistDraft ? videoId : null;

  // Saved baseline snapshot for dirty-check & reset
  const [savedSnapshot, setSavedSnapshot] = useState(null);

  // Save / Menu / Action feedback states
  const [isSaving, setIsSaving] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState({ type: '', text: '' });
  const [showHeaderMenu, setShowHeaderMenu] = useState(false);
  const headerMenuRef = useRef(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Workflow dispatch states
  const [isDispatchingThumbs, setIsDispatchingThumbs] = useState(false);
  const [isDispatchingRating, setIsDispatchingRating] = useState(false);
  const [isRetranscoding, setIsRetranscoding] = useState(false);

  // Delete modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const statusRevisionsRef = useRef({});

  // Initial load from GET /api/videos/[id]/status
  useEffect(() => {
    if (!rawId) return;
    let cancelled = false;

    async function fetchStudioVideo() {
      try {
        const res = await fetch(`/api/videos/${encodeURIComponent(rawId)}/status`, {
          cache: 'no-store',
        });
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;

        if (!res.ok || !data?.video) {
          setLoadError({
            status: res.status,
            message:
              data?.error ||
              (res.status === 401
                ? 'กรุณาเข้าสู่ระบบเพื่อแก้ไขวิดีโอ'
                : res.status === 403
                  ? 'คุณไม่มีสิทธิ์แก้ไขวิดีโอนี้ (เฉพาะเจ้าของวิดีโอหรือผู้ดูแลระบบ)'
                  : 'ไม่พบข้อมูลวิดีโอ'),
          });
          setLoading(false);
          return;
        }

        statusRevisionsRef.current = data.revisions || {};
        const v = data.video;
        const snap = buildFormSnapshot(v);
        setVideo(v);
        setVersions(
          Array.isArray(data.versions)
            ? data.versions
            : Array.isArray(v?.versions)
              ? v.versions
              : []
        );
        setTitle(snap.title);
        setDescription(snap.description);
        setSourceLanguage(snap.sourceLanguage);
        setCategory(snap.category);
        setTags(snap.tags);
        setThumbnailUrl(snap.thumbnailUrl);
        setContentRating(snap.contentRating);
        setSubtitleTracks(snap.subtitleTracks);
        setSavedSnapshot(snap);
        setLoadError({ status: 0, message: '' });
      } catch (err) {
        if (!cancelled) {
          setLoadError({ status: 500, message: err.message || 'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้' });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchStudioVideo();
    return () => {
      cancelled = true;
    };
  }, [rawId]);

  useEffect(() => {
    if (!loadPlaylistsForVideo) return;
    const controller = new AbortController();
    const { signal } = controller;
    const fallback = 'โหลดเพลย์ลิสต์ของวิดีโอไม่สำเร็จ';

    queueMicrotask(async () => {
      if (signal.aborted) return;
      try {
        const data = await requestPlaylistJson(`/api/videos/${loadPlaylistsForVideo}/playlists`, { signal }, fallback);
        if (!data.authenticated) throw new Error('กรุณาเข้าสู่ระบบเพื่อแก้ไขเพลย์ลิสต์');
        if (!Array.isArray(data.normalPlaylistIds)) throw new Error(fallback);
        if (!signal.aborted) {
          const ids = data.normalPlaylistIds;
          setPlaylistState({ videoId: loadPlaylistsForVideo, savedIds: ids, selectedIds: ids });
        }
      } catch (error) {
        if (!signal.aborted) setPlaylistState({ videoId: loadPlaylistsForVideo, error: error.message });
      }
    });
    return () => controller.abort();
  }, [loadPlaylistsForVideo]);

  // Close top "..." menu on outside click / Escape
  useEffect(() => {
    if (!showHeaderMenu) return;
    const onOutside = (e) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target)) {
        setShowHeaderMenu(false);
      }
    };
    const onEsc = (e) => {
      if (e.key === 'Escape') setShowHeaderMenu(false);
    };
    document.addEventListener('mousedown', onOutside);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onOutside);
      document.removeEventListener('keydown', onEsc);
    };
  }, [showHeaderMenu]);

  const currentSnapshot = useMemo(
    () => ({
      title,
      description,
      sourceLanguage,
      category,
      tags,
      thumbnailUrl,
      contentRating,
      subtitleTracks,
    }),
    [title, description, sourceLanguage, category, tags, thumbnailUrl, contentRating, subtitleTracks]
  );

  const isMetadataDirty = useMemo(
    () => Boolean(savedSnapshot && !areSnapshotsEqual(currentSnapshot, savedSnapshot)),
    [currentSnapshot, savedSnapshot]
  );
  const isPlaylistDirty = Boolean(
    playlistDraft?.savedIds && !arePlaylistIdsEqual(playlistDraft.selectedIds, playlistDraft.savedIds)
  );
  const isDirty = isMetadataDirty || isPlaylistDirty;

  // Warn browser before closing tab with unsaved changes
  useEffect(() => {
    if (!isDirty) return;
    const handleBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  // Keep refs of dirty fields so background status polling won't overwrite active edits
  const dirtyFlagsRef = useRef({
    thumbnail: false,
    rating: false,
    subtitles: false,
  });

  useEffect(() => {
    if (!savedSnapshot) return;
    dirtyFlagsRef.current = {
      thumbnail: thumbnailUrl !== savedSnapshot.thumbnailUrl,
      rating: contentRating !== savedSnapshot.contentRating,
      subtitles:
        serializeTracksForDiff(subtitleTracks) !==
        serializeTracksForDiff(savedSnapshot.subtitleTracks),
    };
  }, [thumbnailUrl, contentRating, subtitleTracks, savedSnapshot]);

  // Background polling while AI workflows or HLS transcoding are active
  const hasActiveWorker = Boolean(
    video &&
    (video.thumbnailStatus === 'generating' ||
      video.thumbnailStatus === 'extracting' ||
      video.ratingCheckStatus === 'analyzing' ||
      video.ratingCheckStatus === 'checking' ||
      video.spriteStatus === 'generating' ||
      video.subtitleStatus === 'processing' ||
      video.subtitleStatus === 'extracting' ||
      video.audioStatus === 'extracting' ||
      video.status === 'TRANSCODING' ||
      video.status === 'PROCESSING' ||
      video.status === 'QUEUED')
  );

  useEffect(() => {
    if (!video?.id || !hasActiveWorker) return;
    let cancelled = false;
    let pending = false;
    let lastSubtitleSync = 0;

    const pollOnce = async () => {
      if (cancelled || pending || (typeof document !== 'undefined' && document.hidden)) return;
      pending = true;
      try {
        const rev = statusRevisionsRef.current || {};
        const params = new URLSearchParams();
        if (Date.now() - lastSubtitleSync >= 15000) {
          params.set('syncSubtitles', '1');
          lastSubtitleSync = Date.now();
        }
        if (rev.subtitles) params.set('subtitlesRevision', rev.subtitles);
        if (rev.logs) params.set('logsRevision', rev.logs);
        if (rev.meta) params.set('metaRevision', rev.meta);
        const query = params.toString();
        const res = await fetch(
          `/api/videos/${video.id}/status${query ? `?${query}` : ''}`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        const latest = data?.video;
        if (cancelled || !latest) return;

        if (data?.revisions) {
          statusRevisionsRef.current = data.revisions;
        }

        setVideo((prev) => ({ ...(prev || {}), ...latest }));

        if (latest.thumbnailStatus !== 'generating' && latest.thumbnailStatus !== 'extracting') {
          setIsDispatchingThumbs(false);
        }
        if (latest.ratingCheckStatus !== 'analyzing' && latest.ratingCheckStatus !== 'checking') {
          setIsDispatchingRating(false);
        }
        if (latest.status !== 'TRANSCODING' && latest.status !== 'PROCESSING' && latest.status !== 'QUEUED') {
          setIsRetranscoding(false);
        }

        // Safely sync newly produced worker assets only when payload arrived and user hasn't unsaved local edits
        const hasSubtitlePayload =
          Array.isArray(latest.subtitleTracks) ||
          typeof latest.subtitleSrt === 'string' ||
          typeof latest.subtitleVtt === 'string';
        const incomingTracks = hasSubtitlePayload
          ? normalizeSubtitleTracks(
            latest.subtitleTracks,
            latest.subtitleSrt || '',
            latest.subtitleVtt || ''
          )
          : null;

        setSavedSnapshot((prevSnap) => {
          if (!prevSnap) return prevSnap;
          return {
            ...prevSnap,
            thumbnailUrl: latest.thumbnailUrl || prevSnap.thumbnailUrl,
            contentRating: latest.contentRating || prevSnap.contentRating,
            subtitleTracks:
              incomingTracks && (incomingTracks.length > 0 || latest.subtitleStatus === 'done' || latest.subtitleStatus === 'ready')
                ? incomingTracks
                : prevSnap.subtitleTracks,
          };
        });

        if (!dirtyFlagsRef.current.thumbnail && latest.thumbnailUrl) {
          setThumbnailUrl(latest.thumbnailUrl);
        }
        if ((!dirtyFlagsRef.current.rating || isRatingEvaluated(latest.ratingCheckStatus)) && latest.contentRating) {
          setContentRating(latest.contentRating);
        }
        if (
          incomingTracks &&
          !dirtyFlagsRef.current.subtitles &&
          (incomingTracks.length > 0 || latest.subtitleStatus === 'done' || latest.subtitleStatus === 'ready')
        ) {
          setSubtitleTracks(incomingTracks);
        }

        invalidateClientVideoCache(video.id);
      } catch (_) {
      } finally {
        pending = false;
      }
    };

    const onVisibilityChange = () => {
      if (!document.hidden) void pollOnce();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const timer = setInterval(pollOnce, 4500);
    void pollOnce();

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      clearInterval(timer);
    };
  }, [video?.id, hasActiveWorker]);

  const handleSelectTab = (nextTab) => {
    setTabState({ value: nextTab, forParam: qTab });
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      if (nextTab === 'details') url.searchParams.delete('tab');
      else url.searchParams.set('tab', nextTab);
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  };

  const handleResetChanges = () => {
    if (!savedSnapshot || isSaving) return;
    setTitle(savedSnapshot.title);
    setDescription(savedSnapshot.description);
    setSourceLanguage(savedSnapshot.sourceLanguage);
    setCategory(savedSnapshot.category);
    setTags(savedSnapshot.tags);
    setThumbnailUrl(savedSnapshot.thumbnailUrl);
    setContentRating(savedSnapshot.contentRating);
    setSubtitleTracks(savedSnapshot.subtitleTracks);
    if (isPlaylistDirty) {
      setPlaylistState((draft) => ({ ...draft, selectedIds: draft.savedIds }));
    }
    const feedback = { type: 'info', text: 'ย้อนคืนค่าที่บันทึกล่าสุดแล้ว' };
    setSaveFeedback(feedback);
    setTimeout(() => setSaveFeedback((current) => current === feedback ? { type: '', text: '' } : current), 3000);
  };

  const saveVideoDetails = async (trimmedTitle) => {
    const normalizedTracks = normalizeSubtitleTracks(subtitleTracks);
    const response = await fetch(`/api/videos/${videoId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: trimmedTitle,
        description,
        sourceLanguage,
        category,
        tags,
        thumbnailUrl,
        thumbnailOptions: Array.isArray(video.thumbnailOptions) ? video.thumbnailOptions : [],
        ...(!isRatingEvaluated(video.ratingCheckStatus) && contentRating !== savedSnapshot?.contentRating && { contentRating }),
        subtitleTracks: normalizedTracks,
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
      throw new Error(data?.error || 'บันทึกรายละเอียดวิดีโอไม่สำเร็จ');
    }

    const savedV = data.video || {};
    const nextSnap = {
      title: savedV.title ?? trimmedTitle,
      description: savedV.description ?? description,
      sourceLanguage: normalizeVideoLanguageCode(savedV.sourceLanguage ?? sourceLanguage),
      category: savedV.category ?? category,
      tags: parseTagsField(savedV.tags ?? tags),
      thumbnailUrl: savedV.thumbnailUrl ?? thumbnailUrl,
      contentRating: savedV.contentRating ?? contentRating,
      subtitleTracks: normalizeSubtitleTracks(
        savedV.subtitleTracks ?? normalizedTracks,
        savedV.subtitleSrt || '',
        savedV.subtitleVtt || ''
      ),
    };

    setVideo((prev) => ({
      ...prev,
      ...savedV,
      title: nextSnap.title,
      description: nextSnap.description,
      sourceLanguage: nextSnap.sourceLanguage,
      category: nextSnap.category,
      tags: nextSnap.tags.join(', '),
      thumbnailUrl: nextSnap.thumbnailUrl,
      contentRating: nextSnap.contentRating,
      subtitleTracks: nextSnap.subtitleTracks,
      subtitleStatus: savedV.subtitleStatus ?? prev.subtitleStatus,
    }));
    setTitle((value) => value === title ? nextSnap.title : value);
    setDescription((value) => value === description ? nextSnap.description : value);
    setSourceLanguage((value) => value === sourceLanguage ? nextSnap.sourceLanguage : value);
    setCategory((value) => value === category ? nextSnap.category : value);
    setTags((value) => value === tags ? nextSnap.tags : value);
    setThumbnailUrl((value) => value === thumbnailUrl ? nextSnap.thumbnailUrl : value);
    setContentRating((value) => value === contentRating ? nextSnap.contentRating : value);
    setSubtitleTracks((value) => value === subtitleTracks ? nextSnap.subtitleTracks : value);
    setSavedSnapshot(nextSnap);

    invalidateClientVideoCache(videoId);
    if (video.slug) invalidateClientVideoCache(video.slug);
  };

  const saveVideoPlaylists = async (selectedIds) => {
    const fallback = 'บันทึกเพลย์ลิสต์ไม่สำเร็จ';
    const { playlistIds: savedIds } = await requestPlaylistJson(`/api/videos/${videoId}/playlists`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playlistIds: selectedIds }),
    }, fallback);
    if (!Array.isArray(savedIds)) throw new Error(fallback);

    setPlaylistState((draft) => draft?.videoId === videoId ? {
      videoId,
      savedIds,
      selectedIds: draft.selectedIds === selectedIds ? savedIds : draft.selectedIds,
    } : draft);
  };

  const handleSave = async () => {
    if (!videoId || isSaving || !isDirty) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setSaveFeedback({ type: 'error', text: 'กรุณาระบุชื่อวิดีโอก่อนบันทึก' });
      handleSelectTab('details');
      return;
    }

    setIsSaving(true);
    setSaveFeedback({ type: '', text: '' });

    const [detailsResult, playlistsResult] = await Promise.allSettled([
      isMetadataDirty && saveVideoDetails(trimmedTitle),
      isPlaylistDirty && saveVideoPlaylists(playlistDraft.selectedIds),
    ]);

    const detailsFailed = detailsResult.status === 'rejected';
    const playlistsFailed = playlistsResult.status === 'rejected';
    const failed = detailsFailed || playlistsFailed;
    const feedback = {
      type: failed ? 'error' : 'success',
      text: [
        isMetadataDirty && (detailsFailed ? detailsResult.reason?.message || 'บันทึกรายละเอียดวิดีโอไม่สำเร็จ' : 'บันทึกรายละเอียดวิดีโอแล้ว'),
        isPlaylistDirty && (playlistsFailed ? playlistsResult.reason?.message || 'บันทึกเพลย์ลิสต์ไม่สำเร็จ' : 'บันทึกเพลย์ลิสต์แล้ว'),
      ].filter(Boolean).join(' · '),
    };
    setSaveFeedback(feedback);
    if (!failed) {
      setTimeout(() => setSaveFeedback((current) => current === feedback ? { type: '', text: '' } : current), 4500);
    }
    setIsSaving(false);
  };

  const dispatchStudioWorkflow = async (payload, pendingSetter, optimisticallyUpdate) => {
    if (!video?.id) return;
    pendingSetter?.(true);
    setSaveFeedback({ type: '', text: '' });
    try {
      const res = await fetch('/api/upload/dispatch-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: video.id,
          rawFileName: video.rawFileName || '',
          ...payload,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'ไม่สามารถส่งคำสั่งไปยัง Worker ได้');
      }
      setVideo((prev) => ({ ...prev, ...optimisticallyUpdate }));
      setSaveFeedback({
        type: 'success',
        text: 'ส่งคำสั่งไปยัง GitHub Actions Worker แล้ว กำลังอัปเดตสถานะอัตโนมัติ...',
      });
    } catch (err) {
      pendingSetter?.(false);
      setSaveFeedback({ type: 'error', text: err.message || 'สั่งงาน Worker ไม่สำเร็จ' });
    }
  };

  const handleDispatchThumbnails = () =>
    dispatchStudioWorkflow({ workflowType: 'thumbnails' }, setIsDispatchingThumbs, {
      thumbnailStatus: 'extracting',
    });

  const handleDispatchSpriteRating = () =>
    dispatchStudioWorkflow(
      {
        workflowType: 'sprite_rating',
        userRating: contentRating,
        autoApply: true,
      },
      setIsDispatchingRating,
      { ratingCheckStatus: 'checking' }
    );

  const handleDispatchTranscode = () =>
    dispatchStudioWorkflow({ workflowType: 'transcode' }, setIsRetranscoding, {
      status: 'TRANSCODING',
      transcodeProgress: 5,
    });

  const handleConfirmDelete = async () => {
    if (!video || isDeleting) return;
    setIsDeleting(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/videos/${video.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'ลบวิดีโอไม่สำเร็จ');
      }
      invalidateClientVideoCache(video.id);
      if (video.slug) invalidateClientVideoCache(video.slug);
      setShowDeleteModal(false);
      router.push('/videos');
    } catch (err) {
      setDeleteError(err.message || 'ไม่สามารถลบวิดีโอได้');
    } finally {
      setIsDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[80vh] flex flex-col items-center justify-center gap-3 bg-[#FBF9F5] dark:bg-[#0F0F0F] text-[#6C655D] dark:text-[#9A9A9A]">
        <Loader2 className="w-8 h-8 animate-spin text-[#FF7A00]" />
        <span className="text-sm font-medium">กำลังโหลด TubeLock Studio Editor...</span>
      </div>
    );
  }

  if (loadError.message || !video) {
    return (
      <div className="min-h-[80vh] px-4 py-12 flex items-center justify-center bg-[#FBF9F5] dark:bg-[#0F0F0F]">
        <div className="max-w-md w-full rounded-3xl bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 p-8 text-center space-y-4 shadow-sm">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-500">
            {loadError.status === 401 || loadError.status === 403 ? (
              <LockKeyhole className="w-7 h-7" />
            ) : (
              <AlertTriangle className="w-7 h-7" />
            )}
          </div>
          <h1 className="text-lg font-bold text-[#212529] dark:text-[#F1F1F1]">
            {loadError.message || 'ไม่พบข้อมูลวิดีโอ'}
          </h1>
          <div className="flex items-center justify-center gap-2.5 pt-2">
            {loadError.status === 401 ? (
              <Link
                href={`/login?next=/videos/${rawId}/edit`}
                className="px-5 py-2.5 rounded-full bg-[#FF7A00] hover:bg-[#E66E00] text-white text-xs sm:text-sm font-semibold transition"
              >
                เข้าสู่ระบบ
              </Link>
            ) : (
              <Link
                href="/videos"
                className="px-5 py-2.5 rounded-full bg-[#FF7A00] hover:bg-[#E66E00] text-white text-xs sm:text-sm font-semibold transition"
              >
                กลับไปคลังวิดีโอ
              </Link>
            )}
            <Link
              href="/"
              className="px-5 py-2.5 rounded-full bg-[#F4F0E8] dark:bg-[#222222] text-[#212529] dark:text-[#F1F1F1] text-xs sm:text-sm font-semibold transition"
            >
              หน้าแรก
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const watchSlug = encodeVideoSlug(video.id, category || video.category) || String(video.id);
  const watchHref = `/watch/${watchSlug}`;
  const fullWatchUrl =
    typeof window !== 'undefined' ? `${window.location.origin}${watchHref}` : watchHref;

  const ratingInfo =
    CONTENT_RATINGS.find((r) => r.id === contentRating) || CONTENT_RATINGS[0];

  const handleCopyWatchUrl = async () => {
    try {
      await navigator.clipboard.writeText(fullWatchUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (_) { }
  };

  const tabHeading =
    activeTab === 'subtitles'
      ? 'คำบรรยายของวิดีโอ'
      : activeTab === 'versions'
        ? 'จัดการเวอร์ชันวิดีโอ (Multi-Version)'
        : activeTab === 'tech'
          ? 'ข้อมูลเทคนิคและคิวงาน'
          : 'รายละเอียดของวิดีโอ';

  return (
    <div className="min-h-screen bg-[#FBF9F5] dark:bg-[#0F0F0F] text-[#212529] dark:text-[#F1F1F1]">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-5 flex flex-col lg:flex-row gap-6 items-start">
        {/* Left YouTube Studio Navigation Column */}
        <aside className="w-full lg:w-64 shrink-0 lg:sticky lg:top-20 bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-4 shadow-xs space-y-4">
          <Link
            href="/videos"
            className="inline-flex items-center gap-2 text-xs font-semibold text-[#6C655D] dark:text-[#CCCCCC] hover:text-[#FF7A00] transition"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>เนื้อหาของช่อง</span>
          </Link>

          {/* Compact Thumbnail + Title Preview Card */}
          <div className="space-y-2.5">
            <div className="relative aspect-video rounded-xl overflow-hidden bg-[#111111] border border-[#EFECE6] dark:border-white/10">
              {thumbnailUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumbnailUrl}
                  alt={title || video.title || 'poster'}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-500">
                  <Film className="w-6 h-6 opacity-60" />
                </div>
              )}
              {Number(video.duration) > 0 && (
                <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] font-mono font-semibold">
                  {formatVideoDuration(video.duration)}
                </span>
              )}
            </div>
            <div className="space-y-0.5">
              <div className="text-[11px] font-semibold text-[#8C857B] dark:text-[#9A9A9A]">
                วิดีโอของคุณ
              </div>
              <div className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1] line-clamp-2 leading-snug">
                {title || video.title || video.rawFileName || `วิดีโอ #${video.id}`}
              </div>
            </div>
          </div>

          {/* Studio Editor Tabs */}
          <nav className="flex lg:flex-col gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            {[
              { id: 'details', label: 'รายละเอียด', icon: Pencil },
              {
                id: 'subtitles',
                label: 'คำบรรยาย',
                icon: Captions,
                badge: subtitleTracks.length > 0 ? String(subtitleTracks.length) : null,
              },
              {
                id: 'versions',
                label: 'เวอร์ชัน',
                icon: Layers,
                badge: versions.length > 0 ? String(versions.length) : null,
              },
              { id: 'tech', label: 'ข้อมูลเทคนิค & คิวงาน', icon: Cpu },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleSelectTab(tab.id)}
                  className={`flex items-center justify-between gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${isActive
                      ? 'bg-[#FF7A00]/12 text-[#FF7A00] border border-[#FF7A00]/30'
                      : 'text-[#6C655D] dark:text-[#CCCCCC] hover:bg-[#F4F0E8] dark:hover:bg-white/5 border border-transparent'
                    }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{tab.label}</span>
                  </span>
                  {tab.badge && (
                    <span
                      className={`px-1.5 py-0.2 rounded-md text-[10px] font-mono ${isActive
                          ? 'bg-[#FF7A00] text-white'
                          : 'bg-[#F4F0E8] dark:bg-[#242424] text-[#6C655D] dark:text-[#AAAAAA]'
                        }`}
                    >
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Secondary Utility Links */}
          <div className="hidden lg:flex flex-col gap-1.5 pt-3 border-t border-[#EFECE6] dark:border-white/10 text-xs">
            <Link
              href={watchHref}
              className="px-3 py-2 rounded-xl hover:bg-[#F4F0E8] dark:hover:bg-white/5 text-[#6C655D] dark:text-[#CCCCCC] flex items-center gap-2 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>ดูใน TubeLock</span>
            </Link>
          </div>
        </aside>

        {/* Main Studio Workspace */}
        <main className="flex-1 min-w-0 w-full space-y-5">
          {/* Sticky Studio Top Bar (YouTube Studio Screenshot 2 style) */}
          <header className="sticky top-14 z-20 bg-[#FBF9F5]/95 dark:bg-[#0F0F0F]/95 backdrop-blur-md py-3 border-b border-[#EFECE6] dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="text-lg sm:text-2xl font-extrabold tracking-tight truncate">
                {tabHeading}
              </h1>
              {isDirty && (
                <span className="px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-[11px] font-semibold whitespace-nowrap">
                  ยังไม่บันทึก
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                disabled={!isDirty || isSaving}
                onClick={handleResetChanges}
                className="px-3.5 py-2 rounded-full bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border border-[#EFECE6] dark:border-white/10 text-xs font-semibold text-[#212529] dark:text-[#F1F1F1] disabled:opacity-45 disabled:cursor-not-allowed inline-flex items-center gap-1.5 transition cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>เลิกทำการเปลี่ยนแปลง</span>
              </button>

              <button
                type="button"
                disabled={!isDirty || isSaving || !title.trim()}
                onClick={handleSave}
                className={`px-4 sm:px-5 py-2 rounded-full text-xs font-bold inline-flex items-center gap-1.5 transition cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed ${isDirty
                    ? 'bg-[#FF7A00] hover:bg-[#E66E00] text-white shadow-sm'
                    : 'bg-zinc-200 dark:bg-white/15 text-zinc-600 dark:text-zinc-300'
                  }`}
              >
                {isSaving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Save className="w-3.5 h-3.5" />
                )}
                <span>{isSaving ? 'กำลังบันทึก...' : 'บันทึก'}</span>
              </button>

              <div className="relative" ref={headerMenuRef}>
                <button
                  type="button"
                  onClick={() => setShowHeaderMenu((prev) => !prev)}
                  title="ตัวเลือกเพิ่มเติม"
                  className="w-9 h-9 rounded-full bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border border-[#EFECE6] dark:border-white/10 flex items-center justify-center text-[#6C655D] dark:text-[#CCCCCC] transition cursor-pointer"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>

                {showHeaderMenu && (
                  <div className="absolute right-0 top-full mt-1.5 w-52 rounded-2xl bg-white dark:bg-[#212121] border border-[#EFECE6] dark:border-white/15 shadow-2xl py-1.5 z-40 text-xs">
                    <Link
                      href={watchHref}
                      onClick={() => setShowHeaderMenu(false)}
                      className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-[#F4F0E8] dark:hover:bg-white/10 transition"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-[#8C857B]" />
                      <span>ดูใน TubeLock</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => {
                        handleCopyWatchUrl();
                        setShowHeaderMenu(false);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-[#F4F0E8] dark:hover:bg-white/10 transition text-left cursor-pointer"
                    >
                      <Copy className="w-3.5 h-3.5 text-[#8C857B]" />
                      <span>คัดลอกลิงก์วิดีโอ</span>
                    </button>
                    <Link
                      href={`/upload?upload_id=${encodeUploadId(video.id)}`}
                      onClick={() => setShowHeaderMenu(false)}
                      className="flex items-center gap-2.5 px-3.5 py-2 hover:bg-[#F4F0E8] dark:hover:bg-white/10 transition"
                    >
                      <ListOrdered className="w-3.5 h-3.5 text-[#8C857B]" />
                      <span>เปิด Pipeline อัปโหลด</span>
                    </Link>
                    <div className="my-1 border-t border-[#EFECE6] dark:border-white/10" />
                    <button
                      type="button"
                      onClick={() => {
                        setShowHeaderMenu(false);
                        setDeleteError('');
                        setShowDeleteModal(true);
                      }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 font-semibold transition text-left cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>ลบวิดีโอถาวร</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </header>

          {/* Status / Save Feedback Banner */}
          {saveFeedback.text && (
            <div
              className={`px-4 py-3 rounded-2xl border text-xs sm:text-sm font-medium flex items-center gap-2 ${saveFeedback.type === 'error'
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                  : saveFeedback.type === 'info'
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-600 dark:text-amber-400'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                }`}
            >
              {saveFeedback.type === 'error' ? (
                <AlertTriangle className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <span>{saveFeedback.text}</span>
            </div>
          )}

          {/* Split Editor + Right Summary Card */}
          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
            {/* Active Tab Form */}
            <div className="min-w-0">
              {activeTab === 'details' && (
                <StudioDetailsTab
                  title={title}
                  setTitle={setTitle}
                  description={description}
                  setDescription={setDescription}
                  sourceLanguage={sourceLanguage}
                  setSourceLanguage={setSourceLanguage}
                  category={category}
                  setCategory={setCategory}
                  tags={tags}
                  setTags={setTags}
                  playlistIds={playlistDraft?.selectedIds}
                  onPlaylistsChange={(selectedIds) => {
                    setPlaylistState((draft) => draft?.savedIds && draft.videoId === videoId
                      ? { ...draft, selectedIds }
                      : draft);
                  }}
                  playlistLoadError={playlistDraft?.error}
                  onRetryPlaylists={() => setPlaylistState(null)}
                  isSaving={isSaving}
                  thumbnailUrl={thumbnailUrl}
                  setThumbnailUrl={setThumbnailUrl}
                  thumbnailOptions={video.thumbnailOptions || []}
                  thumbnailStatus={video.thumbnailStatus || 'waiting'}
                  contentRating={contentRating}
                  setContentRating={setContentRating}
                  ratingCheckStatus={video.ratingCheckStatus || 'pending'}
                  visionResult={video.visionAnalysis || null}
                  hasRawFile={Boolean(video.rawFileName)}
                  onDispatchThumbnails={handleDispatchThumbnails}
                  onDispatchSpriteRating={handleDispatchSpriteRating}
                  isDispatchingThumbs={isDispatchingThumbs}
                  isDispatchingRating={isDispatchingRating}
                />
              )}

              {activeTab === 'subtitles' && (
                <StudioSubtitlesTab
                  videoId={video.id}
                  videoTitle={title || video.title || 'video'}
                  tracks={subtitleTracks}
                  onChangeTracks={setSubtitleTracks}
                  subtitleStatus={video.subtitleStatus || 'waiting'}
                  audioStatus={video.audioStatus || 'waiting'}
                  workerDetail={video.stageDetail || ''}
                />
              )}

              {activeTab === 'versions' && (
                <StudioVersionsTab
                  videoId={video.id}
                  video={video}
                  versions={versions}
                  onVersionsUpdated={(nextVersions) => {
                    const list = Array.isArray(nextVersions) ? nextVersions : [];
                    setVersions(list);
                    setVideo((prev) => (prev ? { ...prev, versions: list } : prev));
                    if (video?.id) invalidateClientVideoCache(video.id);
                  }}
                />
              )}

              {activeTab === 'tech' && (
                <StudioTechTab
                  video={video}
                  isRetranscoding={isRetranscoding}
                  onDispatchTranscode={handleDispatchTranscode}
                />
              )}
            </div>

            {/* Right YouTube Studio Summary Sidebar */}
            <aside className="xl:sticky xl:top-36 space-y-4">
              <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl overflow-hidden shadow-xs">
                <StudioMiniPlayer
                  videoId={video.id}
                  posterUrl={thumbnailUrl}
                  title={title}
                  duration={video.duration}
                  status={video.status}
                  subtitleTracks={subtitleTracks}
                />

                <div className="p-4 space-y-3.5 text-xs">
                  {/* Copyable Watch Link */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 space-y-0.5">
                      <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A]">
                        ลิงก์วิดีโอ
                      </div>
                      <Link
                        href={watchHref}
                        className="text-[#FF7A00] hover:underline font-mono font-semibold truncate block"
                      >
                        {watchHref}
                      </Link>
                    </div>
                    <button
                      type="button"
                      onClick={handleCopyWatchUrl}
                      title="คัดลอกลิงก์"
                      className="p-2 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border border-[#EFECE6] dark:border-white/10 text-[#6C655D] dark:text-[#CCCCCC] transition shrink-0 cursor-pointer"
                    >
                      {copiedLink ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>

                  {/* Filename */}
                  <div className="space-y-0.5">
                    <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A]">ชื่อไฟล์</div>
                    <div className="font-mono text-[11px] text-[#212529] dark:text-[#F1F1F1] break-all">
                      {video.rawFileName || `stream_vid_${video.id}`}
                    </div>
                  </div>

                  {/* Video Quality Specs */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A]">
                      คุณภาพวิดีโอ
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-md bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 font-mono font-bold text-[11px]">
                        {formatResolutionBadge(video.resolution)}
                      </span>
                      {video.codec && (
                        <span className="px-2 py-0.5 rounded-md bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 font-mono font-semibold text-[11px]">
                          {String(video.codec).toUpperCase()}
                        </span>
                      )}
                      {Number(video.fps) > 0 && (
                        <span className="px-2 py-0.5 rounded-md bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 font-mono text-[11px]">
                          {Math.round(Number(video.fps))} fps
                        </span>
                      )}
                      <span className="px-2 py-0.5 rounded-md bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 font-mono text-[11px]">
                        {formatFileSize(video.fileSizeBytes)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Status & Restriction Summary Box */}
              <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-4 shadow-xs space-y-3 text-xs">
                <div className="flex items-start gap-2.5">
                  <ShieldAlert className="w-4 h-4 text-[#FF7A00] mt-0.5 shrink-0" />
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A]">
                      เรตติ้งและการจำกัดอายุ
                    </div>
                    <div className="font-semibold text-[#212529] dark:text-[#F1F1F1]">
                      {ratingInfo.label} ({ratingInfo.badge})
                    </div>
                  </div>
                </div>

                <div className="pt-2.5 border-t border-[#EFECE6] dark:border-white/10 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Captions className="w-4 h-4 text-sky-500 shrink-0" />
                    <div>
                      <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A]">
                        คำบรรยาย (CC)
                      </div>
                      <div className="font-semibold">
                        {subtitleTracks.length > 0
                          ? `${subtitleTracks.length} แทร็กพร้อมใช้งาน`
                          : 'ยังไม่มีซับไตเติล'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelectTab('subtitles')}
                    className="text-[11px] font-semibold text-[#FF7A00] hover:underline cursor-pointer shrink-0"
                  >
                    แก้ไขซับ
                  </button>
                </div>

                <div className="pt-2.5 border-t border-[#EFECE6] dark:border-white/10 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Cpu className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div>
                      <div className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A]">
                        สถานะ HLS
                      </div>
                      <div className="font-semibold font-mono">
                        {video.status} {video.status !== 'READY' ? `(${video.transcodeProgress || 0}%)` : ''}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelectTab('tech')}
                    className="text-[11px] font-semibold text-[#FF7A00] hover:underline cursor-pointer shrink-0"
                  >
                    รายละเอียด
                  </button>
                </div>
              </div>
            </aside>
          </div>
        </main>
      </div>

      <DeleteVideoModal
        isOpen={showDeleteModal}
        onClose={() => !isDeleting && setShowDeleteModal(false)}
        onConfirm={handleConfirmDelete}
        isDeleting={isDeleting}
        deleteError={deleteError}
        videoTitle={title || video.title || video.rawFileName || ''}
      />
    </div>
  );
}

export default function StudioEditPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[80vh] flex flex-col items-center justify-center gap-3 bg-[#FBF9F5] dark:bg-[#0F0F0F] text-[#6C655D] dark:text-[#9A9A9A]">
          <Loader2 className="w-8 h-8 animate-spin text-[#FF7A00]" />
          <span className="text-sm font-medium">กำลังเปิด TubeLock Studio Editor...</span>
        </div>
      }
    >
      <StudioEditorInner />
    </Suspense>
  );
}

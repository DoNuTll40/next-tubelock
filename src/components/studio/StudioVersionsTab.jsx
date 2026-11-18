'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Layers,
  Plus,
  UploadCloud,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Pencil,
  Trash2,
  Star,
  RefreshCw,
  Terminal,
  Captions,
  RotateCcw,
  X,
  Film,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { extractVideoMetadata, uploadFileDirectToSession } from '@/lib/uploader';
import { detectCodecFromHeader, formatAspectRatio } from '@/lib/videoUtils';
import { normalizeSubtitleTracks } from '@/lib/videoEditorUtils';
import { invalidateClientVideoCache } from '@/lib/playbackResolver';

const VERSION_PRESETS = [
  {
    id: 'imax',
    name: 'IMAX Enhanced',
    label: 'IMAX Enhanced',
    badge: 'IMAX',
    aspectLabel: '1.90:1',
    description: 'สัดส่วนภาพขยายเต็มจอ IMAX ตลอดเรื่อง',
  },
  {
    id: 'restored',
    name: 'Restored (AI)',
    label: 'Restored (AI)',
    badge: 'AI',
    aspectLabel: '',
    description: 'เวอร์ชันปรับปรุงความคมชัดด้วย AI',
  },
  {
    id: 'uncut',
    name: 'Uncut',
    label: 'Uncut / Extended',
    badge: 'UNCUT',
    aspectLabel: '',
    description: 'เวอร์ชันฉบับเต็มไม่ตัดฉาก',
  },
  {
    id: 'custom',
    name: 'กำหนดเอง',
    label: '',
    badge: '',
    aspectLabel: '',
    description: '',
  },
];

const ACTIVE_TRANSCODE_STATUSES = new Set(['QUEUED', 'PROCESSING', 'TRANSCODING']);

function suggestCompactAspectLabel(width, height) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!w || !h) return '';
  const ratio = w / h;
  if (ratio >= 1.74 && ratio <= 1.82) return '16:9';
  if (ratio >= 1.86 && ratio <= 1.96) return '1.90:1';
  if (ratio >= 2.34 && ratio <= 2.44) return '2.39:1';
  if (ratio >= 1.30 && ratio <= 1.37) return '4:3';
  if (ratio >= 0.54 && ratio <= 0.59) return '9:16';
  return `${ratio.toFixed(2)}:1`;
}

function formatDurationClock(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  }
  return `${mins}:${String(rem).padStart(2, '0')}`;
}

function formatBytesReadable(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n >= 1024 * 1024 * 1024) {
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function getVersionStatusMeta(status) {
  const upper = String(status || '').toUpperCase();
  if (upper === 'READY' || upper === 'COMPLETED') {
    return {
      text: 'พร้อมเล่น',
      className: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25',
    };
  }
  if (ACTIVE_TRANSCODE_STATUSES.has(upper)) {
    return {
      text: upper === 'QUEUED' ? 'อยู่ในคิวแปลง' : 'กำลังแปลง HLS',
      className: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/25',
    };
  }
  if (upper === 'FAILED') {
    return {
      text: 'แปลงไม่สำเร็จ',
      className: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25',
    };
  }
  if (upper === 'UPLOADING') {
    return {
      text: 'รออัปโหลดให้เสร็จ',
      className: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/25',
    };
  }
  return {
    text: upper || 'ไม่ทราบสถานะ',
    className: 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 border-zinc-500/20',
  };
}

export default function StudioVersionsTab({
  videoId,
  video,
  versions = [],
  onVersionsUpdated,
}) {
  const [showAddForm, setShowAddForm] = useState(() => (versions?.length || 0) <= 1);
  const [selectedPreset, setSelectedPreset] = useState('imax');
  const [newLabel, setNewLabel] = useState('IMAX Enhanced');
  const [newBadge, setNewBadge] = useState('IMAX');
  const [newAspectLabel, setNewAspectLabel] = useState('1.90:1');
  const [newDescription, setNewDescription] = useState('สัดส่วนภาพขยายเต็มจอ IMAX ตลอดเรื่อง');
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileMeta, setFileMeta] = useState(null);
  const [isInspectingFile, setIsInspectingFile] = useState(false);

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadLogs, setUploadLogs] = useState([]);
  const [uploadError, setUploadError] = useState('');
  const xhrRef = useRef(null);
  const fileInputRef = useRef(null);

  const [actionBanner, setActionBanner] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState({
    label: '',
    badge: '',
    aspectLabel: '',
    description: '',
    versionKey: '',
  });
  const [busyVersionId, setBusyVersionId] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [expandedLogsId, setExpandedLogsId] = useState(null);
  const [versionLogsMap, setVersionLogsMap] = useState({});

  const hasActiveTranscode = useMemo(
    () =>
      Array.isArray(versions) &&
      versions.some((v) => ACTIVE_TRANSCODE_STATUSES.has(String(v?.status || '').toUpperCase())),
    [versions]
  );

  const refreshVersionsList = async ({ invalidate = false } = {}) => {
    if (!videoId) return [];
    const res = await fetch(`/api/videos/${videoId}/versions?all=1`, { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'โหลดรายการเวอร์ชันไม่สำเร็จ');
    }
    const nextList = Array.isArray(data.versions) ? data.versions : [];
    onVersionsUpdated?.(nextList);
    if (invalidate) {
      invalidateClientVideoCache(videoId);
    }
    return nextList;
  };

  const fetchVersionStatusDetail = async (targetVerId) => {
    if (!videoId || !targetVerId) return;
    setVersionLogsMap((prev) => ({
      ...prev,
      [targetVerId]: { ...(prev[targetVerId] || {}), loading: true, error: '' },
    }));
    try {
      const res = await fetch(
        `/api/videos/${videoId}/status?versionId=${encodeURIComponent(targetVerId)}`,
        { cache: 'no-store' }
      );
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'ไม่สามารถโหลด Log ได้');
      }
      setVersionLogsMap((prev) => ({
        ...prev,
        [targetVerId]: {
          loading: false,
          error: '',
          runnerSpecs: data.version?.runnerSpecs || null,
          workerLogs: Array.isArray(data.version?.workerLogs) ? data.version.workerLogs : [],
        },
      }));
    } catch (err) {
      setVersionLogsMap((prev) => ({
        ...prev,
        [targetVerId]: {
          ...(prev[targetVerId] || {}),
          loading: false,
          error: err.message || 'โหลด Log ไม่สำเร็จ',
        },
      }));
    }
  };

  // Auto-poll when any version is queued/processing/transcoding
  useEffect(() => {
    if (!videoId || !hasActiveTranscode) return;
    const timer = setInterval(async () => {
      try {
        const list = await refreshVersionsList();
        const stillActive = list.some((v) =>
          ACTIVE_TRANSCODE_STATUSES.has(String(v?.status || '').toUpperCase())
        );
        if (!stillActive) {
          invalidateClientVideoCache(videoId);
        }
        if (expandedLogsId) {
          await fetchVersionStatusDetail(expandedLogsId);
        }
      } catch (_) {}
    }, 4500);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, hasActiveTranscode, expandedLogsId]);

  const handleApplyPreset = (preset) => {
    setSelectedPreset(preset.id);
    if (preset.id === 'custom') {
      setNewLabel('');
      setNewBadge('');
      setNewDescription('');
      if (fileMeta?.width && fileMeta?.height) {
        setNewAspectLabel(suggestCompactAspectLabel(fileMeta.width, fileMeta.height));
      } else {
        setNewAspectLabel('');
      }
      return;
    }
    setNewLabel(preset.label);
    setNewBadge(preset.badge);
    setNewDescription(preset.description);
    if (preset.aspectLabel) {
      setNewAspectLabel(preset.aspectLabel);
    } else if (fileMeta?.width && fileMeta?.height) {
      setNewAspectLabel(suggestCompactAspectLabel(fileMeta.width, fileMeta.height));
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0] || null;
    setUploadError('');
    setSelectedFile(file);
    setFileMeta(null);
    if (!file) return;

    setIsInspectingFile(true);
    try {
      const [meta, codec] = await Promise.all([
        extractVideoMetadata(file),
        detectCodecFromHeader(file),
      ]);
      const fullMeta = { ...meta, codec };
      setFileMeta(fullMeta);
      if (!newAspectLabel.trim() && meta.width && meta.height) {
        setNewAspectLabel(suggestCompactAspectLabel(meta.width, meta.height));
      }
    } catch (_) {
      setFileMeta(null);
    } finally {
      setIsInspectingFile(false);
    }
  };

  const handleUploadNewVersion = async (e) => {
    e.preventDefault();
    if (!selectedFile) {
      setUploadError('กรุณาเลือกไฟล์วิดีโอสำหรับเวอร์ชันใหม่');
      return;
    }
    if (!newLabel.trim()) {
      setUploadError('กรุณากรอกชื่อเวอร์ชัน (เช่น IMAX Enhanced หรือ Restored)');
      return;
    }

    setIsUploading(true);
    setUploadError('');
    setActionBanner(null);
    setUploadLogs([`เตรียมข้อมูลไฟล์ "${selectedFile.name}" (${formatBytesReadable(selectedFile.size)})...`]);
    setUploadProgress({ percent: 0, currentMB: '0', totalMB: (selectedFile.size / (1024 * 1024)).toFixed(1) });

    try {
      let meta = fileMeta;
      if (!meta) {
        const [extracted, codec] = await Promise.all([
          extractVideoMetadata(selectedFile),
          detectCodecFromHeader(selectedFile),
        ]);
        meta = { ...extracted, codec };
        setFileMeta(meta);
      }

      setUploadLogs((prev) => [...prev, 'กำลังเปิด Upload Session บน OneDrive สำหรับเวอร์ชันใหม่...']);
      const sessionRes = await fetch('/api/upload/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          targetVideoId: videoId,
          fileName: selectedFile.name,
          fileSize: selectedFile.size,
          versionLabel: newLabel.trim(),
          versionBadge: newBadge.trim(),
          versionAspectLabel: newAspectLabel.trim(),
          versionDescription: newDescription.trim(),
        }),
      });
      const sessionData = await sessionRes.json();
      if (!sessionRes.ok || !sessionData.success || !sessionData.uploadUrl) {
        throw new Error(sessionData.error || 'สร้าง Upload Session ไม่สำเร็จ');
      }

      const { versionId: newVersionId, uploadUrl } = sessionData;
      setUploadLogs((prev) => [
        ...prev,
        `สร้างเวอร์ชัน ID #${newVersionId} สำเร็จ! เริ่มอัปโหลดเข้า OneDrive...`,
      ]);

      await uploadFileDirectToSession(selectedFile, uploadUrl, {
        onProgress: (prog) => setUploadProgress(prog),
        onLog: (msg) => setUploadLogs((prev) => [...prev.slice(-24), msg]),
        xhrRef,
      });

      setUploadLogs((prev) => [...prev, 'อัปโหลดเสร็จ 100%! กำลังส่งคำสั่งแปลง HLS บน GitHub Actions...']);
      const completeRes = await fetch('/api/upload/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          versionId: newVersionId,
          clientMeta: {
            duration: meta?.duration || 0,
            resolution: meta?.resolution || '',
            fps: meta?.fps || 30,
            codec: meta?.codec || '',
            thumbnailDataUrl: meta?.thumbnailDataUrl || '',
          },
        }),
      });
      const completeData = await completeRes.json();
      if (!completeRes.ok || !completeData.success) {
        throw new Error(completeData.warning || completeData.error || 'เริ่มงานแปลง HLS ไม่สำเร็จ');
      }

      await refreshVersionsList({ invalidate: true });
      setActionBanner({
        type: 'success',
        text: `เพิ่มเวอร์ชัน "${newLabel.trim()}" และส่งเข้าคิวแปลง HLS แล้ว`,
      });
      setSelectedFile(null);
      setFileMeta(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setShowAddForm(false);
    } catch (err) {
      setUploadError(err.message || 'เกิดข้อผิดพลาดระหว่างอัปโหลดเวอร์ชันใหม่');
      try {
        await refreshVersionsList();
      } catch (_) {}
    } finally {
      setIsUploading(false);
      xhrRef.current = null;
    }
  };

  const handleStartEdit = (ver) => {
    setEditingId(ver.id);
    setEditDraft({
      label: ver.label || '',
      badge: ver.badge || '',
      aspectLabel: ver.aspectLabel || '',
      description: ver.description || '',
      versionKey: ver.versionKey || '',
    });
    setActionBanner(null);
  };

  const handleSaveEdit = async (verId) => {
    if (!editDraft.label.trim()) {
      setActionBanner({ type: 'error', text: 'ชื่อเวอร์ชันห้ามว่างเปล่า' });
      return;
    }
    setBusyVersionId(verId);
    setActionBanner(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/versions/${verId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: editDraft.label.trim(),
          badge: editDraft.badge.trim(),
          aspectLabel: editDraft.aspectLabel.trim(),
          description: editDraft.description.trim(),
          versionKey: editDraft.versionKey.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'บันทึกการแก้ไขเวอร์ชันไม่สำเร็จ');
      }
      setEditingId(null);
      await refreshVersionsList({ invalidate: true });
      setActionBanner({ type: 'success', text: 'อัปเดตข้อมูลเวอร์ชันเรียบร้อยแล้ว' });
    } catch (err) {
      setActionBanner({ type: 'error', text: err.message });
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleSetDefault = async (ver) => {
    setBusyVersionId(ver.id);
    setActionBanner(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/versions/${ver.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isDefault: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'ตั้งค่าเวอร์ชันเริ่มต้นไม่สำเร็จ');
      }
      await refreshVersionsList({ invalidate: true });
      setActionBanner({ type: 'success', text: `ตั้ง "${ver.label}" เป็นเวอร์ชันเริ่มต้นแล้ว` });
    } catch (err) {
      setActionBanner({ type: 'error', text: err.message });
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleRetranscodeVersion = async (ver) => {
    setBusyVersionId(ver.id);
    setActionBanner(null);
    try {
      const res = await fetch('/api/upload/dispatch-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId,
          versionId: ver.id,
          workflowType: 'transcode',
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'ส่งคำสั่งแปลง HLS ไม่สำเร็จ');
      }
      await refreshVersionsList({ invalidate: true });
      setExpandedLogsId(ver.id);
      await fetchVersionStatusDetail(ver.id);
      setActionBanner({
        type: 'success',
        text: `ส่งคำสั่งแปลง HLS สำหรับ "${ver.label}" เข้าคิว GitHub Actions แล้ว`,
      });
    } catch (err) {
      setActionBanner({ type: 'error', text: err.message });
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleDeleteVersion = async (ver) => {
    setBusyVersionId(ver.id);
    setActionBanner(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/versions/${ver.id}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'ลบเวอร์ชันไม่สำเร็จ');
      }
      setConfirmDeleteId(null);
      if (expandedLogsId === ver.id) setExpandedLogsId(null);
      await refreshVersionsList({ invalidate: true });
      setActionBanner({ type: 'success', text: `ลบเวอร์ชัน "${ver.label}" แล้ว` });
    } catch (err) {
      setActionBanner({ type: 'error', text: err.message });
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleUploadSubtitleOverride = async (ver, file) => {
    if (!file) return;
    setBusyVersionId(ver.id);
    setActionBanner(null);
    try {
      const text = await file.text();
      const isVtt = file.name.toLowerCase().endsWith('.vtt') || /^\s*WEBVTT/i.test(text);
      const tracks = normalizeSubtitleTracks([
        {
          id: 'th',
          label: `ไทย (${ver.badge || ver.label})`,
          lang: 'th',
          srt: isVtt ? '' : text,
          vtt: isVtt ? text : '',
        },
      ]);
      if (tracks.length === 0 || (!tracks[0].srt && !tracks[0].vtt)) {
        throw new Error('ไฟล์คำบรรยายไม่มีข้อความหรือรูปแบบไม่ถูกต้อง');
      }

      const res = await fetch(`/api/videos/${videoId}/versions/${ver.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subtitleTracksOverride: tracks }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'บันทึกซับเฉพาะเวอร์ชันไม่สำเร็จ');
      }
      await refreshVersionsList({ invalidate: true });
      setActionBanner({
        type: 'success',
        text: `บันทึกซับไตเติลเฉพาะเวอร์ชัน "${ver.label}" เรียบร้อยแล้ว`,
      });
    } catch (err) {
      setActionBanner({ type: 'error', text: err.message });
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleResetSubtitleOverride = async (ver) => {
    setBusyVersionId(ver.id);
    setActionBanner(null);
    try {
      const res = await fetch(`/api/videos/${videoId}/versions/${ver.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resetSubtitleOverride: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'รีเซ็ตซับไตเติลไม่สำเร็จ');
      }
      await refreshVersionsList({ invalidate: true });
      setActionBanner({
        type: 'success',
        text: `เวอร์ชัน "${ver.label}" กลับไปใช้ซับไตเติลหลักของวิดีโอแล้ว`,
      });
    } catch (err) {
      setActionBanner({ type: 'error', text: err.message });
    } finally {
      setBusyVersionId(null);
    }
  };

  const handleToggleLogs = async (verId) => {
    if (expandedLogsId === verId) {
      setExpandedLogsId(null);
      return;
    }
    setExpandedLogsId(verId);
    await fetchVersionStatusDetail(verId);
  };

  return (
    <div className="space-y-6">
      {/* Header Summary Card */}
      <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#FF7A00]/12 border border-[#FF7A00]/25 flex items-center justify-center shrink-0">
              <Layers className="w-5 h-5 text-[#FF7A00]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#212529] dark:text-[#F1F1F1]">
                เวอร์ชันวิดีโอ (Multi-Version)
              </h2>
              <p className="text-xs text-[#606060] dark:text-[#AAAAAA] mt-0.5 leading-relaxed">
                เพิ่มหลายเวอร์ชันไว้ในเรื่องเดียว เช่น ปกติ (2.39:1) กับ IMAX Enhanced (1.90:1) หรือ Restored AI โดยคนดูสามารถสลับเวอร์ชันระหว่างเล่นได้ทันที
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowAddForm((prev) => !prev)}
            className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-[#FF7A00] hover:bg-[#e56d00] text-white text-xs font-bold shadow-xs transition active:scale-[0.98] cursor-pointer"
          >
            {showAddForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            <span>{showAddForm ? 'ซ่อนฟอร์มเพิ่มเวอร์ชัน' : 'เพิ่มเวอร์ชันใหม่'}</span>
          </button>
        </div>

        {actionBanner && (
          <div
            className={`mt-4 flex items-center justify-between gap-2 px-4 py-2.5 rounded-xl border text-xs font-medium ${
              actionBanner.type === 'error'
                ? 'bg-rose-500/10 border-rose-500/25 text-rose-600 dark:text-rose-400'
                : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-400'
            }`}
          >
            <div className="flex items-center gap-2">
              {actionBanner.type === 'error' ? (
                <AlertCircle className="w-4 h-4 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0" />
              )}
              <span>{actionBanner.text}</span>
            </div>
            <button
              type="button"
              onClick={() => setActionBanner(null)}
              className="p-1 opacity-70 hover:opacity-100 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Add New Version Form */}
      {showAddForm && (
        <form
          onSubmit={handleUploadNewVersion}
          className="bg-white dark:bg-[#181818] border border-[#FF7A00]/35 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5"
        >
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4.5 h-4.5 text-[#FF7A00]" />
              <h3 className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1]">
                อัปโหลดไฟล์วิดีโอเวอร์ชันใหม่เข้าเรื่องนี้
              </h3>
            </div>
            <span className="text-[11px] text-[#8C857B] dark:text-[#AAAAAA]">
              {versions.length === 0
                ? 'ระบบจะสร้างเวอร์ชัน "ปกติ" จากสตรีมปัจจุบันให้อัตโนมัติเมื่อเริ่มอัปโหลด'
                : `วิดีโอนี้มีอยู่แล้ว ${versions.length} เวอร์ชัน`}
            </span>
          </div>

          {/* Preset Pills */}
          <div className="space-y-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[#606060] dark:text-[#AAAAAA]">
              รูปแบบด่วน (Presets)
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              {VERSION_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  disabled={isUploading}
                  onClick={() => handleApplyPreset(preset)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition cursor-pointer disabled:opacity-50 ${
                    selectedPreset === preset.id
                      ? 'bg-[#FF7A00]/15 border-[#FF7A00] text-[#CC5800] dark:text-[#FF9E40]'
                      : 'bg-[#FBF9F5] dark:bg-white/5 border-[#E5E0D8] dark:border-white/10 text-[#495057] dark:text-zinc-300 hover:border-[#FF7A00]/45'
                  }`}
                >
                  {preset.name}
                </button>
              ))}
            </div>
          </div>

          {/* Fields Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#495057] dark:text-zinc-300 mb-1.5">
                ชื่อเวอร์ชัน *
              </label>
              <input
                type="text"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                disabled={isUploading}
                placeholder="เช่น IMAX Enhanced"
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E0D8] dark:border-white/15 bg-[#FBF9F5] dark:bg-[#121212] text-sm text-[#212529] dark:text-white focus:outline-none focus:border-[#FF7A00]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#495057] dark:text-zinc-300 mb-1.5">
                ป้ายสั้น (Badge)
              </label>
              <input
                type="text"
                value={newBadge}
                onChange={(e) => setNewBadge(e.target.value)}
                disabled={isUploading}
                placeholder="เช่น IMAX, AI, 4K"
                maxLength={32}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E0D8] dark:border-white/15 bg-[#FBF9F5] dark:bg-[#121212] text-sm text-[#212529] dark:text-white focus:outline-none focus:border-[#FF7A00]"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#495057] dark:text-zinc-300 mb-1.5">
                สัดส่วนภาพ (Aspect Ratio)
              </label>
              <input
                type="text"
                value={newAspectLabel}
                onChange={(e) => setNewAspectLabel(e.target.value)}
                disabled={isUploading}
                placeholder="เช่น 1.90:1 หรือ 16:9"
                maxLength={24}
                className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E0D8] dark:border-white/15 bg-[#FBF9F5] dark:bg-[#121212] text-sm font-mono text-[#212529] dark:text-white focus:outline-none focus:border-[#FF7A00]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#495057] dark:text-zinc-300 mb-1.5">
              คำอธิบายสั้นๆ ใต้ตัวเลือกบนหน้า Watch
            </label>
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              disabled={isUploading}
              placeholder="เช่น สัดส่วนภาพขยายเต็มจอ IMAX 1.90:1 ตลอดทั้งเรื่อง"
              maxLength={400}
              className="w-full px-3.5 py-2.5 rounded-xl border border-[#E5E0D8] dark:border-white/15 bg-[#FBF9F5] dark:bg-[#121212] text-sm text-[#212529] dark:text-white focus:outline-none focus:border-[#FF7A00]"
            />
          </div>

          {/* File Selector */}
          <div>
            <label className="block text-xs font-semibold text-[#495057] dark:text-zinc-300 mb-1.5">
              ไฟล์วิดีโอสำหรับเวอร์ชันนี้ *
            </label>
            <label className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border-2 border-dashed border-[#E5E0D8] dark:border-white/15 bg-[#FBF9F5] dark:bg-white/[0.02] hover:border-[#FF7A00]/60 transition cursor-pointer">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-[#FF7A00]/12 flex items-center justify-center shrink-0">
                  <UploadCloud className="w-5 h-5 text-[#FF7A00]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[#212529] dark:text-zinc-100 truncate">
                    {selectedFile ? selectedFile.name : 'คลิกเพื่อเลือกไฟล์วิดีโอ (.mp4, .mkv, .mov, ...)'}
                  </p>
                  <p className="text-xs text-[#606060] dark:text-zinc-400 mt-0.5">
                    {isInspectingFile
                      ? 'กำลังตรวจสอบขนาดภาพและความยาว...'
                      : selectedFile
                        ? [
                            formatBytesReadable(selectedFile.size),
                            fileMeta?.resolution,
                            fileMeta?.width && fileMeta?.height
                              ? formatAspectRatio(fileMeta.width, fileMeta.height)
                              : null,
                            fileMeta?.duration ? formatDurationClock(fileMeta.duration) : null,
                            fileMeta?.codec ? fileMeta.codec.toUpperCase() : null,
                          ]
                            .filter(Boolean)
                            .join(' • ')
                        : 'รองรับไฟล์ขนาดใหญ่ อัปโหลดตรงเข้า OneDrive แบบแบ่ง Chunk และแปลง HLS อัตโนมัติ'}
                  </p>
                </div>
              </div>
              <span className="shrink-0 px-3 py-1.5 rounded-lg bg-white dark:bg-white/10 border border-[#E5E0D8] dark:border-white/15 text-xs font-bold text-[#212529] dark:text-white text-center">
                {selectedFile ? 'เปลี่ยนไฟล์' : 'เลือกไฟล์'}
              </span>
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                disabled={isUploading}
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>

          {uploadError && (
            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs font-medium text-rose-600 dark:text-rose-400">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{uploadError}</span>
            </div>
          )}

          {/* Upload Progress & Live Logs */}
          {isUploading && uploadProgress && (
            <div className="space-y-2.5 p-4 rounded-xl bg-[#FBF9F5] dark:bg-[#121212] border border-[#EFECE6] dark:border-white/10">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="text-[#FF7A00]">
                  กำลังอัปโหลด... {uploadProgress.percent}%
                </span>
                <span className="font-mono text-[#606060] dark:text-zinc-400">
                  {uploadProgress.currentMB} / {uploadProgress.totalMB} MB
                  {uploadProgress.speedMBs ? ` • ${uploadProgress.speedMBs} MB/s` : ''}
                  {uploadProgress.etaSec > 0 ? ` • เหลือ ~${uploadProgress.etaSec}s` : ''}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-[#FF7A00] transition-all duration-200"
                  style={{ width: `${uploadProgress.percent}%` }}
                />
              </div>
              {uploadLogs.length > 0 && (
                <div className="max-h-24 overflow-y-auto text-[11px] font-mono text-[#606060] dark:text-zinc-400 space-y-0.5 pt-1">
                  {uploadLogs.map((line, i) => (
                    <div key={i} className="truncate">{line}</div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            {isUploading && (
              <button
                type="button"
                onClick={() => xhrRef.current?.abort()}
                className="px-4 py-2 rounded-xl border border-rose-500/35 text-rose-600 dark:text-rose-400 text-xs font-bold hover:bg-rose-500/10 transition cursor-pointer"
              >
                ยกเลิกการอัปโหลด
              </button>
            )}
            <button
              type="submit"
              disabled={isUploading || !selectedFile}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF7A00] hover:bg-[#e56d00] disabled:opacity-50 text-white text-xs font-bold shadow-xs transition cursor-pointer"
            >
              {isUploading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>กำลังอัปโหลดเข้าคิว...</span>
                </>
              ) : (
                <>
                  <UploadCloud className="w-4 h-4" />
                  <span>อัปโหลดและเริ่มแปลง HLS เวอร์ชันนี้</span>
                </>
              )}
            </button>
          </div>
        </form>
      )}

      {/* Existing Versions List */}
      <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[#212529] dark:text-[#F1F1F1]">
            รายการเวอร์ชันทั้งหมด ({versions.length || 1})
          </h3>
          <button
            type="button"
            onClick={() => void refreshVersionsList()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#E5E0D8] dark:border-white/15 text-xs font-semibold text-[#495057] dark:text-zinc-300 hover:bg-black/5 dark:hover:bg-white/5 transition cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>รีเฟรชสถานะ</span>
          </button>
        </div>

        {versions.length === 0 ? (
          <div className="p-4 rounded-xl bg-[#FBF9F5] dark:bg-white/[0.03] border border-[#EFECE6] dark:border-white/10 flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#FF7A00]/12 flex items-center justify-center shrink-0">
                <Film className="w-4.5 h-4.5 text-[#FF7A00]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-[#212529] dark:text-white">
                    ปกติ (สตรีมหลักปัจจุบัน)
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FF7A00]/15 text-[#FF7A00]">
                    ค่าเริ่มต้น
                  </span>
                </div>
                <p className="text-xs text-[#606060] dark:text-zinc-400 mt-0.5">
                  {[
                    video?.resolution,
                    video?.fps ? `${Number(video.fps).toFixed(0)} fps` : null,
                    video?.codec ? String(video.codec).toUpperCase() : null,
                    video?.duration ? formatDurationClock(video.duration) : null,
                  ]
                    .filter(Boolean)
                    .join(' • ') || 'ยังไม่มีเวอร์ชันเสริม — ใช้แบบฟอร์มด้านบนเพื่อเพิ่มเวอร์ชันใหม่'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {versions.map((ver) => {
              const statusMeta = getVersionStatusMeta(ver.status);
              const isTranscoding = ACTIVE_TRANSCODE_STATUSES.has(String(ver.status || '').toUpperCase());
              const isReady = ['READY', 'COMPLETED'].includes(String(ver.status || '').toUpperCase());
              const isEditing = editingId === ver.id;
              const isBusy = busyVersionId === ver.id;
              const logsInfo = versionLogsMap[ver.id];
              const isLogsExpanded = expandedLogsId === ver.id;

              return (
                <div
                  key={ver.id}
                  className={`rounded-2xl border p-4 transition ${
                    ver.isDefault
                      ? 'border-[#FF7A00]/45 bg-[#FF7A00]/[0.03] dark:bg-[#FF7A00]/[0.05]'
                      : 'border-[#EFECE6] dark:border-white/10 bg-[#FBF9F5]/60 dark:bg-white/[0.02]'
                  }`}
                >
                  {isEditing ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-[11px] font-semibold text-[#606060] dark:text-zinc-400 mb-1">
                            ชื่อเวอร์ชัน
                          </label>
                          <input
                            type="text"
                            value={editDraft.label}
                            onChange={(e) => setEditDraft((p) => ({ ...p, label: e.target.value }))}
                            className="w-full px-3 py-2 rounded-lg border border-[#E5E0D8] dark:border-white/15 bg-white dark:bg-[#121212] text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-[#606060] dark:text-zinc-400 mb-1">
                            Badge
                          </label>
                          <input
                            type="text"
                            value={editDraft.badge}
                            onChange={(e) => setEditDraft((p) => ({ ...p, badge: e.target.value }))}
                            maxLength={32}
                            className="w-full px-3 py-2 rounded-lg border border-[#E5E0D8] dark:border-white/15 bg-white dark:bg-[#121212] text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-[#606060] dark:text-zinc-400 mb-1">
                            สัดส่วนภาพ
                          </label>
                          <input
                            type="text"
                            value={editDraft.aspectLabel}
                            onChange={(e) => setEditDraft((p) => ({ ...p, aspectLabel: e.target.value }))}
                            maxLength={24}
                            className="w-full px-3 py-2 rounded-lg border border-[#E5E0D8] dark:border-white/15 bg-white dark:bg-[#121212] text-sm font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] font-semibold text-[#606060] dark:text-zinc-400 mb-1">
                            URL Key (?v=...)
                          </label>
                          <input
                            type="text"
                            value={editDraft.versionKey}
                            onChange={(e) => setEditDraft((p) => ({ ...p, versionKey: e.target.value }))}
                            maxLength={64}
                            className="w-full px-3 py-2 rounded-lg border border-[#E5E0D8] dark:border-white/15 bg-white dark:bg-[#121212] text-sm font-mono"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold text-[#606060] dark:text-zinc-400 mb-1">
                          คำอธิบาย
                        </label>
                        <input
                          type="text"
                          value={editDraft.description}
                          onChange={(e) => setEditDraft((p) => ({ ...p, description: e.target.value }))}
                          maxLength={400}
                          className="w-full px-3 py-2 rounded-lg border border-[#E5E0D8] dark:border-white/15 bg-white dark:bg-[#121212] text-sm"
                        />
                      </div>

                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 rounded-lg border border-[#E5E0D8] dark:border-white/15 text-xs font-semibold cursor-pointer"
                        >
                          ยกเลิก
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleSaveEdit(ver.id)}
                          className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#FF7A00] text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                        >
                          {isBusy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                          <span>บันทึก</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                        <div className="min-w-0 space-y-1.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-[#212529] dark:text-white">
                              {ver.label}
                            </span>
                            {ver.badge && (
                              <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-[#FF7A00]/15 text-[#CC5800] dark:text-[#FF9E40] border border-[#FF7A00]/30">
                                {ver.badge}
                              </span>
                            )}
                            {ver.isDefault && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#FF7A00] text-white">
                                <Star className="w-2.5 h-2.5 fill-current" />
                                ค่าเริ่มต้น
                              </span>
                            )}
                            <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-full border ${statusMeta.className}`}>
                              {statusMeta.text}
                            </span>
                            {ver.versionKey && (
                              <span className="text-[11px] font-mono text-[#8C857B] dark:text-zinc-500">
                                ?v={ver.versionKey}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 flex-wrap text-xs text-[#606060] dark:text-zinc-400">
                            {[
                              ver.aspectLabel ? `สัดส่วน ${ver.aspectLabel}` : null,
                              ver.resolution,
                              Number(ver.fps) > 0 ? `${Number(ver.fps).toFixed(0)} fps` : null,
                              ver.codec ? String(ver.codec).toUpperCase() : null,
                              ver.fileSizeBytes ? formatBytesReadable(ver.fileSizeBytes) : null,
                              ver.duration ? formatDurationClock(ver.duration) : null,
                            ]
                              .filter(Boolean)
                              .map((chip, idx, arr) => (
                                <span key={idx} className="inline-flex items-center gap-2">
                                  <span className="font-mono">{chip}</span>
                                  {idx < arr.length - 1 && <span>•</span>}
                                </span>
                              ))}
                          </div>

                          {ver.description && (
                            <p className="text-xs text-[#606060] dark:text-zinc-400">
                              {ver.description}
                            </p>
                          )}
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                          {!ver.isDefault && isReady && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleSetDefault(ver)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#FF7A00]/35 text-[#CC5800] dark:text-[#FF9E40] hover:bg-[#FF7A00]/10 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                            >
                              <Star className="w-3.5 h-3.5" />
                              <span>ตั้งเป็นค่าเริ่มต้น</span>
                            </button>
                          )}

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => handleStartEdit(ver)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E5E0D8] dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5 text-xs font-semibold transition cursor-pointer"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                            <span>แก้ไข</span>
                          </button>

                          <button
                            type="button"
                            disabled={isBusy || isTranscoding}
                            onClick={() => handleRetranscodeVersion(ver)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E5E0D8] dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5 text-xs font-semibold transition cursor-pointer disabled:opacity-45"
                            title="สั่ง GitHub Actions แปลง HLS ใหม่อีกครั้ง (ต้องยังมีไฟล์ต้นฉบับบน OneDrive)"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isTranscoding ? 'animate-spin' : ''}`} />
                            <span>แปลงใหม่</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleToggleLogs(ver.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[#E5E0D8] dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5 text-xs font-semibold transition cursor-pointer"
                          >
                            <Terminal className="w-3.5 h-3.5" />
                            <span>Logs</span>
                            {isLogsExpanded ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </button>

                          {versions.length > 1 && (
                            confirmDeleteId === ver.id ? (
                              <div className="inline-flex items-center gap-1 pl-1">
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleDeleteVersion(ver)}
                                  className="px-2.5 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                                >
                                  {isBusy ? 'กำลังลบ...' : 'ยืนยันลบ'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteId(null)}
                                  className="px-2 py-1.5 rounded-lg border border-[#E5E0D8] dark:border-white/15 text-xs cursor-pointer"
                                >
                                  ยกเลิก
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() => setConfirmDeleteId(ver.id)}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 text-xs font-semibold transition cursor-pointer disabled:opacity-50"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>ลบ</span>
                              </button>
                            )
                          )}
                        </div>
                      </div>

                      {/* Active Transcode Progress Bar */}
                      {isTranscoding && (
                        <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/10 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center gap-1.5">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              {ver.stageDetail || 'กำลังประมวลผลบน GitHub Actions...'}
                            </span>
                            <span className="font-mono font-bold text-[#FF7A00]">
                              {Number(ver.transcodeProgress || 0)}%
                            </span>
                          </div>
                          <div className="w-full h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                            <div
                              className="h-full bg-[#FF7A00] transition-all duration-300"
                              style={{ width: `${Math.max(3, Number(ver.transcodeProgress || 0))}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {/* Failed Error */}
                      {String(ver.status || '').toUpperCase() === 'FAILED' && ver.errorMessage && (
                        <div className="mt-3 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-600 dark:text-rose-400">
                          {ver.errorMessage}
                        </div>
                      )}

                      {/* Per-version Subtitle Override Row */}
                      <div className="mt-3 pt-3 border-t border-black/5 dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs text-[#606060] dark:text-zinc-400">
                          <Captions className="w-4 h-4 text-[#FF7A00] shrink-0" />
                          <span>
                            คำบรรยาย:{' '}
                            <strong className="text-[#212529] dark:text-zinc-200">
                              {ver.hasSubtitleOverride
                                ? `ใช้ซับเฉพาะเวอร์ชันนี้ (${ver.subtitleTracksOverride?.length || 1} แทร็ก)`
                                : 'ใช้ซับหลักร่วมกัน (ค่าเริ่มต้น)'}
                            </strong>
                          </span>
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <label className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white dark:bg-white/5 border border-[#E5E0D8] dark:border-white/15 hover:border-[#FF7A00]/50 text-[11.5px] font-semibold cursor-pointer transition">
                            <UploadCloud className="w-3.5 h-3.5 text-[#FF7A00]" />
                            <span>อัปโหลด .SRT / .VTT เฉพาะเวอร์ชันนี้</span>
                            <input
                              type="file"
                              accept=".srt,.vtt,text/vtt,application/x-subrip"
                              disabled={isBusy}
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                e.target.value = '';
                                if (f) void handleUploadSubtitleOverride(ver, f);
                              }}
                              className="hidden"
                            />
                          </label>
                          {ver.hasSubtitleOverride && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() => handleResetSubtitleOverride(ver)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[#E5E0D8] dark:border-white/15 hover:bg-black/5 dark:hover:bg-white/5 text-[11.5px] font-semibold text-[#606060] dark:text-zinc-300 cursor-pointer disabled:opacity-50"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>กลับไปใช้ซับหลัก</span>
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Expandable Worker Logs */}
                      {isLogsExpanded && (
                        <div className="mt-3 p-3.5 rounded-xl bg-[#111111] text-zinc-200 border border-white/10 space-y-2">
                          <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                            <span>
                              Worker Logs — Version #{ver.id}
                              {logsInfo?.runnerSpecs
                                ? ` (${[logsInfo.runnerSpecs.cpuModel, logsInfo.runnerSpecs.cpuCores ? `${logsInfo.runnerSpecs.cpuCores} cores` : null].filter(Boolean).join(', ')})`
                                : ''}
                            </span>
                            <button
                              type="button"
                              onClick={() => fetchVersionStatusDetail(ver.id)}
                              className="text-[#FF9E40] hover:underline cursor-pointer"
                            >
                              รีเฟรช Log
                            </button>
                          </div>
                          {logsInfo?.loading ? (
                            <div className="flex items-center gap-2 text-xs text-zinc-400 py-2">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>กำลังโหลด Log...</span>
                            </div>
                          ) : logsInfo?.error ? (
                            <p className="text-xs text-rose-400">{logsInfo.error}</p>
                          ) : !logsInfo?.workerLogs?.length ? (
                            <p className="text-xs text-zinc-500 font-mono">ยังไม่มีบันทึกจาก Worker</p>
                          ) : (
                            <div className="max-h-56 overflow-y-auto space-y-1 font-mono text-[11px]">
                              {logsInfo.workerLogs.map((entry, idx) => (
                                <div key={idx} className="leading-relaxed break-words">
                                  {typeof entry === 'string' ? (
                                    <span className="text-zinc-200">{entry}</span>
                                  ) : (
                                    <>
                                      {(entry.ts || entry.t || entry.time || entry.timestamp) && (
                                        <span className="text-zinc-500">
                                          [{new Date(entry.ts || entry.t || entry.time || entry.timestamp).toLocaleTimeString('th-TH')}]{' '}
                                        </span>
                                      )}
                                      <span className={entry.level === 'error' ? 'text-rose-400' : 'text-zinc-200'}>
                                        {entry.message || entry.msg || entry.text || JSON.stringify(entry)}
                                      </span>
                                    </>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

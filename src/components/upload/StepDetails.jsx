'use client';

import { useMemo, useState, useRef } from 'react';
import {
  X,
  Plus,
  CheckCircle2,
  Loader2,
  ImagePlus,
  Check,
  Sparkles,
} from 'lucide-react';
import Select from '@/components/ui/Select';
import UploadDescriptionEditor from '@/components/upload/UploadDescriptionEditor';
import VideoLanguagePicker from '@/components/upload/VideoLanguagePicker';
import PlaylistPicker from '@/components/playlist/PlaylistPicker';
import { parseDescriptionDocument } from '@/lib/descriptionDocument.mjs';
import {
  UPLOAD_CATEGORIES,
  SUGGESTED_TAGS,
  cleanVideoTitle,
  formatThumbTime,
  resizeThumbnailFile,
} from '@/lib/videoEditorUtils';

const descriptionFileOptions = {
  types: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  help: 'เลือกรูป JPEG, PNG, WebP หรือ GIF',
};

export default function StepDetails({
  title,
  setTitle,
  description,
  onSaveDescription,
  sourceLanguage = '',
  setSourceLanguage,
  category,
  setCategory,
  tags,
  setTags,
  selectedPlaylistIds,
  onChangePlaylists,
  thumbnailUrl = '',
  thumbnailOptions = [],
  thumbnailStatus = 'waiting',
  isRawUploaded = false,
  isSavingThumbnail = false,
  onSelectThumbnail,
  onDispatchThumbnails,
  visionResult,
  onAddLog,
  workerDetail = '',
}) {
  const [tagInputValue, setTagInputValue] = useState('');
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [aiAnalysisSuccess, setAiAnalysisSuccess] = useState(false);
  const [thumbError, setThumbError] = useState('');
  const thumbInputRef = useRef(null);
  const descriptionValue = useMemo(() => parseDescriptionDocument(description), [description]);

  const handleCustomThumbnailUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setThumbError('');
    try {
      const dataUrl = await resizeThumbnailFile(file);
      if (onSelectThumbnail) await onSelectThumbnail(dataUrl, 'custom');
    } catch (err) {
      setThumbError(err.message || 'อัปโหลดภาพปกไม่สำเร็จ');
    }
  };

  // Clean filename helper
  const handleCleanTitle = () => {
    if (!title) return;
    setTitle(cleanVideoTitle(title));
  };

  // Add tag
  const handleAddTag = (rawTag) => {
    const trimmed = rawTag.trim().replace(/^[#,]+/, '');
    if (!trimmed) return;
    if (tags.length >= 15) return;
    if (tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return;
    setTags([...tags, trimmed]);
    setTagInputValue('');
  };

  // Remove tag
  const handleRemoveTag = (indexToRemove) => {
    setTags(tags.filter((_, idx) => idx !== indexToRemove));
  };

  const handleTagKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      handleAddTag(tagInputValue);
    } else if (e.key === 'Backspace' && !tagInputValue && tags.length > 0) {
      handleRemoveTag(tags.length - 1);
    }
  };

  // Trigger AI Category & Tag Analysis
  const handleRunAiAnalysis = async () => {
    if (isAiAnalyzing) return;
    setIsAiAnalyzing(true);
    setAiAnalysisSuccess(false);
    if (onAddLog) onAddLog('กำลังใช้ AI วิเคราะห์หมวดหมู่และแท็กที่เหมาะสมจากข้อมูลวิดีโอ...');

    try {
      await new Promise((r) => setTimeout(r, 900));

      let recommendedCategory = visionResult?.recommendedCategory || 'general';
      let recommendedTags = Array.isArray(visionResult?.recommendedTags)
        ? visionResult.recommendedTags
        : [];

      const lowerTitle = (title || '').toLowerCase();
      if (!visionResult?.recommendedCategory) {
        if (lowerTitle.includes('mv') || lowerTitle.includes('song') || lowerTitle.includes('เพลง') || lowerTitle.includes('official')) {
          recommendedCategory = 'music';
          recommendedTags = ['Music', 'Official MV', 'HLS'];
        } else if (lowerTitle.includes('game') || lowerTitle.includes('play') || lowerTitle.includes('เกม')) {
          recommendedCategory = 'gaming';
          recommendedTags = ['Gaming', 'Gameplay', 'Walkthrough'];
        } else if (lowerTitle.includes('short') || lowerTitle.includes('clip')) {
          recommendedCategory = 'shorts';
          recommendedTags = ['Shorts', 'Trending'];
        } else {
          recommendedCategory = 'entertainment';
          recommendedTags = ['HD', 'Streaming', 'TubeLock'];
        }
      }

      setCategory(recommendedCategory);
      setTags((prev) => Array.from(new Set([...prev, ...recommendedTags])).slice(0, 15));
      setAiAnalysisSuccess(true);
      if (onAddLog) {
        onAddLog(`AI วิเคราะห์เสร็จสิ้น: แนะนำหมวดหมู่ "${recommendedCategory}" และเพิ่มแท็ก [${recommendedTags.join(', ')}]`);
      }
    } catch (err) {
      if (onAddLog) onAddLog(`ข้อผิดพลาดการวิเคราะห์: ${err.message}`);
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  return (
    <div className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
      <div>
        <h2 className="text-base font-bold text-[#212529] dark:text-[#F1F1F1]">
          01 รายละเอียดวิดีโอ
        </h2>
        <p className="text-xs sm:text-sm text-[#6C655D] dark:text-[#AAAAAA] mt-0.5">
          ตั้งชื่อเรื่อง คำอธิบาย หมวดหมู่ และแท็กให้ผู้ชมค้นหาได้ง่าย
        </p>
      </div>

      {/* Title Field */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
            ชื่อวิดีโอ <span className="text-[#FF7A00]">*</span>
          </label>
          <button
            type="button"
            onClick={handleCleanTitle}
            disabled={!title}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] text-[#6C655D] dark:text-[#CCCCCC] border border-[#EFECE6] dark:border-white/10 transition disabled:opacity-40 cursor-pointer"
          >
            ล้างนามสกุลไฟล์ &amp; จัดคำ
          </button>
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="เช่น ตัวอย่างวิดีโอคมชัดสูง 4K HLS Streaming"
          className="w-full px-3.5 py-2.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 focus:bg-white dark:focus:bg-[#181818] focus:border-[#FF7A00] focus:ring-3 focus:ring-[#FF7A00]/15 text-[#212529] dark:text-[#F1F1F1] placeholder-[#8C857B] dark:placeholder-[#71717A] text-sm outline-none transition"
        />
        <div className="flex justify-between items-center text-[11px] text-[#8C857B] dark:text-[#9A9A9A]">
          <span>แนะนำความยาว 50–60 ตัวอักษร</span>
          <span className={title.length > 80 ? 'text-amber-600 dark:text-amber-400 font-mono' : 'font-mono'}>
            {title.length}/100
          </span>
        </div>
      </div>

      {/* Mandatory Source Spoken Language Picker */}
      <VideoLanguagePicker
        value={sourceLanguage}
        onChange={(val) => setSourceLanguage && setSourceLanguage(val)}
        required
      />

      <UploadDescriptionEditor
        value={descriptionValue}
        onSave={onSaveDescription}
        title={title}
        tags={tags}
        fileOptions={descriptionFileOptions}
        includeTimestamp
      />

      {/* Thumbnail Picker Section (YouTube Studio style) */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
              ภาพปกวิดีโอ
            </div>
            <p className="text-[11px] text-[#6C655D] dark:text-[#9A9A9A] mt-0.5">
              อัปโหลดภาพปกเอง หรือเลือกจาก 3 ช่วงของวิดีโอ (ต้น • กลาง • ท้าย)
            </p>
          </div>
          {isRawUploaded && thumbnailOptions.length === 0 && thumbnailStatus !== 'generating' && onDispatchThumbnails && (
            <button
              type="button"
              onClick={onDispatchThumbnails}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-[#FF7A00]/10 hover:bg-[#FF7A00] text-[#FF7A00] hover:text-white border border-[#FF7A00]/30 font-semibold transition cursor-pointer inline-flex items-center gap-1"
            >
              <Sparkles className="w-3 h-3" />
              <span>ดึง 3 ภาพจากวิดีโอ</span>
            </button>
          )}
        </div>

        <input
          ref={thumbInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleCustomThumbnailUpload}
          className="hidden"
        />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {/* Card 1: Custom Upload */}
          <button
            type="button"
            disabled={isSavingThumbnail}
            onClick={() => thumbInputRef.current?.click()}
            className="aspect-video rounded-xl border border-dashed border-[#D8D1C7] dark:border-white/20 bg-[#F4F0E8]/70 dark:bg-[#222222]/80 hover:border-[#FF7A00] hover:bg-[#FF7A00]/5 transition flex flex-col items-center justify-center gap-1.5 text-[#6C655D] dark:text-[#AAAAAA] hover:text-[#FF7A00] cursor-pointer disabled:opacity-60"
          >
            {isSavingThumbnail ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#FF7A00]" />
            ) : (
              <ImagePlus className="w-4 h-4" />
            )}
            <span className="text-[11px] font-semibold">อัปโหลดไฟล์ปก</span>
          </button>

          {/* Cards 2-4: 3 Video Segment Frames */}
          {thumbnailOptions.length > 0 ? (
            thumbnailOptions.slice(0, 3).map((opt, idx) => {
              const isSelected = Boolean(thumbnailUrl && thumbnailUrl === opt.dataUrl);
              return (
                <button
                  key={opt.id || idx}
                  type="button"
                  disabled={isSavingThumbnail}
                  onClick={() => onSelectThumbnail && onSelectThumbnail(opt.dataUrl, opt.label || `เฟรมที่ ${idx + 1}`)}
                  className={`group relative aspect-video rounded-xl overflow-hidden border transition cursor-pointer bg-[#141414] ${
                    isSelected
                      ? 'border-[#FF7A00] ring-2 ring-[#FF7A00]/40'
                      : 'border-[#EFECE6] dark:border-white/10 hover:border-[#FF7A00]/60'
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={opt.dataUrl}
                    alt=""
                    aria-hidden="true"
                    className="absolute inset-0 w-full h-full object-cover blur-md scale-110 opacity-50 pointer-events-none select-none"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={opt.dataUrl}
                    alt={opt.label || `ตัวอย่างภาพปก ${idx + 1}`}
                    className="relative z-10 w-full h-full object-contain group-hover:scale-[1.03] transition duration-200"
                  />
                  <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-2 py-1 flex items-center justify-between text-[10px] text-white">
                    <span className="font-medium truncate">{opt.label || `ช่วงที่ ${idx + 1}`}</span>
                    <span className="font-mono opacity-85">{formatThumbTime(opt.timeSec)}</span>
                  </div>
                  {isSelected && (
                    <span className="absolute top-1.5 right-1.5 z-20 w-5 h-5 rounded-full bg-[#FF7A00] text-white flex items-center justify-center shadow">
                      <Check className="w-3 h-3 stroke-[2.5]" />
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            ['ช่วงต้น', 'ช่วงกลาง', 'ช่วงท้าย'].map((segLabel) => (
              <div
                key={segLabel}
                className="aspect-video rounded-xl border border-[#EFECE6] dark:border-white/10 bg-[#F4F0E8]/60 dark:bg-[#222222]/50 flex flex-col items-center justify-center gap-1 text-[10px] text-[#8C857B] dark:text-[#8E8E93] px-2 text-center"
              >
                {thumbnailStatus === 'generating' && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FF7A00]" />
                )}
                <span>{thumbnailStatus === 'generating' ? `กำลังดึง ${segLabel}...` : segLabel}</span>
              </div>
            ))
          )}
        </div>

        {thumbnailStatus === 'generating' && (
          <div className="px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/25 text-[11px] font-mono text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-[#FF7A00]" />
            <span className="truncate">{workerDetail || 'กำลังส่งงานเข้า GitHub Actions เพื่อสกัดภาพปก 3 ช่วง...'}</span>
          </div>
        )}

        {thumbnailStatus === 'failed' && thumbnailOptions.length === 0 && (
          <div className="px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/25 text-[11px] text-rose-600 dark:text-rose-400">
            {workerDetail || 'สกัดภาพปก 3 ช่วงไม่สำเร็จ — สามารถกด "ดึง 3 ภาพจากวิดีโอ" ด้านบนเพื่อลองใหม่ หรืออัปโหลดภาพปกเอง'}
          </div>
        )}

        {thumbError && (
          <div className="text-[11px] text-rose-600 dark:text-rose-400">{thumbError}</div>
        )}
      </div>

      {/* AI Category & Tag Helper Card */}
      <div className="p-3.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
            ช่วยจัดหมวดหมู่และแท็กด้วย AI
          </div>
          <div className="text-[11px] text-[#6C655D] dark:text-[#9A9A9A] mt-0.5">
            วิเคราะห์จากชื่อวิดีโอและแนะนำหมวดหมู่พร้อมแท็กให้อัตโนมัติ
          </div>
        </div>
        <button
          type="button"
          onClick={handleRunAiAnalysis}
          disabled={isAiAnalyzing}
          className="px-3.5 py-2 rounded-xl text-xs font-semibold transition border bg-[#FF7A00]/10 border-[#FF7A00]/30 text-[#FF7A00] hover:bg-[#FF7A00] hover:text-white cursor-pointer shrink-0 flex items-center justify-center gap-1.5 disabled:opacity-60"
        >
          {isAiAnalyzing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          <span>{isAiAnalyzing ? 'กำลังวิเคราะห์...' : 'สั่ง AI แนะนำหมวดหมู่ & แท็ก'}</span>
        </button>
      </div>

      {aiAnalysisSuccess && (
        <div className="px-3.5 py-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>AI เลือกหมวดหมู่ที่เหมาะสมและเพิ่มแท็กที่เกี่ยวข้องให้เรียบร้อยแล้ว</span>
        </div>
      )}

      {/* Category & Tags Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <label className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1] block">
            หมวดหมู่
          </label>
          <Select
            options={UPLOAD_CATEGORIES}
            value={category}
            onChange={(val) => setCategory(val)}
            placeholder="เลือกหมวดหมู่วิดีโอ"
            className="w-full"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
              แท็กกำกับวิดีโอ
            </label>
            <span className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] font-mono">
              {tags.length}/15
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 focus-within:border-[#FF7A00] focus-within:bg-white dark:focus-within:bg-[#181818] transition">
            {tags.map((t, idx) => (
              <span
                key={idx}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-white dark:bg-[#181818] text-[#212529] dark:text-[#E4E4E7] border border-[#EFECE6] dark:border-white/10"
              >
                #{t}
                <button
                  type="button"
                  onClick={() => handleRemoveTag(idx)}
                  className="text-[#8C857B] hover:text-[#FF7A00] transition cursor-pointer"
                  aria-label={`ลบแท็ก ${t}`}
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}

            {tags.length < 15 && (
              <input
                type="text"
                value={tagInputValue}
                onChange={(e) => setTagInputValue(e.target.value)}
                onKeyDown={handleTagKeyDown}
                placeholder={tags.length === 0 ? 'พิมพ์แท็กแล้วกด Enter' : 'เพิ่มแท็ก...'}
                className="flex-1 min-w-[110px] bg-transparent text-xs sm:text-sm text-[#212529] dark:text-[#F1F1F1] placeholder-[#8C857B] dark:placeholder-[#71717A] outline-none px-1.5 py-0.5"
              />
            )}
          </div>
        </div>
      </div>

      {/* Suggested Tags */}
      <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
        <span className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] mr-1">แนะนำ:</span>
        {SUGGESTED_TAGS.map((stag) => {
          const isAlreadyAdded = tags.some((t) => t.toLowerCase() === stag.toLowerCase());
          return (
            <button
              key={stag}
              type="button"
              disabled={isAlreadyAdded || tags.length >= 15}
              onClick={() => handleAddTag(stag)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition cursor-pointer inline-flex items-center gap-1 ${
                isAlreadyAdded
                  ? 'bg-[#FF7A00]/10 border-[#FF7A00]/30 text-[#FF7A00] font-semibold cursor-default'
                  : 'bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] border-[#EFECE6] dark:border-white/10 text-[#6C655D] dark:text-[#AAAAAA]'
              }`}
            >
              <Plus className="w-2.5 h-2.5" />
              {stag}
            </button>
          );
        })}
      </div>

      <PlaylistPicker selectedIds={selectedPlaylistIds} onChange={onChangePlaylists} />
    </div>
  );
}

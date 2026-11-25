'use client';

import { useState, useRef } from 'react';
import {
  X,
  Plus,
  Check,
  ImagePlus,
  Loader2,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  Globe,
  Link2,
  Lock,
} from 'lucide-react';
import Select from '@/components/ui/Select';
import PlaylistPicker from '@/components/playlist/PlaylistPicker';
import VideoLanguagePicker from '@/components/upload/VideoLanguagePicker';
import { isRatingEvaluated } from '@/lib/ratingStatus';
import {
  VISIBILITY_OPTIONS,
  normalizeVideoVisibility,
  getVisibilityMeta,
} from '@/lib/videoVisibility';
import {
  UPLOAD_CATEGORIES,
  SUGGESTED_TAGS,
  CONTENT_RATINGS,
  cleanVideoTitle,
  formatThumbTime,
  resizeThumbnailFile,
} from '@/lib/videoEditorUtils';

function formatModerationText(text) {
  if (!text) return '';
  return String(text)
    .replace(/กิจรรม/g, 'กิจกรรม')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export default function StudioDetailsTab({
  title,
  setTitle,
  description,
  setDescription,
  sourceLanguage = '',
  setSourceLanguage,
  category,
  setCategory,
  tags,
  setTags,
  playlistIds,
  onPlaylistsChange,
  playlistLoadError,
  onRetryPlaylists,
  isSaving,
  thumbnailUrl,
  setThumbnailUrl,
  thumbnailOptions = [],
  thumbnailStatus = 'waiting',
  contentRating,
  setContentRating,
  visibility = 'public',
  setVisibility,
  ratingCheckStatus = 'pending',
  visionResult = null,
  hasRawFile = false,
  onDispatchThumbnails,
  onDispatchSpriteRating,
  isDispatchingThumbs = false,
  isDispatchingRating = false,
}) {
  const [tagInputValue, setTagInputValue] = useState('');
  const [thumbError, setThumbError] = useState('');
  const [isProcessingThumb, setIsProcessingThumb] = useState(false);
  const thumbInputRef = useRef(null);

  const handleCleanTitle = () => {
    if (!title) return;
    setTitle(cleanVideoTitle(title));
  };

  const handleInsertTimestamp = () => {
    const sample = `\n\nไทม์แสตมป์:\n00:00 บทนำ\n00:30 ช่วงสำคัญ\n01:00 สรุป`;
    setDescription((prev) => (prev ? prev + sample : sample.trim()));
  };

  const handleCustomThumbnailUpload = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setThumbError('');
    setIsProcessingThumb(true);
    try {
      const dataUrl = await resizeThumbnailFile(file);
      setThumbnailUrl(dataUrl);
    } catch (err) {
      setThumbError(err.message || 'ไม่สามารถอัปโหลดภาพปกได้');
    } finally {
      setIsProcessingThumb(false);
    }
  };

  const handleAddTag = (rawTag) => {
    const trimmed = String(rawTag || '').trim().replace(/^[#,]+/, '');
    if (!trimmed || tags.length >= 15) return;
    if (tags.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return;
    setTags([...tags, trimmed]);
    setTagInputValue('');
  };

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

  const isSelectedFromOptions = thumbnailOptions.some(
    (opt) => opt?.dataUrl && thumbnailUrl && opt.dataUrl === thumbnailUrl
  );
  const showCustomPreviewCard = Boolean(thumbnailUrl && !isSelectedFromOptions);
  const isThumbsBusy = isDispatchingThumbs || thumbnailStatus === 'generating';
  const isRatingBusy = isDispatchingRating || ratingCheckStatus === 'analyzing';
  const ratingLocked = isRatingEvaluated(ratingCheckStatus);

  return (
    <div className="space-y-6">
      {/* 1. Title & Description Card */}
      <section className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-5">
        {/* Title */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
              ชื่อ (ต้องระบุ) <span className="text-[#FF7A00]">*</span>
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
            maxLength={150}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="ระบุชื่อวิดีโอของคุณ"
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 focus:bg-white dark:focus:bg-[#181818] focus:border-[#FF7A00] focus:ring-3 focus:ring-[#FF7A00]/15 text-[#212529] dark:text-[#F1F1F1] placeholder-[#8C857B] dark:placeholder-[#71717A] text-sm outline-none transition"
          />
          <div className="flex justify-between items-center text-[11px] text-[#8C857B] dark:text-[#9A9A9A]">
            <span>แนะนำความยาว 50–100 ตัวอักษร</span>
            <span className={title.length > 100 ? 'text-amber-600 dark:text-amber-400 font-mono' : 'font-mono'}>
              {title.length}/150
            </span>
          </div>
        </div>

        {/* Description */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-xs sm:text-sm font-semibold text-[#212529] dark:text-[#F1F1F1]">
              คำอธิบาย
            </label>
            <button
              type="button"
              onClick={handleInsertTimestamp}
              className="text-[11px] px-2.5 py-1 rounded-lg bg-[#F4F0E8] dark:bg-[#222222] hover:bg-[#EFECE6] dark:hover:bg-[#2c2c2c] text-[#6C655D] dark:text-[#CCCCCC] border border-[#EFECE6] dark:border-white/10 transition cursor-pointer"
            >
              + เพิ่มโครงร่างไทม์แสตมป์
            </button>
          </div>
          <textarea
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="บอกข้อมูลเกี่ยวกับวิดีโอของคุณให้ผู้ชมทราบ เช่น เรื่องย่อ เครดิต หรือไทม์แสตมป์..."
            className="w-full px-3.5 py-2.5 rounded-xl bg-[#F4F0E8] dark:bg-[#222222] border border-[#EFECE6] dark:border-white/10 focus:bg-white dark:focus:bg-[#181818] focus:border-[#FF7A00] focus:ring-3 focus:ring-[#FF7A00]/15 text-[#212529] dark:text-[#F1F1F1] placeholder-[#8C857B] dark:placeholder-[#71717A] text-sm outline-none transition resize-y"
          />
        </div>
      </section>

      {/* 2. Thumbnail Picker Card */}
      <section className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-[#212529] dark:text-[#F1F1F1]">
              ภาพปก (Thumbnail)
            </h3>
            <p className="text-[11px] text-[#6C655D] dark:text-[#9A9A9A] mt-0.5">
              อัปโหลดภาพปกใหม่ หรือเลือกเฟรมจากช่วงต่างๆ ของวิดีโอ (อัปเดตทั้งฐานข้อมูลและ poster.jpg บน OneDrive)
            </p>
          </div>

          {hasRawFile && onDispatchThumbnails && (
            <button
              type="button"
              disabled={isThumbsBusy}
              onClick={onDispatchThumbnails}
              className="text-[11px] px-3 py-1.5 rounded-xl bg-[#FF7A00]/10 hover:bg-[#FF7A00] text-[#FF7A00] hover:text-white border border-[#FF7A00]/30 font-semibold transition cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isThumbsBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{isThumbsBusy ? 'กำลังสกัด 3 ภาพ...' : 'ดึง 3 ภาพจากวิดีโอ'}</span>
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Upload new cover button */}
          <button
            type="button"
            disabled={isProcessingThumb}
            onClick={() => thumbInputRef.current?.click()}
            className="aspect-video rounded-xl border border-dashed border-[#D8D1C7] dark:border-white/20 bg-[#F4F0E8]/70 dark:bg-[#222222]/80 hover:border-[#FF7A00] hover:bg-[#FF7A00]/5 transition flex flex-col items-center justify-center gap-1.5 text-[#6C655D] dark:text-[#AAAAAA] hover:text-[#FF7A00] cursor-pointer disabled:opacity-60"
          >
            {isProcessingThumb ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#FF7A00]" />
            ) : (
              <ImagePlus className="w-5 h-5" />
            )}
            <span className="text-[11px] font-semibold">อัปโหลดไฟล์ปกใหม่</span>
          </button>

          {/* Current / Custom active cover card (if not in the 3 extracted frames) */}
          {showCustomPreviewCard && (
            <div className="relative aspect-video rounded-xl overflow-hidden border border-[#FF7A00] ring-2 ring-[#FF7A00]/35 bg-[#141414]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailUrl}
                alt=""
                aria-hidden="true"
                className="absolute inset-0 w-full h-full object-cover blur-md scale-110 opacity-45 pointer-events-none select-none"
              />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbnailUrl}
                alt="ภาพปกปัจจุบัน"
                className="relative z-10 w-full h-full object-contain"
              />
              <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/80 via-black/30 to-transparent px-2 py-1 text-[10px] text-white font-medium">
                ปกปัจจุบัน / กำหนดเอง
              </div>
              <span className="absolute top-1.5 right-1.5 z-20 w-5 h-5 rounded-full bg-[#FF7A00] text-white flex items-center justify-center shadow">
                <Check className="w-3 h-3 stroke-[2.5]" />
              </span>
            </div>
          )}

          {/* Extracted 3 segment thumbnails */}
          {thumbnailOptions.slice(0, 3).map((opt, idx) => {
            const isSelected = Boolean(thumbnailUrl && thumbnailUrl === opt.dataUrl);
            return (
              <button
                key={opt.id || idx}
                type="button"
                onClick={() => setThumbnailUrl(opt.dataUrl)}
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
                  className="absolute inset-0 w-full h-full object-cover blur-md scale-110 opacity-45 pointer-events-none select-none"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={opt.dataUrl}
                  alt={opt.label || `เฟรมที่ ${idx + 1}`}
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
          })}
        </div>

        {thumbError && (
          <div className="text-xs text-rose-600 dark:text-rose-400">{thumbError}</div>
        )}
      </section>

      {/* 3. Language, Category & Tags Card */}
      <section className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <VideoLanguagePicker
          value={sourceLanguage}
          onChange={(val) => setSourceLanguage && setSourceLanguage(val)}
          required={false}
          compact
        />

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

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="text-[11px] text-[#8C857B] dark:text-[#9A9A9A] mr-1">แท็กแนะนำ:</span>
          {SUGGESTED_TAGS.map((stag) => {
            const isAdded = tags.some((t) => t.toLowerCase() === stag.toLowerCase());
            return (
              <button
                key={stag}
                type="button"
                disabled={isAdded || tags.length >= 15}
                onClick={() => handleAddTag(stag)}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition cursor-pointer inline-flex items-center gap-1 ${
                  isAdded
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

        <div className="border-t border-[#EFECE6] pt-4 dark:border-white/10">
          <PlaylistPicker
            selectedIds={playlistIds ?? []}
            onChange={onPlaylistsChange}
            disabled={!playlistIds || isSaving}
            helperText="การเปลี่ยนแปลงเพลย์ลิสต์จะมีผลเมื่อกดบันทึก"
          />
          {playlistLoadError ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-rose-700 dark:text-rose-400">
              <p role="alert">{playlistLoadError}</p>
              <button type="button" onClick={onRetryPlaylists} className="cursor-pointer font-semibold underline">
                ลองอีกครั้ง
              </button>
            </div>
          ) : !playlistIds && (
            <p role="status" className="mt-2 flex items-center gap-2 text-xs text-[#6C655D] dark:text-[#AAAAAA]">
              <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
              กำลังโหลดเพลย์ลิสต์ของวิดีโอ…
            </p>
          )}
        </div>
      </section>

      {/* 3.5 Visibility Card */}
      {setVisibility && (() => {
        const currentVisibility = normalizeVideoVisibility(visibility);
        const currentMeta = getVisibilityMeta(currentVisibility);
        const VisibilityIcon =
          currentVisibility === 'private' ? Lock : currentVisibility === 'unlisted' ? Link2 : Globe;
        const visibilitySelectOptions = VISIBILITY_OPTIONS.map((opt) => ({
          value: opt.value,
          label: opt.label,
          desc: opt.description,
          icon: opt.value === 'private' ? Lock : opt.value === 'unlisted' ? Link2 : Globe,
        }));

        return (
          <section className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs sm:text-sm font-bold text-[#212529] dark:text-[#F1F1F1] flex items-center gap-1.5">
                  <VisibilityIcon className="w-4 h-4 text-[#FF7A00]" />
                  <span>ระดับการแสดงผล (Visibility)</span>
                </h3>
                <p className="text-[11px] text-[#6C655D] dark:text-[#9A9A9A] mt-0.5">
                  เลือกว่าใครสามารถค้นหาและรับชมวิดีโอนี้ได้บ้าง
                </p>
              </div>
              <span className="text-[11px] px-2.5 py-0.5 rounded-full font-semibold bg-[#FF7A00]/10 text-[#FF7A00] shrink-0">
                {currentMeta.label}
              </span>
            </div>

            <Select
              options={visibilitySelectOptions}
              value={currentVisibility}
              onChange={(val) => setVisibility(val)}
              placeholder="เลือกระดับการแสดงผล..."
              disabled={isSaving}
              className="w-full"
            />

            <p className="text-[11px] text-[#6C655D] dark:text-[#9A9A9A] leading-relaxed">
              {currentMeta.description}
            </p>
          </section>
        );
      })()}

      {/* 4. Audience / Content Rating Card */}
      <section className="bg-white dark:bg-[#181818] border border-[#EFECE6] dark:border-white/10 rounded-2xl p-5 sm:p-6 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-xs sm:text-sm font-bold text-[#212529] dark:text-[#F1F1F1] flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-[#FF7A00]" />
              <span>เรตติ้งและการจำกัดอายุผู้ชม</span>
            </h3>
            <p className="text-[11px] text-[#6C655D] dark:text-[#9A9A9A] mt-0.5">
              {ratingLocked
                ? 'ประเมินเรตแล้วและล็อกการแก้ไข'
                : 'กำหนดระดับความเหมาะสมของเนื้อหา (หากตั้งเป็น 18+ หรือ จำกัดเฉพาะ หน้าแรกจะซ่อนภาพปกไว้จนกว่าผู้ชมที่ล็อกอินจะกดยืนยัน)'}
            </p>
          </div>

          {!ratingLocked && hasRawFile && onDispatchSpriteRating && (
            <button
              type="button"
              disabled={isRatingBusy}
              onClick={onDispatchSpriteRating}
              className="text-[11px] px-3 py-1.5 rounded-xl bg-[#FF7A00]/10 hover:bg-[#FF7A00] text-[#FF7A00] hover:text-white border border-[#FF7A00]/30 font-semibold transition cursor-pointer inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isRatingBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{isRatingBusy ? 'AI กำลังประเมิน...' : 'ให้ AI ตรวจสอบเรตใหม่'}</span>
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {CONTENT_RATINGS.map((item) => {
            const isSelected = contentRating === item.id;
            return (
              <button
                key={item.id}
                type="button"
                disabled={ratingLocked || isRatingBusy}
                aria-pressed={isSelected}
                onClick={() => setContentRating(item.id)}
                className={`p-3.5 rounded-xl border text-left transition enabled:cursor-pointer ${
                  isSelected
                    ? 'bg-[#FF7A00]/10 border-[#FF7A00]'
                    : 'bg-[#F4F0E8] dark:bg-[#222222] border-[#EFECE6] dark:border-white/10 enabled:hover:border-[#D5CFC5] dark:enabled:hover:border-white/20'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs sm:text-sm font-bold text-[#212529] dark:text-[#F1F1F1]">
                    {item.label}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-md font-bold border ${
                      isSelected
                        ? 'bg-[#FF7A00] border-[#FF7A00] text-white'
                        : 'bg-white dark:bg-[#181818] border-[#EFECE6] dark:border-white/10 text-[#6C655D] dark:text-[#AAAAAA]'
                    }`}
                  >
                    {item.badge}
                  </span>
                </div>
                <p className="text-[11px] text-[#6C655D] dark:text-[#9A9A9A] leading-relaxed">
                  {item.desc}
                </p>
              </button>
            );
          })}
        </div>

        {visionResult && (
          <div
            className={`p-3.5 rounded-xl border space-y-2 ${
              visionResult.verificationStatus === 'MISMATCH_WARNING'
                ? 'bg-amber-500/10 border-amber-500/30'
                : 'bg-emerald-500/10 border-emerald-500/30'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-semibold flex items-center gap-1.5 text-[#212529] dark:text-[#F1F1F1]">
                {visionResult.verificationStatus === 'MISMATCH_WARNING' ? (
                  <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                )}
                <span>
                  ผลประเมิน AI ล่าสุด: {visionResult.suggestedRatingLabel || visionResult.suggestedRating}
                </span>
              </div>
              {!ratingLocked && !isRatingBusy && visionResult.suggestedRating && contentRating !== visionResult.suggestedRating && (
                <button
                  type="button"
                  onClick={() => setContentRating(visionResult.suggestedRating)}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition cursor-pointer"
                >
                  ใช้เรตที่ AI แนะนำ
                </button>
              )}
            </div>
            {visionResult.summary && (
              <p className="text-xs text-[#6C655D] dark:text-[#CCCCCC] leading-relaxed [word-break:normal] [overflow-wrap:break-word]">
                {formatModerationText(visionResult.summary)}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

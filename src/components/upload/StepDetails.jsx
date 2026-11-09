'use client';

import { useState } from 'react';
import {
  FileText,
  Sliders,
  Tag,
  X,
  Plus,
  Cpu,
  CheckCircle2,
  Loader2,
} from 'lucide-react';
import Select from '@/components/ui/Select';

const UPLOAD_CATEGORIES = [
  { value: 'general', label: 'ทั่วไป (General)' },
  { value: 'shorts', label: 'วิดีโอสั้น (Shorts)' },
  { value: 'cinema', label: 'ภาพยนตร์ / ซีรีส์ (Cinema)' },
  { value: 'music', label: 'เพลง / ดนตรี (Music)' },
  { value: 'entertainment', label: 'บันเทิง / วาไรตี้' },
  { value: 'gaming', label: 'เกม (Gaming)' },
  { value: 'tech', label: 'เทคโนโลยี / ไอที' },
  { value: 'education', label: 'การศึกษา / สาระ' },
];

const SUGGESTED_TAGS = ['Shorts', '4K', '1080p', 'Music', 'Gaming', 'HLS', 'Tech', 'Vlog', 'Tutorial', 'Highlight'];

export default function StepDetails({
  title,
  setTitle,
  description,
  setDescription,
  category,
  setCategory,
  tags,
  setTags,
  visionResult,
  onAddLog,
}) {
  const [tagInputValue, setTagInputValue] = useState('');
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [aiAnalysisSuccess, setAiAnalysisSuccess] = useState(false);

  // Clean filename helper
  const handleCleanTitle = () => {
    if (!title) return;
    const cleaned = title
      .replace(/\.(mp4|mkv|mov|avi|webm|flv|m4v|wmv)$/i, '')
      .replace(/[_\-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    setTitle(cleaned);
  };

  // Insert timestamp sample helper
  const handleInsertTimestamp = () => {
    const sample = `\n\n📌 ไทม์แสตมป์:\n00:00 บทนำ\n00:30 จุดเด่น\n01:00 สรุป`;
    setDescription((prev) => (prev ? prev + sample : sample.trim()));
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
    <div className="space-y-6">
      {/* Title Field (Required) */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-[#F1F1F1] flex items-center gap-1.5">
            <FileText className="w-4 h-4 text-[#f97316]" />
            ชื่อวิดีโอ (Title) <span className="text-[#f97316]">*</span>
          </label>
          <button
            type="button"
            onClick={handleCleanTitle}
            disabled={!title}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-[#222222] hover:bg-[#2c2c2c] text-[#A1A1AA] hover:text-[#F1F1F1] border border-[#333333] transition disabled:opacity-40 cursor-pointer"
          >
            ล้างนามสกุลไฟล์ & จัดคำ
          </button>
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="เช่น ตัวอย่างวิดีโอคมชัดสูง 4K HLS Streaming"
          className="w-full px-4 py-3 rounded-xl bg-[#0a0a0a] border border-[#2e2e2e] focus:border-[#f97316] focus:ring-1 focus:ring-[#f97316] text-[#F1F1F1] placeholder-[#555555] text-sm outline-none transition"
        />
        <div className="flex justify-between items-center mt-2 text-xs text-[#71717A]">
          <span>แนะนำความยาว 50-60 ตัวอักษรเพื่อประสิทธิภาพ SEO สูงสุด</span>
          <span className={title.length > 80 ? 'text-amber-400 font-mono' : 'font-mono'}>
            {title.length}/100
          </span>
        </div>
      </div>

      {/* Description Field */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-lg">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold text-[#F1F1F1]">
            คำอธิบายวิดีโอ (Description)
          </label>
          <button
            type="button"
            onClick={handleInsertTimestamp}
            className="text-[11px] px-2.5 py-1 rounded-lg bg-[#222222] hover:bg-[#2c2c2c] text-[#A1A1AA] hover:text-[#F1F1F1] border border-[#333333] transition cursor-pointer"
          >
            + เพิ่มโครงร่างไทม์แสตมป์
          </button>
        </div>
        <textarea
          rows={5}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="ใส่รายละเอียด เนื้อหา บทบรรยาย หรือข้อมูลเครดิต..."
          className="w-full px-4 py-3 rounded-xl bg-[#0a0a0a] border border-[#2e2e2e] focus:border-[#f97316] focus:ring-1 focus:ring-[#f97316] text-[#F1F1F1] placeholder-[#555555] text-sm outline-none transition resize-y font-sans"
        />
      </div>

      {/* Category & AI Assistant */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-lg space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <label className="text-sm font-semibold text-[#F1F1F1] flex items-center gap-1.5">
            <Sliders className="w-4 h-4 text-[#f97316]" />
            หมวดหมู่วิดีโอ (Category)
          </label>

          {/* AI Category Assistant Button (Unlocked via ENV Key) */}
          <button
            type="button"
            onClick={handleRunAiAnalysis}
            disabled={isAiAnalyzing}
            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition border bg-gradient-to-r from-[#ea580c]/20 to-[#f97316]/20 border-[#f97316]/50 text-[#f97316] hover:bg-[#f97316] hover:text-white cursor-pointer shadow-md shadow-[#ea580c]/10"
          >
            {isAiAnalyzing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>กำลังวิเคราะห์หมวดหมู่และแท็ก...</span>
              </>
            ) : (
              <>
                <Cpu className="w-3.5 h-3.5" />
                <span>ให้ AI วิเคราะห์หมวดหมู่และแท็กจากวิดีโอ</span>
              </>
            )}
          </button>
        </div>

        {/* Category Selector */}
        <div className="max-w-md">
          <Select
            options={UPLOAD_CATEGORIES}
            value={category}
            onChange={(val) => setCategory(val)}
            placeholder="เลือกหมวดหมู่วิดีโอ"
          />
        </div>

        {aiAnalysisSuccess && (
          <div className="p-3 bg-emerald-950/30 border border-emerald-800/40 rounded-xl text-xs text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>AI ได้เลือกหมวดหมู่ที่เหมาะสมและเพิ่มแท็กที่เกี่ยวข้องให้เรียบร้อยแล้ว</span>
          </div>
        )}
      </div>

      {/* Tags Section */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 shadow-lg space-y-3">
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-[#F1F1F1] flex items-center gap-1.5">
            <Tag className="w-4 h-4 text-[#f97316]" />
            แท็กกำกับวิดีโอ (Tags)
          </label>
          <span className="text-xs text-[#71717A] font-mono">{tags.length}/15</span>
        </div>

        {/* Tag Input Box */}
        <div className="flex flex-wrap items-center gap-2 p-2.5 rounded-xl bg-[#0a0a0a] border border-[#2e2e2e] focus-within:border-[#f97316] transition">
          {tags.map((t, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[#1c1c1c] text-[#E4E4E7] border border-[#333333]"
            >
              #{t}
              <button
                type="button"
                onClick={() => handleRemoveTag(idx)}
                className="text-[#71717A] hover:text-[#f97316] transition cursor-pointer"
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
              placeholder={tags.length === 0 ? 'พิมพ์แท็กแล้วกด Enter หรือใส่เครื่องหมายจุลภาค (,)' : 'เพิ่มแท็ก...'}
              className="flex-1 min-w-[140px] bg-transparent text-sm text-[#F1F1F1] placeholder-[#555555] outline-none px-2 py-0.5"
            />
          )}
        </div>

        {/* Suggested Tags */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-[#71717A] mr-1">แนะนำ:</span>
          {SUGGESTED_TAGS.map((stag) => {
            const isAlreadyAdded = tags.some((t) => t.toLowerCase() === stag.toLowerCase());
            return (
              <button
                key={stag}
                type="button"
                disabled={isAlreadyAdded || tags.length >= 15}
                onClick={() => handleAddTag(stag)}
                className={`text-[11px] px-2 py-0.5 rounded-md border transition cursor-pointer flex items-center gap-1 ${
                  isAlreadyAdded
                    ? 'bg-[#181818] border-[#282828] text-[#555555] opacity-50 cursor-default'
                    : 'bg-[#1c1c1c] hover:bg-[#252525] border-[#333333] text-[#A1A1AA] hover:text-[#F1F1F1]'
                }`}
              >
                <Plus className="w-2.5 h-2.5" />
                {stag}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

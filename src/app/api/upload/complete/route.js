import { getSessionUserId, isAdmin, accessError } from '@/lib/access';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { triggerGitHubWorkflow } from '@/app/api/upload/dispatch-action/route';
import { ensureWorkerLogsColumn, appendWorkerLog } from '@/lib/workerLogs';

/**
 * POST /api/upload/complete
 * Called when the user confirms settings in Step 4 to start HLS Transcoding
 * and (if not already triggered) dispatches the AI Subtitle & Sprite Content Rating workflows.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      videoId,
      title,
      description,
      category,
      tags,
      contentRating = 'all',
      subtitleMode = 'none', // 'manual' | 'ai' | 'none'
      manualSubtitleSrt = '',
      manualSubtitleVtt = '',
      selectedModel = '',
      customPrompt = '',
      runAiRatingVerify = true,
      clientMeta = {},
    } = body;

    const envModelName = (process.env.GEMINI_MODEL_NAME || 'gemini-3.5-flash-lite')
      .replace(/['"]/g, '')
      .replace(/flesh/gi, 'flash')
      .trim();
    const resolvedModel =
      selectedModel && selectedModel.trim() ? selectedModel.replace(/flesh/gi, 'flash').trim() : envModelName;

    if (!videoId) {
      return NextResponse.json(
        { success: false, error: 'กรุณาระบุ videoId (videoId is required)' },
        { status: 400 }
      );
    }

    const sql = getDb();
    const userId = await getSessionUserId(sql);
    if (userId == null) return accessError(401);

    // Ensure columns exist
    try {
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'general';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS audio_status VARCHAR(50) DEFAULT 'waiting';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_status VARCHAR(50) DEFAULT 'waiting';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_srt TEXT DEFAULT '';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_vtt TEXT DEFAULT '';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS subtitle_model VARCHAR(100) DEFAULT '';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS sprite_status VARCHAR(50) DEFAULT 'waiting';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS sprite_preview_url TEXT DEFAULT '';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS content_rating VARCHAR(50) DEFAULT 'all';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS user_selected_rating VARCHAR(50) DEFAULT 'all';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS ai_suggested_rating VARCHAR(50) DEFAULT '';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS rating_check_status VARCHAR(50) DEFAULT 'pending';`;
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS vision_analysis JSONB;`;
      await sql`ALTER TABLE videos ALTER COLUMN fps TYPE NUMERIC(7, 3);`;
      await ensureWorkerLogsColumn(sql);
    } catch (_) {}

    // 1. Verify video exists in DB
    const existing = await sql`
      SELECT id, title, raw_file_name, status, audio_status, subtitle_status, sprite_status, rating_check_status, updated_at
      FROM videos 
      WHERE id = ${videoId} AND (${isAdmin(userId)} OR user_id = ${userId})
      LIMIT 1;
    `;

    if (!existing || existing.length === 0) {
      return NextResponse.json(
        { success: false, error: `ไม่พบวิดีโอ ID: ${videoId}` },
        { status: 404 }
      );
    }

    const currentVideo = existing[0];

    // Anti-Spam / Concurrent Execution Protection
    const nowMs = Date.now();
    const updatedMs = currentVideo.updated_at ? new Date(currentVideo.updated_at).getTime() : 0;
    const isRecent = (nowMs - updatedMs) < 60000; // ภายใน 60 วินาทีที่เพิ่งสั่งรันไป

    if (isRecent && (currentVideo.status === 'PROCESSING' || currentVideo.status === 'TRANSCODING' || currentVideo.status === 'QUEUED')) {
      return NextResponse.json({
        success: true,
        videoId,
        status: currentVideo.status,
        alreadyRunning: true,
        message: 'วิดีโอนี้อยู่ในคิวหรือกำลังรันกระบวนการแปลงไฟล์ HLS อยู่แล้ว ไม่สามารถสั่งซ้ำได้',
      });
    }
    const finalRawFileName = currentVideo.raw_file_name;
    const finalTitle = title || currentVideo.title;
    const finalDescription = typeof description === 'string' ? description : '';
    const finalCategory = typeof category === 'string' && category.trim() ? category.trim() : 'general';
    const finalTags = Array.isArray(tags) ? tags : [];
    const finalRating = contentRating || 'all';

    // Handle manual subtitle upload if provided
    const hasManualSub = subtitleMode === 'manual' && (manualSubtitleSrt || manualSubtitleVtt);
    const rawDurNum = Number(clientMeta?.duration || 0);
    const safeDuration = Number.isFinite(rawDurNum) && rawDurNum > 0 ? Math.floor(rawDurNum) : 0;
    const rawFpsNum = Number(clientMeta?.fps || 0);
    const safeFps = Number.isFinite(rawFpsNum) && rawFpsNum > 0 ? Math.round(rawFpsNum * 1000) / 1000 : 0;

    // 2. Mark as QUEUED in Neon DB and save comprehensive client metadata
    const claimed = await sql`
      UPDATE videos 
      SET 
        status = 'QUEUED',
        transcode_progress = 5,
        stage_detail = 'อัปโหลดเข้า OneDrive สำเร็จ กำลังส่งคำสั่งเข้าคิว GitHub Actions',
        title = ${finalTitle},
        description = ${finalDescription},
        category = ${finalCategory},
        tags = ${finalTags},
        content_rating = ${finalRating === 'auto' ? 'all' : finalRating},
        user_selected_rating = ${finalRating},
        subtitle_status = CASE WHEN ${hasManualSub} THEN 'ready' ELSE subtitle_status END,
        subtitle_srt = CASE WHEN ${hasManualSub} THEN ${manualSubtitleSrt} ELSE subtitle_srt END,
        subtitle_vtt = CASE WHEN ${hasManualSub} THEN ${manualSubtitleVtt} ELSE subtitle_vtt END,
        raw_file_name = ${finalRawFileName},
        duration = CASE WHEN CAST(${safeDuration} AS INTEGER) > 0 THEN CAST(${safeDuration} AS INTEGER) ELSE duration END,
        resolution = CASE WHEN ${clientMeta.resolution || ''} <> '' THEN ${clientMeta.resolution} ELSE resolution END,
        fps = CASE WHEN CAST(${safeFps} AS NUMERIC) > 0 THEN CAST(${safeFps} AS NUMERIC) ELSE fps END,
        codec = CASE WHEN ${clientMeta.codec || ''} <> '' THEN ${clientMeta.codec} ELSE codec END,
        thumbnail_url = CASE 
          WHEN ${clientMeta.thumbnailDataUrl || ''} <> '' THEN ${clientMeta.thumbnailDataUrl}
          WHEN thumbnail_url IS NOT NULL AND thumbnail_url <> '' THEN thumbnail_url
          ELSE ${`/streams/stream_vid_${videoId}/poster.jpg`}
        END,
        updated_at = NOW()
      WHERE id = ${videoId} AND (${isAdmin(userId)} OR user_id = ${userId})
        AND status IS NOT DISTINCT FROM ${currentVideo.status}
        AND (status IS NULL OR status NOT IN ('QUEUED', 'PROCESSING', 'TRANSCODING')
          OR updated_at <= NOW() - INTERVAL '60 seconds')
      RETURNING id;
    `;

    if (!claimed.length) {
      return NextResponse.json({ success: false, error: 'Video status changed' }, { status: 409 });
    }

    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_PAT || process.env.GITHUB_PAT || '';
    if (!githubToken) {
      const warnMsg = 'ไม่ได้ตั้งค่า GITHUB_TOKEN ในระบบ กรุณาเพิ่ม GITHUB_TOKEN ในไฟล์ .env.local หรือ Vercel Environment Variables';
      await sql`
        UPDATE videos 
        SET 
          status = 'FAILED',
          stage_detail = 'รอ Trigger GitHub Actions (ยังไม่ได้ตั้งค่า GITHUB_TOKEN)',
          error_message = ${warnMsg},
          updated_at = NOW()
        WHERE id = ${videoId} AND (${isAdmin(userId)} OR user_id = ${userId});
      `;

      return NextResponse.json({
        success: false,
        videoId,
        status: 'FAILED',
        warning: warnMsg,
        message: 'อัปโหลดไฟล์เข้า OneDrive สำเร็จแล้ว แต่ยังไม่ได้รัน GitHub Actions เนื่องจากยังไม่มี GITHUB_TOKEN',
      }, { status: 503 });
    }

    // 3. Dispatch Workflow #3: HLS Multi-bitrate Transcoder (transcode.yml)
    try {
      await appendWorkerLog(sql, videoId, {
        source: 'hls',
        label: 'HLS Engine',
        message: `🚀 กำลังส่งคำสั่งหั่น HLS Multi-bitrate (transcode.yml) สำหรับไฟล์ ${finalRawFileName}`,
      });
      await triggerGitHubWorkflow('transcode.yml', {
        video_id: String(videoId),
        raw_file_name: String(finalRawFileName),
        title: String(finalTitle),
      });
      await appendWorkerLog(sql, videoId, {
        source: 'hls',
        label: 'HLS Engine',
        level: 'success',
        message: '✅ ส่งคิวเข้า GitHub Actions (transcode.yml) สำเร็จ รอ Ubuntu Runner รับงาน (~10-20 วิ)',
      });
    } catch (dispatchErr) {
      const failMsg = dispatchErr.message;
      await appendWorkerLog(sql, videoId, {
        source: 'hls',
        label: 'HLS Engine',
        level: 'error',
        message: `❌ ส่งคำสั่ง transcode.yml ไม่สำเร็จ: ${failMsg}`,
      });
      await sql`
        UPDATE videos 
        SET 
          status = 'FAILED',
          stage_detail = 'ส่งคำสั่งเข้า GitHub Actions ไม่สำเร็จ',
          error_message = ${failMsg},
          updated_at = NOW()
        WHERE id = ${videoId} AND (${isAdmin(userId)} OR user_id = ${userId});
      `;
      return NextResponse.json(
        { success: false, videoId, status: 'FAILED', error: failMsg },
        { status: 502 }
      );
    }

    // 4. Dispatch Workflow #1 (Audio & AI Subtitles) if subtitleMode === 'ai' and not already running/ready
    const shouldDispatchAudioSub =
      subtitleMode === 'ai' &&
      currentVideo.subtitle_status !== 'ready' &&
      currentVideo.subtitle_status !== 'processing';

    if (shouldDispatchAudioSub) {
      try {
        await sql`
          UPDATE videos
          SET audio_status = 'extracting',
              subtitle_status = 'processing',
              subtitle_model = ${resolvedModel},
              updated_at = NOW()
          WHERE id = ${videoId} AND (${isAdmin(userId)} OR user_id = ${userId});
        `;
        await triggerGitHubWorkflow('extract-audio-subtitles.yml', {
          video_id: String(videoId),
          raw_file_name: String(finalRawFileName),
          model: String(resolvedModel),
          custom_prompt: String(customPrompt || ''),
        });
        await appendWorkerLog(sql, videoId, {
          source: 'subtitles',
          label: 'Audio & Sub',
          message: `🚀 ส่งคำสั่งถอดเสียงและซับอัตโนมัติ (${resolvedModel}) เข้าคิว GitHub Actions`,
        });
      } catch (subErr) {
        console.warn('[Auto-dispatch Audio Subtitle Warning]:', subErr.message);
        await appendWorkerLog(sql, videoId, {
          source: 'subtitles',
          label: 'Audio & Sub',
          level: 'warn',
          message: `⚠️ Auto-dispatch ซับล้มเหลว: ${subErr.message}`,
        });
      }
    }

    // 5. Dispatch Workflow #2 (Detailed Sprite Sheet Grid & AI Content Rating Verification)
    // Runs automatically to verify the user's selected rating (or auto-select if 'auto')
    const shouldDispatchSpriteRating =
      runAiRatingVerify &&
      currentVideo.rating_check_status !== 'analyzing' &&
      currentVideo.rating_check_status !== 'VERIFIED_MATCH' &&
      currentVideo.rating_check_status !== 'AI_AUTO_SELECTED';

    if (shouldDispatchSpriteRating) {
      try {
        await sql`
          UPDATE videos
          SET sprite_status = CASE WHEN sprite_status = 'ready' THEN 'ready' ELSE 'generating' END,
              rating_check_status = 'analyzing',
              updated_at = NOW()
          WHERE id = ${videoId} AND (${isAdmin(userId)} OR user_id = ${userId});
        `;
        await triggerGitHubWorkflow('sprite-content-rating.yml', {
          video_id: String(videoId),
          raw_file_name: String(finalRawFileName),
          user_rating: String(finalRating),
          auto_apply: finalRating === 'auto' ? 'true' : 'false',
          model: String(resolvedModel),
        });
        await appendWorkerLog(sql, videoId, {
          source: 'rating',
          label: 'Sprite & Rating',
          message: `🚀 ส่งคำสั่งตรวจเรตเนื้อหาด้วย Gemini Vision (เรต: ${finalRating})`,
        });
      } catch (spErr) {
        console.warn('[Auto-dispatch Sprite Rating Warning]:', spErr.message);
        await appendWorkerLog(sql, videoId, {
          source: 'rating',
          label: 'Sprite & Rating',
          level: 'warn',
          message: `⚠️ Auto-dispatch ตรวจเรตล้มเหลว: ${spErr.message}`,
        });
      }
    }

    // 6. Update status to 'PROCESSING'
    await sql`
      UPDATE videos 
      SET 
        status = 'PROCESSING',
        transcode_progress = 10,
        stage_detail = 'GitHub Actions ได้รับคิวงานแล้ว กำลังเตรียม Ubuntu Runner',
        error_message = '',
        updated_at = NOW()
      WHERE id = ${videoId} AND (${isAdmin(userId)} OR user_id = ${userId}) AND status = 'QUEUED';
    `;

    return NextResponse.json({
      success: true,
      videoId,
      status: 'PROCESSING',
      dispatchedAudioSub: shouldDispatchAudioSub,
      dispatchedSpriteRating: shouldDispatchSpriteRating,
      message: 'ส่งคำสั่งรัน Transcode และ AI Workflows ไปยัง GitHub Actions เรียบร้อยแล้ว',
    });
  } catch (err) {
    console.error('[Upload Complete Error]:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'เกิดข้อผิดพลาดในการสั่งรัน Transcoder' },
      { status: 500 }
    );
  }
}

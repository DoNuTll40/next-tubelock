import {
  isSubtitleWorkflowActive, isWorkflowConfigured, markSubtitleDispatchFailed,
  normalizeSubtitlePrompt, triggerGitHubWorkflow,
} from '@/lib/subtitleWorkflow';
import { randomUUID } from 'node:crypto';
import { validateSavedDescription } from '@/lib/descriptionDocument.mjs';
import { getCachedServerSession, isAdmin, accessError } from '@/lib/access';
import { apiError } from '@/lib/apiError';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { appendWorkerLog } from '@/lib/workerLogs';
import { EVALUATED_RATING_STATUSES, isRatingEvaluated } from '@/lib/ratingStatus';
import { dispatchSpriteRating, resolveRatingModel } from '@/lib/ratingWorkflow';
import { getRawUploadMismatch } from '@/lib/uploadVerification';
import { CONTENT_RATINGS } from '@/lib/videoEditorUtils';
import { normalizeVideoLanguageCode, getVideoLanguage } from '@/lib/videoLanguages';
import { normalizeVideoVisibility } from '@/lib/videoVisibility';
import { addVideoToPlaylists, ensurePlaylistSchema } from '@/lib/playlists';

const WORKFLOW_UNAVAILABLE = 'บริการประมวลผลวิดีโอยังไม่พร้อม';
const TRANSCODE_DISPATCH_FAILED = 'ส่งคำสั่งแปลงวิดีโอไม่สำเร็จ';

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
      versionId = null,
      title,
      description,
      sourceLanguage = '',
      category,
      tags,
      playlistIds = [],
      contentRating = 'all',
      visibility = 'public',
      subtitleMode = 'auto', // 'manual' | 'requested-ai' | 'auto'
      manualSubtitleSrt = '',
      manualSubtitleVtt = '',
      selectedModel = '',
      customPrompt = '',
      runAiRatingVerify = true,
      clientMeta = {},
    } = body;

    const parsedVersionId = versionId != null ? parseInt(versionId, 10) : null;
    if (versionId != null && (!parsedVersionId || Number.isNaN(parsedVersionId))) {
      return NextResponse.json(
        { success: false, error: 'versionId ไม่ถูกต้อง' },
        { status: 400 }
      );
    }

    if (!videoId) {
      return NextResponse.json(
        { success: false, error: 'กรุณาระบุ videoId (videoId is required)' },
        { status: 400 }
      );
    }

    let savedDescription;
    try { savedDescription = validateSavedDescription(description ?? '', videoId); }
    catch (error) { return NextResponse.json({ success: false, error: error.message }, { status: 400 }); }
    const sql = getDb();
    const userId = (await getCachedServerSession())?.id;
    if (userId == null) return accessError(401);
    const admin = isAdmin(userId);

    // 1. Verify video exists in DB
    const existing = await sql`
      SELECT id, title, raw_file_name, upload_reserved_bytes, status, audio_status, subtitle_status,
             rating_check_status, COALESCE(source_language, '') AS source_language, updated_at
      FROM videos 
      WHERE id = ${videoId} AND (${admin} OR user_id = ${userId})
      LIMIT 1;
    `;

    if (!existing || existing.length === 0) {
      return NextResponse.json(
        { success: false, error: `ไม่พบวิดีโอ ID: ${videoId}` },
        { status: 404 }
      );
    }

    const currentVideo = existing[0];

    // Branch: Completing upload for a specific video_versions record
    if (parsedVersionId) {
      const verRows = await sql`
        SELECT id, video_id, label, raw_file_name, upload_reserved_bytes, status, updated_at
        FROM video_versions
        WHERE id = ${parsedVersionId} AND video_id = ${videoId}
        LIMIT 1;
      `;
      if (!verRows.length) {
        return NextResponse.json(
          { success: false, error: `ไม่พบเวอร์ชัน ID: ${parsedVersionId}` },
          { status: 404 }
        );
      }

      const curVer = verRows[0];
      const uploadMismatch = await getRawUploadMismatch(curVer);
      if (uploadMismatch) return uploadMismatch;

      const verUpdatedMs = curVer.updated_at ? new Date(curVer.updated_at).getTime() : 0;
      if ((Date.now() - verUpdatedMs) < 60000 && ['PROCESSING', 'TRANSCODING', 'QUEUED'].includes(curVer.status)) {
        return NextResponse.json({
          success: true,
          videoId,
          versionId: parsedVersionId,
          status: curVer.status,
          alreadyRunning: true,
          message: 'เวอร์ชันนี้อยู่ในคิวหรือกำลังแปลงไฟล์ HLS อยู่แล้ว',
        });
      }

      const rawDurNum = Number(clientMeta?.duration || 0);
      const safeDuration = Number.isFinite(rawDurNum) && rawDurNum > 0 ? Math.floor(rawDurNum) : 0;
      const rawFpsNum = Number(clientMeta?.fps || 0);
      const safeFps = Number.isFinite(rawFpsNum) && rawFpsNum > 0 ? Math.round(rawFpsNum * 1000) / 1000 : 0;

      const claimedVer = await sql`
        UPDATE video_versions
        SET
          status = 'QUEUED',
          transcode_progress = 5,
          stage_detail = 'อัปโหลดเข้า OneDrive สำเร็จ กำลังส่งคำสั่งเข้าคิว GitHub Actions',
          duration = CASE WHEN CAST(${safeDuration} AS INTEGER) > 0 THEN CAST(${safeDuration} AS INTEGER) ELSE duration END,
          resolution = CASE WHEN ${clientMeta.resolution || ''} <> '' THEN ${clientMeta.resolution} ELSE resolution END,
          fps = CASE WHEN CAST(${safeFps} AS NUMERIC) > 0 THEN CAST(${safeFps} AS NUMERIC) ELSE fps END,
          codec = CASE WHEN ${clientMeta.codec || ''} <> '' THEN ${clientMeta.codec} ELSE codec END,
          thumbnail_url = CASE
            WHEN ${clientMeta.thumbnailDataUrl || ''} <> '' THEN ${clientMeta.thumbnailDataUrl}
            WHEN thumbnail_url IS NOT NULL AND thumbnail_url <> '' THEN thumbnail_url
            ELSE ${`/streams/stream_vid_${videoId}_v${parsedVersionId}/poster.jpg`}
          END,
          updated_at = NOW()
        WHERE id = ${parsedVersionId} AND video_id = ${videoId}
          AND status IS NOT DISTINCT FROM ${curVer.status}
          AND (status IS NULL OR status NOT IN ('QUEUED', 'PROCESSING', 'TRANSCODING')
            OR updated_at <= NOW() - INTERVAL '60 seconds')
        RETURNING id, updated_at::text AS claimed_at;
      `;

      if (!claimedVer.length) {
        return NextResponse.json({ success: false, error: 'Version status changed' }, { status: 409 });
      }

      const versionClaimedAt = claimedVer[0].claimed_at;
      if (!isWorkflowConfigured()) {
        await sql`
          UPDATE video_versions
          SET status = 'FAILED',
              stage_detail = ${WORKFLOW_UNAVAILABLE},
              error_message = ${WORKFLOW_UNAVAILABLE},
              updated_at = NOW()
          WHERE id = ${parsedVersionId} AND video_id = ${videoId} AND status = 'QUEUED'
            AND updated_at = ${versionClaimedAt}::timestamptz;
        `;
        return NextResponse.json({
          success: false,
          videoId,
          versionId: parsedVersionId,
          status: 'FAILED',
          warning: WORKFLOW_UNAVAILABLE,
        }, { status: 503 });
      }

      try {
        await appendWorkerLog(sql, videoId, {
          versionId: parsedVersionId,
          source: 'hls',
          label: 'HLS Engine',
          message: `🚀 กำลังส่งคำสั่งหั่น HLS Multi-bitrate (transcode.yml) สำหรับเวอร์ชัน "${curVer.label}" (${curVer.raw_file_name})`,
        });
        await triggerGitHubWorkflow('transcode.yml', {
          video_id: String(videoId),
          version_id: String(parsedVersionId),
          raw_file_name: String(curVer.raw_file_name),
          title: String(currentVideo.title || ''),
        });
        await appendWorkerLog(sql, videoId, {
          versionId: parsedVersionId,
          source: 'hls',
          label: 'HLS Engine',
          level: 'success',
          message: '✅ ส่งคิวเข้า GitHub Actions (transcode.yml) สำเร็จ รอ Ubuntu Runner รับงาน (~10-20 วิ)',
        });
      } catch (dispatchErr) {
        await sql`
          UPDATE video_versions
          SET status = 'FAILED',
              stage_detail = 'ส่งคำสั่งเข้า GitHub Actions ไม่สำเร็จ',
              error_message = ${TRANSCODE_DISPATCH_FAILED},
              updated_at = NOW()
          WHERE id = ${parsedVersionId} AND video_id = ${videoId} AND status = 'QUEUED'
            AND updated_at = ${versionClaimedAt}::timestamptz;
        `;
        return apiError(dispatchErr, {
          context: 'POST /api/upload/complete version transcode',
          status: 502,
          message: TRANSCODE_DISPATCH_FAILED,
          body: { videoId, versionId: parsedVersionId, status: 'FAILED' },
        });
      }

      await sql`
        UPDATE video_versions
        SET status = 'PROCESSING',
            transcode_progress = 10,
            stage_detail = 'GitHub Actions ได้รับคิวงานเวอร์ชันนี้แล้ว กำลังเตรียม Ubuntu Runner',
            error_message = '',
            updated_at = NOW()
        WHERE id = ${parsedVersionId} AND video_id = ${videoId} AND status = 'QUEUED'
          AND updated_at = ${versionClaimedAt}::timestamptz;
      `;

      return NextResponse.json({
        success: true,
        videoId,
        versionId: parsedVersionId,
        status: 'PROCESSING',
        message: 'ส่งคำสั่งรัน Transcode สำหรับเวอร์ชันใหม่ไปยัง GitHub Actions เรียบร้อยแล้ว',
      });
    }

    const uploadMismatch = await getRawUploadMismatch(currentVideo);
    if (uploadMismatch) return uploadMismatch;

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
    const finalDescription = savedDescription;
    const finalSourceLanguage = normalizeVideoLanguageCode(sourceLanguage || currentVideo.source_language || '');
    const selectedLangMeta = getVideoLanguage(finalSourceLanguage);
    if (!selectedLangMeta) {
      return NextResponse.json(
        { success: false, error: 'กรุณาเลือกภาษาเสียงพูดหลักของวิดีโอก่อนเผยแพร่' },
        { status: 400 }
      );
    }
    const finalCategory = typeof category === 'string' && category.trim() ? category.trim() : 'general';
    const finalTags = Array.isArray(tags) ? tags : [];
    const finalRating = contentRating || 'all';
    if (finalRating !== 'auto' && !CONTENT_RATINGS.some(({ id }) => id === finalRating)) {
      return NextResponse.json({ success: false, error: 'เรตเนื้อหาไม่ถูกต้อง' }, { status: 400 });
    }
    const resolvedModel = runAiRatingVerify ? resolveRatingModel(selectedModel) : null;
    if (runAiRatingVerify && !resolvedModel) {
      return NextResponse.json({ success: false, error: 'โมเดลตรวจเรตไม่ถูกต้อง' }, { status: 400 });
    }
    const finalVisibility = normalizeVideoVisibility(visibility);

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
        source_language = ${finalSourceLanguage},
        category = ${finalCategory},
        tags = ${finalTags},
        visibility = ${finalVisibility},
        content_rating = CASE WHEN rating_check_status = ANY(${EVALUATED_RATING_STATUSES}::text[])
          THEN content_rating ELSE ${finalRating === 'auto' ? 'all' : finalRating} END,
        user_selected_rating = CASE WHEN rating_check_status = ANY(${EVALUATED_RATING_STATUSES}::text[])
          THEN user_selected_rating ELSE ${finalRating} END,
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
      WHERE id = ${videoId} AND (${admin} OR user_id = ${userId})
        AND status IS NOT DISTINCT FROM ${currentVideo.status}
        AND (status IS NULL OR status NOT IN ('QUEUED', 'PROCESSING', 'TRANSCODING')
          OR updated_at <= NOW() - INTERVAL '60 seconds')
      RETURNING id;
    `;

    if (!claimed.length) {
      return NextResponse.json({ success: false, error: 'Video status changed' }, { status: 409 });
    }

    if (Array.isArray(playlistIds) && playlistIds.length > 0) {
      try {
        await ensurePlaylistSchema(sql);
        await addVideoToPlaylists(sql, userId, claimed[0].id, playlistIds);
      } catch (error) {
        console.warn('[Upload Playlist Warning]', { videoId, code: error.code, message: error.message });
      }
    }

    if (!isWorkflowConfigured()) {
      await sql`
        UPDATE videos 
        SET 
          status = 'FAILED',
          stage_detail = ${WORKFLOW_UNAVAILABLE},
          error_message = ${WORKFLOW_UNAVAILABLE},
          updated_at = NOW()
        WHERE id = ${videoId} AND (${admin} OR user_id = ${userId}) AND status = 'QUEUED';
      `;

      return NextResponse.json({
        success: false,
        videoId,
        status: 'FAILED',
        warning: WORKFLOW_UNAVAILABLE,
        message: 'อัปโหลดไฟล์เข้า OneDrive สำเร็จแล้ว กรุณาลองประมวลผลวิดีโออีกครั้ง',
      }, { status: 503 });
    }

    // Claim subtitle generation once, during initial upload completion (skip if source language is 'none').
    const shouldDispatchAudioSub =
      currentVideo.status === 'UPLOADING' && !hasManualSub &&
      !selectedLangMeta.isNone &&
      currentVideo.subtitle_status !== 'ready' &&
      !isSubtitleWorkflowActive(currentVideo);

    let dispatchedAudioSub = false;
    if (selectedLangMeta.isNone && !hasManualSub && currentVideo.status === 'UPLOADING') {
      await appendWorkerLog(sql, videoId, {
        source: 'subtitles',
        label: 'Audio & Sub',
        message: '⏭️ ข้ามการสร้างซับอัตโนมัติ (ตั้งค่าภาษาเสียงพูดเป็นไม่มีเสียงพูด)',
      });
    } else if (shouldDispatchAudioSub) {
      const requestedAi = subtitleMode === 'requested-ai';
      const subtitleJobId = `${Date.now()}-${randomUUID()}-${requestedAi ? 'ai' : 'auto'}`;
      const primarySubtitleModel = 'gemini-3.8-flash';
      try {
        const claimed = await sql`
          UPDATE videos
          SET audio_status = 'extracting',
              subtitle_status = 'extracting',
              subtitle_job_id = ${subtitleJobId},
              subtitle_model = ${primarySubtitleModel},
              updated_at = NOW()
          WHERE id = ${videoId} AND (${admin} OR user_id = ${userId})
            AND COALESCE(subtitle_job_id, '') = ''
            AND COALESCE(audio_status, '') <> 'extracting'
            AND COALESCE(subtitle_status, '') NOT IN ('extracting', 'processing', 'ready')
          RETURNING id;
        `;
        if (claimed.length) {
          await triggerGitHubWorkflow('extract-audio-subtitles.yml', {
            job_id: subtitleJobId,
            video_id: String(videoId),
            raw_file_name: String(finalRawFileName),
            source_language: String(finalSourceLanguage),
            custom_prompt: requestedAi ? normalizeSubtitlePrompt(customPrompt) : '',
          });
          dispatchedAudioSub = true;
          await appendWorkerLog(sql, videoId, {
            source: 'subtitles',
            label: 'Audio & Sub',
            message: `🚀 ส่งคำสั่งถอดเสียงและซับอัตโนมัติ (${primarySubtitleModel} • ภาษา: ${selectedLangMeta.label}) เข้าคิว GitHub Actions`,
          });
        }
      } catch (subErr) {
        await markSubtitleDispatchFailed(sql, videoId, subtitleJobId, currentVideo.audio_status)
          .catch((error) => console.warn('[Subtitle dispatch status]', error.message));
        console.warn('[Auto-dispatch Audio Subtitle Warning]:', subErr);
        await appendWorkerLog(sql, videoId, {
          source: 'subtitles',
          label: 'Audio & Sub',
          level: 'warn',
          message: '⚠️ ส่งคำสั่งสร้างซับไตเติลอัตโนมัติไม่สำเร็จ',
        });
      }
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
      await appendWorkerLog(sql, videoId, {
        source: 'hls',
        label: 'HLS Engine',
        level: 'error',
        message: `❌ ${TRANSCODE_DISPATCH_FAILED}`,
      });
      await sql`
        UPDATE videos
        SET
          status = 'FAILED',
          stage_detail = 'ส่งคำสั่งเข้า GitHub Actions ไม่สำเร็จ',
          error_message = ${TRANSCODE_DISPATCH_FAILED},
          updated_at = NOW()
        WHERE id = ${videoId} AND (${admin} OR user_id = ${userId}) AND status = 'QUEUED';
      `;
      return apiError(dispatchErr, {
        context: 'POST /api/upload/complete transcode',
        status: 502,
        message: TRANSCODE_DISPATCH_FAILED,
        body: { videoId, status: 'FAILED' },
      });
    }

    // 5. Dispatch Workflow #2 (Detailed Sprite Sheet Grid & AI Content Rating Verification)
    // Runs automatically to verify the user's selected rating (or auto-select if 'auto')
    const shouldDispatchSpriteRating =
      runAiRatingVerify &&
      currentVideo.rating_check_status !== 'analyzing' &&
      !isRatingEvaluated(currentVideo.rating_check_status);

    let dispatchedSpriteRating = false;
    if (shouldDispatchSpriteRating) {
      try {
        const claimedRating = await dispatchSpriteRating(sql, {
          videoId,
          userId,
          admin,
          rawFileName: finalRawFileName,
          userRating: finalRating,
          autoApply: finalRating === 'auto',
          model: resolvedModel,
          keepReadySprite: true,
        });
        if (claimedRating) {
          dispatchedSpriteRating = true;
          await appendWorkerLog(sql, videoId, {
            source: 'rating',
            label: 'Sprite & Rating',
            message: `🚀 ส่งคำสั่งตรวจเรตเนื้อหาด้วย Gemini Vision (เรต: ${finalRating})`,
          });
        }
      } catch (spErr) {
        console.warn('[Auto-dispatch Sprite Rating Warning]:', spErr);
        await appendWorkerLog(sql, videoId, {
          source: 'rating',
          label: 'Sprite & Rating',
          level: 'warn',
          message: '⚠️ ส่งคำสั่งตรวจเรตเนื้อหาอัตโนมัติไม่สำเร็จ',
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
      WHERE id = ${videoId} AND (${admin} OR user_id = ${userId}) AND status = 'QUEUED';
    `;

    return NextResponse.json({
      success: true,
      videoId,
      status: 'PROCESSING',
      dispatchedAudioSub,
      dispatchedSpriteRating,
      message: 'ส่งคำสั่งรัน Transcode และ AI Workflows ไปยัง GitHub Actions เรียบร้อยแล้ว',
    });
  } catch (err) {
    return apiError(err, {
      context: 'POST /api/upload/complete',
      message: 'เกิดข้อผิดพลาดในการเริ่มประมวลผลวิดีโอ',
    });
  }
}

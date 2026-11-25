import { getSessionUserId, isAdmin, accessError } from '@/lib/access';
import { apiError } from '@/lib/apiError';
import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { appendWorkerLog } from '@/lib/workerLogs';
import { dispatchSpriteRating, resolveRatingModel } from '@/lib/ratingWorkflow';
import { markSubtitleDispatchFailed, normalizeSubtitlePrompt, triggerGitHubWorkflow } from '@/lib/subtitleWorkflow';
import { getRawUploadMismatch } from '@/lib/uploadVerification';
import { CONTENT_RATINGS } from '@/lib/videoEditorUtils';
import { normalizeVideoLanguageCode, getVideoLanguage } from '@/lib/videoLanguages';

/**
 * POST /api/upload/dispatch-action
 * Dispatches subtitle, rating, transcode, or thumbnail workers.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      videoId,
      versionId = null,
      workflowType,
      model = '',
      userRating = 'auto',
      autoApply = true,
      sourceLanguage = '',
      customPrompt = '',
    } = body;
    const parsedVersionId = versionId != null ? parseInt(versionId, 10) : null;

    if (!videoId || !workflowType) {
      return NextResponse.json(
        { success: false, error: 'กรุณาระบุ videoId และ workflowType' },
        { status: 400 }
      );
    }

    const sql = getDb();
    const userId = await getSessionUserId(sql);
    if (userId == null) return accessError(401);
    const admin = isAdmin(userId);

    const rows = await sql`
      SELECT id, title, raw_file_name, upload_reserved_bytes, content_rating, audio_status, subtitle_status,
             source_language, thumbnail_status, status, updated_at
      FROM videos
      WHERE id = ${videoId} AND (${admin} OR user_id = ${userId})
      LIMIT 1;
    `;
    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { success: false, error: `ไม่พบวิดีโอ ID #${videoId}` },
        { status: 404 }
      );
    }

    const video = rows[0];
    const effectiveRawName = video.raw_file_name || '';

    if (workflowType !== 'transcode' || !parsedVersionId) {
      const uploadMismatch = await getRawUploadMismatch(video);
      if (uploadMismatch) return uploadMismatch;
    }

    // Anti-Spam / Concurrent execution debounce (45 seconds)
    const nowMs = Date.now();
    const updatedMs = video.updated_at ? new Date(video.updated_at).getTime() : 0;
    const isRecent = (nowMs - updatedMs) < 45000;

    if (workflowType === 'audio_subtitles') {
      if (
        isRecent &&
        (video.subtitle_status === 'extracting' ||
          video.subtitle_status === 'processing' ||
          video.audio_status === 'extracting')
      ) {
        return NextResponse.json({
          success: true,
          videoId,
          workflowType,
          audioStatus: video.audio_status,
          subtitleStatus: video.subtitle_status,
          alreadyRunning: true,
          message: 'GitHub Action กำลังถอดเสียงและสร้างซับไตเติลอยู่แล้ว ไม่ต้องส่งซ้ำ',
        });
      }

      const resolvedLang = normalizeVideoLanguageCode(sourceLanguage || video.source_language || '');
      const langMeta = getVideoLanguage(resolvedLang);
      if (langMeta?.isNone) {
        return NextResponse.json(
          { success: false, error: 'วิดีโอนี้ตั้งค่าภาษาเสียงพูดเป็น "ไม่มีเสียงพูด" กรุณาเลือกภาษาเสียงพูดก่อนสร้างซับ' },
          { status: 400 }
        );
      }

      const subtitleJobId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-ai`;
      await sql`
        UPDATE videos
        SET audio_status = 'extracting',
            subtitle_status = 'extracting',
            subtitle_job_id = ${subtitleJobId},
            source_language = CASE WHEN ${resolvedLang} <> '' THEN ${resolvedLang} ELSE source_language END,
            updated_at = NOW()
        WHERE id = ${videoId} AND (${admin} OR user_id = ${userId});
      `;

      try {
        await triggerGitHubWorkflow('extract-audio-subtitles.yml', {
          job_id: subtitleJobId,
          video_id: String(videoId),
          raw_file_name: String(effectiveRawName),
          source_language: String(resolvedLang),
          custom_prompt: normalizeSubtitlePrompt(customPrompt),
        });
        await appendWorkerLog(sql, videoId, {
          source: 'sub',
          label: 'เสียง & ซับไตเติล AI',
          message: `🚀 ส่งคำสั่งทำซับใหม่ (ภาษา: ${langMeta ? langMeta.label : 'ตรวจอัตโนมัติ'}) เข้าคิว GitHub Actions — รอ Runner รับงาน...`,
        });
      } catch (wfErr) {
        await markSubtitleDispatchFailed(sql, videoId, subtitleJobId, video.audio_status)
          .catch((rollbackError) => console.error('[Subtitle dispatch rollback]', rollbackError));
        await appendWorkerLog(sql, videoId, {
          source: 'sub',
          label: 'เสียง & ซับไตเติล AI',
          level: 'error',
          message: '❌ ส่งคำสั่งสร้างซับไตเติลไม่สำเร็จ',
        });
        throw wfErr;
      }

      return NextResponse.json({
        success: true,
        videoId,
        workflowType,
        subtitleJobId,
        audioStatus: 'extracting',
        subtitleStatus: 'extracting',
        message: 'ส่งคำสั่งถอดเสียงและสร้างซับไตเติลใหม่ไปยัง GitHub Actions เรียบร้อยแล้ว',
      });
    }

    if (workflowType === 'sprite_rating') {
      const resolvedModel = resolveRatingModel(model);
      if (!resolvedModel) {
        return NextResponse.json({ success: false, error: 'โมเดลตรวจเรตไม่ถูกต้อง' }, { status: 400 });
      }
      const targetUserRating = userRating || video.content_rating || 'auto';
      if (targetUserRating !== 'auto' && !CONTENT_RATINGS.some(({ id }) => id === targetUserRating)) {
        return NextResponse.json({ success: false, error: 'เรตเนื้อหาไม่ถูกต้อง' }, { status: 400 });
      }

      const claimedRating = await dispatchSpriteRating(sql, {
        videoId,
        userId,
        admin,
        rawFileName: effectiveRawName,
        userRating: targetUserRating,
        autoApply,
        model: resolvedModel,
      });
      if (!claimedRating) {
        const [latest] = await sql`
          SELECT sprite_status, rating_check_status FROM videos
          WHERE id = ${videoId} AND (${admin} OR user_id = ${userId});
        `;
        if (!latest) return accessError(404);
        if (latest.sprite_status !== 'generating' && latest.rating_check_status !== 'analyzing') {
          return NextResponse.json({ success: false, error: 'สถานะการประเมินเรตเปลี่ยนไป' }, { status: 409 });
        }
        return NextResponse.json({
          success: true,
          videoId,
          workflowType,
          spriteStatus: latest.sprite_status,
          ratingCheckStatus: latest.rating_check_status,
          alreadyRunning: true,
          message: 'GitHub Action #2 กำลังสร้าง Sprite Sheet และตรวจเรตเนื้อหาอยู่แล้ว ไม่ต้องส่งซ้ำ',
        });
      }

      await appendWorkerLog(sql, videoId, {
        source: 'rating',
        label: 'Sprite & Rating',
        message: `🚀 ส่งคำสั่ง GitHub Actions (sprite-content-rating.yml) ตรวจเรต "${targetUserRating}" — รอ Runner รับงาน...`,
      });

      return NextResponse.json({
        success: true,
        videoId,
        workflowType,
        spriteStatus: claimedRating.sprite_status,
        ratingCheckStatus: claimedRating.rating_check_status,
        message: 'ส่งคำสั่งให้ GitHub Actions สร้าง Sprite Sheet Grid และประเมินเรตเนื้อหาด้วย AI เรียบร้อยแล้ว',
      });
    }

    if (workflowType === 'transcode') {
      if (parsedVersionId) {
        const verRows = await sql`
          SELECT id, label, raw_file_name, upload_reserved_bytes, status, updated_at
          FROM video_versions
          WHERE id = ${parsedVersionId} AND video_id = ${videoId}
          LIMIT 1;
        `;
        if (!verRows.length) {
          return NextResponse.json({ success: false, error: `ไม่พบเวอร์ชัน ID #${parsedVersionId}` }, { status: 404 });
        }
        const ver = verRows[0];
        const uploadMismatch = await getRawUploadMismatch(ver);
        if (uploadMismatch) return uploadMismatch;
        const verRecent = (Date.now() - (ver.updated_at ? new Date(ver.updated_at).getTime() : 0)) < 45000;
        if (verRecent && ['PROCESSING', 'TRANSCODING', 'QUEUED'].includes(ver.status)) {
          return NextResponse.json({
            success: true,
            videoId,
            versionId: parsedVersionId,
            workflowType,
            status: ver.status,
            alreadyRunning: true,
            message: 'GitHub Action กำลังแปลงเวอร์ชันนี้อยู่แล้ว ไม่ต้องส่งซ้ำ',
          });
        }
        await triggerGitHubWorkflow('transcode.yml', {
          video_id: String(videoId),
          version_id: String(parsedVersionId),
          raw_file_name: String(ver.raw_file_name || ''),
          title: String(video.title || ''),
        });
        await appendWorkerLog(sql, videoId, {
          versionId: parsedVersionId,
          source: 'hls',
          label: 'HLS Engine',
          message: `🚀 ส่งคำสั่ง GitHub Actions (transcode.yml) สำหรับเวอร์ชัน "${ver.label}"`,
        });
        return NextResponse.json({
          success: true,
          videoId,
          versionId: parsedVersionId,
          workflowType,
          message: 'ส่งคำสั่งรัน HLS Transcoder สำหรับเวอร์ชันนี้เรียบร้อยแล้ว',
        });
      }

      if (isRecent && (video.status === 'PROCESSING' || video.status === 'TRANSCODING' || video.status === 'QUEUED')) {
        return NextResponse.json({
          success: true,
          videoId,
          workflowType,
          status: video.status,
          alreadyRunning: true,
          message: 'GitHub Action #3 (HLS Transcode) กำลังทำงานอยู่แล้ว ไม่ต้องส่งซ้ำ',
        });
      }

      await triggerGitHubWorkflow('transcode.yml', {
        video_id: String(videoId),
        raw_file_name: String(effectiveRawName),
        title: String(video.title || ''),
      });
      await appendWorkerLog(sql, videoId, {
        source: 'hls',
        label: 'HLS Engine',
        message: `🚀 ส่งคำสั่ง GitHub Actions (transcode.yml) สำหรับ ${effectiveRawName}`,
      });

      return NextResponse.json({
        success: true,
        videoId,
        workflowType,
        message: 'ส่งคำสั่งรัน HLS Transcoder ไปยัง GitHub Actions เรียบร้อยแล้ว',
      });
    }

    if (workflowType === 'thumbnails') {
      if (isRecent && video.thumbnail_status === 'generating') {
        return NextResponse.json({
          success: true,
          videoId,
          workflowType,
          thumbnailStatus: video.thumbnail_status,
          alreadyRunning: true,
          message: 'GitHub Action สกัดภาพปก 3 ช่วงกำลังทำงานอยู่แล้ว',
        });
      }

      await sql`
        UPDATE videos
        SET thumbnail_status = 'generating',
            updated_at = NOW()
        WHERE id = ${videoId} AND (${admin} OR user_id = ${userId});
      `;

      try {
        await triggerGitHubWorkflow('extract-thumbnails.yml', {
          video_id: String(videoId),
          raw_file_name: String(effectiveRawName),
        });
        await appendWorkerLog(sql, videoId, {
          source: 'thumbnail',
          label: 'Thumbnails',
          message: `🚀 ส่งคำสั่ง GitHub Actions (extract-thumbnails.yml) สกัดภาพปก 3 ช่วงสำหรับ ${effectiveRawName}`,
        });
      } catch (wfErr) {
        const isNotFound = wfErr.status === 404;
        await appendWorkerLog(sql, videoId, {
          source: 'thumbnail',
          label: 'Thumbnails',
          level: isNotFound ? 'warn' : 'error',
          message: isNotFound
            ? '⚠️ ยังไม่พบ workflow extract-thumbnails.yml บน GitHub branch main'
            : '❌ ส่งคำสั่งสกัดภาพปกไม่สำเร็จ',
        });
        await sql`
          UPDATE videos
          SET thumbnail_status = ${isNotFound ? 'waiting' : 'failed'},
              updated_at = NOW()
          WHERE id = ${videoId} AND (${admin} OR user_id = ${userId});
        `;
        if (isNotFound) {
          return NextResponse.json({
            success: false,
            videoId,
            workflowType,
            workflowNotFound: true,
            error: 'ยังไม่พบ workflow สำหรับสกัดภาพปก',
          });
        }
        return apiError(wfErr, {
          context: 'POST /api/upload/dispatch-action thumbnails',
          status: 502,
          message: 'ส่งคำสั่งสกัดภาพปกไม่สำเร็จ',
          body: { videoId, workflowType, workflowNotFound: false },
        });
      }

      return NextResponse.json({
        success: true,
        videoId,
        workflowType,
        thumbnailStatus: 'generating',
        message: 'ส่งคำสั่งให้ GitHub Actions หั่นภาพปก 3 ช่วงของวิดีโอแล้ว',
      });
    }

    return NextResponse.json(
      { success: false, error: `ไม่รู้จัก workflowType: ${workflowType}` },
      { status: 400 }
    );
  } catch (err) {
    return apiError(err, {
      context: 'POST /api/upload/dispatch-action',
      message: 'ไม่สามารถส่งคำสั่งไปยัง GitHub Actions ได้',
    });
  }
}

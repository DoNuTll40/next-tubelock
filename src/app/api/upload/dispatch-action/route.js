import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

async function ensureAiColumns(sql) {
  try {
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
  } catch (_) {}
}

export async function triggerGitHubWorkflow(workflowFile, inputs) {
  const githubToken = (
    process.env.GITHUB_TOKEN ||
    process.env.GH_PAT ||
    process.env.GITHUB_PAT ||
    ''
  ).trim();
  const githubRepo = process.env.GITHUB_REPO || 'DoNuTll40/next-tubelock';
  const githubBranch = process.env.GITHUB_BRANCH || 'main';

  if (!githubToken) {
    throw new Error('ยังไม่ได้ตั้งค่า GITHUB_TOKEN ใน .env.local หรือ Vercel Environment Variables');
  }

  const dispatchUrl = `https://api.github.com/repos/${githubRepo}/actions/workflows/${workflowFile}/dispatches`;
  const res = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'TubeLock-Studio-Dispatcher',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ref: githubBranch,
      inputs,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`GitHub Actions Dispatch Error (${res.status} on ${workflowFile}): ${errText}`);
  }
  return true;
}

/**
 * POST /api/upload/dispatch-action
 * Dispatches one of the 3 specialized GitHub Actions workflows:
 * - 'audio_subtitles' -> extract-audio-subtitles.yml
 * - 'sprite_rating'   -> sprite-content-rating.yml
 * - 'transcode'       -> transcode.yml
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      videoId,
      workflowType, // 'audio_subtitles' | 'sprite_rating' | 'transcode'
      rawFileName = '',
      model = '',
      customPrompt = '',
      userRating = 'auto',
      autoApply = true,
    } = body;

    const envModelName = (process.env.GEMINI_MODEL_NAME || 'gemini-2.5-flash').replace(/['"]/g, '').trim();
    const resolvedModel = (model && model.trim()) ? model.trim() : envModelName;

    if (!videoId || !workflowType) {
      return NextResponse.json(
        { success: false, error: 'กรุณาระบุ videoId และ workflowType' },
        { status: 400 }
      );
    }

    const sql = getDb();
    await ensureAiColumns(sql);

    const rows = await sql`
      SELECT id, title, raw_file_name, content_rating
      FROM videos
      WHERE id = ${videoId}
      LIMIT 1;
    `;
    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { success: false, error: `ไม่พบวิดีโอ ID #${videoId}` },
        { status: 404 }
      );
    }

    const video = rows[0];
    const effectiveRawName = rawFileName || video.raw_file_name || '';

    if (workflowType === 'audio_subtitles') {
      await sql`
        UPDATE videos
        SET audio_status = 'extracting',
            subtitle_status = 'processing',
            subtitle_model = ${resolvedModel},
            updated_at = NOW()
        WHERE id = ${videoId};
      `;

      await triggerGitHubWorkflow('extract-audio-subtitles.yml', {
        video_id: String(videoId),
        raw_file_name: String(effectiveRawName),
        model: String(resolvedModel),
        custom_prompt: String(customPrompt || ''),
      });

      return NextResponse.json({
        success: true,
        videoId,
        workflowType,
        audioStatus: 'extracting',
        subtitleStatus: 'processing',
        message: 'ส่งคำสั่งให้ GitHub Actions สกัดไฟล์เสียงและสร้างซับไตเติลผ่าน AI เรียบร้อยแล้ว',
      });
    }

    if (workflowType === 'sprite_rating') {
      const targetUserRating = userRating || video.content_rating || 'auto';

      await sql`
        UPDATE videos
        SET sprite_status = 'generating',
            rating_check_status = 'analyzing',
            user_selected_rating = ${targetUserRating},
            updated_at = NOW()
        WHERE id = ${videoId};
      `;

      await triggerGitHubWorkflow('sprite-content-rating.yml', {
        video_id: String(videoId),
        raw_file_name: String(effectiveRawName),
        user_rating: String(targetUserRating),
        auto_apply: autoApply ? 'true' : 'false',
        model: String(resolvedModel),
      });

      return NextResponse.json({
        success: true,
        videoId,
        workflowType,
        spriteStatus: 'generating',
        ratingCheckStatus: 'analyzing',
        message: 'ส่งคำสั่งให้ GitHub Actions สร้าง Sprite Sheet Grid และประเมินเรตเนื้อหาด้วย AI เรียบร้อยแล้ว',
      });
    }

    if (workflowType === 'transcode') {
      await triggerGitHubWorkflow('transcode.yml', {
        video_id: String(videoId),
        raw_file_name: String(effectiveRawName),
        title: String(video.title || ''),
      });

      return NextResponse.json({
        success: true,
        videoId,
        workflowType,
        message: 'ส่งคำสั่งรัน HLS Transcoder ไปยัง GitHub Actions เรียบร้อยแล้ว',
      });
    }

    return NextResponse.json(
      { success: false, error: `ไม่รู้จัก workflowType: ${workflowType}` },
      { status: 400 }
    );
  } catch (err) {
    console.error('[Dispatch Action Error]:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'ไม่สามารถสั่งรัน GitHub Actions ได้' },
      { status: 500 }
    );
  }
}

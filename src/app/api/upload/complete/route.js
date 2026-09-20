import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

/**
 * POST /api/upload/complete
 * Step 2: Called when the browser finishes 100% Chunked Upload to OneDrive.
 * Updates video status to 'QUEUED' / 'PROCESSING' and triggers GitHub Actions workflow_dispatch.
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { videoId, rawFileName, title, description, category, tags, clientMeta = {} } = body;

    if (!videoId) {
      return NextResponse.json(
        { success: false, error: 'กรุณาระบุ videoId (videoId is required)' },
        { status: 400 }
      );
    }

    const sql = getDb();

    // Ensure category column exists
    try {
      await sql`ALTER TABLE videos ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'general';`;
    } catch (_) {}

    // 1. Verify video exists in DB
    const existing = await sql`
      SELECT id, title, raw_file_name, status, file_size_bytes 
      FROM videos 
      WHERE id = ${videoId} 
      LIMIT 1;
    `;

    if (!existing || existing.length === 0) {
      return NextResponse.json(
        { success: false, error: `ไม่พบวิดีโอ ID: ${videoId}` },
        { status: 404 }
      );
    }

    const currentVideo = existing[0];
    const finalRawFileName = rawFileName || currentVideo.raw_file_name;
    const finalTitle = title || currentVideo.title;
    const finalDescription = typeof description === 'string' ? description : (currentVideo.description || '');
    const finalCategory = typeof category === 'string' && category.trim() ? category.trim() : 'general';
    const finalTags = Array.isArray(tags) ? tags : [];

    // 2. Mark as QUEUED in Neon DB and save comprehensive client metadata
    await sql`
      UPDATE videos 
      SET 
        status = 'QUEUED',
        transcode_progress = 5,
        stage_detail = 'อัปโหลดเข้า OneDrive สำเร็จ กำลังส่งคำสั่งเข้าคิว GitHub Actions',
        title = ${finalTitle},
        description = ${finalDescription},
        category = ${finalCategory},
        tags = ${finalTags},
        raw_file_name = ${finalRawFileName},
        duration = CASE WHEN ${clientMeta.duration || 0} > 0 THEN ${Math.floor(clientMeta.duration || 0)} ELSE duration END,
        resolution = CASE WHEN ${clientMeta.resolution || ''} <> '' THEN ${clientMeta.resolution} ELSE resolution END,
        fps = CASE WHEN ${clientMeta.fps || 0} > 0 THEN ${clientMeta.fps} ELSE fps END,
        codec = CASE WHEN ${clientMeta.codec || ''} <> '' THEN ${clientMeta.codec} ELSE codec END,
        thumbnail_url = CASE WHEN ${clientMeta.thumbnailDataUrl || ''} <> '' THEN ${clientMeta.thumbnailDataUrl} ELSE thumbnail_url END,
        updated_at = NOW()
      WHERE id = ${videoId};
    `;

    // 3. Dispatch GitHub Actions workflow
    const githubToken = process.env.GITHUB_TOKEN || process.env.GH_PAT || process.env.GITHUB_PAT || '';
    const githubRepo = process.env.GITHUB_REPO || 'DoNuTll40/next-tubelock';
    const githubBranch = process.env.GITHUB_BRANCH || 'main';

    if (!githubToken) {
      const warnMsg = 'ไม่ได้ตั้งค่า GITHUB_TOKEN ในระบบ กรุณาเพิ่ม GITHUB_TOKEN ในไฟล์ .env.local หรือ Vercel Environment Variables';
      console.warn(`[Upload Complete Warning]: ${warnMsg}`);

      await sql`
        UPDATE videos 
        SET 
          stage_detail = 'รอ Trigger GitHub Actions (ยังไม่ได้ตั้งค่า GITHUB_TOKEN)',
          error_message = ${warnMsg},
          updated_at = NOW()
        WHERE id = ${videoId};
      `;

      return NextResponse.json({
        success: true,
        videoId,
        status: 'QUEUED',
        warning: warnMsg,
        message: 'อัปโหลดไฟล์เข้า OneDrive สำเร็จแล้ว แต่ยังไม่ได้รัน GitHub Actions เนื่องจากยังไม่มี GITHUB_TOKEN',
      });
    }

    const dispatchUrl = `https://api.github.com/repos/${githubRepo}/actions/workflows/transcode.yml/dispatches`;

    const dispatchRes = await fetch(dispatchUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken.trim()}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'TubeLock-CloudTranscoder',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: githubBranch,
        inputs: {
          video_id: String(videoId),
          raw_file_name: finalRawFileName,
          title: finalTitle,
        },
      }),
    });

    if (!dispatchRes.ok) {
      const errText = await dispatchRes.text();
      const failMsg = `GitHub Actions API Error (${dispatchRes.status}): ${errText}`;
      console.error('[Workflow Dispatch Error]:', failMsg);

      await sql`
        UPDATE videos 
        SET 
          stage_detail = 'ส่งคำสั่งเข้า GitHub Actions ไม่สำเร็จ',
          error_message = ${failMsg},
          updated_at = NOW()
        WHERE id = ${videoId};
      `;

      return NextResponse.json({
        success: false,
        videoId,
        status: 'FAILED',
        error: failMsg,
      }, { status: 502 });
    }

    // 4. Update status to 'PROCESSING'
    await sql`
      UPDATE videos 
      SET 
        status = 'PROCESSING',
        transcode_progress = 10,
        stage_detail = 'GitHub Actions ได้รับคิวงานแล้ว กำลังเตรียม Ubuntu Runner',
        error_message = '',
        updated_at = NOW()
      WHERE id = ${videoId};
    `;

    return NextResponse.json({
      success: true,
      videoId,
      status: 'PROCESSING',
      message: 'ส่งคำสั่งรัน Transcode ไปยัง GitHub Actions Runner เรียบร้อยแล้ว',
    });
  } catch (err) {
    console.error('[Upload Complete Error]:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'เกิดข้อผิดพลาดในการสั่งรัน Transcoder' },
      { status: 500 }
    );
  }
}

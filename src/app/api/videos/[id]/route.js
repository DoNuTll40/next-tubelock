import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/videos/[id]
 * Lightning-fast metadata retrieval (<50ms) for instant UI rendering
 */
export async function GET(request, context) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 });
    }

    const sql = getDb();
    const rows = await sql`SELECT * FROM videos WHERE id = ${id} LIMIT 1;`;
    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, video: rows[0] });
  } catch (err) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}

/**
 * DELETE /api/videos/[id]
 * Completely removes a video or queue item from Neon DB and OneDrive (no cache)
 */
export async function DELETE(request, context) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Video ID is required' }, { status: 400 });
    }

    const sql = getDb();

    // 1. Fetch video details first to clean up OneDrive assets
    const rows = await sql`
      SELECT id, raw_file_name, onedrive_folder_id, onedrive_item_id, title 
      FROM videos 
      WHERE id = ${id} 
      LIMIT 1;
    `;

    if (rows && rows.length > 0) {
      const vid = rows[0];

      // 2. Best-effort cleanup of OneDrive files/folders
      try {
        const token = await getGraphToken();
        const driveId = await getUserDriveId(token);

        // Delete raw file from /raw/ if present
        if (vid.raw_file_name) {
          try {
            const rawRes = await fetch(
              `https://graph.microsoft.com/v1.0/drives/${driveId}/root:/raw/${encodeURIComponent(vid.raw_file_name)}`,
              { headers: { Authorization: `Bearer ${token}` } }
            );
            if (rawRes.ok) {
              const rawData = await rawRes.json();
              await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${rawData.id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
              });
            }
          } catch (_) {}
        }

        // Delete HLS folder if present
        const folderId = vid.onedrive_folder_id;
        if (folderId) {
          try {
            await fetch(`https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            });
          } catch (_) {}
        }
      } catch (graphErr) {
        console.warn('[Cleanup OneDrive Warning]:', graphErr.message);
      }
    }

    // 3. Delete record completely from Neon DB
    await sql`DELETE FROM videos WHERE id = ${id};`;

    return NextResponse.json(
      {
        success: true,
        message: `ลบคิวและข้อมูลวิดีโอ #${id} ออกจากระบบถาวรเรียบร้อยแล้ว`,
        deletedId: id,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      }
    );
  } catch (err) {
    console.error('[DELETE_VIDEO_ERROR]:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

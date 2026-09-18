import { NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { getGraphToken, getUserDriveId } from '@/lib/onedriveServer';

/**
 * GET /api/videos/[id]/source
 * Resolves direct playback URL from OneDrive via Azure Client Secret (No Login Required!)
 */
export async function GET(request, context) {
  try {
    const { id } = await context.params;
    const sql = getDb();

    const rows = await sql`SELECT * FROM videos WHERE id = ${id} LIMIT 1;`;
    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
    }

    const video = rows[0];
    const token = await getGraphToken();
    const driveId = await getUserDriveId(token);

    // Case 1: HLS Stream Folder
    if (video.source_type === 'hls' || video.onedrive_folder_id) {
      const folderId = video.onedrive_folder_id || video.onedrive_item_id;
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${folderId}/children?select=id,name,@microsoft.graph.downloadUrl`,
        { headers: { Authorization: `Bearer ${token}` } }
      );

      if (!res.ok) {
        throw new Error(`Failed to read HLS folder from OneDrive (${res.status})`);
      }

      const data = await res.json();
      const items = data.value || [];

      // Return items with their authenticated download URLs so client player can stream
      return NextResponse.json({
        success: true,
        type: 'hls',
        video,
        items: items.map(i => ({
          name: i.name,
          downloadUrl: i['@microsoft.graph.downloadUrl'],
        })),
      });
    }

    // Case 2: Standalone Video File (MP4, MKV, etc.)
    const itemId = video.onedrive_item_id;
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${itemId}?select=id,@microsoft.graph.downloadUrl`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      throw new Error(`Failed to fetch video download link from OneDrive (${res.status})`);
    }

    const data = await res.json();
    const downloadUrl = data['@microsoft.graph.downloadUrl'];

    return NextResponse.json({
      success: true,
      type: 'mp4',
      url: downloadUrl,
      video,
    });
  } catch (err) {
    console.error('[API_VIDEO_SOURCE_ERROR]:', err);
    return NextResponse.json(
      { success: false, error: err.message },
      { status: 500 }
    );
  }
}

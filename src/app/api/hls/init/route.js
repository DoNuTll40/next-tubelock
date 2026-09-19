import { NextResponse } from 'next/server';
import { createHlsFolder } from '@/lib/onedriveServer';

/**
 * POST /api/hls/init
 * Creates a subfolder on OneDrive for an HLS video package (e.g. hls_myvideo_1789728340)
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { parentFolder = '/Videos', title = 'video' } = body;

    const cleanTitle = title
      .replace(/[^a-zA-Z0-9_\-\u0E00-\u0E7F]/g, '_')
      .slice(0, 40) || 'video';

    const subFolderName = `hls_${cleanTitle}_${Date.now()}`;

    const folderInfo = await createHlsFolder(parentFolder, subFolderName);

    return NextResponse.json({
      success: true,
      ...folderInfo,
    });
  } catch (err) {
    console.error('[HLS Init Error]:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'ไม่สามารถสร้างโฟลเดอร์ HLS บน OneDrive ได้' },
      { status: 500 }
    );
  }
}

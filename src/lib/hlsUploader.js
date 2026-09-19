import { transcodeToHls } from './ffmpegService';

/**
 * End-to-end HLS Transcoding and OneDrive Upload Pipeline
 */
export async function processAndUploadHls(file, options = {}) {
  const {
    title = '',
    description = '',
    parentFolder = '/Videos',
    tags = [],
    thumbnailUrl = '',
    onProgress = () => {},
    onLog = () => {},
  } = options;

  const cleanTitle = title.trim() || file.name.replace(/\.[^/.]+$/, '');

  // -------------------------------------------------------------
  // Step 1: Transcode / Segment to HLS
  // -------------------------------------------------------------
  onLog(`🎬 เริ่มต้นกระบวนการแปลงไฟล์ "${file.name}" เป็นชุด HLS ABR...`);
  onProgress({
    stage: 'transcoding',
    percent: 0,
    text: 'กำลังโหลดและเริ่มหั่นวิดีโอเป็น HLS...',
  });

  const { files: hlsFiles, probeData } = await transcodeToHls(
    file,
    file.name,
    (transcodePct) => {
      onProgress({
        stage: 'transcoding',
        percent: transcodePct,
        text: `กำลังประมวลผลและตัดแบ่ง HLS Segment (${transcodePct}%)...`,
      });
    }
  );

  onLog(`✅ หั่น HLS สำเร็จ! ได้ทั้งหมด ${hlsFiles.length} ไฟล์ (Playlists + Segments)`);

  // -------------------------------------------------------------
  // Step 2: Create HLS Folder on OneDrive
  // -------------------------------------------------------------
  onLog(`📁 กำลังสร้างโฟลเดอร์สำหรับชุด HLS บน OneDrive...`);
  onProgress({
    stage: 'creating_folder',
    percent: 0,
    text: 'กำลังสร้างโฟลเดอร์ HLS บน OneDrive...',
  });

  const initRes = await fetch('/api/hls/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      parentFolder,
      title: cleanTitle,
    }),
  });

  const initData = await initRes.json();
  if (!initRes.ok || !initData.success) {
    throw new Error(initData.error || 'สร้างโฟลเดอร์ HLS บน OneDrive ไม่สำเร็จ');
  }

  const { folderId, folderName } = initData;
  onLog(`📁 สร้างโฟลเดอร์ "${folderName}" เรียบร้อยแล้ว (ID: ${folderId.slice(0, 15)}...)`);

  // -------------------------------------------------------------
  // Step 3: Upload each HLS File to OneDrive
  // -------------------------------------------------------------
  onLog(`🚀 เริ่มทยอยอัปโหลดไฟล์ HLS ทั้งหมด ${hlsFiles.length} รายการเข้าสู่ OneDrive...`);

  for (let i = 0; i < hlsFiles.length; i++) {
    const item = hlsFiles[i];
    const pct = Math.round(((i + 1) / hlsFiles.length) * 100);

    onProgress({
      stage: 'uploading',
      percent: pct,
      currentFile: i + 1,
      totalFiles: hlsFiles.length,
      fileName: item.name,
      text: `กำลังอัปโหลดไฟล์ ${i + 1}/${hlsFiles.length}: ${item.name}`,
    });

    const formData = new FormData();
    formData.append('folderId', folderId);
    formData.append('fileName', item.name);
    formData.append('file', item.blob, item.name);

    const uploadRes = await fetch('/api/hls/upload-file', {
      method: 'POST',
      body: formData,
    });

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || !uploadData.success) {
      throw new Error(uploadData.error || `อัปโหลดไฟล์ "${item.name}" ไม่สำเร็จ`);
    }
  }

  onLog(`✨ อัปโหลดไฟล์ HLS ครบถ้วนทั้ง ${hlsFiles.length} ไฟล์เรียบร้อย 100%!`);

  // -------------------------------------------------------------
  // Step 4: Record HLS Package in Neon Database
  // -------------------------------------------------------------
  onLog(`💾 กำลังลงทะเบียนชุด HLS เข้าฐานข้อมูล Neon DB...`);
  onProgress({
    stage: 'completing',
    percent: 100,
    text: 'กำลังลงทะเบียนข้อมูลวิดีโอขึ้น Feed...',
  });

  const resolutionLabel = `${probeData?.height || 1080}p`;
  const completeRes = await fetch('/api/hls/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      folderId,
      title: cleanTitle,
      description: description || `ชุด HLS จากโฟลเดอร์ ${parentFolder}/${folderName}`,
      duration: probeData?.duration || 0,
      file_size_bytes: file.size,
      resolution: resolutionLabel,
      fps: probeData?.fps ? Math.round(parseFloat(probeData.fps)) : 30,
      codec: 'h264',
      thumbnail_url: thumbnailUrl || probeData?.thumbnail_url || '',
      tags: tags.length > 0 ? tags : ['HLS', resolutionLabel],
    }),
  });

  const completeData = await completeRes.json();
  if (!completeRes.ok || !completeData.success) {
    throw new Error(completeData.error || 'บันทึกข้อมูลเข้าฐานข้อมูลไม่สำเร็จ');
  }

  onLog(`🎉 สำเร็จสมบูรณ์! วิดีโอพร้อมสตรีมมิ่งผ่าน HLS แบบลื่นไหล ไม่มีดรอปเฟรม`);

  return {
    success: true,
    video: completeData.video,
    folderId,
    folderName,
    totalFiles: hlsFiles.length,
  };
}

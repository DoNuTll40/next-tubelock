import { getRawUploadSize } from './uploadLimits';

export async function getRawUploadMismatch(video) {
  if (video.status !== 'UPLOADING' || video.upload_reserved_bytes == null) return null;

  const uploadedBytes = await getRawUploadSize(video.raw_file_name);
  if (uploadedBytes === Number(video.upload_reserved_bytes)) return null;

  return Response.json({
    success: false,
    error: uploadedBytes == null
      ? 'ยังไม่พบไฟล์ต้นฉบับที่อัปโหลดเสร็จแล้วใน OneDrive'
      : 'ขนาดไฟล์ต้นฉบับไม่ตรงกับที่จองไว้ กรุณาเริ่มอัปโหลดใหม่',
  }, { status: 409 });
}

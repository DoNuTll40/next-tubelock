import { neon } from '@neondatabase/serverless';

/**
 * Shared Neon DB client
 */
export function getDb() {
  let url = process.env.DATABASE_URL || process.env.NEXT_DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not defined');
  }

  // ทำความสะอาดเฉพาะ space ทั่วไปหัวท้าย
  url = url.trim();

  // ไม่ต้องแทนที่ /mytube_db เป็น /neondb แล้ว ให้เชื่อมต่อตรงตาม URL ที่ตั้งไว้
  return neon(url);
}
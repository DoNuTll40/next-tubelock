import { neon } from '@neondatabase/serverless';

/**
 * Shared Neon DB client with URL sanitization
 */
export function getDb() {
  let url = process.env.DATABASE_URL || process.env.NEXT_DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not defined');
  }

  // ลบ zero-width space ที่อาจติดมาตอนก๊อปปี้ URL
  url = url.replace(/%E2%80%8B/g, '').replace(/\u200b/g, '').trim();

  // ปรับชื่อ database เป็น neondb ถ้าเผลอใส่ mytube_db
  if (url.includes('/mytube_db')) {
    url = url.replace('/mytube_db', '/neondb');
  }

  return neon(url);
}
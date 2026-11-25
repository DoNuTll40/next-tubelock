import { neon } from '@neondatabase/serverless';

const transientNetworkCodes = new Set([
  'EAI_AGAIN',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
]);

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

/**
 * Retry transient transport failures for explicitly read-only queries.
 */
export async function retryDbRead(query) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await query();
    } catch (error) {
      const transport = error?.sourceError ?? error;
      const code = transport?.cause?.code ?? transport?.code;
      const isNetworkFailure = transientNetworkCodes.has(code) ||
        (transport instanceof TypeError && transport.message === 'fetch failed');
      if (attempt === 2 || !isNetworkFailure) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1)));
    }
  }
}

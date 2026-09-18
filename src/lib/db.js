import { neon } from '@neondatabase/serverless';

/**
 * Shared Neon DB client with URL sanitization & fallback handling
 */
export function getDb() {
  let url = process.env.DATABASE_URL || process.env.NEXT_DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL environment variable is not defined');
  }

  // Remove URL-encoded zero-width space if present
  url = url.replace(/%E2%80%8B/g, '').replace(/\u200b/g, '');

  // Neon default database name is 'neondb'
  if (url.includes('/mytube_db')) {
    url = url.replace('/mytube_db', '/neondb');
  }

  return neon(url);
}

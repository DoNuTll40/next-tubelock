import { NextResponse } from 'next/server';
import { getServerSessionByToken } from '@/lib/access';
import { isPreviewImage } from '@/lib/videoUtils';

export async function proxy(request) {
  const url = request.nextUrl.clone();
  const { pathname } = url;
  const host = request.headers.get('host') || '';
  const isReadRequest = request.method === 'GET' || request.method === 'HEAD';
  const isMaintenanceCron = isReadRequest && pathname === '/api/cron/maintenance';
  const isPublicStreamImage = isReadRequest && pathname.startsWith('/streams/') && isPreviewImage(pathname);
  const isVideoPlaylistApi = /^\/api\/videos\/[^/]+\/playlists$/.test(pathname);
  // These handlers validate with getCachedServerSession and return their own 401 response.
  const playlistApiHandlesAuth = isVideoPlaylistApi
    || /^\/api\/playlists(?:\/[^/]+(?:\/items(?:\/reorder)?)?)?$/.test(pathname);
  const playlistPageHandlesAuth = isReadRequest && pathname === '/playlists';

  // ── เข้า /watch โดยไม่ระบุรหัสวิดีโอ หรือเป็น undefined/null → redirect ไปหน้าแรก / เสมอ ──
  if (
    pathname === '/watch' ||
    pathname === '/watch/' ||
    pathname === '/watch/undefined' ||
    pathname === '/watch/null'
  ) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // ── 1. Paths ที่ bypass auth ────────────────────────────────────────────────
  // OAuth callbacks และ static assets ไม่ต้องตรวจ session
  const isOAuthPath =
    pathname.startsWith('/api/auth/google') ||
    pathname.startsWith('/api/auth/facebook') ||
    pathname.startsWith('/api/auth/line');

  const isPublicPath =
    pathname === '/' ||
    isMaintenanceCron ||
    pathname.startsWith('/results') ||
    pathname.startsWith('/api/search') ||
    (isReadRequest &&
      (pathname === '/api/videos' ||
        /^\/(?:api\/playlists|playlist)\/\d+$/.test(pathname) ||
        isVideoPlaylistApi ||
        (/^\/api\/videos\/[^/]+(?:\/poster)?$/.test(pathname) &&
          pathname !== '/api/videos/queue'))) ||
    pathname.startsWith('/api/og') ||
    isPublicStreamImage ||
    pathname.startsWith('/images') ||
    pathname.startsWith('/login') ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/auth/me' ||
    pathname.startsWith('/tubelock') ||
    pathname.startsWith('/_next') ||
    pathname === '/m' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/sw.js' ||
    pathname === '/favicon.ico' ||
    pathname === '/robots.txt' ||
    pathname === '/sitemap.xml';

  // OAuth callbacks ข้ามการตรวจ session ทั้งหมด
  if (isOAuthPath) return NextResponse.next();

  // ── 2. อ่าน session token จาก Cookie ─────────────────────────────────────
  const token = request.cookies.get('tubelock_session')?.value;

  // ไม่มี token + ไม่ใช่ public path → redirect /login
  if (!token && !isPublicPath && !playlistApiHandlesAuth) {
    if (pathname.startsWith('/api/') || pathname.startsWith('/streams/')) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname + url.search);
    return NextResponse.redirect(loginUrl);
  }

  // Public routes perform their own optional session lookups when needed.
  if (token && !playlistApiHandlesAuth && !playlistPageHandlesAuth && (!isPublicPath || pathname === '/login')) {
    try {
      const session = await getServerSessionByToken(token);
      if (session && pathname === '/login') {
        return NextResponse.redirect(new URL('/', request.url));
      }
      if (!session && !isPublicPath) {
        if (pathname.startsWith('/api/') || pathname.startsWith('/streams/')) {
          return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('from', pathname + url.search);
        const response = NextResponse.redirect(loginUrl);
        response.cookies.delete('tubelock_session');
        return response;
      }
    } catch (err) {
      console.error('[Middleware DB Error]:', err);
      if (!isPublicPath) {
        return NextResponse.json({ error: 'Session validation unavailable' }, { status: 503 });
      }
    }
  }

  // ── 4. Subdomain rewrite (m. → /m) ──────────────────────────────────────
  if (host.startsWith('m.') && !pathname.startsWith('/api')) {
    if (pathname === '/') {
      url.pathname = '/m';
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

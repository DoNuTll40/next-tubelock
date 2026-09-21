import { NextResponse } from 'next/server';
import { neon } from '@neondatabase/serverless';

export async function middleware(request) {
  const url = request.nextUrl.clone();
  const host = request.headers.get('host') || '';
  const { pathname } = url;

  // ── 1. Paths ที่ bypass auth ────────────────────────────────────────────────
  // OAuth callbacks และ static assets ไม่ต้องตรวจ session
  const isOAuthPath =
    pathname.startsWith('/api/auth/google') ||
    pathname.startsWith('/api/auth/line');

  const isPublicPath =
    pathname === '/' ||
    pathname === '/api/videos' ||
    pathname.startsWith('/streams') ||
    pathname.startsWith('/login') ||
    pathname === '/api/auth/logout' ||
    pathname === '/api/auth/me' ||
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico';

  // OAuth callbacks ข้ามการตรวจ session ทั้งหมด
  if (isOAuthPath) return NextResponse.next();

  // ── 2. อ่าน session token จาก Cookie ─────────────────────────────────────
  const token = request.cookies.get('tubelock_session')?.value;

  // ไม่มี token + ไม่ใช่ public path → redirect /login
  if (!token && !isPublicPath) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // ── 3. Validate token ใน DB ───────────────────────────────────────────────
  // ทำเฉพาะเมื่อมี token (ทั้ง public และ protected paths ที่มี token)
  if (token) {
    try {
      const sql = neon(process.env.DATABASE_URL);

      // SELECT เพื่อ validate — UPDATE last_seen_at ทำใน /api/auth/me แทน
      const result = await sql`
        SELECT id FROM user_sessions
        WHERE session_token = ${token}
          AND is_active = TRUE
          AND expires_at > NOW()
        LIMIT 1
      `;

      const isValid = result.length > 0;

      if (!isValid) {
        // Token หมดอายุหรือถูก revoke
        if (!isPublicPath) {
          const loginUrl = new URL('/login', request.url);
          loginUrl.searchParams.set('from', pathname);
          const res = NextResponse.redirect(loginUrl);
          res.cookies.set('tubelock_session', '', { maxAge: 0, path: '/' });
          return res;
        }
        // Public path + invalid token → ปล่อยผ่าน (จะ redirect ใน component เอง)
        return NextResponse.next();
      }

      // Valid session + กำลังจะเปิด /login → redirect ไปหน้าแรก
      if (isValid && pathname === '/login') {
        return NextResponse.redirect(new URL('/', request.url));
      }
    } catch (err) {
      // DB error → fall through (อย่า block user เพราะ infra ล่ม)
      console.error('[Middleware DB Error]:', err?.message);
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
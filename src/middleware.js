import { NextResponse } from 'next/server';

export function middleware(request) {
  const url = request.nextUrl.clone();
  const host = request.headers.get('host') || '';

  // Support m. subdomain (e.g. m.tubelock.vercel.app or m.localhost:3000)
  if (host.startsWith('m.') && !url.pathname.startsWith('/api')) {
    if (url.pathname === '/') {
      url.pathname = '/m';
      return NextResponse.rewrite(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};

// Next.js 16 renamed Middleware -> Proxy. This does OPTIMISTIC auth gating only
// (cookie presence). Real auth/role checks happen in the Route Handlers via
// getCurrentUser()/requireAdmin(). Keep this fast — no DB access here.
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/auth';

const PUBLIC_PATHS = ['/login'];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Auth endpoints must always be reachable (login/logout/me).
  if (pathname.startsWith('/api/auth')) return NextResponse.next();

  const hasSession = Boolean(req.cookies.get(SESSION_COOKIE)?.value);
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + '/'));

  if (!hasSession && !isPublic) {
    if (pathname.startsWith('/api')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  // Already logged in? Skip the login page.
  if (hasSession && pathname === '/login') {
    const url = req.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};

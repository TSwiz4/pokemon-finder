import { NextRequest, NextResponse } from 'next/server';
import { authenticate, createSession, logActivity } from '@/lib/auth';

export async function POST(req: NextRequest) {
  const { username, password } = await req.json().catch(() => ({}));
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }

  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';
  const user = authenticate(String(username), String(password));

  if (!user) {
    logActivity({ username: String(username), action: 'login_failed', ip });
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 });
  }

  await createSession(user.id);
  logActivity({ userId: user.id, username: user.username, action: 'login', ip });
  return NextResponse.json({ user });
}

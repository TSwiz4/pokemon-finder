import { NextResponse } from 'next/server';
import { getCurrentUser, destroyCurrentSession, logActivity } from '@/lib/auth';

export async function POST() {
  const user = await getCurrentUser();
  await destroyCurrentSession();
  if (user) logActivity({ userId: user.id, username: user.username, action: 'logout' });
  return NextResponse.json({ ok: true });
}

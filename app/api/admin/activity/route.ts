import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

// Recent activity, newest first. Optional ?user_id= to filter to one user (admin only).
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const userId = req.nextUrl.searchParams.get('user_id');
  const db = getDb();
  const rows = userId
    ? db.prepare('SELECT * FROM activity_log WHERE user_id = ? ORDER BY id DESC LIMIT 200').all(userId)
    : db.prepare('SELECT * FROM activity_log ORDER BY id DESC LIMIT 200').all();
  return NextResponse.json(rows);
}

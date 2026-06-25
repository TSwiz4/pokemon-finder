import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { requireAdmin, logActivity } from '@/lib/auth';
import { hashPassword } from '@/lib/crypto';

// List all users (admin only)
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const users = getDb().prepare(
    'SELECT id, username, role, active, created_at, last_login_at FROM users ORDER BY role DESC, username'
  ).all();
  return NextResponse.json(users);
}

// Create a user (admin only)
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { username, password, role } = await req.json().catch(() => ({}));
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }
  const resolvedRole = role === 'admin' ? 'admin' : 'friend';

  const db = getDb();
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    return NextResponse.json({ error: 'Username already exists' }, { status: 409 });
  }

  const result = db.prepare(
    'INSERT INTO users (username, password_hash, role, active) VALUES (?, ?, ?, 1)'
  ).run(String(username), hashPassword(String(password)), resolvedRole);

  logActivity({ userId: admin.id, username: admin.username, action: 'create_user', detail: `${username} (${resolvedRole})` });

  const user = db.prepare('SELECT id, username, role, active, created_at, last_login_at FROM users WHERE id = ?')
    .get(result.lastInsertRowid);
  return NextResponse.json(user, { status: 201 });
}

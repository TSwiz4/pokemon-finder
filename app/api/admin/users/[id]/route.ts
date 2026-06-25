import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { requireAdmin, logActivity } from '@/lib/auth';
import { hashPassword } from '@/lib/crypto';

// Delete a user (admin only). Can't delete yourself.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  if (Number(id) === admin.id) {
    return NextResponse.json({ error: 'You cannot delete your own account' }, { status: 400 });
  }

  const db = getDb();
  const target = db.prepare('SELECT username FROM users WHERE id = ?').get(id) as { username: string } | undefined;
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  logActivity({ userId: admin.id, username: admin.username, action: 'delete_user', detail: target.username });
  return NextResponse.json({ ok: true });
}

// Update a user: toggle active, or reset password (admin only).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const db = getDb();
  const target = db.prepare('SELECT username FROM users WHERE id = ?').get(id) as { username: string } | undefined;
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  if (body.active !== undefined) {
    const active = body.active ? 1 : 0;
    db.prepare('UPDATE users SET active = ? WHERE id = ?').run(active, id);
    if (!active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); // force logout
  }
  if (body.password) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(body.password)), id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id); // force re-login
  }

  logActivity({ userId: admin.id, username: admin.username, action: 'update_user', detail: target.username });
  const user = db.prepare('SELECT id, username, role, active, created_at, last_login_at FROM users WHERE id = ?').get(id);
  return NextResponse.json(user);
}

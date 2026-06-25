import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { requireAdmin, logActivity } from '@/lib/auth';

// Remove a watch item (admin only)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const db = getDb();
  const row = db.prepare('SELECT label FROM sniper_watchlist WHERE id = ?').get(id) as { label: string } | undefined;
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  db.prepare('DELETE FROM sniper_events WHERE watch_id = ?').run(id);
  db.prepare('DELETE FROM sniper_watchlist WHERE id = ?').run(id);
  logActivity({ userId: admin.id, username: admin.username, action: 'sniper_remove', detail: row.label });
  return NextResponse.json({ ok: true });
}

// Toggle active / edit max_qty (admin only)
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const db = getDb();
  if (!db.prepare('SELECT id FROM sniper_watchlist WHERE id = ?').get(id)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (body.active !== undefined) {
    db.prepare('UPDATE sniper_watchlist SET active = ? WHERE id = ?').run(body.active ? 1 : 0, id);
  }
  if (body.max_qty !== undefined && Number(body.max_qty) > 0) {
    db.prepare('UPDATE sniper_watchlist SET max_qty = ? WHERE id = ?').run(Math.floor(Number(body.max_qty)), id);
  }
  const row = db.prepare('SELECT * FROM sniper_watchlist WHERE id = ?').get(id);
  return NextResponse.json(row);
}

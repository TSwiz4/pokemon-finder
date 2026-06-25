import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { requireAdmin, logActivity } from '@/lib/auth';

const RETAILERS = ['walmart', 'target', 'bestbuy'];

// List the watchlist (admin only)
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const rows = getDb().prepare('SELECT * FROM sniper_watchlist ORDER BY active DESC, retailer, label').all();
  return NextResponse.json(rows);
}

// Add a watch item (admin only)
export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const { retailer, item_id, label, max_qty } = await req.json().catch(() => ({}));
  if (!retailer || !item_id || !label) {
    return NextResponse.json({ error: 'retailer, item_id and label are required' }, { status: 400 });
  }
  if (!RETAILERS.includes(retailer)) {
    return NextResponse.json({ error: `retailer must be one of ${RETAILERS.join(', ')}` }, { status: 400 });
  }

  const db = getDb();
  if (db.prepare('SELECT id FROM sniper_watchlist WHERE retailer = ? AND item_id = ?').get(retailer, String(item_id))) {
    return NextResponse.json({ error: 'That item is already on the watchlist' }, { status: 409 });
  }

  const qty = Number.isFinite(Number(max_qty)) && Number(max_qty) > 0 ? Math.floor(Number(max_qty)) : 99;
  const result = db.prepare(
    'INSERT INTO sniper_watchlist (retailer, item_id, label, max_qty) VALUES (?, ?, ?, ?)'
  ).run(retailer, String(item_id), String(label), qty);

  logActivity({ userId: admin.id, username: admin.username, action: 'sniper_add', detail: `${retailer}:${item_id} ${label}` });
  const row = db.prepare('SELECT * FROM sniper_watchlist WHERE id = ?').get(result.lastInsertRowid);
  return NextResponse.json(row, { status: 201 });
}

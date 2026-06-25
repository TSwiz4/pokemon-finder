import { NextRequest } from 'next/server';
import getDb from '@/lib/db';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const patterns = db.prepare(`
    SELECT * FROM store_patterns WHERE store_id = ? ORDER BY upvotes DESC, created_at DESC
  `).all(id);
  return Response.json(patterns);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const { reporter, truck_days, stock_time, employee_friendly, notes, confidence } = body;

  if (!truck_days && !stock_time && !notes) {
    return Response.json({ error: 'Provide at least one piece of intel.' }, { status: 400 });
  }

  const db = getDb();
  const store = db.prepare('SELECT id FROM stores WHERE id = ?').get(id);
  if (!store) return Response.json({ error: 'Store not found' }, { status: 404 });

  const result = db.prepare(`
    INSERT INTO store_patterns (store_id, reporter, truck_days, stock_time, employee_friendly, notes, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, reporter || 'Anonymous', truck_days || null, stock_time || null,
    employee_friendly ? 1 : 0, notes || null, confidence ?? 1);

  return Response.json(db.prepare('SELECT * FROM store_patterns WHERE id = ?').get(result.lastInsertRowid), { status: 201 });
}

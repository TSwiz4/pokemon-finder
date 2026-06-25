import { NextRequest, NextResponse } from 'next/server';
import getDb from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || 'unknown';

  const db = getDb();

  // Check if already upvoted
  const existing = db.prepare('SELECT id FROM upvotes WHERE restock_id = ? AND ip = ?').get(id, ip);
  if (existing) {
    return NextResponse.json({ error: 'Already upvoted' }, { status: 409 });
  }

  db.prepare('INSERT INTO upvotes (restock_id, ip) VALUES (?, ?)').run(id, ip);
  db.prepare('UPDATE restocks SET upvotes = upvotes + 1 WHERE id = ?').run(id);

  const restock = db.prepare('SELECT upvotes FROM restocks WHERE id = ?').get(id) as { upvotes: number };
  return NextResponse.json({ upvotes: restock.upvotes });
}

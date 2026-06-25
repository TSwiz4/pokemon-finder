import { NextRequest } from 'next/server';
import getDb from '@/lib/db';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; pid: string }> }) {
  const { pid } = await params;
  const db = getDb();
  db.prepare('UPDATE store_patterns SET upvotes = upvotes + 1 WHERE id = ?').run(pid);
  const row = db.prepare('SELECT upvotes FROM store_patterns WHERE id = ?').get(pid) as { upvotes: number };
  return Response.json({ upvotes: row?.upvotes ?? 0 });
}

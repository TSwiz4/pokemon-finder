import { NextRequest } from 'next/server';
import getDb from '@/lib/db';

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('store_id');
  const restockType = req.nextUrl.searchParams.get('restock_type'); // 'instore' | 'online'
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '50');

  const db = getDb();

  const conditions: string[] = [];
  const args: (string | number)[] = [];

  if (storeId) { conditions.push('r.store_id = ?'); args.push(storeId); }
  if (restockType) { conditions.push('r.restock_type = ?'); args.push(restockType); }

  const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

  const restocks = db.prepare(`
    SELECT r.*, s.name as store_name, s.chain, s.address, s.store_type
    FROM restocks r
    JOIN stores s ON s.id = r.store_id
    ${where}
    ORDER BY r.restock_date DESC, r.created_at DESC
    LIMIT ?
  `).all(...args, limit);

  return Response.json(restocks);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { store_id, reporter, products, shipment_details, restock_date, quantity_desc, source, restock_type } = body;

  if (!store_id || !products || !restock_date) {
    return Response.json({ error: 'Missing required fields: store_id, products, restock_date' }, { status: 400 });
  }

  const db = getDb();

  const store = db.prepare('SELECT id FROM stores WHERE id = ?').get(store_id);
  if (!store) return Response.json({ error: 'Store not found' }, { status: 404 });

  const result = db.prepare(`
    INSERT INTO restocks (store_id, reporter, products, shipment_details, restock_date, quantity_desc, source, restock_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    store_id,
    reporter || 'Anonymous',
    products,
    shipment_details || null,
    restock_date,
    quantity_desc || null,
    source || 'community',
    restock_type || 'instore',
  );

  const restock = db.prepare('SELECT * FROM restocks WHERE id = ?').get(result.lastInsertRowid);
  return Response.json(restock, { status: 201 });
}

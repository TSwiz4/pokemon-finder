import { NextRequest } from 'next/server';
import getDb from '@/lib/db';

export async function GET(req: NextRequest) {
  const storeId = req.nextUrl.searchParams.get('store_id');
  if (!storeId) {
    return Response.json({ error: 'store_id required' }, { status: 400 });
  }

  const db = getDb();

  const rows = db.prepare(`
    SELECT
      p.id           AS product_id,
      p.name         AS product_name,
      p.set_name,
      p.product_type,
      i.quantity,
      i.last_checked_at,
      i.source,
      cs.sku         AS chain_sku,
      cs.confirmed   AS sku_confirmed,
      s.chain
    FROM products p
    CROSS JOIN stores s
    LEFT JOIN inventory i  ON i.product_id = p.id AND i.store_id = s.id
    LEFT JOIN chain_skus cs ON cs.product_id = p.id AND cs.chain = s.chain
    WHERE s.id = ?
    ORDER BY p.set_name, p.product_type
  `).all(storeId);

  return Response.json(rows);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { store_id, product_id, quantity, source } = body;

  if (store_id == null || product_id == null || quantity == null) {
    return Response.json(
      { error: 'store_id, product_id, quantity required' },
      { status: 400 }
    );
  }
  if (typeof quantity !== 'number' || quantity < 0 || !Number.isFinite(quantity)) {
    return Response.json({ error: 'quantity must be a non-negative number' }, { status: 400 });
  }

  const db = getDb();

  const store = db.prepare('SELECT id FROM stores WHERE id = ?').get(store_id);
  if (!store) return Response.json({ error: 'Store not found' }, { status: 404 });

  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(product_id);
  if (!product) return Response.json({ error: 'Product not found' }, { status: 404 });

  db.prepare(`
    INSERT INTO inventory (store_id, product_id, quantity, last_checked_at, source)
    VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(store_id, product_id) DO UPDATE SET
      quantity = excluded.quantity,
      last_checked_at = excluded.last_checked_at,
      source = excluded.source
  `).run(store_id, product_id, quantity, source || 'manual');

  const row = db.prepare(`
    SELECT i.*, p.name AS product_name, p.set_name, p.product_type
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    WHERE i.store_id = ? AND i.product_id = ?
  `).get(store_id, product_id);

  return Response.json(row, { status: 201 });
}

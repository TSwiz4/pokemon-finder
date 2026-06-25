import { NextRequest } from 'next/server';
import getDb from '@/lib/db';

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get('type'); // 'retail' | 'online' | null (all)
  const db = getDb();

  const where = type ? `WHERE s.store_type = '${type}'` : '';

  const stores = db.prepare(`
    SELECT
      s.*,
      MAX(r.restock_date) as last_restock,
      COUNT(r.id) as restock_count
    FROM stores s
    LEFT JOIN restocks r ON r.store_id = s.id
    ${where}
    GROUP BY s.id
    ORDER BY s.chain, s.name
  `).all();

  return Response.json(stores);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { name, chain, address, lat, lng, store_type } = body;

  if (!name || !chain || !address) {
    return Response.json({ error: 'Missing required fields' }, { status: 400 });
  }

  const sType = store_type || 'retail';
  const latVal = sType === 'online' ? 0 : lat;
  const lngVal = sType === 'online' ? 0 : lng;

  if (sType === 'retail' && (!lat || !lng)) {
    return Response.json({ error: 'lat and lng required for retail stores' }, { status: 400 });
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO stores (name, chain, address, lat, lng, store_type) VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, chain, address, latVal, lngVal, sType);

  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(result.lastInsertRowid);
  return Response.json(store, { status: 201 });
}

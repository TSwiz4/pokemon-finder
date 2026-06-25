// GET /api/fills — the shared "Fills" live feed.
//
// Every login sees the same global feed: each row is a moment a SKU was
// detected in stock at a store (which SKU, how many, where, and when). Rows are
// written by /api/inventory/scan whenever a product transitions into stock.

import { NextRequest } from 'next/server';
import getDb from '@/lib/db';

interface FillRow {
  id: number;
  store_id: number;
  product_id: number;
  quantity: number;
  store_name: string;
  chain: string;
  address: string;
  lat: number;
  lng: number;
  product_label: string;
  detected_at: string;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '60', 10) || 60));
  const sinceId = parseInt(sp.get('since_id') ?? '0', 10) || 0;

  const db = getDb();
  const rows = db.prepare(`
    SELECT id, store_id, product_id, quantity, store_name, chain, address, lat, lng, product_label, detected_at
    FROM fills
    WHERE id > ?
    ORDER BY id DESC
    LIMIT ?
  `).all(sinceId, limit) as FillRow[];

  const latest = db.prepare('SELECT MAX(id) AS max_id FROM fills').get() as { max_id: number | null };

  return Response.json({
    count: rows.length,
    latest_id: latest.max_id ?? 0,
    fills: rows,
  });
}

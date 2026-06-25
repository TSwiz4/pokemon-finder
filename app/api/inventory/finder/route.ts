// GET /api/inventory/finder — per-store SKU detail for the Product Finder tab.
//
// Unlike /radius (which returns only aggregates), this returns each store WITH
// the list of products found there, so the UI can show exactly which SKUs are
// in stock at which store. Supports chain + set filters and an in-stock-only
// filter (the "only show stores that actually have something" toggle).

import { NextRequest } from 'next/server';
import getDb from '@/lib/db';

const EARTH_RADIUS_MI = 3958.8;

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

interface StoreRow { id: number; name: string; chain: string; address: string; lat: number; lng: number; }
interface InvRow {
  store_id: number; product_id: number; quantity: number; last_checked_at: string;
  name: string; set_name: string; product_type: string;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = parseFloat(sp.get('lat') ?? '');
  const lng = parseFloat(sp.get('lng') ?? '');
  const radius = parseFloat(sp.get('radius') ?? '10');
  const setFilter = sp.get('set'); // optional slug
  const inStockOnly = sp.get('in_stock_only') === '1';
  const chainsParam = sp.get('chains');
  const chains = chainsParam
    ? chainsParam.split(',').map((c) => c.trim().toLowerCase()).filter(Boolean)
    : null;

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: 'lat and lng required' }, { status: 400 });
  }
  if (!Number.isFinite(radius) || radius <= 0 || radius > 500) {
    return Response.json({ error: 'radius must be 0–500 miles' }, { status: 400 });
  }

  const db = getDb();
  const latDelta = radius / 69;
  const lngDelta = radius / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const chainClause = chains && chains.length ? `AND chain IN (${chains.map(() => '?').join(',')})` : '';

  const stores = db.prepare(`
    SELECT id, name, chain, address, lat, lng
    FROM stores
    WHERE store_type = 'retail'
      AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
      ${chainClause}
  `).all(lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta, ...(chains ?? [])) as StoreRow[];

  const inRadius = stores
    .map((s) => ({ ...s, distance_mi: Math.round(haversineMiles(lat, lng, s.lat, s.lng) * 10) / 10 }))
    .filter((s) => s.distance_mi <= radius);

  const storeIds = inRadius.map((s) => s.id);
  const invByStore = new Map<number, InvRow[]>();
  if (storeIds.length) {
    const setClause = setFilter ? 'AND p.set_name = ?' : '';
    const qtyClause = inStockOnly ? 'AND i.quantity > 0' : '';
    const rows = db.prepare(`
      SELECT i.store_id, i.product_id, i.quantity, i.last_checked_at,
             p.name, p.set_name, p.product_type
      FROM inventory i
      JOIN products p ON p.id = i.product_id
      WHERE i.store_id IN (${storeIds.map(() => '?').join(',')})
        ${setClause} ${qtyClause}
      ORDER BY i.quantity DESC, p.set_name, p.product_type
    `).all(...storeIds, ...(setFilter ? [setFilter] : [])) as InvRow[];
    for (const r of rows) {
      if (!invByStore.has(r.store_id)) invByStore.set(r.store_id, []);
      invByStore.get(r.store_id)!.push(r);
    }
  }

  let results = inRadius.map((s) => {
    const products = (invByStore.get(s.id) ?? []).map((r) => ({
      product_id: r.product_id,
      name: r.name,
      set_name: r.set_name,
      type: r.product_type,
      quantity: r.quantity,
      last_checked_at: r.last_checked_at,
    }));
    const in_stock_count = products.filter((p) => p.quantity > 0).length;
    const last_checked_at = products.reduce<string | null>(
      (max, p) => (!max || p.last_checked_at > max ? p.last_checked_at : max), null);
    return { ...s, products, in_stock_count, scanned: products.length > 0, last_checked_at };
  });

  if (inStockOnly) results = results.filter((s) => s.in_stock_count > 0);

  results.sort((a, b) => {
    if (b.in_stock_count !== a.in_stock_count) return b.in_stock_count - a.in_stock_count;
    return a.distance_mi - b.distance_mi;
  });

  return Response.json({
    center: { lat, lng },
    radius_mi: radius,
    count: results.length,
    stores: results,
  });
}

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

interface StoreRow {
  id: number;
  name: string;
  chain: string;
  address: string;
  lat: number;
  lng: number;
}

interface InventoryAggRow {
  store_id: number;
  total_quantity: number;
  product_count: number;
  last_checked_at: string;
}

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get('lat') ?? '');
  const lng = parseFloat(req.nextUrl.searchParams.get('lng') ?? '');
  const radius = parseFloat(req.nextUrl.searchParams.get('radius') ?? '10');
  const setFilter = req.nextUrl.searchParams.get('set'); // optional: 'ascended_heroes' | ...
  const chainsParam = req.nextUrl.searchParams.get('chains'); // optional CSV: 'target,walmart'
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

  // Bounding box pre-filter: 1 deg lat ~= 69 mi; lng compresses by cos(lat)
  const latDelta = radius / 69;
  const lngDelta = radius / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));

  const chainClause = chains && chains.length
    ? `AND chain IN (${chains.map(() => '?').join(',')})`
    : '';

  const stores = db.prepare(`
    SELECT id, name, chain, address, lat, lng
    FROM stores
    WHERE store_type = 'retail'
      AND lat BETWEEN ? AND ?
      AND lng BETWEEN ? AND ?
      ${chainClause}
  `).all(lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta, ...(chains ?? [])) as StoreRow[];

  const setClause = setFilter ? 'AND p.set_name = ?' : '';
  const setArgs = setFilter ? [setFilter] : [];

  const inventoryRows = db.prepare(`
    SELECT
      i.store_id,
      SUM(i.quantity)        AS total_quantity,
      COUNT(i.product_id)    AS product_count,
      MAX(i.last_checked_at) AS last_checked_at
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    WHERE 1=1 ${setClause}
    GROUP BY i.store_id
  `).all(...setArgs) as InventoryAggRow[];

  const invByStore = new Map<number, InventoryAggRow>();
  for (const row of inventoryRows) invByStore.set(row.store_id, row);

  const results = stores
    .map(s => {
      const distance_mi = haversineMiles(lat, lng, s.lat, s.lng);
      const inv = invByStore.get(s.id);
      return {
        ...s,
        distance_mi: Math.round(distance_mi * 10) / 10,
        total_quantity: inv?.total_quantity ?? 0,
        product_count: inv?.product_count ?? 0,
        last_checked_at: inv?.last_checked_at ?? null,
      };
    })
    .filter(s => s.distance_mi <= radius)
    .sort((a, b) => {
      if (b.total_quantity !== a.total_quantity) return b.total_quantity - a.total_quantity;
      return a.distance_mi - b.distance_mi;
    });

  return Response.json({
    center: { lat, lng },
    radius_mi: radius,
    set: setFilter,
    count: results.length,
    stores: results,
  });
}

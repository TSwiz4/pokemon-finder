// POST /api/inventory/scan — the WRITER that fills the inventory table.
//
// The radius reader (/api/inventory/radius) only ever showed zeros because
// nothing wrote live per-store stock. This endpoint does a targeted, capped
// scan (the way paid services stay under rate limits): pick the nearest N
// stores of the requested chains, look up live stock, and upsert into the
// `inventory` table so the map pins + Stock list show real quantities.
//
// Today only Target returns live per-store stock server-side. Walmart/Best Buy
// are online-drop lanes (sitewide, not per-store) and are bot-walled until a
// residential worker (SCANNER_WORKER_URL) is configured — they are reported in
// the response as skipped with a reason rather than silently producing zeros.

import { NextRequest } from 'next/server';
import getDb from '@/lib/db';
import { scanTargetStore } from '@/lib/scanner';
import { hasResidentialWorker } from '@/lib/retailFetch';

const EARTH_RADIUS_MI = 3958.8;
const DEFAULT_LIMIT = 6;
const MAX_LIMIT = 15;

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

interface StoreRow { id: number; name: string; chain: string; lat: number; lng: number; }
interface SkuRow { sku: string; product_id: number; }

// Per-store live scanning is only implemented for these chains today.
const PER_STORE_CHAINS = new Set(['target']);
// Online-drop chains have no per-store inventory; surfaced via the sniper, not the map.
const ONLINE_ONLY_REASON: Record<string, string> = {
  walmart: 'online drop (sitewide, not per-store); bot-walled until a residential worker is set',
  bestbuy: 'needs Best Buy key or residential worker',
};

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'JSON body required' }, { status: 400 });
  }

  const lat = Number(body.lat);
  const lng = Number(body.lng);
  const radius = Number(body.radius ?? 10);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(body.limit ?? DEFAULT_LIMIT)));
  const setFilter = typeof body.set === 'string' && body.set !== 'all' ? body.set : null;
  const chains: string[] = Array.isArray(body.chains) && body.chains.length
    ? (body.chains as unknown[]).map(String)
    : ['target'];

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return Response.json({ error: 'lat and lng required' }, { status: 400 });
  }
  if (!Number.isFinite(radius) || radius <= 0 || radius > 500) {
    return Response.json({ error: 'radius must be 0–500 miles' }, { status: 400 });
  }

  const db = getDb();
  const skipped: { chain: string; reason: string }[] = [];

  // Online-only / unsupported chains: report why, don't scan.
  for (const c of chains) {
    if (!PER_STORE_CHAINS.has(c)) {
      skipped.push({ chain: c, reason: ONLINE_ONLY_REASON[c] ?? 'no per-store detector' });
    }
  }

  const scanChains = chains.filter((c) => PER_STORE_CHAINS.has(c));
  if (scanChains.length === 0) {
    return Response.json({
      scanned_stores: 0, in_stock_stores: 0, wrote_rows: 0,
      residential_worker: hasResidentialWorker(), skipped, stores: [],
    });
  }

  // SKUs to scan (Target only today), optionally set-filtered.
  const setClause = setFilter ? 'AND p.set_name = ?' : '';
  const targetSkus = db.prepare(`
    SELECT cs.sku AS sku, cs.product_id AS product_id
    FROM chain_skus cs
    JOIN products p ON p.id = cs.product_id
    WHERE cs.chain = 'target' AND cs.confirmed = 1 ${setClause}
  `).all(...(setFilter ? [setFilter] : [])) as SkuRow[];

  const tcinToProduct = new Map<string, number>();
  for (const r of targetSkus) tcinToProduct.set(r.sku, r.product_id);
  const tcins = [...tcinToProduct.keys()];

  // Bounding box, then nearest-N of the requested per-store chains.
  const latDelta = radius / 69;
  const lngDelta = radius / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const placeholders = scanChains.map(() => '?').join(',');
  const candidates = (db.prepare(`
    SELECT id, name, chain, lat, lng FROM stores
    WHERE store_type = 'retail' AND chain IN (${placeholders})
      AND lat BETWEEN ? AND ? AND lng BETWEEN ? AND ?
  `).all(...scanChains, lat - latDelta, lat + latDelta, lng - lngDelta, lng + lngDelta) as StoreRow[])
    .map((s) => ({ ...s, distance_mi: Math.round(haversineMiles(lat, lng, s.lat, s.lng) * 10) / 10 }))
    .filter((s) => s.distance_mi <= radius)
    .sort((a, b) => a.distance_mi - b.distance_mi)
    .slice(0, limit);

  const upsert = db.prepare(`
    INSERT INTO inventory (store_id, product_id, quantity, last_checked_at, source)
    VALUES (?, ?, ?, datetime('now'), ?)
    ON CONFLICT(store_id, product_id) DO UPDATE SET
      quantity = excluded.quantity,
      last_checked_at = excluded.last_checked_at,
      source = excluded.source
  `);

  const stores: { id: number; name: string; chain: string; distance_mi: number; status: string; in_stock: number; wrote: number; }[] = [];
  let wroteRows = 0;
  let inStockStores = 0;

  for (const store of candidates) {
    if (store.chain !== 'target' || tcins.length === 0) {
      stores.push({ id: store.id, name: store.name, chain: store.chain, distance_mi: store.distance_mi, status: 'SKIPPED', in_stock: 0, wrote: 0 });
      continue;
    }

    const result = await scanTargetStore(store.lat, store.lng, tcins);
    if (!result) {
      stores.push({ id: store.id, name: store.name, chain: store.chain, distance_mi: store.distance_mi, status: 'CHECK_FAILED', in_stock: 0, wrote: 0 });
      continue;
    }

    let storeInStock = 0;
    let wrote = 0;
    const writeAll = db.transaction(() => {
      for (const [tcin, stock] of result.stock) {
        const productId = tcinToProduct.get(tcin);
        if (productId == null) continue;
        if (stock.status === 'CHECK_FAILED') continue; // don't overwrite good data with a failed probe
        const qty = stock.quantity ?? (stock.available ? 1 : 0);
        upsert.run(store.id, productId, qty, 'target_live');
        if (qty > 0) storeInStock++;
        wrote++;
      }
    });
    writeAll();

    wroteRows += wrote;
    if (storeInStock > 0) inStockStores++;
    stores.push({ id: store.id, name: store.name, chain: store.chain, distance_mi: store.distance_mi, status: 'OK', in_stock: storeInStock, wrote });

    await new Promise((r) => setTimeout(r, 350)); // gentle pacing between stores
  }

  return Response.json({
    scanned_stores: stores.length,
    in_stock_stores: inStockStores,
    wrote_rows: wroteRows,
    residential_worker: hasResidentialWorker(),
    skipped,
    stores,
    checked_at: new Date().toISOString(),
  });
}

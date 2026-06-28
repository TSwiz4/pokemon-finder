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
import { getCurrentUser } from '@/lib/auth';

const EARTH_RADIUS_MI = 3958.8;
const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 10;
// RedSky is burst-rate-limited — space calls ~8s apart to stay un-flagged.
const PACE_MS = 8000;
// Per-PERSON 1-hour cooldown. NOTE: all scans still funnel through the one
// residential worker IP, so a global lock (below) serializes them so they never
// burst — the per-user cooldown is fairness, the lock is IP protection.
const SCAN_COOLDOWN_MS = 60 * 60 * 1000;
const SCAN_LOCK_TTL_MS = 5 * 60 * 1000; // stale-lock auto-expiry (a scan never runs this long)

type DB = ReturnType<typeof getDb>;

function getMeta(db: DB, key: string): string | null {
  const r = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value ?? null;
}
function setMeta(db: DB, key: string, value: string) {
  db.prepare('INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}
function userCooldownKey(userId: number | null): string {
  return `last_scan_at:u${userId ?? 'anon'}`;
}
function cooldownRemainingMs(db: DB, key: string): number {
  const last = getMeta(db, key);
  if (!last) return 0;
  return Math.max(0, SCAN_COOLDOWN_MS - (Date.now() - Date.parse(last)));
}

// GET — this user's cooldown status for the scan timer.
export async function GET() {
  const db = getDb();
  const user = await getCurrentUser();
  const key = userCooldownKey(user?.id ?? null);
  const remaining = cooldownRemainingMs(db, key);
  return Response.json({
    can_scan: remaining === 0,
    seconds_remaining: Math.ceil(remaining / 1000),
    cooldown_seconds: SCAN_COOLDOWN_MS / 1000,
    last_scan_at: getMeta(db, key),
  });
}

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

interface StoreRow { id: number; name: string; chain: string; address: string; lat: number; lng: number; ext_store_id: string | null; }
interface SkuRow { sku: string; product_id: number; product_name: string; }

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

  // Per-person cooldown: each user gets one scan per hour.
  const user = await getCurrentUser();
  const cdKey = userCooldownKey(user?.id ?? null);
  const remainingMs = cooldownRemainingMs(db, cdKey);
  if (remainingMs > 0) {
    return Response.json({
      error: 'cooldown', cooldown: true,
      seconds_remaining: Math.ceil(remainingMs / 1000),
      last_scan_at: getMeta(db, cdKey),
    }, { status: 429 });
  }
  // Global serializer: all scans share one residential IP, so never run two at
  // once (that would burst the IP and trip Akamai). Stale locks auto-expire.
  const lock = getMeta(db, 'scan_lock');
  if (lock && Date.now() - Date.parse(lock) < SCAN_LOCK_TTL_MS) {
    return Response.json({
      error: 'busy', busy: true,
      message: 'Another scan is running right now — try again in a moment.',
    }, { status: 409 });
  }
  setMeta(db, 'scan_lock', new Date().toISOString());
  // Claim this user's hourly slot now that we hold the lock.
  setMeta(db, cdKey, new Date().toISOString());

  try {
  // SKUs to scan (Target only today), optionally set-filtered.
  const setClause = setFilter ? 'AND p.set_name = ?' : '';
  const targetSkus = db.prepare(`
    SELECT cs.sku AS sku, cs.product_id AS product_id, p.name AS product_name
    FROM chain_skus cs
    JOIN products p ON p.id = cs.product_id
    WHERE cs.chain = 'target' AND cs.confirmed = 1 ${setClause}
  `).all(...(setFilter ? [setFilter] : [])) as SkuRow[];

  const tcinToProduct = new Map<string, number>();
  const productLabel = new Map<number, string>();
  for (const r of targetSkus) { tcinToProduct.set(r.sku, r.product_id); productLabel.set(r.product_id, r.product_name); }
  const tcins = [...tcinToProduct.keys()];

  // Bounding box, then nearest-N of the requested per-store chains.
  const latDelta = radius / 69;
  const lngDelta = radius / (69 * Math.max(Math.cos((lat * Math.PI) / 180), 0.01));
  const placeholders = scanChains.map(() => '?').join(',');
  const candidates = (db.prepare(`
    SELECT id, name, chain, address, lat, lng, ext_store_id FROM stores
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
  const prevQty = db.prepare('SELECT quantity FROM inventory WHERE store_id = ? AND product_id = ?');
  const insertFill = db.prepare(`
    INSERT INTO fills (store_id, product_id, quantity, store_name, chain, address, lat, lng, product_label)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const saveStoreId = db.prepare('UPDATE stores SET ext_store_id = ? WHERE id = ? AND ext_store_id IS NULL');

  const stores: { id: number; name: string; chain: string; distance_mi: number; status: string; in_stock: number; wrote: number; }[] = [];
  let wroteRows = 0;
  let inStockStores = 0;
  let newFills = 0;

  let storeIdx = 0;
  for (const store of candidates) {
    if (store.chain !== 'target' || tcins.length === 0) {
      stores.push({ id: store.id, name: store.name, chain: store.chain, distance_mi: store.distance_mi, status: 'SKIPPED', in_stock: 0, wrote: 0 });
      continue;
    }
    // Pace between stores so RedSky doesn't see a burst.
    if (storeIdx > 0) await new Promise((r) => setTimeout(r, PACE_MS));
    storeIdx++;

    const result = await scanTargetStore(store.lat, store.lng, tcins, {
      knownStoreId: store.ext_store_id ?? undefined,
      paceMs: PACE_MS,
    });
    if (!result) {
      stores.push({ id: store.id, name: store.name, chain: store.chain, distance_mi: store.distance_mi, status: 'CHECK_FAILED', in_stock: 0, wrote: 0 });
      continue;
    }
    if (result.storeId && !store.ext_store_id) saveStoreId.run(result.storeId, store.id);

    let storeInStock = 0;
    let wrote = 0;
    const writeAll = db.transaction(() => {
      for (const [tcin, stock] of result.stock) {
        const productId = tcinToProduct.get(tcin);
        if (productId == null) continue;
        if (stock.status === 'CHECK_FAILED') continue; // don't overwrite good data with a failed probe
        const qty = stock.quantity ?? (stock.available ? 1 : 0);
        const prev = prevQty.get(store.id, productId) as { quantity: number } | undefined;
        const wasInStock = (prev?.quantity ?? 0) > 0;
        upsert.run(store.id, productId, qty, 'target_live');
        wrote++;
        if (qty > 0) {
          storeInStock++;
          // A "fill" = a fresh transition into stock. Logged to the shared Fills feed.
          if (!wasInStock) {
            insertFill.run(store.id, productId, qty, store.name, store.chain, store.address, store.lat, store.lng, productLabel.get(productId) ?? null);
            newFills++;
          }
        }
      }
    });
    writeAll();

    wroteRows += wrote;
    if (storeInStock > 0) inStockStores++;
    stores.push({ id: store.id, name: store.name, chain: store.chain, distance_mi: store.distance_mi, status: 'OK', in_stock: storeInStock, wrote });
  }

  return Response.json({
    scanned_stores: stores.length,
    in_stock_stores: inStockStores,
    wrote_rows: wroteRows,
    new_fills: newFills,
    residential_worker: hasResidentialWorker(),
    cooldown_seconds: SCAN_COOLDOWN_MS / 1000,
    next_scan_in: SCAN_COOLDOWN_MS / 1000,
    skipped,
    stores,
    checked_at: new Date().toISOString(),
  });
  } finally {
    setMeta(db, 'scan_lock', ''); // release the global lock so the next scan can run
  }
}

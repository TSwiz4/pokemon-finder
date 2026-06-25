// scanner.ts — single source of truth for per-chain stock detectors.
//
// All network calls go through retailFetch (the home-PC seam). Functions here
// are pure detectors: give them an id, get back a normalized result. They do
// NOT touch the DB — callers (scan route, sniper check route) decide what to
// persist. Target works server-side today; Walmart/Best Buy will mostly return
// CHECK_FAILED until a residential worker is configured (SCANNER_WORKER_URL).

import { randomUUID } from 'crypto';
import { retailFetch } from './retailFetch';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Public web key target.com itself sends to RedSky. Required on every aggregations call.
const REDSKY_KEY = '9f36aeafbe60771e321a7cc95a78140772ab3e96';

export type StockStatus = 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN' | 'CHECK_FAILED';

export interface TcinStock {
  tcin: string;
  status: StockStatus;
  available: boolean;
  quantity: number | null;
  price: number | null;
}

export interface ItemCheck {
  status: StockStatus;
  detail: string;
  price: number | null;
}

// ---------------------------------------------------------------------------
// Target (RedSky) — per-store inventory. Works without a key or proxy.
// ---------------------------------------------------------------------------

/**
 * Resolve the nearest Target store_id for lat/lng.
 * Uses nearby_stores_v1 — the v3/stores/nearby endpoint was retired (HTTP 410).
 */
export async function findTargetStoreId(lat: number, lng: number): Promise<string | null> {
  const url =
    `https://redsky.target.com/redsky_aggregations/v1/web/nearby_stores_v1` +
    `?key=${REDSKY_KEY}&limit=1&within=100&place=${lat},${lng}`;
  const res = await retailFetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.target.com/' },
    timeoutMs: 8000,
  });
  if (!res.ok) return null;
  try {
    const data = JSON.parse(res.text);
    const stores = data?.data?.nearby_stores?.stores ?? data?.data?.stores ?? [];
    if (Array.isArray(stores) && stores.length) {
      return String(stores[0]?.store_id ?? stores[0]?.location_id);
    }
  } catch {
    /* fall through to regex */
  }
  // Defensive fallback: pluck the first store_id from the raw body.
  const m = res.text.match(/"store_id"\s*:\s*"?(\d+)"?/);
  return m ? m[1] : null;
}

/** Query RedSky product-summary-with-fulfillment for a batch of TCINs at a store. */
async function queryRedSky(
  tcins: string[],
  storeId: string,
  zip: string,
  state: string,
  lat: number,
  lng: number,
): Promise<Record<string, unknown> | null> {
  const visitorId = randomUUID().replace(/-/g, '').toUpperCase();
  const params = new URLSearchParams({
    key: REDSKY_KEY,
    tcins: tcins.join(','),
    store_id: storeId,
    required_store_id: storeId,
    zip,
    state,
    latitude: String(lat),
    longitude: String(lng),
    visitor_id: visitorId,
    channel: 'WEB',
    page: '/s?searchTerm=pokemon+cards',
    has_required_store_id: 'true',
    skip_price_promo: 'true',
  });
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/product_summary_with_fulfillment_v1?${params}`;
  const res = await retailFetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.target.com/s?searchTerm=pokemon+cards',
      Origin: 'https://www.target.com',
    },
    timeoutMs: 12000,
  });
  if (!res.ok) return null;
  try {
    return JSON.parse(res.text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseTcinStock(data: Record<string, unknown>, tcin: string): TcinStock {
  try {
    const root = (data as Record<string, unknown>)?.data as Record<string, unknown> | unknown[] | undefined;
    const summaries = (root as Record<string, unknown>)?.product_summaries;
    const items: unknown[] = Array.isArray(summaries)
      ? summaries
      : Array.isArray(root)
        ? root
        : [];
    for (const rawItem of items) {
      const item = rawItem as Record<string, unknown>;
      const inner = (item?.item ?? {}) as Record<string, unknown>;
      const itemTcin = String(item?.tcin ?? inner?.tcin ?? '');
      if (!itemTcin.includes(tcin)) continue;

      const fulfillment = (item?.fulfillment ?? inner?.fulfillment) as Record<string, unknown> | undefined;
      const storeOpts = (fulfillment?.store_options ?? []) as Record<string, unknown>[];
      const storeOpt = (storeOpts[0] ?? {}) as Record<string, unknown>;

      const qty = Number(storeOpt?.location_available_to_promise_quantity ?? -1);
      const pickupAvail = ((storeOpt?.order_pickup ?? {}) as Record<string, unknown>)?.availability_status;
      const instoreAvail = ((storeOpt?.in_store_only ?? {}) as Record<string, unknown>)?.availability_status;
      const rawStatus = String(pickupAvail ?? instoreAvail ?? 'UNKNOWN');

      const priceObj = (item?.price ?? inner?.price ?? {}) as Record<string, unknown>;
      const price = Number(priceObj?.current_retail ?? 0) || null;

      const available = rawStatus === 'IN_STOCK' || rawStatus === 'LIMITED_STOCK' || qty > 0;
      const status: StockStatus = available ? 'IN_STOCK' : 'OUT_OF_STOCK';
      return { tcin, status, available, quantity: qty >= 0 ? qty : null, price };
    }
  } catch {
    /* fall through */
  }
  return { tcin, status: 'UNKNOWN', available: false, quantity: null, price: null };
}

/**
 * Live per-store stock for a list of Target TCINs near lat/lng.
 * Resolves the store internally and returns a map keyed by TCIN.
 * Returns null if the store couldn't be resolved (caller marks the store failed).
 */
export async function scanTargetStore(
  lat: number,
  lng: number,
  tcins: string[],
  opts: { zip?: string; state?: string } = {},
): Promise<{ storeId: string; stock: Map<string, TcinStock> } | null> {
  const storeId = await findTargetStoreId(lat, lng);
  if (!storeId) return null;

  const zip = opts.zip ?? '34677';
  const state = opts.state ?? 'FL';
  const stock = new Map<string, TcinStock>();

  for (let i = 0; i < tcins.length; i += 10) {
    const batch = tcins.slice(i, i + 10);
    const data = await queryRedSky(batch, storeId, zip, state, lat, lng);
    if (data) {
      for (const tcin of batch) stock.set(tcin, parseTcinStock(data, tcin));
    } else {
      for (const tcin of batch) {
        stock.set(tcin, { tcin, status: 'CHECK_FAILED', available: false, quantity: null, price: null });
      }
    }
    if (i + 10 < tcins.length) await new Promise((r) => setTimeout(r, 400));
  }
  return { storeId, stock };
}

// ---------------------------------------------------------------------------
// Walmart — online drops. Sitewide product page (buyable + price), NOT per-store.
// Server-side this is PerimeterX-walled; works once a residential worker is set.
// ---------------------------------------------------------------------------

export async function checkWalmartItem(itemId: string): Promise<ItemCheck> {
  const res = await retailFetch(`https://www.walmart.com/ip/${itemId}`, {
    headers: { 'User-Agent': UA, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
    timeoutMs: 9000,
  });
  if (res.status === 412 || res.status === 403 || res.status === 429) {
    return { status: 'CHECK_FAILED', detail: `blocked (HTTP ${res.status})`, price: null };
  }
  if (!res.ok) return { status: 'CHECK_FAILED', detail: res.status ? `HTTP ${res.status}` : res.text, price: null };

  const html = res.text;
  const priceMatch = html.match(/"currentPrice"\s*:\s*\{[^}]*"price"\s*:\s*([\d.]+)/) ||
    html.match(/"price"\s*:\s*([\d.]+)\s*,\s*"priceString"/);
  const price = priceMatch ? Number(priceMatch[1]) || null : null;

  const m = html.match(/"availabilityStatus"\s*:\s*"([A-Z_]+)"/);
  if (!m) return { status: 'UNKNOWN', detail: 'no availability signal (likely bot-walled)', price };
  if (m[1] === 'IN_STOCK') return { status: 'IN_STOCK', detail: 'availabilityStatus=IN_STOCK', price };
  return { status: 'OUT_OF_STOCK', detail: `availabilityStatus=${m[1]}`, price };
}

// ---------------------------------------------------------------------------
// Target single-item check (PDP) — used by the sniper watchlist.
// ---------------------------------------------------------------------------

export async function checkTargetItem(tcin: string): Promise<ItemCheck> {
  const url = `https://redsky.target.com/redsky_aggregations/v1/web/pdp_client_v1?key=${REDSKY_KEY}&tcin=${tcin}&pricing_store_id=1768`;
  const res = await retailFetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Referer: 'https://www.target.com/' },
    timeoutMs: 9000,
  });
  if (!res.ok) return { status: 'CHECK_FAILED', detail: res.status ? `RedSky HTTP ${res.status}` : res.text, price: null };
  const text = res.text;
  if (text.includes('captcha')) return { status: 'CHECK_FAILED', detail: 'RedSky captcha-gated', price: null };
  const priceMatch = text.match(/"current_retail"\s*:\s*([\d.]+)/);
  const price = priceMatch ? Number(priceMatch[1]) || null : null;
  const m = text.match(/"availability_status"\s*:\s*"([A-Z_]+)"/);
  if (!m) return { status: 'UNKNOWN', detail: 'no availability_status in response', price };
  if (m[1] === 'IN_STOCK') return { status: 'IN_STOCK', detail: 'availability_status=IN_STOCK', price };
  return { status: 'OUT_OF_STOCK', detail: `availability_status=${m[1]}`, price };
}

// ---------------------------------------------------------------------------
// Best Buy — unofficial endpoints are Akamai-walled server-side; needs worker.
// ---------------------------------------------------------------------------

export async function checkBestBuyItem(sku: string): Promise<ItemCheck> {
  const res = await retailFetch(
    `https://www.bestbuy.com/api/3.0/priceBlocks?skus=${sku}`,
    { headers: { 'User-Agent': UA, Accept: 'application/json' }, timeoutMs: 9000 },
  );
  if (!res.ok) return { status: 'CHECK_FAILED', detail: res.status ? `HTTP ${res.status}` : (res.text || 'no response (Akamai wall)'), price: null };
  const m = res.text.match(/"buttonState"\s*:\s*"([A-Z_]+)"/);
  if (!m) return { status: 'UNKNOWN', detail: 'no buttonState signal', price: null };
  if (m[1] === 'ADD_TO_CART') return { status: 'IN_STOCK', detail: 'buttonState=ADD_TO_CART', price: null };
  return { status: 'OUT_OF_STOCK', detail: `buttonState=${m[1]}`, price: null };
}

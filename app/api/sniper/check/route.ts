// Sniper detector. Checks each ACTIVE watchlist item's availability, updates
// last_status, and logs an event whenever status CHANGES (esp. -> IN_STOCK).
//
// NOTE: Walmart fronts pages with PerimeterX/HUMAN and will often block a plain
// server fetch (status -> CHECK_FAILED). That's expected: this endpoint proves the
// pipeline. Robust detection needs residential proxies (Phase 2, see docs/SNIPER_FEASIBILITY.md).
// Target uses the same RedSky path that already works for the SKU finder.
import { NextResponse } from 'next/server';
import getDb from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { checkWalmartItem, checkTargetItem, checkBestBuyItem, type ItemCheck } from '@/lib/scanner';

async function checkRetailer(retailer: string, itemId: string): Promise<ItemCheck> {
  if (retailer === 'walmart') return checkWalmartItem(itemId);
  if (retailer === 'target') return checkTargetItem(itemId);
  if (retailer === 'bestbuy') return checkBestBuyItem(itemId);
  return { status: 'UNKNOWN', detail: 'retailer not supported', price: null };
}

interface WatchRow { id: number; retailer: string; item_id: string; label: string; last_status: string | null }

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const db = getDb();
  const rows = db.prepare('SELECT id, retailer, item_id, label, last_status FROM sniper_watchlist WHERE active = 1').all() as WatchRow[];

  const updateRow = db.prepare('UPDATE sniper_watchlist SET last_status = ?, last_checked_at = datetime(\'now\') WHERE id = ?');
  const markInStock = db.prepare('UPDATE sniper_watchlist SET last_in_stock_at = datetime(\'now\') WHERE id = ?');
  const logEvent = db.prepare('INSERT INTO sniper_events (watch_id, status, detail) VALUES (?, ?, ?)');

  const results: { id: number; label: string; retailer: string; status: string; detail: string; changed: boolean }[] = [];

  for (const row of rows) {
    const result = await checkRetailer(row.retailer, row.item_id);

    const changed = result.status !== row.last_status;
    updateRow.run(result.status, row.id);
    if (result.status === 'IN_STOCK') markInStock.run(row.id);
    if (changed) logEvent.run(row.id, result.status, result.detail);

    results.push({ id: row.id, label: row.label, retailer: row.retailer, ...result, changed });
    await new Promise((r) => setTimeout(r, 400)); // be gentle between requests
  }

  const inStock = results.filter((r) => r.status === 'IN_STOCK');
  return NextResponse.json({ checked: results.length, in_stock: inStock.length, checked_at: new Date().toISOString(), results });
}

// Live per-store Target stock for the map-pin popup.
// Delegates to lib/scanner (RedSky via retailFetch) — the old v3/stores/nearby
// endpoint this route used was retired (HTTP 410); scanner uses nearby_stores_v1.

import { NextRequest } from 'next/server';
import { scanTargetStore } from '@/lib/scanner';

// TCINs confirmed from target.com URLs. Names/types/sets label the popup rows.
export const POKEMON_TCINS: Record<string, { tcin: string; name: string; type: string }[]> = {
  'Chaos Rising': [
    { tcin: '95267143', name: 'Chaos Rising ETB',             type: 'ETB' },
    { tcin: '95298172', name: 'Chaos Rising Booster Bundle',  type: 'Bundle' },
  ],
  'First Partner Collection': [
    { tcin: '1011209279', name: 'First Partner Illustration Collection Series 2', type: 'Collection' },
  ],
  'Perfect Order': [
    { tcin: '95230445', name: 'Perfect Order ETB',              type: 'ETB' },
    { tcin: '95230447', name: 'Perfect Order Booster Bundle',   type: 'Bundle' },
    { tcin: '95252674', name: 'Perfect Order Booster Display',  type: 'Booster Box' },
    { tcin: '95230446', name: 'Perfect Order Blister',          type: 'Blister' },
  ],
  'Ascended Heroes': [
    { tcin: '95082118', name: 'Ascended Heroes ETB',            type: 'ETB' },
    { tcin: '95120834', name: 'Ascended Heroes Booster Bundle', type: 'Bundle' },
    { tcin: '1009871732', name: 'Ascended Heroes PC ETB',       type: 'ETB' },
  ],
  'Prismatic Evolutions': [
    { tcin: '93954435', name: 'Prismatic Evolutions ETB',            type: 'ETB' },
    { tcin: '93954446', name: 'Prismatic Evolutions Booster Bundle', type: 'Bundle' },
    { tcin: '94300072', name: 'Prismatic Evolutions Super Premium',  type: 'SPC' },
    { tcin: '93803457', name: 'Prismatic Evolutions Poster Coll.',   type: 'Collection' },
  ],
  'Surging Sparks': [
    { tcin: '91619922', name: 'Surging Sparks ETB',            type: 'ETB' },
    { tcin: '91619929', name: 'Surging Sparks Booster Bundle', type: 'Bundle' },
    { tcin: '91619928', name: 'Surging Sparks Blister',        type: 'Blister' },
  ],
};

export const ALL_TCINS = Object.values(POKEMON_TCINS).flat();

interface StockItem {
  tcin: string; name: string; type: string; set: string;
  available: boolean; quantity: number | null; status: string; price: number | null;
}

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get('lat') ?? '');
  const lng = parseFloat(req.nextUrl.searchParams.get('lng') ?? '');
  const zip = req.nextUrl.searchParams.get('zip') ?? '34677';
  const state = req.nextUrl.searchParams.get('state') ?? 'FL';

  if (isNaN(lat) || isNaN(lng)) {
    return Response.json({ error: 'lat and lng required' }, { status: 400 });
  }

  const tcins = ALL_TCINS.map((p) => p.tcin);
  const result = await scanTargetStore(lat, lng, tcins, { zip, state });
  if (!result) {
    return Response.json({ error: 'Could not reach Target stock (no store nearby, or rate-limited — try again shortly).' }, { status: 502 });
  }

  const inventory: StockItem[] = [];
  for (const [setName, products] of Object.entries(POKEMON_TCINS)) {
    for (const product of products) {
      const stock = result.stock.get(product.tcin);
      inventory.push({
        tcin: product.tcin,
        name: product.name,
        type: product.type,
        set: setName,
        available: stock?.available ?? false,
        quantity: stock?.quantity ?? null,
        status: stock?.status ?? 'UNKNOWN',
        price: stock?.price ?? null,
      });
    }
  }

  const inStock = inventory.filter((i) => i.available);
  return Response.json({
    store_id: result.storeId,
    checked_at: new Date().toISOString(),
    in_stock_count: inStock.length,
    total_checked: inventory.length,
    inventory,
  });
}

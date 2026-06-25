import { NextRequest } from 'next/server';
import getDb from '@/lib/db';

const CHAIN_MAP: Record<string, string> = {
  'target':          'target',
  'walmart':         'walmart',
  'best buy':        'bestbuy',
  'gamestop':        'gamestop',
  'game stop':       'gamestop',
  'walgreens':       'walgreens',
  'costco':          'costco',
  'meijer':          'walmart',
  'kroger':          'walmart',
  'cvs':             'cvs',
  "thornton's":      'thorntons',
  'thorntons':       'thorntons',
  'thornton':        'thorntons',
  'dollar general':  'dollargeneral',
  'barnes & noble':  'barnesnoble',
  'barnes and noble':'barnesnoble',
  'barnes':          'barnesnoble',
  'five below':      'fivebelow',
  'dollar tree':     'dollartree',
};

function detectChain(name: string): string {
  const lower = name.toLowerCase();
  for (const [key, val] of Object.entries(CHAIN_MAP)) {
    if (lower.includes(key)) return val;
  }
  return 'other';
}

export async function GET(req: NextRequest) {
  const lat = req.nextUrl.searchParams.get('lat');
  const lng = req.nextUrl.searchParams.get('lng');
  const radius = req.nextUrl.searchParams.get('radius') || '16000'; // meters, ~10 miles

  if (!lat || !lng) {
    return Response.json({ error: 'lat and lng required' }, { status: 400 });
  }

  // Overpass query — find retail stores by known brand names within radius
  const query = `
    [out:json][timeout:30];
    (
      node["brand"~"Target|Walmart|GameStop|Best Buy|Walgreens|CVS|Thornton|Dollar General|Barnes|Costco|Five Below|Dollar Tree",i](around:${radius},${lat},${lng});
      way["brand"~"Target|Walmart|GameStop|Best Buy|Walgreens|CVS|Thornton|Dollar General|Barnes|Costco|Five Below|Dollar Tree",i](around:${radius},${lat},${lng});
      node["name"~"Target|Walmart|GameStop|Best Buy|Walgreens|CVS|Thornton|Dollar General|Barnes|Costco|Five Below|Dollar Tree",i]["shop"](around:${radius},${lat},${lng});
      way["name"~"Target|Walmart|GameStop|Best Buy|Walgreens|CVS|Thornton|Dollar General|Barnes|Costco|Five Below|Dollar Tree",i]["shop"](around:${radius},${lat},${lng});
    );
    out center;
  `.trim();

  // Overpass requires form-encoded body (text/plain returns 406). Try Kumi
  // mirror first since the main instance rate-limits aggressively.
  const OVERPASS_MIRRORS = [
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass-api.de/api/interpreter',
  ];

  let osmResults: OsmElement[] | null = null;
  let lastError = '';
  for (const url of OVERPASS_MIRRORS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: 'data=' + encodeURIComponent(query),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'pokemonfinder/1.0',
        },
        signal: AbortSignal.timeout(35000),
      });
      if (!res.ok) { lastError = `${url} → HTTP ${res.status}`; continue; }
      const data = await res.json() as { elements: OsmElement[] };
      osmResults = data.elements;
      break;
    } catch (err) {
      lastError = `${url} → ${String(err).slice(0, 100)}`;
    }
  }
  if (osmResults === null) {
    return Response.json({ error: 'Overpass API failed', detail: lastError }, { status: 502 });
  }

  const db = getDb();
  const checkOsm = db.prepare('SELECT id FROM stores WHERE osm_id = ?');
  const checkCoords = db.prepare('SELECT id FROM stores WHERE ABS(lat - ?) < 0.001 AND ABS(lng - ?) < 0.001');
  const insert = db.prepare(`
    INSERT INTO stores (name, chain, address, lat, lng, store_type, osm_id)
    VALUES (?, ?, ?, ?, ?, 'retail', ?)
  `);

  const added: { id: number; name: string; chain: string; address: string; lat: number; lng: number }[] = [];
  const skipped: string[] = [];

  for (const el of osmResults) {
    const elLat = el.type === 'way' ? el.center?.lat : el.lat;
    const elLng = el.type === 'way' ? el.center?.lon : el.lon;
    if (!elLat || !elLng) continue;

    const name = el.tags?.name || el.tags?.brand || 'Unknown Store';
    const brand = el.tags?.brand || el.tags?.name || '';
    const chain = detectChain(brand);
    const osmId = `${el.type}/${el.id}`;

    const address = [
      el.tags?.['addr:housenumber'],
      el.tags?.['addr:street'],
      el.tags?.['addr:city'],
      el.tags?.['addr:state'],
    ].filter(Boolean).join(', ') || `${elLat.toFixed(4)}, ${elLng.toFixed(4)}`;

    // Skip if already in DB
    if (checkOsm.get(osmId)) { skipped.push(name); continue; }
    if (checkCoords.get(elLat, elLng)) { skipped.push(name); continue; }

    const result = insert.run(name, chain, address, elLat, elLng, osmId);
    added.push({ id: Number(result.lastInsertRowid), name, chain, address, lat: elLat, lng: elLng });
  }

  return Response.json({ added, skipped_count: skipped.length, total_found: osmResults.length });
}

interface OsmElement {
  type: 'node' | 'way';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

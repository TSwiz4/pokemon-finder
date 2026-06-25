// Fetches recent Pokemon restock tweets from known alert accounts
// Uses public nitter RSS feeds — no Twitter API key required.
// IMPORTANT: uses Node's `https` module instead of global fetch — undici/HTTP-2
// returns an empty body from nitter.net's Caddy server; HTTP/1.1 works fine.

import { NextRequest } from 'next/server';
import https from 'https';

// Known Pokemon TCG restock alert accounts on X
const ALERT_ACCOUNTS = [
  'PokeTCGAlerts',
  'PokeAlerts_',
  'PokemonRestocks',
  'TCGTracker',
  'PokemonDealsTCG',
  'PokemonDealsX',
];

// Nitter instances to try (in order — fall through on failure).
// Most public Nitter instances have died over the past year. nitter.net is the
// most reliable as of 2026-05; xcancel.com is a separate Twitter mirror.
const NITTER_INSTANCES = [
  'https://nitter.net',
  'https://xcancel.com',
];

// Posts older than this are dropped server-side (frontend also enforces).
const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

export interface XPost {
  id: string;
  account: string;
  text: string;
  link: string;
  date: string;
  retailer: string | null;
  products: string[];
}

// Keywords that indicate a restock post
const RESTOCK_KEYWORDS = [
  'restock', 'in stock', 'instock', 'back in stock', 'live', 'available',
  'add to cart', 'atc', 'drop', 'just dropped', 'now available',
  'pokemon center', 'target', 'walmart', 'best buy', 'gamestop', 'amazon',
  'prismatic', 'surging sparks', 'perfect order', 'ascended heroes',
  'mega evolutions', 'stellar crown', 'twilight masquerade', 'temporal forces',
  'paldean fates', 'obsidian flames', 'etb', 'booster box', 'booster bundle',
];

// Detect which retailer a tweet mentions
function detectRetailer(text: string): string | null {
  const t = text.toLowerCase();
  if (t.includes('pokemon center') || t.includes('pokemoncenter')) return 'Pokemon Center';
  if (t.includes('target.com') || t.includes(' target ')) return 'Target';
  if (t.includes('walmart')) return 'Walmart';
  if (t.includes('best buy') || t.includes('bestbuy')) return 'Best Buy';
  if (t.includes('gamestop')) return 'GameStop';
  if (t.includes('amazon')) return 'Amazon';
  if (t.includes('tcgplayer')) return 'TCGPlayer';
  if (t.includes('walgreens')) return 'Walgreens';
  return null;
}

// Detect which Pokemon products a tweet mentions
function detectProducts(text: string): string[] {
  const t = text.toLowerCase();
  const found: string[] = [];
  const checks: [string, string][] = [
    ['mega evolutions', 'Mega Evolutions'],
    ['ascended heroes', 'Ascended Heroes'],
    ['perfect order', 'Perfect Order'],
    ['space time smackdown', 'Space Time Smackdown'],
    ['destined rivals', 'Destined Rivals'],
    ['prismatic evolutions', 'Prismatic Evolutions'],
    ['surging sparks', 'Surging Sparks'],
    ['stellar crown', 'Stellar Crown'],
    ['twilight masquerade', 'Twilight Masquerade'],
    ['temporal forces', 'Temporal Forces'],
    ['paldean fates', 'Paldean Fates'],
    ['paradox rift', 'Paradox Rift'],
    ['obsidian flames', 'Obsidian Flames'],
    ['151', '151'],
    ['booster box', 'Booster Box'],
    ['booster bundle', 'Booster Bundle'],
    ['elite trainer', 'ETB'],
    [' etb', 'ETB'],
    ['blister', 'Blister Pack'],
    ['collection box', 'Collection Box'],
    ['tin', 'Tin'],
  ];
  for (const [kw, label] of checks) {
    if (t.includes(kw) && !found.includes(label)) found.push(label);
  }
  return found;
}

function isRestockRelated(text: string): boolean {
  const t = text.toLowerCase();
  return RESTOCK_KEYWORDS.some(kw => t.includes(kw));
}

// HTTP/1.1 GET via Node's https module. Returns body as string.
// Necessary because global fetch (undici) gets 0-byte responses from nitter.net.
function httpsGet(urlStr: string, timeoutMs = 8000): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, text/xml, */*',
      },
    }, res => {
      // Follow one redirect if any (Nitter sometimes 302s)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        httpsGet(new URL(res.headers.location, urlStr).toString(), timeoutMs).then(resolve, reject);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

async function fetchNitterRSS(account: string, instance: string): Promise<XPost[]> {
  const url = `${instance}/${account}/rss`;
  const { status, body: xml } = await httpsGet(url, 8000);
  if (status < 200 || status >= 300 || xml.length === 0) {
    throw new Error(`status=${status} size=${xml.length}`);
  }

  const posts: XPost[] = [];
  // Parse RSS items via regex (no XML lib needed for simple RSS)
  const items = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const match of items) {
    const item = match[1];
    const title = (item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || item.match(/<title>([\s\S]*?)<\/title>/))?.[1]?.trim() ?? '';
    const link  = (item.match(/<link>([\s\S]*?)<\/link>/) )?.[1]?.trim() ?? '';
    const pubDate = (item.match(/<pubDate>([\s\S]*?)<\/pubDate>/))?.[1]?.trim() ?? '';
    const desc = (item.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) || [])?.[1] ?? title;

    // Strip HTML tags from description
    const text = (title + ' ' + desc.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

    if (!isRestockRelated(text)) continue;

    // Build a stable ID from link
    const id = link.split('/').pop() ?? Math.random().toString(36).slice(2);
    const xLink = link.replace(instance, 'https://x.com');

    posts.push({
      id: `${account}_${id}`,
      account,
      text: title,
      link: xLink,
      date: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      retailer: detectRetailer(text),
      products: detectProducts(text),
    });
  }
  return posts;
}

export async function GET(req: NextRequest) {
  const accounts = req.nextUrl.searchParams.get('accounts')?.split(',') ?? ALERT_ACCOUNTS;

  const allPosts: XPost[] = [];
  const errors: string[] = [];

  // Try each account, falling through nitter instances on failure
  await Promise.allSettled(
    accounts.map(async (account) => {
      for (const instance of NITTER_INSTANCES) {
        try {
          const posts = await fetchNitterRSS(account, instance);
          allPosts.push(...posts);
          return; // success — move to next account
        } catch {
          // try next instance
        }
      }
      errors.push(account); // all instances failed for this account
    })
  );

  // Deduplicate, drop posts older than 4 hours, sort newest first, limit 60
  const cutoff = Date.now() - FOUR_HOURS_MS;
  const seen = new Set<string>();
  const deduped = allPosts
    .filter(p => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
    .filter(p => new Date(p.date).getTime() >= cutoff)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 60);

  return Response.json({ posts: deduped, failed_accounts: errors, window_hours: 4 });
}

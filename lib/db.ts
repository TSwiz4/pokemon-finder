import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { hashPassword } from './crypto';

const DB_PATH = path.join(process.cwd(), 'data', 'pokemon-finder.db');

const dataDir = path.join(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    initSchema(db);
    migrate(db);
  }
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      chain TEXT NOT NULL,
      address TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      store_type TEXT DEFAULT 'retail',
      osm_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS restocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id),
      reporter TEXT DEFAULT 'Anonymous',
      products TEXT NOT NULL,
      shipment_details TEXT,
      restock_date TEXT NOT NULL,
      quantity_desc TEXT,
      source TEXT DEFAULT 'community',
      restock_type TEXT DEFAULT 'instore',
      verified INTEGER DEFAULT 0,
      upvotes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS upvotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      restock_id INTEGER NOT NULL REFERENCES restocks(id),
      ip TEXT NOT NULL,
      UNIQUE(restock_id, ip)
    );

    CREATE TABLE IF NOT EXISTS store_patterns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id),
      reporter TEXT DEFAULT 'Anonymous',
      truck_days TEXT,
      stock_time TEXT,
      employee_friendly INTEGER DEFAULT 0,
      notes TEXT,
      confidence INTEGER DEFAULT 1,
      upvotes INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      set_name TEXT NOT NULL,
      product_type TEXT NOT NULL,
      UNIQUE(set_name, product_type)
    );

    CREATE TABLE IF NOT EXISTS chain_skus (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id),
      chain TEXT NOT NULL,
      sku TEXT NOT NULL,
      confirmed INTEGER NOT NULL DEFAULT 1,
      UNIQUE(product_id, chain)
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      store_id INTEGER NOT NULL REFERENCES stores(id),
      product_id INTEGER NOT NULL REFERENCES products(id),
      quantity INTEGER NOT NULL DEFAULT 0,
      last_checked_at TEXT NOT NULL DEFAULT (datetime('now')),
      source TEXT NOT NULL DEFAULT 'manual',
      UNIQUE(store_id, product_id)
    );

    CREATE INDEX IF NOT EXISTS idx_inventory_store ON inventory(store_id);
    CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product_id);

    -- Auth: users, sessions, activity log --
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'friend',   -- 'admin' | 'friend'
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      username TEXT,
      action TEXT NOT NULL,
      detail TEXT,
      ip TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_activity_user ON activity_log(user_id);

    -- Sniper (admin-only): watchlist + event log --
    CREATE TABLE IF NOT EXISTS sniper_watchlist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      retailer TEXT NOT NULL,                 -- 'walmart' | 'target' | 'bestbuy'
      item_id TEXT NOT NULL,                  -- Walmart item id / Target TCIN
      label TEXT NOT NULL,
      max_qty INTEGER NOT NULL DEFAULT 99,
      active INTEGER NOT NULL DEFAULT 1,
      last_status TEXT,                       -- IN_STOCK | OUT_OF_STOCK | UNKNOWN | CHECK_FAILED
      last_checked_at TEXT,
      last_in_stock_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(retailer, item_id)
    );

    CREATE TABLE IF NOT EXISTS sniper_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      watch_id INTEGER REFERENCES sniper_watchlist(id),
      status TEXT NOT NULL,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_sniper_events_watch ON sniper_events(watch_id);
  `);
}

// Safe migrations for existing DBs missing new columns
function migrate(db: Database.Database) {
  const storesCols = (db.prepare("PRAGMA table_info(stores)").all() as { name: string }[]).map(c => c.name);
  if (!storesCols.includes('store_type')) db.exec("ALTER TABLE stores ADD COLUMN store_type TEXT DEFAULT 'retail'");
  if (!storesCols.includes('osm_id'))    db.exec("ALTER TABLE stores ADD COLUMN osm_id TEXT");

  const restocksCols = (db.prepare("PRAGMA table_info(restocks)").all() as { name: string }[]).map(c => c.name);
  if (!restocksCols.includes('restock_type')) db.exec("ALTER TABLE restocks ADD COLUMN restock_type TEXT DEFAULT 'instore'");

  const skuCols = (db.prepare("PRAGMA table_info(chain_skus)").all() as { name: string }[]).map(c => c.name);
  if (skuCols.length && !skuCols.includes('confirmed')) {
    db.exec("ALTER TABLE chain_skus ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 1");
  }

  // Retail-store seeding is disabled — original seed addresses were unreliable.
  // Real stores are now sourced from OSM via the MAP tab's auto-discover, which
  // writes osm_id on every row. Keeping seedRetailStores() defined for reference.
  void seedRetailStores; // silence unused warning

  // Seed online retailers if not yet added
  const onlineCount = db.prepare("SELECT COUNT(*) as c FROM stores WHERE store_type='online'").get() as { c: number };
  if (onlineCount.c === 0) seedOnlineStores(db);

  // Seed products + known Target SKUs (idempotent — re-runs on every boot to pick up catalog changes)
  seedProducts(db);

  // Seed the first admin if no admin exists yet (creds from env, else admin/admin)
  seedAdmin(db);

  // Seed the sniper watchlist with the known Walmart drop items (once)
  seedSniper(db);
}

function seedSniper(db: Database.Database) {
  const { c } = db.prepare('SELECT COUNT(*) AS c FROM sniper_watchlist').get() as { c: number };
  if (c > 0) return;
  const insert = db.prepare(
    'INSERT OR IGNORE INTO sniper_watchlist (retailer, item_id, label, max_qty) VALUES (?, ?, ?, ?)'
  );
  const items: [string, string, string, number][] = [
    ['walmart', '19999900284', 'Pokemon Mega Moonlit Tin',                 99],
    ['walmart', '19986002628', 'Mega Evolution Chaos Rising Bundle',        99],
    ['walmart', '19994265476', 'Lumiose City Mini Tin Display (10 tins)',   99],
    ['walmart', '19965460207', 'SV10 Destined Rivals Elite Trainer Box',    99],
  ];
  for (const it of items) insert.run(...it);
}

function seedAdmin(db: Database.Database) {
  const { c } = db.prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get() as { c: number };
  if (c > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'admin';
  db.prepare("INSERT INTO users (username, password_hash, role, active) VALUES (?, ?, 'admin', 1)")
    .run(username, hashPassword(password));
  console.warn(`[auth] Seeded admin user '${username}'. CHANGE THE PASSWORD in the Admin panel after first login.`);
}

function seedRetailStores(db: Database.Database) {
  const insert = db.prepare(`INSERT INTO stores (name, chain, address, lat, lng, store_type) VALUES (?, ?, ?, ?, ?, 'retail')`);
  const stores: [string, string, string, number, number][] = [
    ['Target - Oldsmar',        'target',   '3461 Tampa Rd, Oldsmar, FL',               28.0534, -82.6817],
    ['Walmart - Oldsmar',       'walmart',  '3854 Tampa Rd, Oldsmar, FL',               28.0561, -82.6756],
    ['Walgreens - Oldsmar',     'walgreens','3595 Tampa Rd, Oldsmar, FL',               28.0548, -82.6789],
    ['GameStop - Oldsmar',      'gamestop', '3461 Tampa Rd Ste 500, Oldsmar, FL',       28.0531, -82.6820],
    ['Target - Safety Harbor',  'target',   '2945 Philippe Pkwy, Safety Harbor, FL',    27.9878, -82.6923],
    ['Walmart - Safety Harbor', 'walmart',  '2701 McMullen Booth Rd, Clearwater, FL',   27.9944, -82.7198],
    ['Best Buy - Clearwater',   'bestbuy',  '2525 Gulf to Bay Blvd, Clearwater, FL',    27.9658, -82.7468],
    ['GameStop - Clearwater',   'gamestop', '2535 Gulf to Bay Blvd, Clearwater, FL',    27.9660, -82.7471],
    ['Target - Dunedin',        'target',   '1700 Causeway Blvd, Dunedin, FL',          28.0211, -82.7609],
    ['Walgreens - Palm Harbor', 'walgreens','35101 US-19 N, Palm Harbor, FL',           28.0822, -82.7283],
    ['Target - Palm Harbor',    'target',   '34953 US-19 N, Palm Harbor, FL',           28.0804, -82.7280],
    ['Walmart - Tarpon Springs','walmart',  '40370 US-19 N, Tarpon Springs, FL',        28.1456, -82.7568],
  ];
  for (const row of stores) insert.run(...row);
}

function seedOnlineStores(db: Database.Database) {
  const insert = db.prepare(`INSERT INTO stores (name, chain, address, lat, lng, store_type) VALUES (?, ?, ?, 0, 0, 'online')`);
  const online: [string, string, string][] = [
    ['Pokemon Center',     'pokemoncenter', 'pokemoncenter.com'],
    ['Target Online',      'target',        'target.com'],
    ['Walmart Online',     'walmart',       'walmart.com'],
    ['Best Buy Online',    'bestbuy',       'bestbuy.com'],
    ['GameStop Online',    'gamestop',      'gamestop.com'],
    ['Walgreens Online',   'walgreens',     'walgreens.com'],
    ['Amazon',             'amazon',        'amazon.com'],
    ['TCGPlayer',          'tcgplayer',     'tcgplayer.com'],
    ['eBay',               'ebay',          'ebay.com'],
    ['Costco Online',      'costco',        'costco.com'],
    ["Sam's Club Online",  'samsclub',      'samsclub.com'],
    ['Five Below Online',  'fivebelow',     'fivebelow.com'],
  ];
  for (const row of online) insert.run(...row);
}

// Pokemon SKU catalog. Target TCINs are real (sourced from target.com URLs).
// Best Buy / Walmart / GameStop SKUs are populated manually by users via the +Report Stock UI.
//
// To add a new product or set, append a row to PRODUCT_CATALOG. Existing rows are not modified.
const PRODUCT_CATALOG: { set_slug: string; set_display: string; product_type: string }[] = [
  // Ascended Heroes
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'ETB' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Booster Bundle' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Booster Box' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Premium Poster Collection' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Poster - Lucario' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Poster - Gardevoir' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: '3-Pack Blister' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Tech Sticker - Gastly' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Tech Sticker - Charmander' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Deluxe Pin Collection' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'ex Box' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Blister' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: '2-Pack Blister' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Mini Tin' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Mega Zard Tin' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Knockout Collection' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Pokemon Day Collection Box' },
  { set_slug: 'ascended_heroes',   set_display: 'Ascended Heroes',           product_type: 'Single Pack' },

  // Phantasmal Flames
  { set_slug: 'phantasmal_flames', set_display: 'Phantasmal Flames',         product_type: 'ETB' },
  { set_slug: 'phantasmal_flames', set_display: 'Phantasmal Flames',         product_type: 'Booster Bundle' },
  { set_slug: 'phantasmal_flames', set_display: 'Phantasmal Flames',         product_type: 'Booster Box' },
  { set_slug: 'phantasmal_flames', set_display: 'Phantasmal Flames',         product_type: 'Blister' },
  { set_slug: 'phantasmal_flames', set_display: 'Phantasmal Flames',         product_type: '3-Pack Blister - Sneasel' },
  { set_slug: 'phantasmal_flames', set_display: 'Phantasmal Flames',         product_type: '3-Pack Blister - Weavile' },
  { set_slug: 'phantasmal_flames', set_display: 'Phantasmal Flames',         product_type: 'Mega Charizard UPC' },
  { set_slug: 'phantasmal_flames', set_display: 'Phantasmal Flames',         product_type: 'Single Pack' },

  // Prismatic Evolutions
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: 'ETB' },
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: 'Booster Bundle' },
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: 'Booster Box' },
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: 'Surprise Box' },
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: 'Super Premium Collection' },
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: 'Poster Collection' },
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: 'Binder Collection' },
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: 'Tech Sticker Collection' },
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: 'Accessory Pouch Special Collection' },
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: 'Blister' },
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: '2-Pack Blister' },
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: 'Mini Tin' },
  { set_slug: 'prismatic',         set_display: 'Prismatic Evolutions',      product_type: 'Single Pack' },

  // Destined Rivals
  { set_slug: 'destined_rivals',   set_display: 'Destined Rivals',           product_type: 'ETB' },
  { set_slug: 'destined_rivals',   set_display: 'Destined Rivals',           product_type: 'Booster Bundle' },
  { set_slug: 'destined_rivals',   set_display: 'Destined Rivals',           product_type: 'Booster Box' },
  { set_slug: 'destined_rivals',   set_display: 'Destined Rivals',           product_type: 'Sleeved Booster' },
  { set_slug: 'destined_rivals',   set_display: 'Destined Rivals',           product_type: 'Single Pack Blister' },
  { set_slug: 'destined_rivals',   set_display: 'Destined Rivals',           product_type: '3-Pack Blister' },
  { set_slug: 'destined_rivals',   set_display: 'Destined Rivals',           product_type: 'Checklane Blister - Eevee' },

  // First Partner Collection
  { set_slug: 'first_partner',     set_display: 'First Partner Collection',  product_type: 'Illustration Collection Series 1' },
  { set_slug: 'first_partner',     set_display: 'First Partner Collection',  product_type: 'Illustration Collection Series 2' },
  { set_slug: 'first_partner',     set_display: 'First Partner Collection',  product_type: 'Deluxe Pin Collection' },

  // Chaos Rising
  { set_slug: 'chaos_rising',      set_display: 'Chaos Rising',              product_type: 'ETB' },
  { set_slug: 'chaos_rising',      set_display: 'Chaos Rising',              product_type: 'Booster Bundle' },
  { set_slug: 'chaos_rising',      set_display: 'Chaos Rising',              product_type: 'Booster Box' },
];

// (set_slug, product_type, chain) -> sku. Only entries with real, verified SKUs.
// confirmed=false means SKU is a placeholder (e.g., 'TBD') — UI/polling logic should skip until updated.
const KNOWN_SKUS: { set: string; type: string; chain: string; sku: string; confirmed?: boolean }[] = [
  // Target TCINs (8-digit, from existing target.com URLs)
  { set: 'ascended_heroes', type: 'ETB',                              chain: 'target',  sku: '95082118' },
  { set: 'ascended_heroes', type: 'Booster Bundle',                   chain: 'target',  sku: '95120834' },
  { set: 'prismatic',       type: 'ETB',                              chain: 'target',  sku: '93954435' },
  { set: 'prismatic',       type: 'Booster Bundle',                   chain: 'target',  sku: '93954446' },

  // Best Buy SKUs (7-digit, except newer 8-digit Checklane)
  { set: 'ascended_heroes', type: 'ETB',                              chain: 'bestbuy', sku: '6665449' },
  { set: 'ascended_heroes', type: 'Booster Bundle',                   chain: 'bestbuy', sku: '6665401' },
  { set: 'ascended_heroes', type: '2-Pack Blister',                   chain: 'bestbuy', sku: '6665402' },
  { set: 'ascended_heroes', type: 'Premium Poster Collection',        chain: 'bestbuy', sku: '6665394' },
  { set: 'ascended_heroes', type: '3-Pack Blister',                   chain: 'bestbuy', sku: '6665395' },
  { set: 'ascended_heroes', type: 'Mini Tin',                         chain: 'bestbuy', sku: '6665448' },
  { set: 'ascended_heroes', type: 'ex Box',                           chain: 'bestbuy', sku: '6667282' },
  { set: 'prismatic',       type: 'ETB',                              chain: 'bestbuy', sku: '6606082' },
  { set: 'first_partner',   type: 'Illustration Collection Series 1', chain: 'bestbuy', sku: '6668620' },
  { set: 'first_partner',   type: 'Deluxe Pin Collection',            chain: 'bestbuy', sku: '6667284' },

  // Target TCINs — Ascended Heroes
  { set: 'ascended_heroes', type: 'Tech Sticker - Gastly',            chain: 'target',  sku: '95120822' },
  { set: 'ascended_heroes', type: 'Tech Sticker - Charmander',        chain: 'target',  sku: '1007935778' },
  { set: 'ascended_heroes', type: 'Deluxe Pin Collection',            chain: 'target',  sku: '95093989' },
  { set: 'ascended_heroes', type: 'Mini Tin',                         chain: 'target',  sku: '95022094' },
  { set: 'ascended_heroes', type: 'Poster - Lucario',                 chain: 'target',  sku: '95093981' },
  { set: 'ascended_heroes', type: 'Poster - Gardevoir',               chain: 'target',  sku: '95093982' },
  { set: 'ascended_heroes', type: 'Mega Zard Tin',                    chain: 'target',  sku: '95138464' },
  { set: 'ascended_heroes', type: 'Pokemon Day Collection Box',       chain: 'target',  sku: '95082138' },
  { set: 'first_partner',   type: 'Illustration Collection Series 1', chain: 'target',  sku: '95225595' },

  // Target TCINs — Phantasmal Flames
  { set: 'phantasmal_flames', type: 'ETB',                            chain: 'target',  sku: '94860231' },
  { set: 'phantasmal_flames', type: 'Booster Bundle',                 chain: 'target',  sku: '948844963' },
  { set: 'phantasmal_flames', type: '3-Pack Blister - Sneasel',       chain: 'target',  sku: '94884511' },
  { set: 'phantasmal_flames', type: '3-Pack Blister - Weavile',       chain: 'target',  sku: '94884505' },
  { set: 'phantasmal_flames', type: 'Mega Charizard UPC',             chain: 'target',  sku: '94681790' },

  // Dollar General — UPC-format SKUs
  { set: 'prismatic',         type: 'Tech Sticker Collection',        chain: 'dollargeneral', sku: '196214112483' },
  { set: 'ascended_heroes',   type: 'Mini Tin',                       chain: 'dollargeneral', sku: '196214141308' },

  // Walmart — UPC-format SKUs
  { set: 'prismatic',         type: 'Mini Tin',                       chain: 'walmart', sku: '196214119864' },
  { set: 'ascended_heroes',   type: 'Premium Poster Collection',      chain: 'walmart', sku: '196214112537' },

  // CVS — Ascended Heroes
  { set: 'ascended_heroes',   type: '2-Pack Blister',                 chain: 'cvs', sku: '667607' },
  { set: 'ascended_heroes',   type: 'Knockout Collection',            chain: 'cvs', sku: '619797' },
  { set: 'ascended_heroes',   type: 'Mini Tin',                       chain: 'cvs', sku: '662589' },

  // Destined Rivals — Best Buy
  { set: 'destined_rivals', type: 'ETB',                              chain: 'bestbuy', sku: '6624825' },
  { set: 'destined_rivals', type: 'Booster Box',                      chain: 'bestbuy', sku: '6624826' },
  { set: 'destined_rivals', type: 'Booster Bundle',                   chain: 'bestbuy', sku: '6624828' },
  { set: 'destined_rivals', type: 'Sleeved Booster',                  chain: 'bestbuy', sku: '6624827' },
  { set: 'destined_rivals', type: '3-Pack Blister',                   chain: 'bestbuy', sku: '6624830' },
  { set: 'destined_rivals', type: 'Checklane Blister - Eevee',        chain: 'bestbuy', sku: '10982157' },

  // Prismatic Evolutions — Best Buy (ETB 6606082 already seeded above)
  { set: 'prismatic',       type: 'Booster Bundle',                   chain: 'bestbuy', sku: '6608206' },
  { set: 'prismatic',       type: 'Surprise Box',                     chain: 'bestbuy', sku: '6607717' },
  { set: 'prismatic',       type: 'Poster Collection',                chain: 'bestbuy', sku: '6606080' },
  { set: 'prismatic',       type: 'Binder Collection',                chain: 'bestbuy', sku: '6606079' },
  { set: 'prismatic',       type: 'Tech Sticker Collection',          chain: 'bestbuy', sku: '6606078' },
  { set: 'prismatic',       type: 'Accessory Pouch Special Collection', chain: 'bestbuy', sku: '6609202' },
  { set: 'prismatic',       type: 'Mini Tin',                         chain: 'bestbuy', sku: '6607719' },
  { set: 'prismatic',       type: '2-Pack Blister',                   chain: 'bestbuy', sku: '6607716' },
  { set: 'prismatic',       type: 'Super Premium Collection',         chain: 'bestbuy', sku: '6621081' },

  // Chaos Rising — Target TCINs (verified live via RedSky)
  { set: 'chaos_rising',    type: 'ETB',                              chain: 'target',  sku: '95267143' },
  { set: 'chaos_rising',    type: 'Booster Bundle',                   chain: 'target',  sku: '95298172' },

  // First Partner Collection — Target TCIN (verified live via RedSky)
  { set: 'first_partner',   type: 'Illustration Collection Series 2', chain: 'target',  sku: '1011209279' },
];

function seedProducts(db: Database.Database) {
  const insertProduct = db.prepare(
    `INSERT OR IGNORE INTO products (name, set_name, product_type) VALUES (?, ?, ?)`
  );
  const insertSku = db.prepare(
    `INSERT OR IGNORE INTO chain_skus (product_id, chain, sku, confirmed) VALUES (?, ?, ?, ?)`
  );
  const findProduct = db.prepare(
    `SELECT id FROM products WHERE set_name = ? AND product_type = ?`
  );

  for (const p of PRODUCT_CATALOG) {
    insertProduct.run(`${p.set_display} ${p.product_type}`, p.set_slug, p.product_type);
  }

  for (const { set, type, chain, sku, confirmed } of KNOWN_SKUS) {
    const row = findProduct.get(set, type) as { id: number } | undefined;
    if (row) insertSku.run(row.id, chain, sku, confirmed === false ? 0 : 1);
  }
}

export default getDb;

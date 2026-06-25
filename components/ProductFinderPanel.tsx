'use client';

import { useState } from 'react';
import type { Store } from '@/app/page';

const SETS: { slug: string; label: string }[] = [
  { slug: 'all',               label: 'All sets' },
  { slug: 'ascended_heroes',   label: 'Ascended Heroes' },
  { slug: 'phantasmal_flames', label: 'Phantasmal Flames' },
  { slug: 'prismatic',         label: 'Prismatic Evolutions' },
  { slug: 'destined_rivals',   label: 'Destined Rivals' },
  { slug: 'chaos_rising',      label: 'Chaos Rising' },
  { slug: 'first_partner',     label: 'First Partner' },
];

const CHAINS: { slug: string; label: string; emoji: string; live: boolean }[] = [
  { slug: 'target',  label: 'Target',   emoji: '🎯', live: true },
  { slug: 'walmart', label: 'Walmart',  emoji: '🛒', live: false },
  { slug: 'bestbuy', label: 'Best Buy', emoji: '💻', live: false },
];

const RADIUS_OPTIONS = [5, 10, 25, 50];
const SCAN_LIMIT = 6;
const DEFAULT_CENTER = { lat: 28.0534, lng: -82.6817 }; // Oldsmar, FL

const CHAIN_EMOJI: Record<string, string> = {
  target: '🎯', walmart: '🛒', bestbuy: '💻', gamestop: '🎮',
  walgreens: '💊', cvs: '💊', costco: '📦', fivebelow: '5️⃣',
  dollargeneral: '💲', barnesnoble: '📚',
};

interface FinderProduct {
  product_id: number; name: string; set_name: string; type: string;
  quantity: number; last_checked_at: string;
}
interface FinderStore {
  id: number; name: string; chain: string; address: string; lat: number; lng: number;
  distance_mi: number; products: FinderProduct[]; in_stock_count: number;
  scanned: boolean; last_checked_at: string | null;
}

interface Props {
  allStores: Store[];
  onFlyToStore: (store: Store) => void;
  onSearchAreaChange: (area: { lat: number; lng: number; radius: number } | null) => void;
  onStoresUpdated: () => Promise<void> | void;
}

export default function ProductFinderPanel({ allStores, onFlyToStore, onSearchAreaChange, onStoresUpdated }: Props) {
  const [setFilter, setSetFilter] = useState('all');
  const [radius, setRadius] = useState(10);
  const [chains, setChains] = useState<Record<string, boolean>>({ target: true, walmart: false, bestbuy: false });
  const [inStockOnly, setInStockOnly] = useState(true);
  const [view, setView] = useState<'store' | 'product'>('store');
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [stores, setStores] = useState<FinderStore[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [locating, setLocating] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const activeChains = (c = chains) => Object.keys(c).filter((k) => c[k]);

  const loadFinder = async (lat: number, lng: number, r: number, set: string, ch: Record<string, boolean>, only: boolean) => {
    setLoading(true);
    setError('');
    try {
      const p = new URLSearchParams({ lat: String(lat), lng: String(lng), radius: String(r) });
      if (set !== 'all') p.set('set', set);
      const sel = activeChains(ch);
      if (sel.length) p.set('chains', sel.join(','));
      if (only) p.set('in_stock_only', '1');
      const res = await fetch(`/api/inventory/finder?${p}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setStores(data.stores ?? []);
    } catch (e) {
      setError(String(e).replace('Error: ', ''));
      setStores([]);
    }
    setLoading(false);
  };

  const useCenter = async (lat: number, lng: number) => {
    setCenter({ lat, lng });
    onSearchAreaChange({ lat, lng, radius });
    // ensure stores exist nearby, then read what we have
    try {
      const meters = Math.round(Math.max(radius, 25) * 1609.34);
      await fetch(`/api/stores/discover?lat=${lat}&lng=${lng}&radius=${meters}`);
      await onStoresUpdated();
    } catch { /* discovery is best-effort */ }
    loadFinder(lat, lng, radius, setFilter, chains, inStockOnly);
  };

  // Live scan the nearest N stores, then re-read the finder.
  const scanAndFind = async () => {
    if (!center) return;
    const live = activeChains().filter((c) => CHAINS.find((x) => x.slug === c)?.live);
    if (!live.length) { setStatus('Pick Target — it’s the only live-readable chain today.'); setTimeout(() => setStatus(''), 5000); return; }
    setScanning(true);
    setStatus(`Scanning nearest ${SCAN_LIMIT} store(s)…`);
    try {
      const res = await fetch('/api/inventory/scan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: center.lat, lng: center.lng, radius, chains: activeChains(), limit: SCAN_LIMIT, set: setFilter }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const failed = (data.stores ?? []).filter((s: { status: string }) => s.status === 'CHECK_FAILED').length;
      setStatus(`Scanned ${data.scanned_stores} · ${data.in_stock_stores} with stock${failed ? ` · ${failed} blocked (retry later)` : ''}`);
      await loadFinder(center.lat, center.lng, radius, setFilter, chains, inStockOnly);
    } catch (e) {
      setStatus(`Scan failed: ${String(e).replace('Error: ', '').slice(0, 60)}`);
    }
    setScanning(false);
    setTimeout(() => setStatus(''), 8000);
  };

  const handleLocate = () => {
    if (!navigator.geolocation) { useCenter(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng); return; }
    setLocating(true); setError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocating(false); useCenter(pos.coords.latitude, pos.coords.longitude); },
      () => { setLocating(false); setError('Location blocked — showing Oldsmar, FL.'); useCenter(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng); },
      { timeout: 10000, enableHighAccuracy: false, maximumAge: 60000 },
    );
  };

  const reload = (over: Partial<{ r: number; set: string; ch: Record<string, boolean>; only: boolean }> = {}) => {
    if (!center) return;
    loadFinder(center.lat, center.lng, over.r ?? radius, over.set ?? setFilter, over.ch ?? chains, over.only ?? inStockOnly);
  };

  const toggleChain = (slug: string) => {
    const next = { ...chains, [slug]: !chains[slug] };
    if (activeChains(next).length === 0) return;
    setChains(next); reload({ ch: next });
  };

  const flyTo = (s: FinderStore) => {
    const store = allStores.find((x) => x.id === s.id);
    if (store) onFlyToStore(store);
  };

  const toggleExpand = (id: number) => {
    const next = new Set(expanded);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpanded(next);
  };

  // By-product aggregation
  const productAgg = (() => {
    const m = new Map<number, { name: string; set_name: string; type: string; stores: { store: FinderStore; qty: number }[] }>();
    for (const s of stores) for (const p of s.products) {
      if (inStockOnly && p.quantity <= 0) continue;
      if (!m.has(p.product_id)) m.set(p.product_id, { name: p.name, set_name: p.set_name, type: p.type, stores: [] });
      m.get(p.product_id)!.stores.push({ store: s, qty: p.quantity });
    }
    return [...m.values()].sort((a, b) => b.stores.length - a.stores.length);
  })();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Controls */}
      <div style={{ padding: '12px 12px 10px', borderBottom: '1px solid #2e3347', flexShrink: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 800, color: '#e8eaf0', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
          🔎 Product Finder
        </div>

        {/* Chains + Set */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
          {CHAINS.map((c) => {
            const on = chains[c.slug];
            return (
              <button key={c.slug} onClick={() => toggleChain(c.slug)} title={c.live ? 'Live stock' : 'Needs home-PC worker'} style={{
                padding: '4px 9px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                background: on ? '#e63946' : '#242736', color: on ? '#fff' : '#8b91a8',
                display: 'flex', alignItems: 'center', gap: 4,
              }}>
                {c.emoji} {c.label}{!c.live && <span style={{ fontSize: 8 }}>🔒</span>}
              </button>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <select value={setFilter} onChange={(e) => { setSetFilter(e.target.value); reload({ set: e.target.value }); }} style={{
            flex: 1, background: '#242736', color: '#e8eaf0', border: '1px solid #2e3347', borderRadius: 6, padding: '5px 8px', fontSize: 11,
          }}>
            {SETS.map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
          </select>
          <select value={radius} onChange={(e) => { const r = Number(e.target.value); setRadius(r); onSearchAreaChange(center ? { ...center, radius: r } : null); reload({ r }); }} style={{
            background: '#242736', color: '#e8eaf0', border: '1px solid #2e3347', borderRadius: 6, padding: '5px 8px', fontSize: 11,
          }}>
            {RADIUS_OPTIONS.map((r) => <option key={r} value={r}>{r} mi</option>)}
          </select>
        </div>

        {/* In-stock toggle + view switch */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' }}>
          <button onClick={() => { const v = !inStockOnly; setInStockOnly(v); reload({ only: v }); }} style={{
            flex: 1, padding: '5px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
            background: inStockOnly ? '#1f8a4c' : '#242736', color: inStockOnly ? '#fff' : '#8b91a8',
          }}>
            {inStockOnly ? '✓ In stock only' : 'Show all stores'}
          </button>
          <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #2e3347' }}>
            {(['store', 'product'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '5px 10px', border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                background: view === v ? '#3b4252' : '#242736', color: view === v ? '#fff' : '#8b91a8',
              }}>
                {v === 'store' ? 'By store' : 'By product'}
              </button>
            ))}
          </div>
        </div>

        {/* Location / scan */}
        {!center ? (
          <button onClick={handleLocate} disabled={locating} style={{
            width: '100%', padding: '8px', background: locating ? '#4a4f6a' : '#e63946', border: 'none', borderRadius: 7,
            color: '#fff', fontSize: 12, fontWeight: 800, cursor: locating ? 'default' : 'pointer',
          }}>
            {locating ? '⏳ Locating…' : '📍 Use my location'}
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={scanAndFind} disabled={scanning} style={{
              flex: 1, padding: '8px', background: scanning ? '#4a4f6a' : '#1f8a4c', border: 'none', borderRadius: 7,
              color: '#fff', fontSize: 12, fontWeight: 800, cursor: scanning ? 'default' : 'pointer',
            }}>
              {scanning ? '⏳ Scanning…' : `⚡ Scan & find (nearest ${SCAN_LIMIT})`}
            </button>
            <button onClick={handleLocate} title="Re-locate" style={{
              background: '#242736', border: '1px solid #2e3347', color: '#8b91a8', borderRadius: 7, padding: '0 10px', fontSize: 13, cursor: 'pointer',
            }}>↻</button>
          </div>
        )}

        {status && <div style={{ marginTop: 6, fontSize: 10, color: status.startsWith('Scan failed') ? '#f39c12' : '#2ecc71' }}>{status}</div>}
        {error && <div style={{ marginTop: 6, fontSize: 10, color: '#f39c12' }}>⚠ {error}</div>}
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!center ? (
          <Empty title="Find Pokémon stock near you" sub="Pick your location, then Scan & find to pull live quantities into the map." />
        ) : loading ? (
          <Empty title="Loading…" />
        ) : view === 'store' ? (
          stores.length === 0 ? (
            <Empty title={inStockOnly ? 'No stores with stock in range' : 'No stores in range'}
              sub={inStockOnly ? 'Try “Scan & find”, widen the radius, or turn off “In stock only”.' : 'Widen the radius or re-locate.'} />
          ) : stores.map((s) => (
            <StoreCard key={s.id} store={s} expanded={expanded.has(s.id)} inStockOnly={inStockOnly}
              onToggle={() => toggleExpand(s.id)} onFly={() => flyTo(s)} />
          ))
        ) : (
          productAgg.length === 0 ? (
            <Empty title="No products found yet" sub="Run “Scan & find” to populate live stock." />
          ) : productAgg.map((p, i) => (
            <ProductCard key={i} agg={p} onFly={flyTo} />
          ))
        )}
      </div>
    </div>
  );
}

function Empty({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ padding: 36, textAlign: 'center', color: '#8b91a8' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#c8d0e8' }}>{title}</div>
      {sub && <div style={{ fontSize: 11, marginTop: 6, color: '#6b7280', lineHeight: 1.5 }}>{sub}</div>}
    </div>
  );
}

function freshness(iso: string | null): string {
  if (!iso) return 'not scanned';
  const mins = Math.round((Date.now() - new Date(iso + 'Z').getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

function StoreCard({ store, expanded, inStockOnly, onToggle, onFly }: {
  store: FinderStore; expanded: boolean; inStockOnly: boolean; onToggle: () => void; onFly: () => void;
}) {
  const emoji = CHAIN_EMOJI[store.chain] ?? '🏪';
  const shown = inStockOnly ? store.products.filter((p) => p.quantity > 0) : store.products;
  const hasData = store.scanned;
  return (
    <div style={{ borderBottom: '1px solid #2e3347' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', gap: 8 }}>
        <button onClick={onFly} title="Show on map" style={{ background: 'none', border: 'none', cursor: 'pointer', flex: 1, textAlign: 'left', minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: '#e8eaf0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {emoji} {store.name}
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>
            {store.distance_mi.toFixed(1)} mi · {hasData ? freshness(store.last_checked_at) : 'not scanned'}
          </div>
        </button>
        <div style={{
          fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 20,
          background: store.in_stock_count > 0 ? 'rgba(46,204,113,0.15)' : '#242736',
          color: store.in_stock_count > 0 ? '#2ecc71' : '#6b7280',
        }}>
          {store.in_stock_count > 0 ? `${store.in_stock_count} in stock` : (hasData ? 'none' : '—')}
        </div>
        {shown.length > 0 && (
          <button onClick={onToggle} style={{ background: 'none', border: 'none', color: '#8b91a8', cursor: 'pointer', fontSize: 12, padding: 2 }}>
            {expanded ? '▾' : '▸'}
          </button>
        )}
      </div>
      {expanded && shown.length > 0 && (
        <div style={{ padding: '0 12px 10px 30px' }}>
          {shown.map((p) => (
            <div key={p.product_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', fontSize: 11 }}>
              <span style={{ color: '#c8d0e8', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.type}</span>
              <span style={{ color: p.quantity > 0 ? '#2ecc71' : '#6b7280', fontWeight: 700, marginLeft: 8, flexShrink: 0 }}>
                {p.quantity > 0 ? `${p.quantity}×` : 'out'}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ProductCard({ agg, onFly }: {
  agg: { name: string; set_name: string; type: string; stores: { store: FinderStore; qty: number }[] };
  onFly: (s: FinderStore) => void;
}) {
  const total = agg.stores.reduce((n, s) => n + Math.max(0, s.qty), 0);
  return (
    <div style={{ borderBottom: '1px solid #2e3347', padding: '10px 12px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
        <div style={{ fontSize: 12.5, fontWeight: 700, color: '#e8eaf0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {agg.name}
        </div>
        <div style={{ fontSize: 10, color: '#2ecc71', fontWeight: 800, marginLeft: 8, flexShrink: 0 }}>{total}× · {agg.stores.length} store{agg.stores.length !== 1 ? 's' : ''}</div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {agg.stores.sort((a, b) => a.store.distance_mi - b.store.distance_mi).map(({ store, qty }) => (
          <button key={store.id} onClick={() => onFly(store)} title="Show on map" style={{
            background: '#242736', border: '1px solid #2e3347', borderRadius: 5, padding: '2px 7px', cursor: 'pointer',
            fontSize: 10, color: '#c8d0e8',
          }}>
            {CHAIN_EMOJI[store.chain] ?? '🏪'} {store.distance_mi.toFixed(0)}mi · <span style={{ color: '#2ecc71', fontWeight: 700 }}>{qty}×</span>
          </button>
        ))}
      </div>
    </div>
  );
}

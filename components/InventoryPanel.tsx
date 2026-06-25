'use client';

import { useState } from 'react';
import type { Store } from '@/app/page';

const SETS: { slug: string; label: string }[] = [
  { slug: 'all',               label: 'All' },
  { slug: 'ascended_heroes',   label: 'Ascended Heroes' },
  { slug: 'phantasmal_flames', label: 'Phantasmal Flames' },
  { slug: 'prismatic',         label: 'Prismatic Evolutions' },
  { slug: 'destined_rivals',   label: 'Destined Rivals' },
  { slug: 'first_partner',     label: 'First Partner' },
];

// Chains the filter offers. `live` = we can read per-store stock today.
// Non-live chains show stores but need a residential worker / key to read stock.
const CHAINS: { slug: string; label: string; emoji: string; live: boolean; note?: string }[] = [
  { slug: 'target',  label: 'Target',   emoji: '🎯', live: true },
  { slug: 'walmart', label: 'Walmart',  emoji: '🛒', live: false, note: 'online drops · needs home-PC worker' },
  { slug: 'bestbuy', label: 'Best Buy', emoji: '💻', live: false, note: 'needs key / home-PC worker' },
];

const RADIUS_OPTIONS = [5, 10, 25, 50];
const SCAN_LIMIT = 6; // nearest N stores per scan — keeps us under rate limits
const DEFAULT_CENTER = { lat: 28.0534, lng: -82.6817 }; // Oldsmar, FL — fallback if geolocation fails

const CHAIN_EMOJI: Record<string, string> = {
  target: '🎯', walmart: '🛒', bestbuy: '💻', gamestop: '🎮',
  walgreens: '💊', cvs: '💊', thorntons: '⛽',
  costco: '📦', fivebelow: '5️⃣', dollartree: '🌳',
  dollargeneral: '💲', barnesnoble: '📚',
};

interface RadiusStore {
  id: number;
  name: string;
  chain: string;
  address: string;
  lat: number;
  lng: number;
  distance_mi: number;
  total_quantity: number;
  product_count: number;
  last_checked_at: string | null;
}

interface Props {
  allStores: Store[];
  onFlyToStore: (store: Store) => void;
  onSearchAreaChange: (area: { lat: number; lng: number; radius: number } | null) => void;
  onStoresUpdated: () => Promise<void> | void;
}

export default function InventoryPanel({ allStores, onFlyToStore, onSearchAreaChange, onStoresUpdated }: Props) {
  const [setFilter, setSetFilter] = useState('all');
  const [radius, setRadius] = useState(10);
  const [chains, setChains] = useState<Record<string, boolean>>({ target: true, walmart: false, bestbuy: false });
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [results, setResults] = useState<RadiusStore[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [locating, setLocating] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState('');

  const activeChains = (c = chains) => Object.keys(c).filter((k) => c[k]);

  // Pull real chain stores from OSM around a point, then refresh the store list.
  const discoverNearby = async (lat: number, lng: number, r: number) => {
    setDiscovering(true);
    setDiscoverMsg('Finding chain stores nearby…');
    try {
      const meters = Math.round(r * 1609.34);
      const res = await fetch(`/api/stores/discover?lat=${lat}&lng=${lng}&radius=${meters}`);
      const data = await res.json();
      if (data.error) throw new Error(data.detail || data.error);
      await onStoresUpdated();
      setDiscoverMsg(`${data.total_found ?? 0} stores nearby · ${data.added?.length ?? 0} new`);
    } catch (e) {
      setDiscoverMsg(`Discover failed: ${String(e).replace('Error: ', '').slice(0, 70)}`);
    }
    setDiscovering(false);
    setTimeout(() => setDiscoverMsg(''), 6000);
  };

  // Center on a point: update map filter, fetch stock, discover stores.
  const useCenter = (lat: number, lng: number) => {
    setCenter({ lat, lng });
    onSearchAreaChange({ lat, lng, radius });
    fetchResults(lat, lng, radius, setFilter, chains);
    discoverNearby(lat, lng, Math.max(radius, 25));
  };

  const fetchResults = async (lat: number, lng: number, r: number, set: string, ch: Record<string, boolean>) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({
        lat: String(lat), lng: String(lng), radius: String(r),
      });
      if (set !== 'all') params.set('set', set);
      const selected = activeChains(ch);
      if (selected.length) params.set('chains', selected.join(','));
      const res = await fetch(`/api/inventory/radius?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setResults(data.stores ?? []);
    } catch (e) {
      setError(String(e).replace('Error: ', ''));
      setResults([]);
    }
    setLoading(false);
  };

  // Live scan: hit the nearest N filtered stores, write real stock, then refresh.
  const scanStock = async () => {
    if (!center) return;
    const liveSelected = activeChains().filter((c) => CHAINS.find((x) => x.slug === c)?.live);
    if (liveSelected.length === 0) {
      setScanMsg('No live-readable chain selected — Target reads stock today.');
      setTimeout(() => setScanMsg(''), 6000);
      return;
    }
    setScanning(true);
    setScanMsg(`Scanning nearest ${SCAN_LIMIT} store(s)…`);
    try {
      const res = await fetch('/api/inventory/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lat: center.lat, lng: center.lng, radius,
          chains: activeChains(), limit: SCAN_LIMIT,
          set: setFilter,
        }),
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      const skippedNote = data.skipped?.length
        ? ` · ${data.skipped.map((s: { chain: string }) => s.chain).join(', ')} need worker`
        : '';
      setScanMsg(`Scanned ${data.scanned_stores} · ${data.in_stock_stores} in stock${skippedNote}`);
      await fetchResults(center.lat, center.lng, radius, setFilter, chains);
    } catch (e) {
      setScanMsg(`Scan failed: ${String(e).replace('Error: ', '').slice(0, 70)}`);
    }
    setScanning(false);
    setTimeout(() => setScanMsg(''), 8000);
  };

  const handleLocate = () => {
    if (!navigator.geolocation) {
      setError('Geolocation unavailable — using Oldsmar, FL.');
      useCenter(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
      return;
    }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLocating(false);
        useCenter(pos.coords.latitude, pos.coords.longitude);
      },
      err => {
        // Don't dead-end — fall back to the default area so stock still loads.
        const reason =
          err.code === err.PERMISSION_DENIED ? 'permission blocked'
          : err.code === err.POSITION_UNAVAILABLE ? 'position unavailable'
          : err.code === err.TIMEOUT ? 'timed out' : err.message;
        setError(`Location ${reason} — showing Oldsmar, FL. Use 📍 to retry.`);
        setLocating(false);
        useCenter(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng);
      },
      { timeout: 10000, enableHighAccuracy: false, maximumAge: 60000 }
    );
  };

  const handleRadiusChange = (r: number) => {
    setRadius(r);
    if (center) {
      onSearchAreaChange({ lat: center.lat, lng: center.lng, radius: r });
      fetchResults(center.lat, center.lng, r, setFilter, chains);
    }
  };

  const handleSetChange = (s: string) => {
    setSetFilter(s);
    if (center) fetchResults(center.lat, center.lng, radius, s, chains);
  };

  const toggleChain = (slug: string) => {
    const next = { ...chains, [slug]: !chains[slug] };
    // Keep at least one chain on.
    if (activeChains(next).length === 0) return;
    setChains(next);
    if (center) fetchResults(center.lat, center.lng, radius, setFilter, next);
  };

  const handleResultClick = (rs: RadiusStore) => {
    const store = allStores.find(s => s.id === rs.id);
    if (store) onFlyToStore(store);
  };

  const maxQty = Math.max(1, ...results.map(r => r.total_quantity));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #2e3347', flexShrink: 0 }}>
        {/* Set filter pills */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4,
            textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            Set
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {SETS.map(s => (
              <button key={s.slug} onClick={() => handleSetChange(s.slug)} style={{
                padding: '3px 8px', borderRadius: 5, border: 'none', cursor: 'pointer',
                fontSize: 10, fontWeight: 600,
                background: setFilter === s.slug ? '#e63946' : '#242736',
                color: setFilter === s.slug ? 'white' : '#8b91a8',
              }}>
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chain filter */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4,
            textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            Chains
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {CHAINS.map(c => {
              const on = chains[c.slug];
              return (
                <button key={c.slug} onClick={() => toggleChain(c.slug)}
                  title={c.live ? 'Live stock readable' : c.note}
                  style={{
                    padding: '3px 8px', borderRadius: 5, border: 'none', cursor: 'pointer',
                    fontSize: 10, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                    background: on ? '#e63946' : '#242736',
                    color: on ? 'white' : '#8b91a8',
                    opacity: on || c.live ? 1 : 0.7,
                  }}>
                  {c.emoji} {c.label}
                  {!c.live && <span style={{ fontSize: 8, opacity: 0.8 }}>🔒</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Radius buttons */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4,
            textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
            Radius
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            {RADIUS_OPTIONS.map(r => (
              <button key={r} onClick={() => handleRadiusChange(r)} style={{
                flex: 1, padding: '5px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 700,
                background: radius === r ? '#e63946' : '#242736',
                color: radius === r ? 'white' : '#8b91a8',
              }}>
                {r} mi
              </button>
            ))}
          </div>
        </div>

        {/* Locate button or status */}
        {!center ? (
          <button onClick={handleLocate} disabled={locating} style={{
            width: '100%', padding: '7px',
            background: locating ? '#4a4f6a' : '#e63946',
            border: 'none', borderRadius: 7, color: 'white',
            fontSize: 11, fontWeight: 700,
            cursor: locating ? 'not-allowed' : 'pointer',
          }}>
            {locating ? '⏳ Locating...' : '📍 Use my location'}
          </button>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 10, color: '#6b7280' }}>
                {center.lat.toFixed(3)}, {center.lng.toFixed(3)}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => discoverNearby(center.lat, center.lng, Math.max(radius, 25))} disabled={discovering} style={{
                  background: '#242736', border: 'none', color: discovering ? '#555e7a' : '#8b91a8',
                  borderRadius: 5, padding: '3px 8px', fontSize: 10, cursor: discovering ? 'not-allowed' : 'pointer',
                }}>
                  {discovering ? '⏳ Scanning' : '🔍 Re-scan'}
                </button>
                <button onClick={handleLocate} style={{
                  background: '#242736', border: 'none', color: '#8b91a8',
                  borderRadius: 5, padding: '3px 8px', fontSize: 10, cursor: 'pointer',
                }}>
                  ↻ Re-locate
                </button>
              </div>
            </div>

            {/* Live scan — fills real per-store stock into the list */}
            <button onClick={scanStock} disabled={scanning} style={{
              width: '100%', marginTop: 8, padding: '7px',
              background: scanning ? '#4a4f6a' : '#1f8a4c',
              border: 'none', borderRadius: 7, color: 'white',
              fontSize: 11, fontWeight: 700,
              cursor: scanning ? 'not-allowed' : 'pointer',
            }}>
              {scanning ? '⏳ Scanning stock…' : `⚡ Scan stock (nearest ${SCAN_LIMIT})`}
            </button>
            {scanMsg && (
              <div style={{ marginTop: 6, fontSize: 10,
                color: scanMsg.startsWith('Scan failed') ? '#f39c12' : '#2ecc71' }}>
                {scanMsg}
              </div>
            )}

            {discoverMsg && (
              <div style={{ marginTop: 6, fontSize: 10,
                color: discoverMsg.startsWith('Discover failed') ? '#f39c12' : '#8b91a8' }}>
                {discoverMsg}
              </div>
            )}
          </>
        )}

        {error && (
          <div style={{ marginTop: 6, fontSize: 10, color: '#f39c12' }}>⚠ {error}</div>
        )}
      </div>

      {/* Results */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!center ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#8b91a8', fontSize: 12 }}>
            <div>Tap &quot;Use my location&quot; to find stock nearby.</div>
            <div style={{ fontSize: 11, marginTop: 4, color: '#6b7280' }}>
              Then ⚡ Scan stock to pull live quantities.
            </div>
          </div>
        ) : loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#8b91a8', fontSize: 12 }}>
            Loading...
          </div>
        ) : results.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#8b91a8', fontSize: 12 }}>
            No stores for the selected chains in this radius.
          </div>
        ) : (
          results.map(rs => (
            <ResultRow key={rs.id} row={rs} maxQty={maxQty} onClick={() => handleResultClick(rs)} />
          ))
        )}
      </div>
    </div>
  );
}

function ResultRow({ row, maxQty, onClick }: {
  row: RadiusStore; maxQty: number; onClick: () => void;
}) {
  const emoji = CHAIN_EMOJI[row.chain] ?? '🏪';
  const liveChain = row.chain === 'target';
  const neverChecked = row.last_checked_at == null;
  const barPct = Math.round((row.total_quantity / maxQty) * 100);
  const barColor = row.total_quantity === 0 ? '#555e7a'
    : row.total_quantity < 5 ? '#f39c12'
    : '#2ecc71';

  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left',
      background: 'none', border: 'none', cursor: 'pointer',
      padding: '10px 14px', borderBottom: '1px solid #2e3347',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#e8eaf0',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {emoji} {row.name}
          </div>
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>
            {row.distance_mi.toFixed(1)} mi
            {liveChain
              ? ` · ${row.product_count} sku${row.product_count !== 1 ? 's' : ''}${neverChecked ? ' · not scanned' : ''}`
              : ' · 🔒 needs home-PC worker'}
          </div>
        </div>
        <div style={{ fontSize: 13, fontWeight: 800, color: liveChain ? '#e8eaf0' : '#555e7a', marginLeft: 8 }}>
          {liveChain ? row.total_quantity : '—'}
        </div>
      </div>

      <div style={{
        height: 4, background: '#0f1117', borderRadius: 2, overflow: 'hidden',
      }}>
        <div style={{
          height: '100%', width: `${liveChain ? barPct : 0}%`,
          background: barColor, transition: 'width 0.3s',
        }} />
      </div>
    </button>
  );
}

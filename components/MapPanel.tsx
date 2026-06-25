'use client';

import { useEffect, useState } from 'react';
import type { Store } from '@/app/page';

const RADIUS_MI = 25;          // OSM discovery + nearby-store list
const FILTER_RADIUS_MI = 10;   // default visible-marker filter on the map
const EARTH_RADIUS_MI = 3958.8;

const CHAIN_EMOJI: Record<string, string> = {
  target: '🎯', walmart: '🛒', bestbuy: '💻', gamestop: '🎮',
  walgreens: '💊', cvs: '💊', thorntons: '⛽',
  costco: '📦', fivebelow: '5️⃣', dollartree: '🌳',
  dollargeneral: '💲', barnesnoble: '📚',
};

function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

interface NearbyStore extends Store {
  distance_mi: number;
}

interface Props {
  retailStores: Store[];
  onFlyToStore: (store: Store) => void;
  onSearchAreaChange: (area: { lat: number; lng: number; radius: number } | null) => void;
  onStoresUpdated: () => Promise<void> | void;
}

const RADIUS_METERS = Math.round(RADIUS_MI * 1609.34);

export default function MapPanel({ retailStores, onFlyToStore, onSearchAreaChange, onStoresUpdated }: Props) {
  const [center, setCenter] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState('');
  const [error, setError] = useState('');

  // Auto-locate on mount. Don't clear searchArea on unmount — the marker filter
  // should persist across tab switches.
  useEffect(() => {
    locate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const discoverNearby = async (lat: number, lng: number) => {
    setDiscovering(true);
    setDiscoverMsg('Searching OSM for chain stores within 25 mi...');
    try {
      const res = await fetch(`/api/stores/discover?lat=${lat}&lng=${lng}&radius=${RADIUS_METERS}`);
      const data = await res.json();
      if (data.error) throw new Error(data.detail || data.error);
      const added = data.added?.length ?? 0;
      const total = data.total_found ?? 0;
      await onStoresUpdated();
      setDiscoverMsg(`Found ${total} stores nearby · ${added} newly added`);
    } catch (e) {
      setDiscoverMsg(`Discover failed: ${String(e).replace('Error: ', '').slice(0, 80)}. Showing what's already in the DB.`);
    }
    setDiscovering(false);
    setTimeout(() => setDiscoverMsg(''), 6000);
  };

  const locate = () => {
    if (!navigator.geolocation) {
      setError('Geolocation not supported by this browser.');
      return;
    }
    setLocating(true);
    setError('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setCenter(c);
        // Marker filter defaults to 10mi; Stock tab can widen it.
        onSearchAreaChange({ lat: c.lat, lng: c.lng, radius: FILTER_RADIUS_MI });
        setLocating(false);
        // OSM discovery scans a wider area (25mi) so we have stores to show
        // if the user later widens the filter via Stock tab.
        discoverNearby(c.lat, c.lng);
      },
      err => {
        setError(`Location error: ${err.message}`);
        setLocating(false);
      },
      { timeout: 10000 }
    );
  };

  const nearby: NearbyStore[] = center
    ? retailStores
        .map(s => ({ ...s, distance_mi: haversineMi(center.lat, center.lng, s.lat, s.lng) }))
        .filter(s => s.distance_mi <= RADIUS_MI)
        .sort((a, b) => a.distance_mi - b.distance_mi)
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid #2e3347', flexShrink: 0 }}>
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 4,
          textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
          Stores within {RADIUS_MI} mi
        </div>
        {!center ? (
          <button onClick={locate} disabled={locating} style={{
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
                {nearby.length} store{nearby.length !== 1 ? 's' : ''} · {center.lat.toFixed(3)}, {center.lng.toFixed(3)}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => discoverNearby(center.lat, center.lng)} disabled={discovering} style={{
                  background: '#242736', border: 'none', color: discovering ? '#555e7a' : '#8b91a8',
                  borderRadius: 5, padding: '3px 8px', fontSize: 10,
                  cursor: discovering ? 'not-allowed' : 'pointer',
                }}>
                  {discovering ? '⏳ Discovering' : '🔍 Re-scan'}
                </button>
                <button onClick={locate} style={{
                  background: '#242736', border: 'none', color: '#8b91a8',
                  borderRadius: 5, padding: '3px 8px', fontSize: 10, cursor: 'pointer',
                }}>
                  ↻ Re-locate
                </button>
              </div>
            </div>
            {discoverMsg && (
              <div style={{ marginTop: 6, fontSize: 10,
                color: discoverMsg.startsWith('Discover failed') ? '#f39c12' : '#8b91a8' }}>
                {discoverMsg}
              </div>
            )}
          </>
        )}
        {error && <div style={{ marginTop: 6, fontSize: 10, color: '#e63946' }}>⚠ {error}</div>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {!center ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#8b91a8', fontSize: 12 }}>
            <div>Tap &quot;Use my location&quot; to see stores nearby.</div>
            <div style={{ fontSize: 11, marginTop: 4, color: '#6b7280' }}>
              Sorted by distance from you.
            </div>
          </div>
        ) : nearby.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#8b91a8', fontSize: 12 }}>
            <div>{discovering ? 'Searching OSM for nearby stores...' : `No chain stores found within ${RADIUS_MI} miles.`}</div>
            {!discovering && (
              <div style={{ fontSize: 11, marginTop: 6, color: '#6b7280' }}>
                Tap 🔍 Re-scan to query OSM again, or check your location.
              </div>
            )}
          </div>
        ) : (
          nearby.map(s => (
            <button key={s.id} onClick={() => onFlyToStore(s)} style={{
              display: 'block', width: '100%', textAlign: 'left',
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '10px 14px', borderBottom: '1px solid #2e3347',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e8eaf0',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {CHAIN_EMOJI[s.chain] ?? '🏪'} {s.name}
                  </div>
                  <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {s.address}
                  </div>
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#8b91a8', flexShrink: 0 }}>
                  {s.distance_mi.toFixed(1)} mi
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

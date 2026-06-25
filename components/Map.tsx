'use client';

import { useEffect, useRef, useState } from 'react';
import type { Store, Restock } from '@/app/page';

// Brand config — short label + colors for marker badges
const CHAIN_CONFIG: Record<string, { bg: string; text: string; abbr: string; label: string }> = {
  target:     { bg: '#cc0000', text: '#fff',    abbr: 'TGT',  label: 'Target' },
  walmart:    { bg: '#0071ce', text: '#fff',    abbr: 'WMT',  label: 'Walmart' },
  bestbuy:    { bg: '#1a3a8a', text: '#ffe000', abbr: 'BB',   label: 'Best Buy' },
  gamestop:   { bg: '#5a0000', text: '#fff',    abbr: 'GS',   label: 'GameStop' },
  walgreens:  { bg: '#e4002b', text: '#fff',    abbr: 'WAG',  label: 'Walgreens' },
  cvs:           { bg: '#cc0000', text: '#fff',    abbr: 'CVS',  label: 'CVS' },
  thorntons:     { bg: '#e2231a', text: '#ffe000', abbr: 'THN',  label: "Thornton's" },
  costco:        { bg: '#005daa', text: '#fff',    abbr: 'CST',  label: 'Costco' },
  fivebelow:     { bg: '#6a0dad', text: '#fff',    abbr: '5BLW', label: 'Five Below' },
  dollartree:    { bg: '#006400', text: '#ffe000', abbr: 'DT',   label: 'Dollar Tree' },
  dollargeneral: { bg: '#fbb612', text: '#000',    abbr: 'DG',   label: 'Dollar General' },
  barnesnoble:   { bg: '#0a4d2e', text: '#fff',    abbr: 'B&N',  label: 'Barnes & Noble' },
  other:      { bg: '#4a4f6a', text: '#fff',    abbr: '?',    label: 'Store' },
  default:    { bg: '#4a4f6a', text: '#fff',    abbr: '?',    label: 'Store' },
};

function getChain(chain: string) {
  return CHAIN_CONFIG[chain.toLowerCase()] ?? CHAIN_CONFIG.default;
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

function restockStatus(days: number | null) {
  if (days === null) return { color: '#555e7a', ring: '#555e7a', label: 'No data' };
  if (days <= 3)  return { color: '#2ecc71', ring: '#2ecc71', label: `${days}d ago` };
  if (days <= 10) return { color: '#f39c12', ring: '#f39c12', label: `${days}d ago` };
  return { color: '#e74c3c', ring: '#e74c3c', label: `${days}d ago` };
}

// Build the divIcon HTML for a store marker
function buildIconHtml(store: Store): string {
  const chain = getChain(store.chain);
  const days = daysSince(store.last_restock);
  const status = restockStatus(days);
  const abbr = chain.abbr.length > 3 ? chain.abbr.slice(0, 3) : chain.abbr;
  const fontSize = abbr.length <= 2 ? '10px' : abbr.length === 3 ? '9px' : '8px';

  return `
    <div style="
      width:44px; height:44px;
      display:flex; flex-direction:column; align-items:center; justify-content:center;
      background:${chain.bg};
      border:2.5px solid rgba(255,255,255,0.9);
      border-radius:12px;
      box-shadow:0 2px 10px rgba(0,0,0,0.55);
      cursor:pointer;
      position:relative;
      font-family:-apple-system,sans-serif;
      user-select:none;
    ">
      <span style="
        color:${chain.text};
        font-size:${fontSize};
        font-weight:900;
        letter-spacing:-0.5px;
        line-height:1;
      ">${abbr}</span>
      <div style="
        position:absolute; bottom:-4px; right:-4px;
        width:13px; height:13px;
        background:${status.color};
        border:2.5px solid #0f1117;
        border-radius:50%;
        box-shadow:0 0 0 1px ${status.ring}44;
      "></div>
    </div>
  `;
}

interface LiveStockResult {
  store_id: string;
  checked_at: string;
  in_stock_count: number;
  total_checked: number;
  inventory: {
    tcin: string; name: string; type: string; set: string;
    available: boolean; quantity: number | null; status: string; price: number | null;
  }[];
}

export interface InventoryRow {
  product_id: number;
  product_name: string;
  set_name: string;
  product_type: string;
  quantity: number | null;
  last_checked_at: string | null;
  source: string | null;
  chain_sku: string | null;
  sku_confirmed: number | null;
  chain: string;
}

const SET_LABELS: Record<string, string> = {
  ascended_heroes:   'Ascended Heroes',
  phantasmal_flames: 'Phantasmal Flames',
  prismatic:         'Prismatic Evolutions',
  destined_rivals:   'Destined Rivals',
  first_partner:     'First Partner Collection',
};

function qtyDotColor(qty: number | null): string {
  if (qty === null) return '#555e7a';
  if (qty === 0) return '#e74c3c';
  if (qty < 5)  return '#f39c12';
  return '#2ecc71';
}

const EARTH_RADIUS_MI = 3958.8;
function haversineMi(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(a));
}

const DEFAULT_FILTER_RADIUS_MI = 10;

function minsAgo(iso: string | null): string {
  if (!iso) return '';
  // SQLite datetime('now') returns "YYYY-MM-DD HH:MM:SS" in UTC
  const t = iso.includes('T') ? new Date(iso).getTime() : new Date(iso.replace(' ', 'T') + 'Z').getTime();
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

interface Props {
  stores: Store[];
  onStoreClick: (store: Store) => void;
  onIntelClick: (store: Store) => void;
  onStoresDiscovered: () => void;
  flyToStore?: Store | null;
  searchArea?: { lat: number; lng: number; radius: number } | null;
  /** Locations-only mode: hide all SKU/stock UI in popups (Map tab). SKUs live on the SKU Finder. */
  locationsOnly?: boolean;
}

export default function Map({ stores, onStoreClick, onIntelClick, onStoresDiscovered, flyToStore, searchArea, locationsOnly }: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<globalThis.Map<number, L.Marker>>(new globalThis.Map());
  // Track last_restock per store so we can update icons when it changes
  const lastRestockRef = useRef<globalThis.Map<number, string | null>>(new globalThis.Map());
  // Search-area pin + radius circle (Inventory tab)
  const searchPinRef = useRef<L.Marker | null>(null);
  const searchCircleRef = useRef<L.Circle | null>(null);

  const [popupStore, setPopupStore] = useState<Store | null>(null);
  const [popupRestocks, setPopupRestocks] = useState<Restock[]>([]);
  const [popupLoading, setPopupLoading] = useState(false);
  const [liveStock, setLiveStock] = useState<LiveStockResult | null>(null);
  const [liveStockLoading, setLiveStockLoading] = useState(false);
  const [liveStockError, setLiveStockError] = useState('');
  const [stockRows, setStockRows] = useState<InventoryRow[]>([]);
  const [stockLoading, setStockLoading] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportProductId, setReportProductId] = useState<number | null>(null);
  const [reportQty, setReportQty] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoverMsg, setDiscoverMsg] = useState('');

  // Init map once
  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;
    const L = require('leaflet');
    const map = L.map(mapRef.current, { center: [28.0336, -82.6651], zoom: 13, zoomControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map);
    leafletMapRef.current = map;
    return () => { map.remove(); leafletMapRef.current = null; };
  }, []);

  // Filter stores by current search area — only show markers within radius.
  // If searchArea is unset, the map shows nothing (we don't have a center yet).
  const visibleStores = searchArea
    ? stores.filter(s => haversineMi(searchArea.lat, searchArea.lng, s.lat, s.lng) <= searchArea.radius)
    : [];

  // Sync markers whenever filtered stores list changes
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;
    const L = require('leaflet');

    const storeIds = new Set(visibleStores.map(s => s.id));

    // Remove markers for stores no longer in the list
    markersRef.current.forEach((marker, id) => {
      if (!storeIds.has(id)) {
        map.removeLayer(marker);
        markersRef.current.delete(id);
        lastRestockRef.current.delete(id);
      }
    });

    visibleStores.forEach(store => {
      const prevLastRestock = lastRestockRef.current.get(store.id);
      const existingMarker = markersRef.current.get(store.id);

      if (existingMarker) {
        // Update icon if last_restock changed (e.g. after a new report)
        if (prevLastRestock !== store.last_restock) {
          const icon = L.divIcon({
            className: '',
            iconSize: [44, 44],
            iconAnchor: [22, 22],
            popupAnchor: [0, -26],
            html: buildIconHtml(store),
          });
          existingMarker.setIcon(icon);
          lastRestockRef.current.set(store.id, store.last_restock);
        }
        return; // marker already on map
      }

      // Create new marker
      const icon = L.divIcon({
        className: '',
        iconSize: [44, 44],
        iconAnchor: [22, 22],
        popupAnchor: [0, -26],
        html: buildIconHtml(store),
      });

      const marker = L.marker([store.lat, store.lng], { icon });
      marker.addTo(map);
      marker.on('click', () => handleMarkerClick(store));
      markersRef.current.set(store.id, marker);
      lastRestockRef.current.set(store.id, store.last_restock);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stores, searchArea]);

  // Keep click handler up-to-date without recreating markers
  const onStoreClickRef = useRef(onStoreClick);
  useEffect(() => { onStoreClickRef.current = onStoreClick; }, [onStoreClick]);
  const onIntelClickRef = useRef(onIntelClick);
  useEffect(() => { onIntelClickRef.current = onIntelClick; }, [onIntelClick]);

  const fetchStock = async (storeId: number) => {
    setStockLoading(true);
    try {
      const res = await fetch(`/api/inventory?store_id=${storeId}`);
      setStockRows(await res.json());
    } catch {
      setStockRows([]);
    }
    setStockLoading(false);
  };

  const handleMarkerClick = async (store: Store) => {
    setPopupStore(store);
    setPopupLoading(true);
    setPopupRestocks([]);
    setLiveStock(null);
    setLiveStockError('');
    setStockRows([]);
    setReportOpen(false);
    setReportProductId(null);
    setReportQty('');
    const map = leafletMapRef.current;
    if (map) map.setView([store.lat, store.lng], Math.max(map.getZoom(), 14), { animate: true });
    fetchStock(store.id);
    const res = await fetch(`/api/restocks?store_id=${store.id}&limit=5`);
    setPopupRestocks(await res.json());
    setPopupLoading(false);
  };

  const handleStockSubmit = async () => {
    if (!popupStore || reportProductId === null) return;
    const qtyNum = parseInt(reportQty, 10);
    if (!Number.isFinite(qtyNum) || qtyNum < 0) return;
    setReportSubmitting(true);
    try {
      await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          store_id: popupStore.id,
          product_id: reportProductId,
          quantity: qtyNum,
          source: 'manual',
        }),
      });
      await fetchStock(popupStore.id);
      setReportOpen(false);
      setReportProductId(null);
      setReportQty('');
    } catch { /* swallow — user can retry */ }
    setReportSubmitting(false);
  };

  // Programmatic fly-to-store (driven by Inventory tab result clicks)
  useEffect(() => {
    if (!flyToStore) return;
    const map = leafletMapRef.current;
    if (!map) return;
    handleMarkerClick(flyToStore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToStore]);

  // Search-area pin + radius circle (driven by Inventory tab "Use my location")
  useEffect(() => {
    const map = leafletMapRef.current;
    if (!map) return;
    const L = require('leaflet');

    if (!searchArea) {
      if (searchPinRef.current)    { map.removeLayer(searchPinRef.current);    searchPinRef.current = null; }
      if (searchCircleRef.current) { map.removeLayer(searchCircleRef.current); searchCircleRef.current = null; }
      return;
    }

    const { lat, lng, radius } = searchArea;
    const radiusMeters = radius * 1609.34;

    // Pin
    if (!searchPinRef.current) {
      const icon = L.divIcon({
        className: '',
        iconSize: [22, 22],
        iconAnchor: [11, 11],
        html: `
          <div style="
            width:22px; height:22px; border-radius:50%;
            background:#3b9eff; border:3px solid white;
            box-shadow:0 0 0 2px #3b9eff66, 0 2px 8px rgba(0,0,0,0.5);
            position:relative;
          ">
            <div style="
              position:absolute; inset:-8px; border-radius:50%;
              background:#3b9eff33; animation:pulse-ring 2s infinite;
            "></div>
          </div>
        `,
      });
      searchPinRef.current = L.marker([lat, lng], { icon, interactive: false }).addTo(map);
    } else {
      searchPinRef.current.setLatLng([lat, lng]);
    }

    // Circle
    let circle = searchCircleRef.current;
    if (!circle) {
      circle = L.circle([lat, lng], {
        radius: radiusMeters,
        color: '#3b9eff',
        weight: 1.5,
        fillColor: '#3b9eff',
        fillOpacity: 0.07,
        interactive: false,
      }).addTo(map);
      searchCircleRef.current = circle;
    } else {
      circle.setLatLng([lat, lng]);
      circle.setRadius(radiusMeters);
    }

    // Fit map to circle bounds so the whole search area is visible
    map.fitBounds(circle!.getBounds(), { padding: [40, 40], animate: true });
  }, [searchArea]);

  const handleLiveStockCheck = async (store: Store) => {
    setLiveStockLoading(true);
    setLiveStockError('');
    setLiveStock(null);
    try {
      const res = await fetch(`/api/inventory/target?lat=${store.lat}&lng=${store.lng}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setLiveStock(data);
    } catch (e) {
      setLiveStockError(String(e).replace('Error: ', ''));
    }
    setLiveStockLoading(false);
  };

  const handleDiscover = () => {
    if (!navigator.geolocation) { setDiscoverMsg('Geolocation not supported.'); return; }
    setDiscovering(true);
    setDiscoverMsg('Getting your location...');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        const map = leafletMapRef.current;
        if (map) map.setView([latitude, longitude], 13, { animate: true });
        setDiscoverMsg('Searching for nearby stores...');
        try {
          const res = await fetch(`/api/stores/discover?lat=${latitude}&lng=${longitude}&radius=16000`);
          const data = await res.json();
          if (data.error) throw new Error(data.error);
          onStoresDiscovered();
          setDiscoverMsg(`Found ${data.total_found} stores — ${data.added.length} new added.`);
        } catch (e) {
          setDiscoverMsg(`Error: ${String(e)}`);
        }
        setDiscovering(false);
        setTimeout(() => setDiscoverMsg(''), 5000);
      },
      (err) => {
        setDiscoverMsg(`Location error: ${err.message}`);
        setDiscovering(false);
        setTimeout(() => setDiscoverMsg(''), 4000);
      },
      { timeout: 10000 }
    );
  };

  const popupDays = daysSince(popupStore?.last_restock ?? null);
  const popupStatus = restockStatus(popupDays);

  return (
    <div style={{ position: 'relative', height: '100%', borderRadius: 12, overflow: 'hidden' }}>
      <div ref={mapRef} style={{ width: '100%', height: '100%' }} />

      {/* Find My Stores button */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 1000,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <button onClick={handleDiscover} disabled={discovering} style={{
          background: discovering ? '#4a4f6a' : '#e63946', color: 'white',
          border: 'none', cursor: discovering ? 'not-allowed' : 'pointer',
          borderRadius: 10, padding: '8px 14px', fontSize: 12, fontWeight: 700,
          boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
        }}>
          {discovering ? '⏳ Scanning...' : '📡 Find My Stores'}
        </button>
        {discoverMsg && (
          <div style={{ background: '#1a1d27ee', border: '1px solid #2e3347', borderRadius: 8,
            padding: '5px 10px', fontSize: 11, color: '#e8eaf0', maxWidth: 240, textAlign: 'right' }}>
            {discoverMsg}
          </div>
        )}
      </div>

      {/* Chain legend */}
      <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1000,
        display: 'flex', gap: 5, flexWrap: 'wrap', maxWidth: 280 }}>
        {Object.entries(CHAIN_CONFIG)
          .filter(([k]) => k !== 'default' && k !== 'other')
          .map(([key, cfg]) => (
            <div key={key} style={{
              background: cfg.bg, border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 6, padding: '3px 8px',
              fontSize: 10, color: cfg.text, fontWeight: 800,
              letterSpacing: '0.02em',
            }}>
              {cfg.abbr} <span style={{ opacity: 0.75, fontWeight: 400 }}>{cfg.label}</span>
            </div>
          ))}
      </div>

      {/* Status legend */}
      <div style={{
        position: 'absolute', bottom: 48, left: 12, zIndex: 1000,
        background: '#1a1d27ee', border: '1px solid #2e3347',
        borderRadius: 10, padding: '8px 12px',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}>
        {[
          { color: '#2ecc71', label: 'Restocked ≤3 days' },
          { color: '#f39c12', label: 'Restocked ≤10 days' },
          { color: '#e74c3c', label: 'Old / no data' },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#8b91a8' }}>
            <div style={{ width: 9, height: 9, borderRadius: '50%', background: color, flexShrink: 0 }} />
            {label}
          </div>
        ))}
      </div>

      {/* Store popup — anchored bottom-center */}
      {popupStore && (
        <div className="fade-in" style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          zIndex: 1001, width: 340,
          background: '#1a1d27', border: '1px solid #2e3347',
          borderRadius: 14, overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        }}>
          {/* Store header */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #2e3347' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#e8eaf0',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {popupStore.name}
                </div>
                <div style={{ fontSize: 11, color: '#8b91a8', marginTop: 2 }}>{popupStore.address}</div>
              </div>
              <button onClick={() => setPopupStore(null)} style={{
                background: 'none', border: 'none', color: '#8b91a8',
                cursor: 'pointer', fontSize: 20, lineHeight: 1, marginLeft: 8, flexShrink: 0,
              }}>×</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: popupStatus.color, flexShrink: 0 }} />
              <span style={{ fontSize: 11, color: popupStatus.color, fontWeight: 600 }}>
                {popupDays === null ? 'Never reported' : `Last restock ${popupStatus.label}`}
              </span>
              <span style={{ fontSize: 11, color: '#8b91a8', marginLeft: 'auto' }}>
                {popupStore.restock_count} report{popupStore.restock_count !== 1 ? 's' : ''}
              </span>
            </div>
          </div>

          {/* Live stock check — Target only (hidden in locations-only Map; SKUs live on the SKU Finder) */}
          {!locationsOnly && popupStore.chain === 'target' && (
            <div style={{ borderBottom: '1px solid #2e3347' }}>
              {!liveStock && !liveStockLoading && !liveStockError && (
                <div style={{ padding: '8px 14px' }}>
                  <button onClick={() => handleLiveStockCheck(popupStore)} style={{
                    width: '100%', padding: '7px', borderRadius: 8, border: '1px solid #cc000060',
                    cursor: 'pointer', background: '#1e0808',
                    color: '#ff6b6b', fontSize: 11, fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  }}>
                    🔴 Check Live Target Stock (RedSky API)
                  </button>
                </div>
              )}
              {liveStockLoading && (
                <div style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, color: '#8b91a8' }}>
                  Querying Target RedSky API...
                </div>
              )}
              {liveStockError && (
                <div style={{ padding: '8px 14px' }}>
                  <div style={{ fontSize: 10, color: '#e63946', marginBottom: 4 }}>⚠ {liveStockError}</div>
                  <button onClick={() => handleLiveStockCheck(popupStore)} style={{
                    background: '#242736', border: 'none', color: '#8b91a8',
                    borderRadius: 6, padding: '4px 10px', fontSize: 10, cursor: 'pointer',
                  }}>Retry</button>
                </div>
              )}
              {liveStock && (
                <div style={{ padding: '8px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 800, color: liveStock.in_stock_count > 0 ? '#2ecc71' : '#e74c3c' }}>
                      {liveStock.in_stock_count > 0
                        ? `✅ ${liveStock.in_stock_count} item${liveStock.in_stock_count !== 1 ? 's' : ''} IN STOCK`
                        : '❌ Nothing in stock'}
                    </span>
                    <span style={{ fontSize: 9, color: '#6b7280' }}>
                      {new Date(liveStock.checked_at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, maxHeight: 120, overflowY: 'auto' }}>
                    {liveStock.inventory.filter(i => i.available).map(item => (
                      <div key={item.tcin} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: '#0f2a1a', border: '1px solid #2ecc7140',
                        borderRadius: 6, padding: '4px 8px',
                      }}>
                        <div>
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#2ecc71' }}>{item.name}</div>
                          <div style={{ fontSize: 9, color: '#6b7280' }}>
                            {item.quantity !== null ? `Qty: ${item.quantity}` : item.status}
                            {item.price ? ` · $${item.price}` : ''}
                          </div>
                        </div>
                        <span style={{ fontSize: 9, color: '#2ecc71', fontWeight: 800 }}>IN STOCK</span>
                      </div>
                    ))}
                    {liveStock.in_stock_count === 0 && (
                      <div style={{ fontSize: 10, color: '#6b7280', textAlign: 'center', padding: 4 }}>
                        Checked {liveStock.total_checked} products. All out of stock at this store.
                      </div>
                    )}
                  </div>
                  <button onClick={() => handleLiveStockCheck(popupStore)}
                    style={{ background: 'none', border: 'none', color: '#6b7280',
                      cursor: 'pointer', fontSize: 9, marginTop: 4, padding: 0 }}>
                    ↻ Re-check
                  </button>
                </div>
              )}
            </div>
          )}

          {/* SKU stock table (manual/Discord intel) — hidden in locations-only Map */}
          {!locationsOnly && popupStore.store_type === 'retail' && (
            <StockSection
              loading={stockLoading}
              rows={stockRows}
              reportOpen={reportOpen}
              reportProductId={reportProductId}
              reportQty={reportQty}
              reportSubmitting={reportSubmitting}
              onOpenReport={() => {
                setReportOpen(true);
                if (reportProductId === null && stockRows[0]) {
                  setReportProductId(stockRows[0].product_id);
                }
              }}
              onCancelReport={() => setReportOpen(false)}
              onSelectProduct={setReportProductId}
              onChangeQty={setReportQty}
              onSubmit={handleStockSubmit}
            />
          )}

          {/* Restock history */}
          <div style={{ maxHeight: 160, overflowY: 'auto' }}>
            {popupLoading ? (
              <div style={{ padding: 16, textAlign: 'center', color: '#8b91a8', fontSize: 12 }}>Loading...</div>
            ) : popupRestocks.length === 0 ? (
              <div style={{ padding: 16, textAlign: 'center', color: '#8b91a8', fontSize: 12 }}>
                No reports yet — be the first!
              </div>
            ) : popupRestocks.map(r => <PopupRestockCard key={r.id} restock={r} />)}
          </div>


          {/* Actions */}
          <div style={{ padding: '8px 14px', borderTop: '1px solid #2e3347', display: 'flex', gap: 6 }}>
            <button onClick={() => { onStoreClickRef.current(popupStore); setPopupStore(null); }} style={{
              flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: '#e63946', color: 'white', fontSize: 11, fontWeight: 700,
            }}>
              ➕ Report Restock
            </button>
            <button onClick={() => { onIntelClickRef.current(popupStore); setPopupStore(null); }} style={{
              flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: '#242736', color: '#f39c12', fontSize: 11, fontWeight: 700,
              outline: '1px solid #f39c1240',
            }}>
              🕵️ Store Intel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface StockSectionProps {
  loading: boolean;
  rows: InventoryRow[];
  reportOpen: boolean;
  reportProductId: number | null;
  reportQty: string;
  reportSubmitting: boolean;
  onOpenReport: () => void;
  onCancelReport: () => void;
  onSelectProduct: (id: number) => void;
  onChangeQty: (q: string) => void;
  onSubmit: () => void;
}

function StockSection({
  loading, rows, reportOpen, reportProductId, reportQty, reportSubmitting,
  onOpenReport, onCancelReport, onSelectProduct, onChangeQty, onSubmit,
}: StockSectionProps) {
  // Group rows by set_name preserving slug order
  const grouped: Record<string, InventoryRow[]> = {};
  for (const row of rows) {
    if (!grouped[row.set_name]) grouped[row.set_name] = [];
    grouped[row.set_name].push(row);
  }

  // User toggle state per set; undefined entry → use auto default below
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isExpanded = (slug: string): boolean => {
    if (slug in overrides) return overrides[slug];
    // Auto: expand only if this set has any reported stock
    return (grouped[slug] || []).some(r => r.quantity !== null);
  };
  const toggle = (slug: string) => {
    setOverrides(prev => ({ ...prev, [slug]: !isExpanded(slug) }));
  };

  // Newest "last_checked_at" across all populated rows
  const lastUpdated = rows
    .map(r => r.last_checked_at)
    .filter((v): v is string => !!v)
    .sort()
    .pop() ?? null;

  return (
    <div style={{ borderBottom: '1px solid #2e3347', padding: '10px 14px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#8b91a8',
          textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          📦 SKU Stock
        </span>
        <span style={{ fontSize: 9, color: '#6b7280' }}>
          {lastUpdated ? `Last updated ${minsAgo(lastUpdated)}` : 'No data yet'}
        </span>
      </div>

      {loading ? (
        <div style={{ fontSize: 11, color: '#8b91a8', textAlign: 'center', padding: '6px 0' }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.keys(SET_LABELS).map(slug => {
            const setRows = grouped[slug];
            if (!setRows || setRows.length === 0) return null;
            const expanded = isExpanded(slug);
            const inStockCount = setRows.filter(r => r.quantity !== null && r.quantity > 0).length;
            return (
              <div key={slug}>
                <button onClick={() => toggle(slug)} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  width: '100%', padding: '3px 2px', marginBottom: expanded ? 3 : 0,
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 9, fontWeight: 700, color: '#6b7280',
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{
                      display: 'inline-block', width: 8, fontSize: 8, lineHeight: 1,
                      transform: expanded ? 'rotate(90deg)' : 'none',
                      transition: 'transform 0.12s',
                    }}>▶</span>
                    {SET_LABELS[slug]}
                  </span>
                  <span style={{ fontWeight: 500, color: inStockCount > 0 ? '#2ecc71' : '#555e7a' }}>
                    {inStockCount > 0 ? `${inStockCount} in stock` : `${setRows.length} SKUs`}
                  </span>
                </button>
                {expanded && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {setRows.map(row => {
                    const skuPending = row.chain_sku !== null && row.sku_confirmed === 0;
                    return (
                      <div key={row.product_id} style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: '#0f1117', borderRadius: 5, padding: '3px 7px',
                      }}>
                        <span style={{ fontSize: 10, color: '#c8d0e8' }}>{row.product_type}</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          {skuPending ? (
                            <span style={{ fontSize: 9, fontWeight: 700, color: '#f39c12',
                              background: '#1a1208', border: '1px solid #f39c1240',
                              borderRadius: 4, padding: '1px 5px' }}>
                              SKU Pending
                            </span>
                          ) : (
                            <>
                              <span style={{ fontSize: 10, fontWeight: 700,
                                color: row.quantity === null ? '#555e7a' : '#e8eaf0', minWidth: 14, textAlign: 'right' }}>
                                {row.quantity === null ? '—' : row.quantity}
                              </span>
                              <div style={{
                                width: 7, height: 7, borderRadius: '50%',
                                background: qtyDotColor(row.quantity),
                              }} />
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!reportOpen ? (
        <button onClick={onOpenReport} style={{
          marginTop: 8, width: '100%', padding: '6px',
          borderRadius: 7, border: '1px dashed #2e3347',
          background: 'transparent', color: '#8b91a8',
          fontSize: 10, fontWeight: 700, cursor: 'pointer',
        }}>
          + Report Stock
        </button>
      ) : (
        <div style={{
          marginTop: 8, padding: 8, background: '#0f1117',
          border: '1px solid #2e3347', borderRadius: 7,
          display: 'flex', flexDirection: 'column', gap: 6,
        }}>
          <select
            value={reportProductId ?? ''}
            onChange={e => onSelectProduct(parseInt(e.target.value, 10))}
            style={{
              background: '#1a1d27', border: '1px solid #2e3347', color: '#e8eaf0',
              borderRadius: 5, padding: '5px 7px', fontSize: 11,
            }}
          >
            {Object.keys(SET_LABELS).map(slug => {
              const setRows = grouped[slug];
              if (!setRows) return null;
              return (
                <optgroup key={slug} label={SET_LABELS[slug]}>
                  {setRows.map(r => (
                    <option key={r.product_id} value={r.product_id}>{r.product_type}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              type="number"
              min={0}
              placeholder="Qty"
              value={reportQty}
              onChange={e => onChangeQty(e.target.value)}
              style={{
                flex: 1, background: '#1a1d27', border: '1px solid #2e3347', color: '#e8eaf0',
                borderRadius: 5, padding: '5px 7px', fontSize: 11,
              }}
            />
            <button onClick={onCancelReport} disabled={reportSubmitting} style={{
              background: '#242736', border: 'none', color: '#8b91a8',
              borderRadius: 5, padding: '5px 10px', fontSize: 10, fontWeight: 700,
              cursor: reportSubmitting ? 'not-allowed' : 'pointer',
            }}>
              Cancel
            </button>
            <button
              onClick={onSubmit}
              disabled={reportSubmitting || reportProductId === null || reportQty === ''}
              style={{
                background: '#e63946', border: 'none', color: 'white',
                borderRadius: 5, padding: '5px 10px', fontSize: 10, fontWeight: 700,
                cursor: reportSubmitting ? 'not-allowed' : 'pointer',
                opacity: reportSubmitting || reportProductId === null || reportQty === '' ? 0.6 : 1,
              }}
            >
              {reportSubmitting ? '...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function PopupRestockCard({ restock }: { restock: Restock }) {
  const products = restock.products.split(',').map(p => p.trim()).filter(Boolean);
  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid #1e2235' }}>
      <div style={{ fontSize: 10, color: '#8b91a8', marginBottom: 5, display: 'flex', gap: 6 }}>
        <span>{new Date(restock.restock_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
        <span>·</span>
        <span>{restock.reporter}</span>
        <span>·</span>
        <span style={{ color: restock.restock_type === 'online' ? '#3b9eff' : '#2ecc71', fontWeight: 700 }}>
          {restock.restock_type === 'online' ? '🌐 Online' : '🏪 In-Store'}
        </span>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: restock.shipment_details ? 5 : 0 }}>
        {products.map(p => (
          <span key={p} style={{ background: '#242736', color: '#c8d0e8',
            padding: '2px 6px', borderRadius: 4, fontSize: 10 }}>
            🃏 {p}
          </span>
        ))}
      </div>
      {restock.shipment_details && (
        <div style={{ background: '#1e2133', borderLeft: '2px solid #e63946',
          borderRadius: '0 5px 5px 0', padding: '4px 8px', fontSize: 10, color: '#a8b4c8' }}>
          🚚 {restock.shipment_details}
        </div>
      )}
    </div>
  );
}

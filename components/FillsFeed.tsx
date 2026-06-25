'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import type { Store } from '@/app/page';

const CHAIN_EMOJI: Record<string, string> = {
  target: '🎯', walmart: '🛒', bestbuy: '💻', gamestop: '🎮',
  walgreens: '💊', cvs: '💊', costco: '📦', fivebelow: '5️⃣',
  dollargeneral: '💲', barnesnoble: '📚',
};

interface Fill {
  id: number;
  store_id: number;
  product_id: number;
  quantity: number;
  store_name: string;
  chain: string;
  address: string;
  lat: number;
  lng: number;
  product_label: string;
  detected_at: string;
}

interface Props {
  allStores: Store[];
  onFlyToStore: (store: Store) => void;
}

const POLL_MS = 25000;

function timeAgo(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso + 'Z').getTime()) / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export default function FillsFeed({ allStores, onFlyToStore }: Props) {
  const [fills, setFills] = useState<Fill[]>([]);
  const [loading, setLoading] = useState(true);
  const [newCount, setNewCount] = useState(0);
  const seenMax = useRef(0);
  const firstLoad = useRef(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/fills?limit=80');
      const data = await res.json();
      const rows: Fill[] = data.fills ?? [];
      if (!firstLoad.current && rows.length && rows[0].id > seenMax.current) {
        const fresh = rows.filter((r) => r.id > seenMax.current).length;
        setNewCount((n) => n + fresh);
      }
      if (rows.length) seenMax.current = Math.max(seenMax.current, rows[0].id);
      setFills(rows);
    } catch { /* keep last good */ }
    setLoading(false);
    firstLoad.current = false;
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  const flyTo = (f: Fill) => {
    const store = allStores.find((s) => s.id === f.store_id);
    if (store) onFlyToStore(store);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ padding: '12px 14px 10px', borderBottom: '1px solid #2e3347', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15, fontWeight: 800, color: '#e8eaf0' }}>🔔 Fills</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#2ecc71', fontWeight: 700 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2ecc71', boxShadow: '0 0 6px #2ecc71' }} />
            LIVE
          </span>
          {newCount > 0 && (
            <button onClick={() => setNewCount(0)} style={{
              marginLeft: 'auto', background: '#e63946', border: 'none', color: '#fff',
              borderRadius: 20, padding: '2px 9px', fontSize: 10, fontWeight: 800, cursor: 'pointer',
            }}>
              {newCount} new ↑
            </button>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 4 }}>
          Live in-stock finds — shared with everyone. Auto-logged whenever a scan catches stock.
        </div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#8b91a8', fontSize: 12 }}>Loading…</div>
        ) : fills.length === 0 ? (
          <div style={{ padding: 36, textAlign: 'center', color: '#8b91a8' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#c8d0e8' }}>No fills yet</div>
            <div style={{ fontSize: 11, marginTop: 6, color: '#6b7280', lineHeight: 1.5 }}>
              When a scan catches a SKU in stock, it drops here for everyone — which card, how many, where, and when.
            </div>
          </div>
        ) : (
          fills.map((f) => {
            const emoji = CHAIN_EMOJI[f.chain] ?? '🏪';
            return (
              <button key={f.id} onClick={() => flyTo(f)} title="Show on map" style={{
                display: 'block', width: '100%', textAlign: 'left', background: 'none',
                border: 'none', borderBottom: '1px solid #2e3347', cursor: 'pointer', padding: '10px 14px',
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: '#e8eaf0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.product_label || 'Pokémon TCG'}
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#2ecc71', flexShrink: 0 }}>{f.quantity}× in stock</span>
                </div>
                <div style={{ fontSize: 10.5, color: '#8b91a8', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {emoji} {f.store_name}{f.address ? ` · ${f.address}` : ''}
                </div>
                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>{timeAgo(f.detected_at)}</div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

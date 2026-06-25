'use client';

import { useState, useEffect, useCallback } from 'react';

interface Watch {
  id: number;
  retailer: 'walmart' | 'target' | 'bestbuy';
  item_id: string;
  label: string;
  max_qty: number;
  active: number;
  last_status: string | null;
  last_checked_at: string | null;
  last_in_stock_at: string | null;
}

const RETAILER_META: Record<string, { emoji: string; name: string; color: string }> = {
  walmart: { emoji: '🛒', name: 'Walmart', color: '#0071ce' },
  target:  { emoji: '🎯', name: 'Target',  color: '#cc0000' },
  bestbuy: { emoji: '💻', name: 'Best Buy', color: '#1a56ff' },
};

function statusColor(s: string | null): string {
  switch (s) {
    case 'IN_STOCK': return '#2ecc71';
    case 'OUT_OF_STOCK': return '#8b91a8';
    case 'CHECK_FAILED': return '#f39c12';
    default: return '#6b7280';
  }
}

function productUrl(w: Watch): string {
  if (w.retailer === 'walmart') return `https://www.walmart.com/ip/${w.item_id}`;
  if (w.retailer === 'target')  return `https://www.target.com/p/-/A-${w.item_id}`;
  return `https://www.bestbuy.com/site/-/${w.item_id}.p`;
}

export default function SniperPanel({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<Watch[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkMsg, setCheckMsg] = useState('');

  // add form
  const [retailer, setRetailer] = useState<'walmart' | 'target' | 'bestbuy'>('walmart');
  const [itemId, setItemId] = useState('');
  const [label, setLabel] = useState('');
  const [maxQty, setMaxQty] = useState('99');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const res = await fetch('/api/sniper/watchlist');
    if (res.ok) setItems(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function runCheck() {
    setChecking(true);
    setCheckMsg('Checking all active items…');
    try {
      const res = await fetch('/api/sniper/check');
      const data = await res.json();
      if (res.ok) {
        setCheckMsg(`Checked ${data.checked} · ${data.in_stock} in stock`);
        await load();
      } else {
        setCheckMsg(data.error || 'Check failed');
      }
    } catch {
      setCheckMsg('Check failed (network)');
    }
    setChecking(false);
    setTimeout(() => setCheckMsg(''), 8000);
  }

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/sniper/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retailer, item_id: itemId, label, max_qty: Number(maxQty) }),
    });
    if (res.ok) {
      setItemId(''); setLabel(''); setMaxQty('99');
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || 'Failed to add');
    }
  }

  async function toggle(w: Watch) {
    await fetch(`/api/sniper/watchlist/${w.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: w.active ? 0 : 1 }),
    });
    load();
  }

  async function remove(w: Watch) {
    if (!confirm(`Remove "${w.label}" from the watchlist?`)) return;
    await fetch(`/api/sniper/watchlist/${w.id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid #2e3347' }}>
        <span style={{ fontWeight: 600, color: '#e8eaf0', fontSize: 14 }}>🎯 Sniper</span>
        <span style={{ marginLeft: 8, fontSize: 9, padding: '2px 7px', borderRadius: 99, fontWeight: 700,
          background: '#3a2030', color: '#ff9b3d', letterSpacing: '0.05em' }}>ADMIN ONLY</span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={closeBtn}>✕</button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {/* Reality banner */}
        <div style={{ background: '#1c1407', border: '1px solid #4a3410', borderRadius: 9,
          padding: '8px 10px', fontSize: 10, color: '#d7b56a', lineHeight: 1.5, marginBottom: 12 }}>
          ⚠ <b>Detector pipeline (Phase 1).</b> Walmart fronts pages with bot protection, so live checks
          often return <i>CHECK_FAILED</i> from this server until residential proxies are added (Phase 2).
          Target checks use the working RedSky path. &quot;Open&quot; drops you straight onto the product page
          for a fast manual buy.
        </div>

        {/* Check now */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
          <button onClick={runCheck} disabled={checking} style={{
            ...primaryBtn, flex: 1, opacity: checking ? 0.6 : 1, cursor: checking ? 'default' : 'pointer',
          }}>
            {checking ? 'Checking…' : '⚡ Check stock now'}
          </button>
        </div>
        {checkMsg && <div style={{ fontSize: 11, color: '#8b91a8', marginBottom: 12 }}>{checkMsg}</div>}

        {/* Add form */}
        <form onSubmit={addItem} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          <div style={sectionLabel}>Add to watchlist</div>
          <select value={retailer} onChange={(e) => setRetailer(e.target.value as 'walmart' | 'target' | 'bestbuy')} style={input}>
            <option value="walmart">🛒 Walmart (item ID)</option>
            <option value="target">🎯 Target (TCIN)</option>
            <option value="bestbuy">💻 Best Buy (SKU) — phase 2</option>
          </select>
          <input value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="Item ID / TCIN / SKU" style={input} />
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Chaos Rising ETB)" style={input} />
          <input value={maxQty} onChange={(e) => setMaxQty(e.target.value)} placeholder="Max qty" type="number" min={1} style={input} />
          {error && <div style={{ color: '#ff6b6b', fontSize: 12 }}>{error}</div>}
          <button type="submit" style={primaryBtn}>+ Add item</button>
        </form>

        {/* Watchlist */}
        <div style={sectionLabel}>Watchlist ({items.length})</div>
        {items.map((w) => {
          const meta = RETAILER_META[w.retailer];
          return (
            <div key={w.id} style={{ ...card, opacity: w.active ? 1 : 0.55 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 99, fontWeight: 700,
                  background: meta.color + '33', color: meta.color }}>{meta.emoji} {meta.name}</span>
                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 800, color: statusColor(w.last_status) }}>
                  {w.last_status ?? 'not checked'}
                </span>
              </div>
              <div style={{ fontWeight: 600, color: '#e8eaf0', fontSize: 13, marginTop: 4 }}>{w.label}</div>
              <div style={{ fontSize: 10, color: '#8b91a8', marginTop: 2 }}>
                #{w.item_id} · max qty {w.max_qty}
                {w.last_checked_at && ` · checked ${new Date(w.last_checked_at + 'Z').toLocaleTimeString()}`}
              </div>
              {w.last_in_stock_at && (
                <div style={{ fontSize: 10, color: '#2ecc71', marginTop: 2 }}>
                  last in stock: {new Date(w.last_in_stock_at + 'Z').toLocaleString()}
                </div>
              )}
              <div style={{ display: 'flex', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
                <a href={productUrl(w)} target="_blank" rel="noopener noreferrer"
                  style={{ ...miniBtn, color: '#5bd6a0', textDecoration: 'none' }}>↗ Open</a>
                <button onClick={() => toggle(w)} style={miniBtn}>{w.active ? 'Pause' : 'Resume'}</button>
                <button onClick={() => remove(w)} style={{ ...miniBtn, color: '#ff6b6b' }}>Remove</button>
              </div>
            </div>
          );
        })}
        {items.length === 0 && <div style={{ color: '#8b91a8', fontSize: 12 }}>Watchlist is empty.</div>}
      </div>
    </div>
  );
}

const closeBtn: React.CSSProperties = { background: '#242736', color: '#8b91a8', border: 'none', cursor: 'pointer', padding: '4px 9px', borderRadius: 7, fontSize: 12 };
const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#8b91a8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 0' };
const input: React.CSSProperties = { padding: '8px 10px', borderRadius: 7, border: '1px solid #2e3347', background: '#242736', color: '#e8eaf0', fontSize: 13, outline: 'none' };
const primaryBtn: React.CSSProperties = { padding: '9px', borderRadius: 7, border: 'none', cursor: 'pointer', background: '#e63946', color: 'white', fontWeight: 700, fontSize: 13 };
const card: React.CSSProperties = { background: '#242736', border: '1px solid #2e3347', borderRadius: 9, padding: '9px 11px', marginBottom: 8 };
const miniBtn: React.CSSProperties = { padding: '4px 9px', borderRadius: 6, border: '1px solid #2e3347', background: '#1a1d27', color: '#b9bfd0', cursor: 'pointer', fontSize: 11 };

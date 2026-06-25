'use client';

import { useState, useEffect } from 'react';
import type { Store } from '@/app/page';

const PRODUCTS = [
  // Newest sets — top of list
  'Mega Evolutions',
  'Ascended Heroes',
  'Perfect Order',
  'Space Time Smackdown',
  'Destined Rivals',
  // 2024–2025
  'Prismatic Evolutions',
  'Surging Sparks',
  'Stellar Crown',
  'Twilight Masquerade',
  'Shrouded Fable',
  'Temporal Forces',
  'Paldean Fates',
  'Paradox Rift',
  'Obsidian Flames',
  '151',
  'Crown Zenith',
  'Lost Origin',
  'Fusion Strike',
  'Brilliant Stars',
  // Product types
  'ETB (Elite Trainer Box)',
  'Booster Bundle',
  'Booster Box',
  'Blister Pack',
  'Collection Box',
  'Mini Tin',
  'Ultra Premium Collection',
  'Poster Collection',
  'Other',
];

const ONLINE_SOURCES = [
  { value: 'website', label: 'Site went live' },
  { value: 'bot_alert', label: 'Bot / alert fired' },
  { value: 'email', label: 'Email/newsletter drop' },
  { value: 'social', label: 'Social media tip' },
  { value: 'restock_alert', label: 'Restock alert service' },
];

const INSTORE_SOURCES = [
  { value: 'community', label: 'Community sighting' },
  { value: 'employee', label: 'Employee tip' },
  { value: 'shipment', label: 'Shipment manifest' },
  { value: 'tracking', label: 'Tracking info' },
  { value: 'social', label: 'Social media' },
];

interface Props {
  stores: Store[];
  selectedStore: Store | null;
  onSubmitted: () => void;
  onCancel: () => void;
}

export default function RestockForm({ stores, selectedStore, onSubmitted, onCancel }: Props) {
  const initialType = selectedStore?.store_type === 'online' ? 'online' : 'instore';
  const [restockType, setRestockType] = useState<'instore' | 'online'>(initialType);
  const [storeId, setStoreId] = useState<string>(selectedStore ? String(selectedStore.id) : '');
  const [selectedProducts, setSelectedProducts] = useState<string[]>([]);
  const [otherProduct, setOtherProduct] = useState('');
  const [shipmentDetails, setShipmentDetails] = useState('');
  const [restockDate, setRestockDate] = useState(new Date().toISOString().slice(0, 10));
  const [quantityDesc, setQuantityDesc] = useState('');
  const [reporter, setReporter] = useState('');
  const [source, setSource] = useState('community');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // When switching tabs, clear store selection unless it matches
  useEffect(() => {
    const current = stores.find(s => String(s.id) === storeId);
    if (current && current.store_type !== restockType.replace('instore', 'retail')) {
      setStoreId('');
    }
    setSource(restockType === 'online' ? 'website' : 'community');
  }, [restockType]);

  const filteredStores = stores.filter(s =>
    restockType === 'online' ? s.store_type === 'online' : s.store_type === 'retail'
  );

  const toggleProduct = (p: string) => {
    setSelectedProducts(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!storeId) { setError('Select a store.'); return; }

    const allProducts = [...selectedProducts];
    if (allProducts.includes('Other') && otherProduct.trim()) {
      allProducts.splice(allProducts.indexOf('Other'), 1, otherProduct.trim());
    }
    if (allProducts.length === 0) { setError('Select at least one product.'); return; }

    const details = [
      shipmentDetails,
      restockType === 'online' && url ? `URL: ${url}` : '',
    ].filter(Boolean).join(' | ');

    setSubmitting(true);
    const res = await fetch('/api/restocks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        store_id: parseInt(storeId),
        reporter: reporter || 'Anonymous',
        products: allProducts.join(', '),
        shipment_details: details || null,
        restock_date: restockDate,
        quantity_desc: quantityDesc || null,
        source,
        restock_type: restockType,
      }),
    });
    setSubmitting(false);

    if (res.ok) {
      onSubmitted();
    } else {
      const d = await res.json();
      setError(d.error || 'Failed to submit.');
    }
  };

  const sourceOptions = restockType === 'online' ? ONLINE_SOURCES : INSTORE_SOURCES;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #2e3347', flexShrink: 0,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#e8eaf0' }}>➕ Report Restock</div>
        <button onClick={onCancel}
          style={{ background: 'none', border: 'none', color: '#8b91a8', cursor: 'pointer', fontSize: 12 }}>
          ← Back
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: '14px' }}>
        {/* In-Store vs Online toggle */}
        <div style={{ background: '#242736', borderRadius: 10, padding: 3, display: 'flex', marginBottom: 14 }}>
          <TypeBtn active={restockType === 'instore'} onClick={() => setRestockType('instore')}>
            🏪 In-Store
          </TypeBtn>
          <TypeBtn active={restockType === 'online'} onClick={() => setRestockType('online')}>
            🌐 Online Drop
          </TypeBtn>
        </div>

        {/* Context hint */}
        <div style={{ background: '#1e2133', borderRadius: 8, padding: '7px 10px', marginBottom: 12,
          fontSize: 11, color: '#8b91a8', lineHeight: 1.5,
          borderLeft: `3px solid ${restockType === 'online' ? '#3b9eff' : '#2ecc71'}` }}>
          {restockType === 'instore'
            ? '🏪 Physical store restock — shelves, pegs, backstock. Include truck days, quantity, shipment intel.'
            : '🌐 Online drop — website went live, bot fired, email drop, etc. Include URL if possible.'}
        </div>

        {/* Store */}
        <Label>Store *</Label>
        <select value={storeId} onChange={e => setStoreId(e.target.value)} style={selectStyle} required>
          <option value="">Select {restockType === 'online' ? 'retailer' : 'store'}...</option>
          {filteredStores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>

        {/* Date */}
        <Label>Date *</Label>
        <input type="date" value={restockDate} onChange={e => setRestockDate(e.target.value)}
          style={inputStyle} required />

        {/* Products */}
        <Label>Products * <span style={{ fontWeight: 400, color: '#8b91a8', fontSize: 10 }}>(select all that apply)</span></Label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
          {PRODUCTS.map(p => (
            <button key={p} type="button" onClick={() => toggleProduct(p)}
              style={{
                padding: '4px 9px', borderRadius: 6, border: 'none', cursor: 'pointer',
                fontSize: 10, fontWeight: 500,
                background: selectedProducts.includes(p) ? '#e63946' : '#242736',
                color: selectedProducts.includes(p) ? 'white' : '#8b91a8',
              }}>
              {p}
            </button>
          ))}
        </div>
        {selectedProducts.includes('Other') && (
          <input placeholder="Product name..." value={otherProduct}
            onChange={e => setOtherProduct(e.target.value)} style={{ ...inputStyle, marginTop: -6 }} />
        )}

        {/* Quantity */}
        <Label>Quantity / Notes</Label>
        <input
          placeholder={restockType === 'instore'
            ? 'e.g. ~20 ETBs, 3 booster boxes, 1 peg...'
            : 'e.g. Limited qty, sold out in 4 min...'}
          value={quantityDesc} onChange={e => setQuantityDesc(e.target.value)} style={inputStyle} />

        {/* URL (online only) */}
        {restockType === 'online' && (
          <>
            <Label>Drop URL</Label>
            <input placeholder="https://www.target.com/p/..." value={url}
              onChange={e => setUrl(e.target.value)} style={inputStyle} />
          </>
        )}

        {/* Shipment / intel */}
        <Label>
          {restockType === 'instore' ? 'Shipment Intel' : 'Drop Details'}
          <span style={{ fontWeight: 400, color: '#8b91a8', fontSize: 10, marginLeft: 4 }}>(optional)</span>
        </Label>
        <textarea
          placeholder={restockType === 'instore'
            ? 'Truck arrives Tuesdays, manifest info, employee tip, tracking...'
            : 'Bot that caught it, how long it lasted, any patterns noticed...'}
          value={shipmentDetails} onChange={e => setShipmentDetails(e.target.value)}
          rows={2} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />

        {/* Source */}
        <Label>Source</Label>
        <select value={source} onChange={e => setSource(e.target.value)} style={selectStyle}>
          {sourceOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>

        {/* Reporter */}
        <Label>Your Handle</Label>
        <input placeholder="Anonymous" value={reporter}
          onChange={e => setReporter(e.target.value)} style={inputStyle} />

        {error && (
          <div style={{ background: '#2a1515', border: '1px solid #e63946', borderRadius: 8,
            padding: '7px 10px', fontSize: 11, color: '#e63946', marginBottom: 10 }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={submitting}
          style={{
            width: '100%', padding: '11px', borderRadius: 10, border: 'none',
            cursor: submitting ? 'not-allowed' : 'pointer',
            background: submitting ? '#4a4f6a' : restockType === 'online' ? '#3b9eff' : '#e63946',
            color: 'white', fontSize: 13, fontWeight: 700,
          }}>
          {submitting ? 'Submitting...' : restockType === 'online' ? '🌐 Report Online Drop' : '🏪 Report In-Store Restock'}
        </button>
      </form>
    </div>
  );
}

function TypeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      style={{
        flex: 1, padding: '7px 0', borderRadius: 8, border: 'none', cursor: 'pointer',
        fontSize: 12, fontWeight: 700,
        background: active ? '#e63946' : 'transparent',
        color: active ? 'white' : '#8b91a8',
      }}>
      {children}
    </button>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 700, color: '#8b91a8', marginBottom: 5,
      textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '7px 10px', borderRadius: 8,
  background: '#242736', border: '1px solid #2e3347',
  color: '#e8eaf0', fontSize: 12, marginBottom: 11, outline: 'none',
};

const selectStyle: React.CSSProperties = { ...inputStyle };

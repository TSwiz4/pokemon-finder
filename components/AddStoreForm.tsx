'use client';

import { useState } from 'react';

const CHAINS = [
  { value: 'target',        label: '🎯 Target' },
  { value: 'walmart',       label: '🛒 Walmart' },
  { value: 'bestbuy',       label: '🔵 Best Buy' },
  { value: 'gamestop',      label: '🎮 GameStop' },
  { value: 'walgreens',     label: '💊 Walgreens' },
  { value: 'cvs',           label: '💊 CVS' },
  { value: 'thorntons',     label: "⛽ Thornton's" },
  { value: 'dollargeneral', label: '💲 Dollar General' },
  { value: 'barnesnoble',   label: '📚 Barnes & Noble' },
  { value: 'costco',        label: '📦 Costco' },
  { value: 'other',         label: '🏪 Other' },
];

interface Props {
  onAdded: () => void;
  onCancel: () => void;
}

export default function AddStoreForm({ onAdded, onCancel }: Props) {
  const [name, setName] = useState('');
  const [chain, setChain] = useState('target');
  const [address, setAddress] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [geoLoading, setGeoLoading] = useState(false);

  const geocodeAddress = async () => {
    if (!address.trim()) { setError('Enter an address first.'); return; }
    setGeoLoading(true);
    setError('');
    try {
      const encoded = encodeURIComponent(address);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`);
      const data = await res.json();
      if (data.length > 0) {
        setLat(parseFloat(data[0].lat).toFixed(6));
        setLng(parseFloat(data[0].lon).toFixed(6));
      } else {
        setError('Address not found. Try being more specific or enter coordinates manually.');
      }
    } catch {
      setError('Geocoding failed. Enter coordinates manually.');
    }
    setGeoLoading(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name || !chain || !address || !lat || !lng) {
      setError('All fields are required.');
      return;
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || isNaN(lngNum)) {
      setError('Invalid coordinates.');
      return;
    }

    setSubmitting(true);
    const res = await fetch('/api/stores', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, chain, address, lat: latNum, lng: lngNum }),
    });

    setSubmitting(false);
    if (res.ok) {
      onAdded();
    } else {
      const data = await res.json();
      setError(data.error || 'Failed to add store.');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: '1px solid #2e3347', flexShrink: 0,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#e8eaf0' }}>📍 Add Store</div>
        <button onClick={onCancel}
          style={{ background: 'none', border: 'none', color: '#8b91a8', cursor: 'pointer', fontSize: 13 }}>
          ← Back
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        <div style={{ fontSize: 12, color: '#8b91a8', marginBottom: 16, lineHeight: 1.5 }}>
          Add a local retail store to the tracker. Once added, anyone can report restocks there.
        </div>

        <Label>Chain *</Label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
          {CHAINS.map(c => (
            <button key={c.value} type="button" onClick={() => setChain(c.value)}
              style={{
                padding: '5px 12px', borderRadius: 7, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 500,
                background: chain === c.value ? '#e63946' : '#242736',
                color: chain === c.value ? 'white' : '#8b91a8',
              }}>
              {c.label}
            </button>
          ))}
        </div>

        <Label>Store Name *</Label>
        <input
          placeholder={`e.g. Target - Schaumburg`}
          value={name} onChange={e => setName(e.target.value)}
          style={inputStyle} required
        />

        <Label>Address *</Label>
        <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
          <input
            placeholder="123 Main St, City, IL"
            value={address} onChange={e => setAddress(e.target.value)}
            style={{ ...inputStyle, marginBottom: 0, flex: 1 }}
            required
          />
          <button type="button" onClick={geocodeAddress} disabled={geoLoading}
            style={{
              padding: '8px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
              background: '#242736', color: '#8b91a8', fontSize: 12, flexShrink: 0,
            }}>
            {geoLoading ? '...' : '📍'}
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 12 }}>
          Click 📍 to auto-fill coordinates from address, or enter manually below.
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <div style={{ flex: 1 }}>
            <Label>Latitude *</Label>
            <input placeholder="41.8781" value={lat} onChange={e => setLat(e.target.value)}
              style={{ ...inputStyle, marginBottom: 0 }} required />
          </div>
          <div style={{ flex: 1 }}>
            <Label>Longitude *</Label>
            <input placeholder="-87.6298" value={lng} onChange={e => setLng(e.target.value)}
              style={{ ...inputStyle, marginBottom: 0 }} required />
          </div>
        </div>

        {error && (
          <div style={{ background: '#2a1515', border: '1px solid #e63946', borderRadius: 8,
            padding: '8px 12px', fontSize: 12, color: '#e63946', marginBottom: 12 }}>
            {error}
          </div>
        )}

        <button type="submit" disabled={submitting}
          style={{
            width: '100%', padding: '12px', borderRadius: 10, border: 'none',
            cursor: submitting ? 'not-allowed' : 'pointer',
            background: submitting ? '#4a4f6a' : '#e63946',
            color: 'white', fontSize: 14, fontWeight: 700,
          }}>
          {submitting ? 'Adding...' : '📍 Add to Map'}
        </button>
      </form>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: '#8b91a8', marginBottom: 5,
      textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 8,
  background: '#242736', border: '1px solid #2e3347',
  color: '#e8eaf0', fontSize: 12, marginBottom: 12, outline: 'none',
};

'use client';

import { useEffect, useState } from 'react';
import type { Store } from '@/app/page';

interface Pattern {
  id: number;
  store_id: number;
  reporter: string;
  truck_days: string | null;
  stock_time: string | null;
  employee_friendly: number;
  notes: string | null;
  confidence: number;
  upvotes: number;
  created_at: string;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT: Record<string, string> = {
  Monday: 'Mon', Tuesday: 'Tue', Wednesday: 'Wed', Thursday: 'Thu',
  Friday: 'Fri', Saturday: 'Sat', Sunday: 'Sun',
};

const CONFIDENCE_LABELS = ['', 'Unverified', 'Seen once', 'Seen 2–3x', 'Consistent pattern', 'Rock solid'];
const CONFIDENCE_COLORS = ['', '#6b7280', '#f39c12', '#e67e22', '#2ecc71', '#00ff88'];

interface Props {
  store: Store;
  onClose: () => void;
}

export default function StoreIntel({ store, onClose }: Props) {
  const [patterns, setPatterns] = useState<Pattern[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  // Form state
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [stockTime, setStockTime] = useState('');
  const [employeeFriendly, setEmployeeFriendly] = useState(false);
  const [notes, setNotes] = useState('');
  const [confidence, setConfidence] = useState(2);
  const [reporter, setReporter] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch(`/api/stores/${store.id}/patterns`)
      .then(r => r.json())
      .then(data => { setPatterns(data); setLoading(false); });
  }, [store.id]);

  const toggleDay = (day: string) =>
    setSelectedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!selectedDays.length && !stockTime && !notes) {
      setError('Add at least one piece of intel.');
      return;
    }
    setSubmitting(true);
    const res = await fetch(`/api/stores/${store.id}/patterns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        reporter: reporter || 'Anonymous',
        truck_days: selectedDays.join(', ') || null,
        stock_time: stockTime || null,
        employee_friendly: employeeFriendly,
        notes: notes || null,
        confidence,
      }),
    });
    setSubmitting(false);
    if (res.ok) {
      const data = await res.json();
      setPatterns(prev => [data, ...prev]);
      setShowForm(false);
      setSelectedDays([]); setStockTime(''); setNotes(''); setReporter('');
      setEmployeeFriendly(false); setConfidence(2);
    } else {
      const d = await res.json();
      setError(d.error || 'Failed to submit.');
    }
  };

  const handleUpvote = async (p: Pattern) => {
    const res = await fetch(`/api/stores/${store.id}/patterns/${p.id}/upvote`, { method: 'POST' });
    if (res.ok) {
      const { upvotes } = await res.json();
      setPatterns(prev => prev.map(x => x.id === p.id ? { ...x, upvotes } : x));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #2e3347', flexShrink: 0,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#e8eaf0' }}>🕵️ Store Intel</div>
          <div style={{ fontSize: 11, color: '#8b91a8', marginTop: 1 }}>{store.name}</div>
        </div>
        <button onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#8b91a8', cursor: 'pointer', fontSize: 13 }}>
          ← Back
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        {/* Add intel button */}
        {!showForm && (
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #2e3347' }}>
            <button onClick={() => setShowForm(true)} style={{
              width: '100%', padding: '8px', borderRadius: 8, border: '1px dashed #2e3347',
              cursor: 'pointer', background: 'transparent',
              color: '#8b91a8', fontSize: 12, fontWeight: 600,
            }}>
              + Add Your Intel About This Store
            </button>
          </div>
        )}

        {/* Submit form */}
        {showForm && (
          <form onSubmit={handleSubmit} style={{ padding: '12px 14px', borderBottom: '1px solid #2e3347' }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#e8eaf0', marginBottom: 10 }}>
              Share what you know about this store
            </div>

            <Label>Truck / Delivery Days</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 12 }}>
              {DAYS.map(day => (
                <button key={day} type="button" onClick={() => toggleDay(day)} style={{
                  padding: '4px 9px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 11, fontWeight: 600,
                  background: selectedDays.includes(day) ? '#e63946' : '#242736',
                  color: selectedDays.includes(day) ? 'white' : '#8b91a8',
                }}>
                  {DAY_SHORT[day]}
                </button>
              ))}
            </div>

            <Label>When stock hits shelves</Label>
            <input placeholder="e.g. Friday at open (~8am), Friday afternoon..."
              value={stockTime} onChange={e => setStockTime(e.target.value)}
              style={inputStyle} />

            <Label>Notes / Intel</Label>
            <textarea
              placeholder="e.g. Employees will tell you if they have product in back. Lock case at front of store. Best to come right at open on Fridays..."
              value={notes} onChange={e => setNotes(e.target.value)}
              rows={3} style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />

            <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={employeeFriendly}
                  onChange={e => setEmployeeFriendly(e.target.checked)} />
                <span style={{ fontSize: 11, color: '#8b91a8' }}>Employees are helpful / will check stock</span>
              </label>
            </div>

            <Label>Confidence Level</Label>
            <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
              {[1, 2, 3, 4, 5].map(n => (
                <button key={n} type="button" onClick={() => setConfidence(n)} style={{
                  flex: 1, padding: '5px 4px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  fontSize: 10, fontWeight: 700,
                  background: confidence === n ? CONFIDENCE_COLORS[n] : '#242736',
                  color: confidence === n ? '#000' : '#6b7280',
                }}>
                  {n}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 10, color: CONFIDENCE_COLORS[confidence], marginBottom: 12, marginTop: -8 }}>
              {CONFIDENCE_LABELS[confidence]}
            </div>

            <Label>Your Handle</Label>
            <input placeholder="Anonymous" value={reporter}
              onChange={e => setReporter(e.target.value)} style={inputStyle} />

            {error && (
              <div style={{ background: '#2a1515', border: '1px solid #e63946', borderRadius: 7,
                padding: '6px 10px', fontSize: 11, color: '#e63946', marginBottom: 10 }}>
                {error}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button type="submit" disabled={submitting} style={{
                flex: 1, padding: '9px', borderRadius: 8, border: 'none',
                cursor: submitting ? 'not-allowed' : 'pointer',
                background: submitting ? '#4a4f6a' : '#e63946',
                color: 'white', fontSize: 12, fontWeight: 700,
              }}>
                {submitting ? 'Saving...' : '🕵️ Submit Intel'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} style={{
                padding: '9px 14px', borderRadius: 8, border: 'none', cursor: 'pointer',
                background: '#242736', color: '#8b91a8', fontSize: 12,
              }}>
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Existing patterns */}
        {loading ? (
          <div style={{ padding: 20, textAlign: 'center', color: '#8b91a8', fontSize: 12 }}>Loading...</div>
        ) : patterns.length === 0 && !showForm ? (
          <div style={{ padding: 24, textAlign: 'center', color: '#8b91a8', fontSize: 12, lineHeight: 1.6 }}>
            No intel yet for this store.<br />
            <span style={{ fontSize: 11 }}>You know it best — add what you've observed.</span>
          </div>
        ) : (
          patterns.map(p => <PatternCard key={p.id} pattern={p} onUpvote={() => handleUpvote(p)} />)
        )}
      </div>
    </div>
  );
}

function PatternCard({ pattern, onUpvote }: { pattern: Pattern; onUpvote: () => void }) {
  const days = pattern.truck_days?.split(',').map(d => d.trim()).filter(Boolean) ?? [];
  const conf = Math.min(5, Math.max(1, pattern.confidence));

  return (
    <div style={{ padding: '12px 14px', borderBottom: '1px solid #2e3347' }} className="fade-in">
      {/* Confidence + upvote row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'flex', gap: 2 }}>
            {[1,2,3,4,5].map(n => (
              <div key={n} style={{
                width: 6, height: 6, borderRadius: '50%',
                background: n <= conf ? CONFIDENCE_COLORS[conf] : '#2e3347',
              }} />
            ))}
          </div>
          <span style={{ fontSize: 10, color: CONFIDENCE_COLORS[conf], fontWeight: 700 }}>
            {CONFIDENCE_LABELS[conf]}
          </span>
        </div>
        <button onClick={onUpvote} style={{
          background: '#242736', border: 'none', cursor: 'pointer',
          borderRadius: 5, padding: '2px 8px', fontSize: 10, color: '#8b91a8',
        }}>
          👍 {pattern.upvotes}
        </button>
      </div>

      {/* Truck days */}
      {days.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: '#6b7280', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.05em', marginRight: 6 }}>Truck days:</span>
          {days.map(d => (
            <span key={d} style={{ background: '#242736', color: '#e8eaf0',
              padding: '2px 7px', borderRadius: 5, fontSize: 10, fontWeight: 600,
              marginRight: 4, display: 'inline-block' }}>
              {d}
            </span>
          ))}
        </div>
      )}

      {/* Stock time */}
      {pattern.stock_time && (
        <div style={{ fontSize: 11, color: '#c8d0e8', marginBottom: 6 }}>
          🕐 <span style={{ color: '#f39c12', fontWeight: 600 }}>{pattern.stock_time}</span>
        </div>
      )}

      {/* Employee friendly */}
      {pattern.employee_friendly === 1 && (
        <div style={{ fontSize: 10, color: '#2ecc71', marginBottom: 6 }}>
          ✅ Employees will check stock / helpful
        </div>
      )}

      {/* Notes */}
      {pattern.notes && (
        <div style={{ background: '#1e2133', borderLeft: '2px solid #f39c12',
          borderRadius: '0 6px 6px 0', padding: '6px 10px',
          fontSize: 11, color: '#c8d0e8', lineHeight: 1.5, marginBottom: 6 }}>
          {pattern.notes}
        </div>
      )}

      <div style={{ fontSize: 10, color: '#6b7280' }}>
        by {pattern.reporter} · {new Date(pattern.created_at).toLocaleDateString()}
      </div>
    </div>
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

'use client';

import { useState, useEffect, useCallback } from 'react';

interface User {
  id: number;
  username: string;
  role: 'admin' | 'friend';
  active: number;
  created_at: string;
  last_login_at: string | null;
}

interface Activity {
  id: number;
  user_id: number | null;
  username: string | null;
  action: string;
  detail: string | null;
  ip: string | null;
  created_at: string;
}

type Tab = 'users' | 'activity';

export default function AdminPanel({ currentUserId, onClose }: { currentUserId: number; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>('users');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid #2e3347' }}>
        <span style={{ fontWeight: 600, color: '#e8eaf0', fontSize: 14 }}>🛠 Admin</span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={closeBtn}>✕</button>
      </div>

      <div style={{ display: 'flex', gap: 6, padding: '10px 14px' }}>
        {(['users', 'activity'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} style={{
            ...tabBtn,
            background: tab === t ? '#e63946' : '#242736',
            color: tab === t ? 'white' : '#8b91a8',
          }}>
            {t === 'users' ? 'Logins' : 'Activity'}
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 14px 14px' }}>
        {tab === 'users' ? <UsersTab currentUserId={currentUserId} /> : <ActivityTab />}
      </div>
    </div>
  );
}

function UsersTab({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<User[]>([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'friend' | 'admin'>('friend');
  const [error, setError] = useState('');

  // Per-user activity popup
  const [activityFor, setActivityFor] = useState<User | null>(null);
  const [acts, setActs] = useState<Activity[]>([]);
  const [actsLoading, setActsLoading] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/admin/users');
    if (res.ok) setUsers(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function openActivity(u: User) {
    setActivityFor(u);
    setActs([]);
    setActsLoading(true);
    const res = await fetch(`/api/admin/activity?user_id=${u.id}`);
    setActs(res.ok ? await res.json() : []);
    setActsLoading(false);
  }

  async function addUser(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const res = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role }),
    });
    if (res.ok) {
      setUsername(''); setPassword(''); setRole('friend');
      load();
    } else {
      const d = await res.json().catch(() => ({}));
      setError(d.error || 'Failed to add user');
    }
  }

  async function removeUser(id: number, name: string) {
    if (!confirm(`Delete login "${name}"? They'll be logged out immediately.`)) return;
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
    if (res.ok) load();
    else { const d = await res.json().catch(() => ({})); alert(d.error || 'Failed'); }
  }

  async function toggleActive(u: User) {
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: u.active ? 0 : 1 }),
    });
    if (res.ok) load();
  }

  async function resetPassword(u: User) {
    const pw = prompt(`New password for "${u.username}":`);
    if (!pw) return;
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) alert('Password updated. They must log in again.');
  }

  return (
    <div>
      <form onSubmit={addUser} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        <div style={sectionLabel}>Add login</div>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" style={input} />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="text" style={input} />
        <select value={role} onChange={(e) => setRole(e.target.value as 'friend' | 'admin')} style={input}>
          <option value="friend">Friend (SKUs + map only)</option>
          <option value="admin">Admin (full access)</option>
        </select>
        {error && <div style={{ color: '#ff6b6b', fontSize: 12 }}>{error}</div>}
        <button type="submit" style={primaryBtn}>+ Add login</button>
      </form>

      <div style={sectionLabel}>Logins ({users.length})</div>
      {users.map((u) => (
        <div key={u.id} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, color: '#e8eaf0', fontSize: 13 }}>{u.username}</span>
            <span style={{
              fontSize: 9, padding: '1px 6px', borderRadius: 99, fontWeight: 700,
              background: u.role === 'admin' ? '#e63946' : '#2f6f4f', color: 'white',
            }}>{u.role.toUpperCase()}</span>
            {!u.active && <span style={{ fontSize: 10, color: '#ff9b3d' }}>disabled</span>}
            {u.id === currentUserId && <span style={{ fontSize: 10, color: '#8b91a8' }}>(you)</span>}
          </div>
          <div style={{ fontSize: 11, color: '#8b91a8', marginTop: 3 }}>
            Last login: {u.last_login_at ? new Date(u.last_login_at + 'Z').toLocaleString() : 'never'}
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
            <button onClick={() => openActivity(u)} style={miniBtn}>📊 Activity</button>
            {u.id !== currentUserId && (
              <>
                <button onClick={() => toggleActive(u)} style={miniBtn}>{u.active ? 'Disable' : 'Enable'}</button>
                <button onClick={() => resetPassword(u)} style={miniBtn}>Reset PW</button>
                <button onClick={() => removeUser(u.id, u.username)} style={{ ...miniBtn, color: '#ff6b6b' }}>Delete</button>
              </>
            )}
          </div>
        </div>
      ))}

      {/* Per-user activity popup */}
      {activityFor && (
        <div
          onClick={() => setActivityFor(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="fade-in"
            style={{
              width: 360, maxHeight: '70vh', display: 'flex', flexDirection: 'column',
              background: '#1a1d27', border: '1px solid #2e3347', borderRadius: 14,
              boxShadow: '0 12px 40px rgba(0,0,0,0.6)', overflow: 'hidden',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', padding: '12px 14px', borderBottom: '1px solid #2e3347' }}>
              <div>
                <div style={{ fontWeight: 700, color: '#e8eaf0', fontSize: 14 }}>{activityFor.username}</div>
                <div style={{ fontSize: 10, color: '#8b91a8' }}>
                  Last login: {activityFor.last_login_at ? new Date(activityFor.last_login_at + 'Z').toLocaleString() : 'never'}
                </div>
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={() => setActivityFor(null)} style={closeBtn}>✕</button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 14px' }}>
              {actsLoading ? (
                <div style={{ color: '#8b91a8', fontSize: 12, textAlign: 'center', padding: 16 }}>Loading…</div>
              ) : acts.length === 0 ? (
                <div style={{ color: '#8b91a8', fontSize: 12, textAlign: 'center', padding: 16 }}>
                  No activity recorded for this login yet.
                </div>
              ) : (
                acts.map((a) => (
                  <div key={a.id} style={{ ...card, marginBottom: 6 }}>
                    <span style={{ fontSize: 12, color: actionColor(a.action), fontWeight: 600 }}>{a.action}</span>
                    {a.detail && <span style={{ fontSize: 11, color: '#b9bfd0' }}> · {a.detail}</span>}
                    <div style={{ fontSize: 10, color: '#8b91a8', marginTop: 2 }}>
                      {new Date(a.created_at + 'Z').toLocaleString()}{a.ip && a.ip !== 'unknown' ? ` · ${a.ip}` : ''}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityTab() {
  const [rows, setRows] = useState<Activity[]>([]);
  useEffect(() => {
    fetch('/api/admin/activity').then((r) => r.ok ? r.json() : []).then(setRows);
  }, []);

  return (
    <div>
      <div style={sectionLabel}>Recent activity</div>
      {rows.length === 0 && <div style={{ color: '#8b91a8', fontSize: 12 }}>No activity yet.</div>}
      {rows.map((a) => (
        <div key={a.id} style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, color: '#e8eaf0', fontSize: 12 }}>{a.username || 'unknown'}</span>
            <span style={{ fontSize: 11, color: actionColor(a.action) }}>{a.action}</span>
          </div>
          {a.detail && <div style={{ fontSize: 11, color: '#b9bfd0' }}>{a.detail}</div>}
          <div style={{ fontSize: 10, color: '#8b91a8', marginTop: 2 }}>
            {new Date(a.created_at + 'Z').toLocaleString()}{a.ip && a.ip !== 'unknown' ? ` · ${a.ip}` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

function actionColor(action: string): string {
  if (action === 'login_failed') return '#ff6b6b';
  if (action === 'login') return '#5bd6a0';
  if (action.startsWith('delete')) return '#ff9b3d';
  return '#8b91a8';
}

const closeBtn: React.CSSProperties = { background: '#242736', color: '#8b91a8', border: 'none', cursor: 'pointer', padding: '4px 9px', borderRadius: 7, fontSize: 12 };
const tabBtn: React.CSSProperties = { padding: '5px 12px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 500 };
const sectionLabel: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: '#8b91a8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '8px 0' };
const input: React.CSSProperties = { padding: '8px 10px', borderRadius: 7, border: '1px solid #2e3347', background: '#242736', color: '#e8eaf0', fontSize: 13, outline: 'none' };
const primaryBtn: React.CSSProperties = { padding: '8px', borderRadius: 7, border: 'none', cursor: 'pointer', background: '#e63946', color: 'white', fontWeight: 600, fontSize: 13 };
const card: React.CSSProperties = { background: '#242736', border: '1px solid #2e3347', borderRadius: 9, padding: '9px 11px', marginBottom: 8 };
const miniBtn: React.CSSProperties = { padding: '4px 9px', borderRadius: 6, border: '1px solid #2e3347', background: '#1a1d27', color: '#b9bfd0', cursor: 'pointer', fontSize: 11 };

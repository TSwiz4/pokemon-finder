'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      if (res.ok) {
        router.replace('/');
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Login failed');
        setBusy(false);
      }
    } catch {
      setError('Network error');
      setBusy(false);
    }
  }

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: '#0f1117',
    }}>
      <form onSubmit={handleSubmit} style={{
        width: 320, background: '#1a1d27', border: '1px solid #2e3347',
        borderRadius: 14, padding: 28, display: 'flex', flexDirection: 'column', gap: 14,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 24 }}>⚡</span>
          <span style={{ fontWeight: 700, fontSize: 18, color: '#e8eaf0' }}>PokemonFinder</span>
        </div>
        <div style={{ textAlign: 'center', color: '#8b91a8', fontSize: 12, marginBottom: 8 }}>
          Sign in to continue
        </div>

        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
          autoFocus
          autoComplete="username"
          style={inputStyle}
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoComplete="current-password"
          style={inputStyle}
        />

        {error && <div style={{ color: '#ff6b6b', fontSize: 12, textAlign: 'center' }}>{error}</div>}

        <button type="submit" disabled={busy} style={{
          padding: '10px', borderRadius: 8, border: 'none', cursor: busy ? 'default' : 'pointer',
          background: busy ? '#7a2530' : '#e63946', color: 'white', fontWeight: 600, fontSize: 14,
        }}>
          {busy ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: '10px 12px', borderRadius: 8, border: '1px solid #2e3347',
  background: '#242736', color: '#e8eaf0', fontSize: 14, outline: 'none',
};

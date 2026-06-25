// Session + authorization helpers. Database-backed sessions (revocable, and they
// power the admin activity log). Cookie is httpOnly; `secure` only in production so
// it works over http://localhost during dev and over https on a server with no change.
import { cookies } from 'next/headers';
import getDb from './db';
import { verifyPassword, randomToken } from './crypto';

export const SESSION_COOKIE = 'pf_session';
const SESSION_DAYS = 30;

export interface SessionUser {
  id: number;
  username: string;
  role: 'admin' | 'friend';
}

interface UserRow {
  id: number;
  username: string;
  role: 'admin' | 'friend';
  active: number;
  password_hash: string;
}

// Verify credentials (does NOT create a session). Returns the user or null.
export function authenticate(username: string, password: string): SessionUser | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username) as UserRow | undefined;
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(row.id);
  return { id: row.id, username: row.username, role: row.role };
}

// Create a DB session and set the cookie. Call from a Route Handler.
export async function createSession(userId: number): Promise<void> {
  const db = getDb();
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .run(token, userId, expires.toISOString());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    expires,
  });
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) getDb().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  store.delete(SESSION_COOKIE);
}

// Resolve the logged-in user from the session cookie (secure check against DB).
export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const db = getDb();
  const row = db.prepare(`
    SELECT u.id, u.username, u.role, u.active, s.expires_at
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token) as (UserRow & { expires_at: string }) | undefined;

  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  if (!row.active) return null;
  return { id: row.id, username: row.username, role: row.role };
}

// Returns the admin user or null. Use at the top of every admin Route Handler.
export async function requireAdmin(): Promise<SessionUser | null> {
  const user = await getCurrentUser();
  return user && user.role === 'admin' ? user : null;
}

export function logActivity(opts: {
  userId?: number | null;
  username?: string | null;
  action: string;
  detail?: string | null;
  ip?: string | null;
}): void {
  getDb().prepare(
    'INSERT INTO activity_log (user_id, username, action, detail, ip) VALUES (?, ?, ?, ?, ?)'
  ).run(opts.userId ?? null, opts.username ?? null, opts.action, opts.detail ?? null, opts.ip ?? null);
}

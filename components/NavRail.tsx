'use client';

export type NavKey = 'inventory' | 'finder' | 'online' | 'xfeed' | 'fills' | 'sniper' | 'admin';

interface NavItem {
  key: NavKey;
  glyph: string;
  label: string;
  adminOnly?: boolean;
}

const ITEMS: NavItem[] = [
  { key: 'inventory', glyph: '🗺',  label: 'Stock' },
  { key: 'finder',    glyph: '🔎', label: 'Finder' },
  { key: 'online',    glyph: '🌐', label: 'Online' },
  { key: 'xfeed',     glyph: '𝕏',  label: 'Feed' },
  { key: 'fills',     glyph: '🔔', label: 'Fills' },
  { key: 'sniper',    glyph: '🎯', label: 'Sniper', adminOnly: true },
  { key: 'admin',     glyph: '🛠', label: 'Admin', adminOnly: true },
];

interface Props {
  active: NavKey | null;
  isAdmin: boolean;
  xUnread: number;
  username?: string;
  onSelect: (key: NavKey) => void;
  onLogout: () => void;
}

export default function NavRail({ active, isAdmin, xUnread, username, onSelect, onLogout }: Props) {
  const items = ITEMS.filter((i) => !i.adminOnly || isAdmin);

  return (
    <nav className="navrail">
      {/* Brand */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, marginBottom: 10 }}>
        <div style={{
          width: 38, height: 38, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 20, background: 'linear-gradient(135deg, #e63946 0%, #b21e2b 100%)',
          boxShadow: '0 4px 14px rgba(230,57,70,0.4)',
        }}>⚡</div>
        <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.12em', color: '#6b7280' }}>FINDER</span>
      </div>

      {/* Nav items */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, width: '100%', alignItems: 'center' }}>
        {items.map((item) => (
          <button
            key={item.key}
            className={`navrail-item${active === item.key ? ' active' : ''}`}
            onClick={() => onSelect(item.key)}
            title={item.label}
          >
            <span className="glyph">{item.glyph}</span>
            <span>{item.label}</span>
            {item.key === 'xfeed' && xUnread > 0 && (
              <span className="navrail-badge">{xUnread > 99 ? '99+' : xUnread}</span>
            )}
          </button>
        ))}
      </div>

      {/* User + logout */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, marginTop: 8 }}>
        {username && (
          <div title={username} style={{
            width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: '#242736', border: '1px solid #2e3347', color: '#c8d0e8', fontSize: 13, fontWeight: 800,
          }}>
            {username.charAt(0).toUpperCase()}
          </div>
        )}
        <button onClick={onLogout} title="Log out" className="navrail-item" style={{ paddingTop: 6, paddingBottom: 6 }}>
          <span className="glyph" style={{ fontSize: 16 }}>⏏</span>
          <span>Out</span>
        </button>
      </div>
    </nav>
  );
}

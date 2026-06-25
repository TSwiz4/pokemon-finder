'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { Restock, Store } from '@/app/page';
import type { XPost } from '@/app/api/x-feed/route';
import InventoryPanel from '@/components/InventoryPanel';

const ONLINE_CHAINS: Record<string, { emoji: string; color: string }> = {
  pokemoncenter: { emoji: '⚡', color: '#f4c430' },
  target:        { emoji: '🎯', color: '#cc0000' },
  walmart:       { emoji: '🛒', color: '#0071ce' },
  bestbuy:       { emoji: '💻', color: '#1a56ff' },
  gamestop:      { emoji: '🎮', color: '#8b0000' },
  walgreens:     { emoji: '💊', color: '#e4002b' },
  cvs:           { emoji: '💊', color: '#cc0000' },
  thorntons:     { emoji: '⛽', color: '#e2231a' },
  dollargeneral: { emoji: '💲', color: '#fbb612' },
  barnesnoble:   { emoji: '📚', color: '#0a4d2e' },
  amazon:        { emoji: '📦', color: '#ff9900' },
  tcgplayer:     { emoji: '🃏', color: '#1e90ff' },
  ebay:          { emoji: '🔴', color: '#e53238' },
  costco:        { emoji: '📦', color: '#005daa' },
  samsclub:      { emoji: '🏪', color: '#0067a0' },
  fivebelow:     { emoji: '5️⃣', color: '#6a0dad' },
  default:       { emoji: '🌐', color: '#8b91a8' },
};

const X_ACCOUNTS = [
  'PokeTCGAlerts',
  'PokeAlerts_',
  'PokemonRestocks',
  'TCGTracker',
  'PokemonDealsTCG',
  'PokemonDealsX',
];

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;
const X_STORAGE_KEY = 'pf_xposts';
const X_SEEN_KEY = 'pf_xseen'; // timestamp when user last viewed X tab
const X_REFRESH_INTERVAL = 2 * 60 * 1000; // re-fetch every 2 min (live)

function getOnlineChain(chain: string) {
  return ONLINE_CHAINS[chain.toLowerCase()] ?? ONLINE_CHAINS.default;
}

// Load cached X posts from localStorage, dropping anything older than 4h
function loadCachedPosts(): XPost[] {
  try {
    const raw = localStorage.getItem(X_STORAGE_KEY);
    if (!raw) return [];
    const posts: (XPost & { fetched_at: number })[] = JSON.parse(raw);
    const cutoff = Date.now() - FOUR_HOURS_MS;
    return posts.filter(p => p.fetched_at > cutoff);
  } catch {
    return [];
  }
}

function savePosts(posts: XPost[]) {
  try {
    const stamped = posts.map(p => ({ ...p, fetched_at: Date.now() }));
    localStorage.setItem(X_STORAGE_KEY, JSON.stringify(stamped));
  } catch { /* storage full — ignore */ }
}

function getLastSeenTime(): number {
  try { return parseInt(localStorage.getItem(X_SEEN_KEY) ?? '0'); }
  catch { return 0; }
}

function markXSeen() {
  try { localStorage.setItem(X_SEEN_KEY, String(Date.now())); }
  catch { /* ignore */ }
}

export type FeedTab = 'online' | 'xfeed' | 'inventory';

interface Props {
  tab: FeedTab;
  onlineStores: Store[];
  allStores: Store[];
  onStoreClick: (store: Store) => void;
  onFlyToStore: (store: Store) => void;
  onSearchAreaChange: (area: { lat: number; lng: number; radius: number } | null) => void;
  onStoresUpdated: () => Promise<void> | void;
  onUnreadChange?: (n: number) => void;
}

export default function RestockFeed({ tab, onlineStores, allStores, onStoreClick, onFlyToStore, onSearchAreaChange, onStoresUpdated, onUnreadChange }: Props) {
  const [restocks, setRestocks] = useState<Restock[]>([]);
  const [loading, setLoading] = useState(true);
  const [chainFilter, setChainFilter] = useState('all');

  // X feed state — lives independently of tab
  const [xPosts, setXPosts] = useState<XPost[]>([]);
  const [xLoading, setXLoading] = useState(false);
  const [xError, setXError] = useState('');
  const [xLastRefresh, setXLastRefresh] = useState<Date | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const onlineChainKeys = ['all', 'pokemoncenter', 'target', 'walmart', 'bestbuy', 'gamestop', 'walgreens', 'cvs', 'barnesnoble', 'amazon', 'tcgplayer', 'ebay'];

  const chainLabel = (key: string): string => {
    if (key === 'all') return '🌐 All';
    const cfg = getOnlineChain(key);
    const names: Record<string, string> = {
      pokemoncenter: 'Pkmn Center', target: 'Target', walmart: 'Walmart',
      bestbuy: 'Best Buy', gamestop: 'GameStop', walgreens: 'Walgreens',
      cvs: 'CVS', thorntons: "Thornton's",
      dollargeneral: 'Dollar Gen.', barnesnoble: 'B&N',
      amazon: 'Amazon', tcgplayer: 'TCGPlayer', ebay: 'eBay',
    };
    return `${cfg.emoji} ${names[key] ?? key}`;
  };

  // Merge new posts with existing, deduplicate, drop >4hr old
  const mergePosts = useCallback((fresh: XPost[], existing: XPost[]): XPost[] => {
    const seen = new Set(existing.map(p => p.id));
    const merged = [
      ...fresh.filter(p => !seen.has(p.id)),
      ...existing,
    ];
    const cutoff = Date.now() - FOUR_HOURS_MS;
    return merged
      .filter(p => new Date(p.date).getTime() > cutoff)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 100);
  }, []);

  const fetchXFeed = useCallback(async (silent = false) => {
    if (!silent) setXLoading(true);
    setXError('');
    try {
      const res = await fetch('/api/x-feed');
      const data = await res.json();
      if (data.posts && Array.isArray(data.posts)) {
        setXPosts(prev => {
          const merged = mergePosts(data.posts, prev);
          savePosts(merged);

          // Count posts newer than last time user viewed the X tab
          const lastSeen = getLastSeenTime();
          const newCount = merged.filter(p => new Date(p.date).getTime() > lastSeen).length;
          setUnreadCount(newCount);

          return merged;
        });
        setXLastRefresh(new Date());
      } else if (!silent) {
        setXError('No posts returned — Nitter may be down.');
      }
    } catch {
      if (!silent) setXError('Failed to fetch X feed. Nitter may be down.');
    }
    if (!silent) setXLoading(false);
  }, [mergePosts]);

  // On mount: load from cache, then immediately fetch, then set interval
  useEffect(() => {
    const cached = loadCachedPosts();
    if (cached.length > 0) {
      setXPosts(cached);
      const lastSeen = getLastSeenTime();
      setUnreadCount(cached.filter(p => new Date(p.date).getTime() > lastSeen).length);
    }

    // Initial fetch (silent so it doesn't show spinner if we have cached posts)
    fetchXFeed(cached.length > 0);

    // Background refresh every 20 minutes
    intervalRef.current = setInterval(() => fetchXFeed(true), X_REFRESH_INTERVAL);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [fetchXFeed]);

  // Load restock feed only when on the 'online' tab
  useEffect(() => {
    if (tab !== 'online') return;
    setLoading(true);
    setChainFilter('all');
    fetch('/api/restocks?restock_type=online&limit=60')
      .then(r => r.json())
      .then(data => { setRestocks(data); setLoading(false); });
  }, [tab]);

  // Bubble unread count up to the nav rail badge
  useEffect(() => { onUnreadChange?.(unreadCount); }, [unreadCount, onUnreadChange]);

  // Mark X posts as read whenever the X feed becomes the active tab
  useEffect(() => {
    if (tab === 'xfeed') { markXSeen(); setUnreadCount(0); }
  }, [tab]);

  const filtered = tab !== 'online' ? [] :
    chainFilter === 'all' ? restocks : restocks.filter(r => r.chain === chainFilter);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Per-view controls (only the Online & X-feed views have a control header) */}
      {(tab === 'online' || tab === 'xfeed') && (
      <div style={{ padding: '12px 12px 0', borderBottom: '1px solid #2e3347', flexShrink: 0 }}>
        {/* Online quick-report buttons */}
        {tab === 'online' && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: '#6b7280', marginBottom: 5,
              textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
              Report a drop at:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {onlineStores.map(s => {
                const cfg = getOnlineChain(s.chain);
                const shortName = s.name
                  .replace(' Online', '').replace('Pokemon Center', 'Pkmn Ctr')
                  .replace("Sam's Club", "Sam's");
                return (
                  <button key={s.id} onClick={() => onStoreClick(s)} style={{
                    background: '#1e2133', border: `1px solid ${cfg.color}40`,
                    borderRadius: 6, padding: '3px 8px', fontSize: 10,
                    color: cfg.color, cursor: 'pointer', fontWeight: 700,
                  }}>
                    {cfg.emoji} {shortName}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* X feed controls */}
        {tab === 'xfeed' && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>
                  {X_ACCOUNTS.length} accounts
                </div>
                {/* Live pulse indicator */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: 6, height: 6, borderRadius: '50%', background: '#2ecc71',
                    animation: 'pulse-ring 2s infinite',
                  }} />
                  <span style={{ fontSize: 9, color: '#2ecc71', fontWeight: 700 }}>LIVE</span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {xLastRefresh && (
                  <span style={{ fontSize: 9, color: '#6b7280' }}>
                    {xLastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                <button onClick={() => fetchXFeed(false)} disabled={xLoading}
                  style={{ background: '#242736', border: 'none', color: '#8b91a8',
                    cursor: xLoading ? 'not-allowed' : 'pointer',
                    borderRadius: 6, padding: '3px 8px', fontSize: 10, fontWeight: 600 }}>
                  {xLoading ? '...' : '↻'}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
              {X_ACCOUNTS.map(a => (
                <a key={a} href={`https://x.com/${a}`} target="_blank" rel="noopener noreferrer"
                  style={{ background: '#1e2133', border: '1px solid #2e3347', borderRadius: 5,
                    padding: '2px 6px', fontSize: 9, color: '#8b91a8', textDecoration: 'none', fontWeight: 600 }}>
                  @{a}
                </a>
              ))}
            </div>
            <div style={{ fontSize: 9, color: '#6b7280', marginTop: 4 }}>
              Posts auto-expire after 4h · refreshes every 2min
            </div>
          </div>
        )}

        {/* Chain filter — only on the online tab */}
        {tab === 'online' && (
          <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', paddingBottom: 8 }}>
            {onlineChainKeys.map(c => (
              <button key={c} onClick={() => setChainFilter(c)} style={{
                padding: '2px 7px', borderRadius: 5, border: 'none', cursor: 'pointer',
                fontSize: 10, fontWeight: 600,
                background: chainFilter === c ? '#e63946' : '#242736',
                color: chainFilter === c ? 'white' : '#8b91a8',
              }}>
                {chainLabel(c)}
              </button>
            ))}
          </div>
        )}
      </div>
      )}

      {/* Feed content */}
      <div style={{ flex: 1, overflowY: 'auto',
        display: tab === 'inventory' ? 'flex' : 'block', flexDirection: 'column' }}>
        {tab === 'inventory' ? (
          <InventoryPanel
            allStores={allStores}
            onFlyToStore={onFlyToStore}
            onSearchAreaChange={onSearchAreaChange}
            onStoresUpdated={onStoresUpdated}
          />
        ) : tab === 'xfeed' ? (
          xLoading && xPosts.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#8b91a8', fontSize: 12 }}>
              Fetching X posts via Nitter...
            </div>
          ) : xError && xPosts.length === 0 ? (
            <XErrorState error={xError} onRetry={() => fetchXFeed(false)} />
          ) : xPosts.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#8b91a8', fontSize: 12 }}>
              No restock posts in the last 4 hours. Try refreshing.
            </div>
          ) : (
            <>
              {xError && (
                <div style={{ padding: '6px 14px', background: '#1e0808',
                  fontSize: 10, color: '#e63946', borderBottom: '1px solid #2e3347' }}>
                  ⚠ Refresh failed — showing cached posts. {xError}
                </div>
              )}
              {xPosts.map(p => <XPostCard key={p.id} post={p} />)}
            </>
          )
        ) : loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#8b91a8', fontSize: 12 }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          filtered.map(r => <FeedItem key={r.id} restock={r} />)
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ padding: 32, textAlign: 'center', color: '#8b91a8', fontSize: 13 }}>
      <div>No online drops reported yet.</div>
      <div style={{ fontSize: 11, marginTop: 4 }}>Click a retailer above to report a drop.</div>
    </div>
  );
}

function XErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div style={{ padding: 24, textAlign: 'center' }}>
      <div style={{ color: '#e63946', fontSize: 12, marginBottom: 8 }}>{error}</div>
      <div style={{ color: '#8b91a8', fontSize: 11, marginBottom: 14, lineHeight: 1.5 }}>
        Nitter (open-source X proxy) may be temporarily down.<br />No API key required.
      </div>
      <button onClick={onRetry} style={{
        background: '#242736', border: '1px solid #2e3347', color: '#e8eaf0',
        borderRadius: 8, padding: '7px 16px', fontSize: 12, cursor: 'pointer',
      }}>
        Try Again
      </button>
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 6 }}>Check directly on X:</div>
        {X_ACCOUNTS.map(a => (
          <a key={a} href={`https://x.com/${a}`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'block', color: '#3b9eff', fontSize: 11, marginBottom: 3, textDecoration: 'none' }}>
            @{a}
          </a>
        ))}
      </div>
    </div>
  );
}

function XPostCard({ post }: { post: XPost }) {
  const ageMs = Date.now() - new Date(post.date).getTime();
  const ageMin = Math.floor(ageMs / 60000);
  const agoStr = ageMin < 60
    ? `${ageMin}m ago`
    : ageMin < 1440
    ? `${Math.floor(ageMin / 60)}h ago`
    : `${Math.floor(ageMin / 1440)}d ago`;

  // Fade out posts approaching 4h
  const hoursOld = ageMs / 3600000;
  const opacity = hoursOld > 3 ? Math.max(0.4, 0.4 + (0.6 * (4 - hoursOld))) : 1;

  return (
    <div style={{ padding: '11px 14px', borderBottom: '1px solid #2e3347', opacity }} className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
        <a href={`https://x.com/${post.account}`} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, fontWeight: 800, color: '#e8eaf0', textDecoration: 'none' }}>
          @{post.account}
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 8 }}>
          {post.retailer && (
            <span style={{ fontSize: 10, color: '#8b91a8', fontWeight: 600 }}>{post.retailer}</span>
          )}
          <span style={{ fontSize: 10, color: hoursOld > 24 ? '#e74c3c' : '#6b7280' }}>{agoStr}</span>
        </div>
      </div>

      <div style={{ fontSize: 12, color: '#c8d0e8', lineHeight: 1.5, marginBottom: 6 }}>
        {post.text}
      </div>

      {post.products.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: 6 }}>
          {post.products.map(p => (
            <span key={p} style={{ background: '#242736', color: '#c8d0e8',
              padding: '2px 6px', borderRadius: 4, fontSize: 10 }}>
              🃏 {p}
            </span>
          ))}
        </div>
      )}

      <a href={post.link} target="_blank" rel="noopener noreferrer"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4,
          background: '#1e2133', border: '1px solid #2e3347',
          borderRadius: 6, padding: '3px 9px', fontSize: 10,
          color: '#3b9eff', textDecoration: 'none', fontWeight: 600 }}>
        𝕏 View on X
      </a>
    </div>
  );
}

function FeedItem({ restock }: { restock: Restock }) {
  const [upvoted, setUpvoted] = useState(false);
  const [votes, setVotes] = useState(restock.upvotes);

  const products = restock.products.split(',').map(p => p.trim()).filter(Boolean);
  const daysAgo = Math.floor((Date.now() - new Date(restock.restock_date).getTime()) / 86400000);
  const isOnline = restock.restock_type === 'online';

  const handleUpvote = async () => {
    if (upvoted) return;
    const res = await fetch(`/api/restocks/${restock.id}/upvote`, { method: 'POST' });
    if (res.ok) { const d = await res.json(); setVotes(d.upvotes); setUpvoted(true); }
  };

  return (
    <div style={{ padding: '10px 14px', borderBottom: '1px solid #2e3347' }} className="fade-in">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 5 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#e8eaf0',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {restock.store_name}
          </div>
          {!isOnline && <div style={{ fontSize: 10, color: '#6b7280', marginTop: 1 }}>{restock.address}</div>}
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700,
            color: daysAgo === 0 ? '#2ecc71' : daysAgo <= 3 ? '#a0e080' : daysAgo <= 10 ? '#f39c12' : '#8b91a8' }}>
            {daysAgo === 0 ? 'Today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`}
          </div>
          <div style={{ fontSize: 9, fontWeight: 700, marginTop: 1,
            color: isOnline ? '#3b9eff' : '#2ecc71' }}>
            {isOnline ? '🌐 ONLINE' : '🏪 IN-STORE'}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginBottom: restock.quantity_desc || restock.shipment_details ? 5 : 0 }}>
        {products.map(p => (
          <span key={p} style={{ background: '#242736', color: '#c8d0e8',
            padding: '2px 6px', borderRadius: 4, fontSize: 10 }}>
            🃏 {p}
          </span>
        ))}
      </div>

      {restock.quantity_desc && (
        <div style={{ fontSize: 11, color: '#8b91a8', marginBottom: 4 }}>📦 {restock.quantity_desc}</div>
      )}

      {restock.shipment_details && (
        <div style={{ background: '#1e2133', borderLeft: `2px solid ${isOnline ? '#3b9eff' : '#e63946'}`,
          borderRadius: '0 6px 6px 0', padding: '4px 8px', fontSize: 10, color: '#a8b4c8', marginBottom: 5 }}>
          {isOnline ? '🌐' : '🚚'} {restock.shipment_details}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontSize: 10, color: '#6b7280' }}>by {restock.reporter}</span>
        <button onClick={handleUpvote} style={{
          background: upvoted ? '#e63946' : '#242736', border: 'none',
          cursor: upvoted ? 'default' : 'pointer', borderRadius: 5,
          padding: '2px 7px', fontSize: 10, color: upvoted ? 'white' : '#8b91a8',
        }}>
          👍 {votes}
        </button>
      </div>
    </div>
  );
}

'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import RestockFeed, { type FeedTab } from '@/components/RestockFeed';
import RestockForm from '@/components/RestockForm';
import StoreIntel from '@/components/StoreIntel';
import AdminPanel from '@/components/AdminPanel';
import SniperPanel from '@/components/SniperPanel';
import ProductFinderPanel from '@/components/ProductFinderPanel';
import FillsFeed from '@/components/FillsFeed';
import NavRail, { type NavKey } from '@/components/NavRail';
import { useRouter } from 'next/navigation';

const Map = dynamic(() => import('@/components/Map'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full"
      style={{ background: '#1a1d27', borderRadius: 12 }}>
      <div style={{ color: '#8b91a8', textAlign: 'center', fontSize: 13 }}>Loading map...</div>
    </div>
  ),
});

export interface Store {
  id: number;
  name: string;
  chain: string;
  address: string;
  lat: number;
  lng: number;
  store_type: 'retail' | 'online';
  last_restock: string | null;
  restock_count: number;
}

export interface Restock {
  id: number;
  store_id: number;
  store_name: string;
  chain: string;
  address: string;
  store_type: 'retail' | 'online';
  reporter: string;
  products: string;
  shipment_details: string | null;
  restock_date: string;
  quantity_desc: string | null;
  source: string;
  restock_type: 'instore' | 'online';
  upvotes: number;
  created_at: string;
}

type Panel = 'feed' | 'submit' | 'intel' | 'admin' | 'sniper' | 'finder' | 'fills';

interface CurrentUser {
  id: number;
  username: string;
  role: 'admin' | 'friend';
}

export default function Home() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [retailStores, setRetailStores] = useState<Store[]>([]);
  const [onlineStores, setOnlineStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<Store | null>(null);
  const [panel, setPanel] = useState<Panel>('feed');
  const [feedTab, setFeedTab] = useState<FeedTab>('inventory'); // land on Stock, not the map
  const [xUnread, setXUnread] = useState(0);
  const [feedKey, setFeedKey] = useState(0);
  const [flyToStore, setFlyToStore] = useState<Store | null>(null);
  const [searchArea, setSearchArea] = useState<{ lat: number; lng: number; radius: number } | null>(null);

  const loadStores = useCallback(async () => {
    const [retailRes, onlineRes] = await Promise.all([
      fetch('/api/stores?type=retail'),
      fetch('/api/stores?type=online'),
    ]);
    setRetailStores(await retailRes.json());
    setOnlineStores(await onlineRes.json());
  }, []);

  useEffect(() => { loadStores(); }, [loadStores]);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setCurrentUser(d.user))
      .catch(() => {});
  }, []);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.replace('/login');
    router.refresh();
  };

  const isAdmin = currentUser?.role === 'admin';

  const handleStoreClick = (store: Store) => {
    setSelectedStore(store);
    setPanel('submit');
  };

  const handleIntelClick = (store: Store) => {
    setSelectedStore(store);
    setPanel('intel');
  };

  const handleRestockSubmitted = () => {
    setFeedKey(k => k + 1);
    loadStores();
    setPanel('feed');
  };

  // Map the left-rail selection onto panels/feed-tabs
  const handleNav = (key: NavKey) => {
    if (key === 'fills') setPanel('fills');
    else if (key === 'admin') setPanel('admin');
    else if (key === 'sniper') setPanel('sniper');
    else if (key === 'finder') setPanel('finder');
    else { setFeedTab(key); setPanel('feed'); }
  };

  const activeNav: NavKey | null =
    panel === 'fills' ? 'fills'
    : panel === 'admin' ? 'admin'
    : panel === 'sniper' ? 'sniper'
    : panel === 'finder' ? 'finder'
    : panel === 'feed' ? feedTab
    : null; // intel / submit have no rail highlight

  const allStores = [...retailStores, ...onlineStores];

  // Map tab = store locations only; SKU Finder = SKUs only. No overlap.
  const mapTab = panel === 'feed' && feedTab === 'inventory';

  // Jump to the Map tab and fly to a store (used by SKU Finder / Fills / feeds).
  const goToMapStore = (store: Store) => {
    setFeedTab('inventory');
    setPanel('feed');
    setFlyToStore(null);
    setTimeout(() => setFlyToStore(store), 120);
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#0f1117' }}>
      <NavRail
        active={activeNav}
        isAdmin={isAdmin}
        xUnread={xUnread}
        username={currentUser?.username}
        onSelect={handleNav}
        onLogout={handleLogout}
      />

      {mapTab ? (
        /* MAP tab — store locations only, full width */
        <div style={{ flex: 1, minWidth: 0, padding: 12 }}>
          <Map
            stores={retailStores}
            onStoreClick={handleStoreClick}
            onIntelClick={handleIntelClick}
            onStoresDiscovered={loadStores}
            flyToStore={flyToStore}
            searchArea={searchArea}
            locationsOnly
          />
        </div>
      ) : (
        <div style={{ display: 'flex', flex: 1, minHeight: 0, justifyContent: 'center' }}>
          <div className="fade-in" key={panel + feedTab} style={{
            width: panel === 'finder' ? 520 : 480, maxWidth: '100%',
            flexShrink: 0, display: 'flex', flexDirection: 'column',
            background: '#12141c', overflow: 'hidden',
            borderLeft: '1px solid #2e3347', borderRight: '1px solid #2e3347',
          }}>
            {panel === 'feed' && (
              <RestockFeed
                key={feedKey}
                tab={feedTab}
                onlineStores={onlineStores}
                allStores={allStores}
                onStoreClick={handleStoreClick}
                onFlyToStore={goToMapStore}
                onSearchAreaChange={setSearchArea}
                onStoresUpdated={loadStores}
                onUnreadChange={setXUnread}
              />
            )}
            {panel === 'submit' && (
              <RestockForm
                stores={allStores}
                selectedStore={selectedStore}
                onSubmitted={handleRestockSubmitted}
                onCancel={() => setPanel('feed')}
              />
            )}
            {panel === 'intel' && selectedStore && (
              <StoreIntel store={selectedStore} onClose={() => setPanel('feed')} />
            )}
            {panel === 'admin' && isAdmin && currentUser && (
              <AdminPanel currentUserId={currentUser.id} onClose={() => setPanel('feed')} />
            )}
            {panel === 'sniper' && isAdmin && (
              <SniperPanel onClose={() => setPanel('feed')} />
            )}
            {panel === 'finder' && (
              <ProductFinderPanel
                allStores={allStores}
                onFlyToStore={goToMapStore}
                onSearchAreaChange={setSearchArea}
                onStoresUpdated={loadStores}
              />
            )}
            {panel === 'fills' && (
              <FillsFeed allStores={allStores} onFlyToStore={goToMapStore} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

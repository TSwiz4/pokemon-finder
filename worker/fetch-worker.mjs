// Residential fetch worker — run this on your HOME PC (residential IP).
//
// The VPS app routes retail requests here (via SCANNER_WORKER_URL) so they
// originate from your home connection instead of a datacenter IP.
//
// Two modes, chosen automatically per URL:
//   • Akamai-walled hosts (Target / RedSky)  -> a REAL Chromium via Playwright.
//     It loads target.com so Akamai's JS mints valid anti-bot cookies, then
//     makes the API call from inside that browser context. This is what beats
//     the CAPTCHA that plain fetch can't.
//   • Everything else                        -> plain fetch (fast, no browser).
//
// SETUP (home PC, one time):
//   cd worker
//   npm run setup          # installs playwright + downloads Chromium
//   SCANNER_WORKER_SECRET=yoursecret node fetch-worker.mjs
//   # expose it:  cloudflared tunnel --url http://localhost:8787
// Then on the VPS set SCANNER_WORKER_URL + SCANNER_WORKER_SECRET and restart.

import { createServer } from 'http';

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.SCANNER_WORKER_SECRET || '';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Hosts that sit behind Akamai and need the real-browser path.
const BROWSER_HOSTS = new Set(['target.com', 'www.target.com', 'redsky.target.com']);
const WARM_TTL_MS = 8 * 60 * 1000; // re-warm Akamai cookies every ~8 min

if (!SECRET) {
  console.warn('[worker] WARNING: SCANNER_WORKER_SECRET is empty — set a secret so this is not an open proxy.');
}

// ---------------------------------------------------------------------------
// Browser (lazy) — a single persistent Chromium context with a warm Target session.
// ---------------------------------------------------------------------------
let _browser = null;
let _context = null;
let _page = null;          // persistent page kept on target.com
let _warmedAt = 0;
let _warming = null;

async function ensureWarmPage() {
  const { chromium } = await import('playwright');
  if (!_browser) {
    _browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    });
    _browser.on('disconnected', () => { _browser = null; _context = null; _page = null; _warmedAt = 0; });
  }
  if (!_context) {
    _context = await _browser.newContext({
      userAgent: UA,
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    // Mask the most obvious headless tell.
    await _context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
  }
  if (_page && Date.now() - _warmedAt < WARM_TTL_MS) return _page;
  if (!_warming) {
    _warming = (async () => {
      try {
        if (!_page || _page.isClosed()) _page = await _context.newPage();
        await _page.goto('https://www.target.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Let Akamai's sensor JS run & validate the _abck cookie (it posts a few times).
        await _page.waitForTimeout(5000);
        _warmedAt = Date.now();
        console.log('[warm] target.com session warmed');
      } catch (e) {
        console.log('[warm] failed: ' + String(e).slice(0, 100));
      } finally {
        _warming = null;
      }
    })();
  }
  await _warming;
  return _page;
}

// Run the request from INSIDE the live target.com page, so Akamai's hooked
// fetch attaches its anti-bot token automatically (the key vs a detached call).
async function pageFetch(page, url, headers, timeoutMs) {
  return page.evaluate(
    async ({ u, h, t }) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), t);
      try {
        const r = await fetch(u, { headers: h, credentials: 'include', signal: ctrl.signal });
        return { status: r.status, text: await r.text() };
      } catch (e) {
        return { status: 0, text: '', error: String(e).slice(0, 150) };
      } finally {
        clearTimeout(timer);
      }
    },
    { u: url, h: { Accept: 'application/json', ...headers }, t: timeoutMs },
  );
}

async function browserFetch(url, headers, timeoutMs) {
  let page = await ensureWarmPage();
  let out = await pageFetch(page, url, headers, timeoutMs);
  // If Akamai still challenges, re-warm and retry once.
  if (out.status === 403 || (out.text || '').includes('captcha')) {
    _warmedAt = 0;
    page = await ensureWarmPage();
    out = await pageFetch(page, url, headers, timeoutMs);
  }
  return out;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = createServer((req, res) => {
  const send = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    return send(200, { ok: true, worker: 'fetch-worker', residential: true, browser_warmed: _warmedAt > 0 });
  }
  if (req.method !== 'POST' || !req.url.startsWith('/fetch')) return send(404, { error: 'not found' });
  if (SECRET && req.headers['x-worker-secret'] !== SECRET) return send(403, { error: 'forbidden' });

  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 1_000_000) req.destroy();
  });
  req.on('end', async () => {
    let job;
    try {
      job = JSON.parse(body);
    } catch {
      return send(400, { error: 'invalid JSON' });
    }
    const { url, method = 'GET', headers = {}, body: reqBody, timeoutMs = 9000 } = job;
    if (!url || typeof url !== 'string') return send(400, { error: 'url required' });

    let host = '';
    try { host = new URL(url).host; } catch { return send(400, { error: 'bad url' }); }

    const useBrowser = BROWSER_HOSTS.has(host) && method.toUpperCase() === 'GET';
    const t = Math.min(Number(timeoutMs) || 9000, 30000);

    try {
      if (useBrowser) {
        const out = await browserFetch(url, headers, t);
        console.log(`[browser] ${host} -> ${out.status} (${out.text.length}b)${out.text.includes('captcha') ? ' CAPTCHA' : ''}`);
        return send(200, out);
      }
      const r = await fetch(url, {
        method, headers, body: reqBody,
        signal: AbortSignal.timeout(t), redirect: 'follow',
      });
      const text = await r.text();
      console.log(`[fetch] ${host} -> ${r.status} (${text.length}b)`);
      send(200, { status: r.status, text });
    } catch (e) {
      console.log(`[error] ${host} -> ${String(e).slice(0, 120)}`);
      send(200, { status: 0, text: '', error: String(e).slice(0, 200) });
    }
  });
});

server.listen(PORT, () => {
  console.log(`[worker] fetch-worker listening on http://localhost:${PORT} (browser mode for Target)`);
});

// Residential fetch worker — run this on your HOME PC (residential IP).
//
// The VPS app routes retail requests here (via SCANNER_WORKER_URL) so they
// originate from your home connection instead of a datacenter IP. That's what
// unlocks Walmart / Best Buy without paid residential proxies. Target works
// either way. This worker holds NO secrets and never touches the database — it
// only fetches a URL and returns the body.
//
// SETUP (on the home PC):
//   1. Node 18+ installed (has global fetch).
//   2. Pick a shared secret and run:
//        SCANNER_WORKER_SECRET=somelongsecret  node worker/fetch-worker.mjs
//      (Windows PowerShell:  $env:SCANNER_WORKER_SECRET="somelongsecret"; node worker/fetch-worker.mjs)
//   3. Expose it to the VPS. Easiest + safest is a Cloudflare Tunnel:
//        cloudflared tunnel --url http://localhost:8787
//      Copy the https URL it prints.
//   4. On the VPS, set and restart:
//        SCANNER_WORKER_URL=https://<that-url>
//        SCANNER_WORKER_SECRET=somelongsecret   (same value as step 2)
//
// That's it — no app code changes. retailFetch() starts delegating immediately.

import { createServer } from 'http';

const PORT = Number(process.env.PORT || 8787);
const SECRET = process.env.SCANNER_WORKER_SECRET || '';

if (!SECRET) {
  console.warn('[worker] WARNING: SCANNER_WORKER_SECRET is empty — anyone who reaches this port can use it as an open proxy. Set a secret.');
}

const server = createServer((req, res) => {
  const send = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    return send(200, { ok: true, worker: 'fetch-worker', residential: true });
  }
  if (req.method !== 'POST' || !req.url.startsWith('/fetch')) {
    return send(404, { error: 'not found' });
  }
  if (SECRET && req.headers['x-worker-secret'] !== SECRET) {
    return send(403, { error: 'forbidden' });
  }

  let body = '';
  req.on('data', (c) => {
    body += c;
    if (body.length > 1_000_000) req.destroy(); // guard against abuse
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

    try {
      const r = await fetch(url, {
        method,
        headers,
        body: reqBody,
        signal: AbortSignal.timeout(Math.min(Number(timeoutMs) || 9000, 30000)),
        redirect: 'follow',
      });
      const text = await r.text();
      send(200, { status: r.status, text });
    } catch (e) {
      send(200, { status: 0, text: '', error: String(e).slice(0, 200) });
    }
  });
});

server.listen(PORT, () => {
  console.log(`[worker] fetch-worker listening on http://localhost:${PORT}`);
  console.log('[worker] expose with: cloudflared tunnel --url http://localhost:' + PORT);
});

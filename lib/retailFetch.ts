// retailFetch — the "scanner seam".
//
// Every outbound call to a retailer (Target RedSky, Walmart, Best Buy) goes
// through this one function. By default it fetches directly from wherever the
// app runs (e.g. a VPS — datacenter IP, so Walmart/Best Buy are bot-walled).
//
// If SCANNER_WORKER_URL is set, the request is instead delegated to a remote
// "fetch worker" running on a residential connection (your home PC). The worker
// performs the fetch from its residential IP and returns the body. That unlocks
// Walmart / Best Buy unofficial endpoints WITHOUT paid proxies — and requires
// no code change here: flip the env var and every detector starts using it.
//
//   SCANNER_WORKER_URL=https://your-home-pc-tunnel.example   (no trailing slash needed)
//   SCANNER_WORKER_SECRET=<shared secret>                    (must match the worker)
//
// See worker/fetch-worker.mjs for the home-PC side.

export interface RetailFetchOpts {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
}

export interface RetailFetchResult {
  ok: boolean;
  status: number;
  text: string;
  /** true when the request was served by the residential worker */
  viaWorker: boolean;
}

const DEFAULT_TIMEOUT = 9000;

export async function retailFetch(url: string, opts: RetailFetchOpts = {}): Promise<RetailFetchResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT;
  const workerUrl = process.env.SCANNER_WORKER_URL?.replace(/\/$/, '');

  if (workerUrl) {
    try {
      const res = await fetch(`${workerUrl}/fetch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-worker-secret': process.env.SCANNER_WORKER_SECRET ?? '',
        },
        body: JSON.stringify({
          url,
          method: opts.method ?? 'GET',
          headers: opts.headers ?? {},
          body: opts.body,
          timeoutMs,
        }),
        // give the worker a little headroom over its own timeout
        signal: AbortSignal.timeout(timeoutMs + 5000),
      });
      if (!res.ok) return { ok: false, status: res.status, text: '', viaWorker: true };
      const data = (await res.json()) as { status?: number; text?: string };
      const status = data.status ?? 0;
      return { ok: status >= 200 && status < 300, status, text: data.text ?? '', viaWorker: true };
    } catch (e) {
      return { ok: false, status: 0, text: String(e).slice(0, 120), viaWorker: true };
    }
  }

  // Direct fetch (no residential worker configured)
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, viaWorker: false };
  } catch (e) {
    return { ok: false, status: 0, text: String(e).slice(0, 120), viaWorker: false };
  }
}

/** Whether a residential worker is configured. */
export function hasResidentialWorker(): boolean {
  return Boolean(process.env.SCANNER_WORKER_URL);
}

# Sniper Feasibility — Target / Walmart / (Best Buy)

_Status: research. Author: feasibility pass 2026-06-24. Admin-only feature._

## 0. The hard requirement

> "Instantly check out on orders. Perfect, with live information, or I'll be stuck behind."

That sentence is the whole problem statement, and it's worth being blunt up front: **"perfect" is not an achievable target for a solo-built bot against Target/Walmart in 2026.** The retailers run commercial-grade bot mitigation, and the people who consistently win drops are running paid, constantly-maintained AIO bots (Stellar, Refract, Estock, etc.) on residential proxy pools with CAPTCHA-solver subscriptions. They lose plenty of drops too.

So the realistic framing is **not** "build something perfect" — it's "build something that is *fast and reliable enough* to win a meaningful share of drops, with a clear-eyed view of the cost and the ceiling." This doc lays out where the time goes, what's actually feasible, and a phased plan that gets value early instead of sinking weeks into a headless checkout that gets blocked.

## 1. The latency budget (where the race is won/lost)

A drop is won in a chain of steps. Total time from "stock exists" to "order confirmed" must beat everyone else:

| Step | What happens | Realistic time | Who controls it |
|------|-------------|----------------|-----------------|
| 1. Detect | Stock flips to available; you observe it | **0–poll interval** | Us (polling cadence) |
| 2. Decide | Confirm real availability, pick product/qty | ~50–200 ms | Us |
| 3. Add to cart | Hit cart endpoint / click | 200–800 ms | Retailer + anti-bot |
| 4. Checkout | Submit shipping/payment, place order | 1–5 s | Retailer + anti-bot |
| 5. Survive review | Order not cancelled post-hoc | minutes–hours | Retailer fraud/bot review |

Key insight: **Step 1 (detection) is the only part we fully control, and it's the cheapest to make excellent.** A 2-second poll loses to a 200 ms poll loses to a push/websocket signal. The existing `/api/inventory/target` RedSky poller is already 80% of a best-in-class detector. Steps 3–4 are where anti-bot lives and where solo builds break.

## 2. Two architectures for checkout

### A) Request/API mode ("backend bot")
Replays the raw HTTP calls the site makes (add-to-cart, set-fulfillment, place-order) directly, no browser. **Fastest possible** (Step 3+4 in <1 s) and cheap to run at scale.
- **Pro:** speed, low resource use, parallelizable.
- **Con:** must reverse-engineer each retailer's checkout API, forge valid anti-bot tokens (the hard part), and it breaks every time the retailer changes the flow. This is the technique commercial bots use and the technique retailers fight hardest.

### B) Browser automation ("front-end macro")
Drive a real/headless browser (Playwright/Puppeteer) to click through the actual UI.
- **Pro:** much easier to build, naturally carries cookies/fingerprint, survives minor UI tweaks.
- **Con:** slow (Step 3+4 can be 3–8 s), heavy, and *highly* detectable — headless fingerprints, automation flags, and behavioral signals get flagged. "Press & Hold" / behavioral challenges eat it alive unless heavily stealthed.

**Reality:** the "macro" you mentioned = (B). It's the fastest to stand up and the first to get blocked on a hyped drop. (A) is what actually wins but is a real engineering + maintenance commitment per retailer.

## 3. Per-retailer reality

### Target
- **Read/detect:** RedSky API (already in this repo). Excellent — we can detect stock changes fast. Note it **CAPTCHA-gates after a few rapid calls** (we tripped this during SKU verification on 2026-06-24), so detection needs rotating IPs / sane cadence.
- **Anti-bot:** multi-layer — IP reputation, account purchase-history scoring, browser fingerprinting (Shape/F5-style). Historically no classic CAPTCHA, but behavioral + device signals are strong. Known for **cancelling** bot-pattern orders after the fact (Step 5 risk is real).
- **Checkout:** request-mode is hard (token forging); orders flagged as bot-like get silently cancelled.

### Walmart
- **Anti-bot:** **PerimeterX / HUMAN** — browser fingerprinting + behavioral + network signals, fronted by the "**Press & Hold** to confirm you're human" challenge. Flagged sessions need fresh **residential** proxies (ISP/datacenter proxies get blocked aggressively).
- **Checkout:** uses Offer IDs (OIDs) for add-to-cart; the community spams ATC to force queueing. Beatable but proxy- and solver-dependent.

### Best Buy
- **Model:** high-demand Pokemon increasingly **invite-only / queue ("waiting room")**, similar to Amazon. A queue defeats raw speed — you wait your turn regardless of how fast your bot is.
- **Verdict:** lowest priority for sniping (you flagged it as "maybe"). Keep it in the **SKU finder** (clean 7-digit SKUs, easy stock reads) but **deprioritize for auto-checkout** — the queue model neutralizes the speed advantage we'd be building.

## 4. What "beating anti-bot" actually requires

To make request-mode checkout work reliably you need, roughly all of:
1. **Residential/mobile proxy pool** (rotating) — datacenter IPs are pre-flagged. (~$ per GB, ongoing.)
2. **CAPTCHA / challenge solving** — 2Captcha / CapMonster / AYCD Autosolve subscriptions for Press & Hold and image challenges.
3. **Realistic browser fingerprints** + token generation matching the retailer's anti-bot SDK.
4. **Warmed accounts + saved payment** — aged accounts with purchase history and pre-saved cards/addresses clear review far better than fresh ones.
5. **Constant maintenance** — flows change; a working bot is a *process*, not a finished artifact.

This is exactly the stack the paid AIO bots productize. Replicating it solo is possible but is the bulk of the work, and the ceiling is still "wins some, loses some."

## 5. Legal / ToS / risk

- **Not illegal** for retail goods. The federal **BOTS Act applies only to event tickets**, not Pokemon cards.
- **Violates Target & Walmart ToS.** Realistic downside is **account bans + order cancellations + card/address flagging** — not legal jeopardy.
- Mitigation: keep it personal-scale (low order counts), use real saved payment, don't hammer in ways that nuke the account you actually want to buy from.

## 6. Recommendation — phased, value-early

**Phase 1 — World-class detector + assisted instant-buy (build first).**
Leverage the existing RedSky poller. Make detection genuinely fast and reliable:
- Tight polling with IP rotation / cadence control to avoid the CAPTCHA wall.
- The instant stock flips → fire a push notification + **deep link straight into a pre-filled cart / one-tap checkout** on your logged-in phone/browser.
- This is robust, low-ban-risk, reuses what's built, and on many drops a human one-tapping a pre-warmed cart *does* get there. It also gives the friends-facing app a real "live stock" upgrade.
- **This is the high-ROI start and I can build it now.**

**Phase 2 — Semi-auto request checkout for ONE retailer (pick Walmart _or_ Target).**
Once Phase 1 is solid, pick the single highest-value retailer and build request-mode ATC→checkout for it, with proxy + solver integration. One retailer done well beats three done flakily. Treat it as an ongoing maintenance commitment.

**Phase 3 — Expand / harden** only if Phase 2 earns its keep.

**Explicitly de-scoped:** Best Buy auto-checkout (queue model), and any promise of "perfect." Best Buy stays in the SKU finder.

## 6b. Locked architecture — sniper is SEPARATE from the SKU finder

Decided 2026-06-24 with user. The sniper and the RedSky SKU finder are **different subsystems, different data, different UI, not related**:

- **SKU finder (friend-facing):** read-only stock on *known* cataloged TCINs/SKUs. Does NOT and should NOT try to catch surprise drops.
- **Sniper (admin-only):** **watchlist hammer + instant buy.** Job = detect a watched item going live → ATC at **max quantity** → checkout, instantly. Especially unannounced ~3am Walmart restocks.

**Detection = watchlist model (NOT cold-discovery scraping):**
- A watchlist of specific Walmart items (incl. currently-sold-out ones). Sniper polls each item's availability endpoint continuously; on flip to in-stock, grab the **Offer ID (OID)** and buy max qty. This catches *restocks of known products*, which is the bulk of real drops.
- **Discovery of "+ surprise" items comes from X, not Walmart search.** The app already pulls `/api/x-feed`. New drops people post on X get added to the watchlist — via manual admin add, or a one-click **"add to sniper watchlist"** action on X-feed posts containing a Walmart/retailer link. No fragile Walmart-search diffing needed.

This makes the detector tractable: a fast, reliable watchlist poller, fed by an existing discovery channel.

## 7. What I can build right now (no new SKUs needed)
- Harden the RedSky poller into a continuous background monitor (cadence control, change-detection, anti-CAPTCHA pacing).
- Push notifications + pre-filled-cart deep links (the Phase 1 assisted-buy core).
- Admin-only gating so this whole subsystem is invisible to friend accounts.

## Sources
- [Target bot overview — nikeshoebot](https://www.nikeshoebot.com/target-bot/)
- [Targeting Target — aiobot](https://www.aiobot.com/target-bots/)
- [Bypassing PerimeterX — ScrapingBee](https://www.scrapingbee.com/blog/how-to-bypass-perimeterx-anti-bot-system/)
- [Walmart bot — aiobot](https://www.aiobot.com/walmart-bot/)
- [Retail botting guide — Tidal Market](https://www.tidalmarket.com/blog/retail-botting-guide)
- [Best Buy Pokemon restocks (invite/queue) — Sole Radar](https://cook-groups.com/when-does-best-buy-restock-pokemon-cards/)
- [Best bot for Pokemon Center 2025 — Sole Radar](https://cook-groups.com/the-best-bot-for-pokemon-center-ultimate-guide/)
- [Sneaker bot legality — Imperva](https://www.imperva.com/learn/application-security/sneaker-bot/)

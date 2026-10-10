// BB Engine service worker — v26_swfix_20261010
// Navigations: network-first (15 s timeout), last good page cached (query string ignored).
// Never resolves respondWith() with null/undefined: falls back to cache, then to an offline page (503).
// App shell (manifest + icon): cache-first, network fallback, never null.
// skipWaiting + clients.claim + SKIP_WAITING message so updates apply.

const CACHE_NAME = "bb-engine-v26_swfix_20261010";
const APP_SHELL = ["./manifest.json", "./A7358954-0D25-46A3-BF5E-EE0894AA056F.JPG"];
const NAV_TIMEOUT_MS = 8000;
const PAGE_KEY = new URL("./", self.registration ? self.registration.scope : self.location.href).href; // e.g. https://x.github.io/TheBetCeo-Basketball-v2/

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((u) => cache.add(u).catch(() => undefined)))
    )
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (e) => {
  if (e && e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

function offlineResponse() {
  const html =
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>Offline</title></head><body style=\"font-family:-apple-system,system-ui,sans-serif;background:#111;color:#eee;" +
    'display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center">' +
    "<div><h2>Offline - pull to refresh</h2><p>The engine could not be loaded and no saved copy exists yet.</p>" +
    '<button onclick="location.reload()" style="padding:10px 18px;font-size:16px">Retry</button></div></body></html>';
  return new Response(html, { status: 503, statusText: "Offline", headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

// The page URL without query/hash (?_build=..&_ts=.. would otherwise create a new cache entry every load)
function pageKey(request) {
  try {
    const u = new URL(request.url);
    u.search = "";
    u.hash = "";
    if (u.pathname.endsWith("/index.html")) u.pathname = u.pathname.slice(0, -"index.html".length);
    return u.href;
  } catch (_) {
    return PAGE_KEY;
  }
}

function fetchWithTimeout(request, ms) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      try { if (ctrl) ctrl.abort(); } catch (_) {}
      reject(new Error("timeout"));
    }, ms);
    fetch(request, ctrl ? { signal: ctrl.signal } : undefined).then(
      (res) => { clearTimeout(t); resolve(res); },
      (err) => { clearTimeout(t); reject(err); }
    );
  });
}

async function cachedPage(request) {
  try {
    const cache = await caches.open(CACHE_NAME);
    return (
      (await cache.match(pageKey(request))) ||
      (await cache.match(request, { ignoreSearch: true })) ||
      (await cache.match(PAGE_KEY)) ||
      (await caches.match(request, { ignoreSearch: true })) || // any older cache that survived
      null
    );
  } catch (_) {
    return null;
  }
}

async function handleNavigation(event) {
  const req = event.request;
  try {
    const res = await fetchWithTimeout(req, NAV_TIMEOUT_MS);
    if (res && res.ok && (res.type === "basic" || res.type === "default")) {
      const copy = res.clone();
      event.waitUntil(
        caches.open(CACHE_NAME).then((c) => c.put(pageKey(req), copy)).catch(() => undefined)
      );
      return res;
    }
    if (res && res.status < 500) return res; // e.g. a real 404: show it, but never null
    return (await cachedPage(req)) || res || offlineResponse();
  } catch (_) {
    return (await cachedPage(req)) || offlineResponse();
  }
}

function isAppShellRequest(request) {
  try {
    const url = new URL(request.url);
    if (url.origin !== self.location.origin) return false;
    const p = url.pathname || "";
    return p.endsWith("/manifest.json") || /\/A7358954-0D25-46A3-BF5E-EE0894AA056F\.JPG$/i.test(p);
  } catch (_) {
    return false;
  }
}

async function handleShell(event) {
  const req = event.request;
  try {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
  } catch (_) {}
  try {
    const res = await fetchWithTimeout(req, NAV_TIMEOUT_MS);
    if (res && res.ok) {
      const copy = res.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(new URL(req.url).pathname, copy)).catch(() => undefined));
    }
    if (res) return res;
  } catch (_) {}
  return new Response("", { status: 504, statusText: "Offline" });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const accept = req.headers.get("accept") || "";
  if (req.mode === "navigate" || (req.destination === "document") || (accept.includes("text/html") && new URL(req.url).origin === self.location.origin)) {
    e.respondWith(handleNavigation(e));
    return;
  }
  if (isAppShellRequest(req)) {
    e.respondWith(handleShell(e));
    return;
  }
  // everything else (worker API, SofaScore, ESPN...) goes straight to the network, untouched
});

// GridLock service worker — makes the installed app work with no signal.
//
//   App shell (HTML)   network-first  → updates arrive on the next launch while online
//   Hashed JS/CSS      cache-first    → filenames change on every build, so they never go stale
//   Map tiles          stale-while-revalidate, capped → areas you've viewed stay visible offline
//   Google Fonts       cache-first
//
// Bump VERSION when this file's caching rules change; old shell caches are deleted on activate.

const VERSION = 'v1'
const SHELL = `gridlock-shell-${VERSION}`
const TILES = 'gridlock-tiles-v1'
const FONTS = 'gridlock-fonts-v1'
const MAX_TILES = 2500 // ~25–40 MB of tiles at typical sizes

const SCOPE = self.registration.scope // e.g. https://adherewraps.github.io/gridlock/
const PRECACHE = ['', 'manifest.webmanifest', 'icon-192.png', 'apple-touch-icon.png', 'favicon.svg'].map((p) => SCOPE + p)

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL)
    await cache.addAll(PRECACHE)
    // The entry bundle loads before this worker controls the page, so fetch it explicitly:
    // otherwise the very first offline launch after installing would have no JS.
    const html = await (await cache.match(SCOPE)).text()
    const assets = [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+)"/g)].map((m) => new URL(m[1], SCOPE).href)
    await cache.addAll(assets)
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('gridlock-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req, SHELL, SCOPE))
  } else if (url.origin === self.location.origin) {
    event.respondWith(url.pathname.includes('/assets/') ? cacheFirst(req, SHELL) : staleWhileRevalidate(req, SHELL))
  } else if (url.hostname === 'server.arcgisonline.com') {
    event.respondWith(staleWhileRevalidate(req, TILES, MAX_TILES))
  } else if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(cacheFirst(req, FONTS))
  }
})

async function networkFirst(req, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName)
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  } catch {
    return (await cache.match(req)) ?? (await cache.match(fallbackUrl)) ?? Response.error()
  }
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) cache.put(req, res.clone())
  return res
}

async function staleWhileRevalidate(req, cacheName, maxEntries) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  const refresh = fetch(req)
    .then(async (res) => {
      if (res.ok) {
        await cache.put(req, res.clone())
        if (maxEntries) trim(cache, maxEntries)
      }
      return res
    })
    .catch(() => hit ?? Response.error())
  return hit ?? refresh
}

// Cache keys come back in insertion order, so the oldest tiles are evicted first.
async function trim(cache, maxEntries) {
  const keys = await cache.keys()
  const excess = keys.length - maxEntries
  for (let i = 0; i < excess; i++) await cache.delete(keys[i])
}

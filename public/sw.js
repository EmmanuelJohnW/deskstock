// DeskStock service worker: lets the dashboard pages open without internet.
// Data comes from IndexedDB (src/lib/offline); this only caches the pages and
// their static files. API calls and Next.js data requests are never cached.

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev'
// Files under /_next/static are content-hashed, so one cache works across deploys.
const STATIC_CACHE = 'deskstock-static'
const PAGE_CACHE = `deskstock-pages-${VERSION}`
const ROUTES = ['/', '/inventory', '/forecast', '/borrows', '/components', '/device', '/reports', '/sync']
const STATIC_URL = /\/_next\/static\/[^"'\s)\\]+/g
// A hanging network shouldn't block the page: fall back to the saved copy.
const NETWORK_TIMEOUT_MS = 4000

/** Browsers refuse redirected responses for navigations; only cache plain OK ones. */
function isCacheable(res) {
  return res.ok && !res.redirected && res.type === 'basic'
}

function fetchWithTimeout(request) {
  return Promise.race([
    fetch(request),
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT_MS)),
  ])
}

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys()
      await Promise.all(
        names.filter(n => n.startsWith('deskstock-pages-') && n !== PAGE_CACHE).map(n => caches.delete(n)),
      )
      await self.clients.claim()
    })(),
  )
})

/** While online: save every page and the static files it uses. */
async function warm() {
  const pages = await caches.open(PAGE_CACHE)
  const assets = await caches.open(STATIC_CACHE)
  for (const route of ROUTES) {
    try {
      const res = await fetch(route, { cache: 'no-store' })
      if (!isCacheable(res)) continue
      const html = await res.clone().text()
      await pages.put(route, res)
      await cacheAssets(assets, html.match(STATIC_URL) || [])
    } catch {
      // Offline or a page failed: keep whatever is already cached.
    }
  }
}

/** Saves static files, and the fonts/images their stylesheets reference. */
async function cacheAssets(assets, urls) {
  for (const url of new Set(urls)) {
    if (await assets.match(url)) continue
    const asset = await fetch(url)
    if (!isCacheable(asset)) continue
    if (url.endsWith('.css')) {
      const css = await asset.clone().text()
      await cacheAssets(assets, css.match(STATIC_URL) || [])
    }
    await assets.put(url, asset)
  }
}

self.addEventListener('message', event => {
  if (event.data === 'warm') event.waitUntil(warm())
})

async function cacheFirst(event) {
  const cached = await caches.match(event.request)
  if (cached) return cached
  const res = await fetch(event.request)
  if (isCacheable(res)) {
    const copy = res.clone()
    event.waitUntil(caches.open(STATIC_CACHE).then(cache => cache.put(event.request, copy)))
  }
  return res
}

async function networkFirstPage(event) {
  const url = new URL(event.request.url)
  const cache = await caches.open(PAGE_CACHE)
  try {
    const res = await fetchWithTimeout(event.request)
    if (isCacheable(res)) {
      const copy = res.clone()
      event.waitUntil(cache.put(url.pathname, copy))
    }
    return res
  } catch {
    const cached = await cache.match(url.pathname)
    if (cached) return cached
    return new Response(
      '<!doctype html><meta charset="utf-8"><title>DeskStock — offline</title>' +
        '<body style="font-family:sans-serif;padding:2rem">This page has not been saved for offline use yet. ' +
        'Open DeskStock once while online.</body>',
      { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    )
  }
}

self.addEventListener('fetch', event => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith('/api/')) return
  // Next.js data requests vary by headers and deploy; let them go to the network.
  if (url.searchParams.has('_rsc') || request.headers.get('RSC')) return

  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(event))
  } else if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(event))
  }
})

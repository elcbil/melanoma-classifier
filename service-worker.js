'use strict';

const APP_VERSION    = 'v1.0.0';  
const CACHE_SHELL    = `dermalens-shell-${APP_VERSION}`;
const CACHE_MODEL    = `dermalens-model-${APP_VERSION}`;
const CACHE_CDN      = `dermalens-cdn-${APP_VERSION}`;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/css/style.css',
  '/js/app.js',
  '/js/register-sw.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',  
];

const MODEL_ASSETS = [
  '/model/model.json',
  '/model/group1-shard1of11.bin',   
  '/model/group1-shard2of11.bin',   
  '/model/group1-shard3of11.bin',   
  '/model/group1-shard4of11.bin',   
  '/model/group1-shard5of11.bin',   
  '/model/group1-shard6of11.bin',   
  '/model/group1-shard7of11.bin',   
  '/model/group1-shard8of11.bin',   
  '/model/group1-shard9of11.bin',   
  '/model/group1-shard10of11.bin',   
  '/model/group1-shard11of11.bin',      
];

const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net'
];

const ALL_CACHES = [CACHE_SHELL, CACHE_MODEL, CACHE_CDN];

async function precacheAll(cacheName, urls) {
  const cache = await caches.open(cacheName);
  const results = await Promise.allSettled(
    urls.map(url => cache.add(url))
  );
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      console.warn(`[SW] Gagal cache: ${urls[i]}`, r.reason);
    }
  });
}

function isCdnRequest(url) {
  return CDN_HOSTS.some(host => url.hostname.includes(host));
}

function isModelRequest(url) {
  return url.pathname.startsWith('/model/');
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone()); 
    }
    return response;
  } catch (err) {
    console.error('[SW] Cache-First gagal untuk:', request.url, err.message);
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request).then(response => {
    if (response.ok) cache.put(request, response.clone());
    return response;
  }).catch(() => null); 

  return cached || networkFetch;
}

self.addEventListener('install', (event) => {
  console.log('[SW] Install —', APP_VERSION);

  event.waitUntil(
    (async () => {
      await Promise.all([
        precacheAll(CACHE_SHELL, SHELL_ASSETS),
        precacheAll(CACHE_MODEL, MODEL_ASSETS),
      ]);
      await self.skipWaiting();
      console.log('[SW] Pra-cache selesai.');
    })()
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activate —', APP_VERSION);

  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter(key => !ALL_CACHES.includes(key))
          .map(key => {
            console.log('[SW] Hapus cache lama:', key);
            return caches.delete(key);
          })
      );
      await clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  if (isModelRequest(url)) {
    event.respondWith(cacheFirst(event.request, CACHE_MODEL));
    return;
  }

  if (isCdnRequest(url)) {
    event.respondWith(staleWhileRevalidate(event.request, CACHE_CDN));
    return;
  }

  if (url.origin === self.location.origin) {
  event.respondWith(
    cacheFirst(event.request, CACHE_SHELL).catch(() =>
      // FIX: fallback ke index.html saat offline & cache miss
      caches.match('/index.html')
    )
  );
  return;
  }

});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

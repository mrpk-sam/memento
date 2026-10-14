/// <reference lib="webworker" />
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { LIMITS } from '@memento/shared';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

const API_CACHE = 'memento-api';
const META_CACHE = 'memento-meta';
const SHARED_CACHE = 'memento-shared';
const THUMBS = (bookId: string) => `memento-thumbs-${bookId}`;
const RECENT_KEY = '/__recent-books';
const KEEP_BOOKS = 3;
const MAX_SHARED = 20;

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// App shell.
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/api\//, /^\/share-target/] }));

// Book JSON and the few calls the shelf and reader need: network first, cache only when offline.
// Not stale-while-revalidate: the app refetches right after every save, and a cached answer
// there would undo the edit on screen. The app's own query cache already shows data instantly.
registerRoute(
  ({ url, request }) => request.method === 'GET' && url.origin === self.location.origin && /^\/api\/(books\/[\w-]+|library|themes|me)$/.test(url.pathname),
  new NetworkFirst({ cacheName: API_CACHE, plugins: [new ExpirationPlugin({ maxEntries: 60 })] }),
);

// Fonts and flag images for offline reading.
registerRoute(({ url }) => url.origin === 'https://fonts.googleapis.com', new StaleWhileRevalidate({ cacheName: 'memento-fonts-css' }));
registerRoute(
  ({ url }) => url.origin === 'https://fonts.gstatic.com' || url.origin === 'https://flagcdn.com',
  new CacheFirst({ cacheName: 'memento-static', plugins: [new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 365 * 86400 })] }),
);

async function recentBooks(): Promise<string[]> {
  const res = await (await caches.open(META_CACHE)).match(RECENT_KEY);
  return res ? ((await res.json()) as string[]) : [];
}

/** Remembers the last three opened books and drops the thumbnail caches of older ones. */
async function markOpened(bookId: string, urls: string[]) {
  const list = [bookId, ...(await recentBooks()).filter((b) => b !== bookId)];
  const keep = list.slice(0, KEEP_BOOKS);
  await (await caches.open(META_CACHE)).put(RECENT_KEY, new Response(JSON.stringify(keep)));
  await Promise.all(list.slice(KEEP_BOOKS).map((b) => caches.delete(THUMBS(b))));
  // Fetch the whole book's thumbnails so it reads offline, not just the spreads already seen.
  const cache = await caches.open(THUMBS(bookId));
  for (const u of urls) {
    if (await cache.match(u)) continue;
    try {
      const res = await fetch(u, { credentials: 'same-origin' });
      if (res.ok) await cache.put(u, res);
    } catch {
      break; // offline: try again next time the book opens
    }
  }
}

self.addEventListener('message', (e) => {
  const d = e.data as { type?: string; bookId?: string; urls?: string[] } | undefined;
  if (d?.type === 'opened-book' && d.bookId) e.waitUntil(markOpened(d.bookId, d.urls ?? []));
  if (d?.type === 'signed-out') {
    e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('memento-') && k !== SHARED_CACHE).map((k) => caches.delete(k)))));
  }
});

// Photos: cache-first for recently opened books (keys never change), network for the rest.
registerRoute(
  ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/api/media/books/'),
  async ({ request, url }) => {
    const bookId = url.pathname.split('/')[4]!;
    if (!(await recentBooks()).includes(bookId)) return fetch(request);
    const cache = await caches.open(THUMBS(bookId));
    const hit = await cache.match(request.url);
    if (hit) return hit;
    const res = await fetch(request);
    if (res.ok) await cache.put(request.url, res.clone());
    return res;
  },
);

// Web Share Target: photos shared from the phone gallery land in the Photo inbox.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'POST' || url.pathname !== '/share-target') return;
  e.respondWith(
    (async () => {
      const form = await e.request.formData();
      const cache = await caches.open(SHARED_CACHE);
      // Keep only images within the upload limit, and at most MAX_SHARED of them.
      const files = form
        .getAll('photos')
        .filter((f): f is File => f instanceof File && f.type.startsWith('image/') && f.size > 0 && f.size <= LIMITS.maxUploadBytes)
        .slice(0, MAX_SHARED);
      await Promise.all(
        files.map((f, i) =>
          cache.put(`/__shared/${Date.now()}-${i}`, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream', 'x-filename': encodeURIComponent(f.name) } })),
        ),
      );
      return Response.redirect('/desk/inbox?shared=1', 303);
    })(),
  );
});

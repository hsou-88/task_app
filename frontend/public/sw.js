const CACHE_NAME = 'research-planner-v1.3';
const SCOPE_URL = new URL(self.registration.scope);
const APP_SHELL = [
  new URL('./', SCOPE_URL).toString(),
  new URL('manifest.webmanifest', SCOPE_URL).toString(),
  new URL('icon.svg', SCOPE_URL).toString(),
];
const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

async function clearOldCaches() {
  const keys = await caches.keys();
  await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
}

async function disableOnLocalhost() {
  const clientsList = await self.clients.matchAll({type: 'window'});
  const isLocalDev = clientsList.some((client) => {
    try {
      return DEV_HOSTS.has(new URL(client.url).hostname);
    } catch {
      return false;
    }
  });

  if (!isLocalDev) return false;

  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
  await self.registration.unregister();
  clientsList.forEach((client) => client.navigate(client.url));
  return true;
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(disableOnLocalhost().then((disabled) => (disabled ? undefined : clearOldCaches().then(() => self.clients.claim()))));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match(new URL('./', SCOPE_URL).toString()))),
  );
});

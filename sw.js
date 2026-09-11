// GitHub Pages 프로젝트는 같은 origin을 공유한다. 이 앱의 캐시만 관리한다.
const PREFIX = `label-ocr:${self.registration.scope}:`;
const CACHE = PREFIX + 'shell-v9';
const ASSETS = PREFIX + 'vendor-v1'; // 화면 업데이트 뒤에도 OCR 모델을 유지한다.
const PRECACHE = ['./', './index.html', './ocr-image.js', './manifest.json', './icon.png'];
const SCRIPTS = ['./vendor/tesseract.min.js', './vendor/worker.min.js'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    await (await caches.open(CACHE)).addAll(PRECACHE);
    await (await caches.open(ASSETS)).addAll(SCRIPTS);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE && name !== ASSETS)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

async function save(cache, request, response) {
  if (response.ok) {
    // 저장 공간이 부족해도 성공한 온라인 요청은 그대로 사용한다.
    try { await cache.put(request, response.clone()); } catch {}
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) || event.request.method !== 'GET') return;
  const vendor = new URL('vendor/', scope).pathname;
  event.respondWith((async () => {
    const cache = await caches.open(url.pathname.startsWith(vendor) ? ASSETS : CACHE);
    if (url.pathname.startsWith(vendor)) {
      return await cache.match(event.request) || await save(cache, event.request, await fetch(event.request));
    }
    try {
      const response = await fetch(event.request);
      if (response.status >= 500) {
        const cached = await cache.match(event.request, { ignoreSearch: true });
        if (cached) return cached;
      }
      return await save(cache, event.request, response);
    } catch {
      const cached = await cache.match(event.request, { ignoreSearch: true });
      if (cached) return cached;
      // 없는 스크립트·이미지 요청에 HTML을 돌려주지 않는다.
      if (event.request.mode === 'navigate') {
        const shell = await cache.match(new URL('index.html', scope).href);
        if (shell) return shell;
      }
      return Response.error();
    }
  })());
});

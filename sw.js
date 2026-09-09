// 오프라인 캐시. https(또는 localhost)에서만 동작한다.
// - 화면(index.html 등)은 네트워크 우선: 고친 내용이 바로 반영되게.
// - 엔진·모델(vendor/)은 캐시 우선: 한 번 받으면 다시 안 받고, 인터넷 없이도 동작.
const CACHE = 'label-ocr-v6';
const PRECACHE = ['./', './index.html', './manifest.json', './icon.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 응답을 캐시에 넣는다. waitUntil로 잡아 두어 워커가 먼저 종료되지 않게 한다.
function store(e, res) {
  if (!res || !res.ok) return res;
  const copy = res.clone();
  e.waitUntil(caches.open(CACHE).then((c) => c.put(e.request, copy)));
  return res;
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin || e.request.method !== 'GET') return;

  if (url.pathname.includes('/vendor/')) {
    // 캐시 우선
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => store(e, res)))
    );
    return;
  }

  // 네트워크 우선, 실패하면 캐시
  e.respondWith(
    fetch(e.request)
      .then((res) => store(e, res))
      .catch(() => caches.match(e.request, { ignoreSearch: true })
        .then((hit) => hit || caches.match('./index.html')))
  );
});

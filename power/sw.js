// 電力需給実績ビューアのサービスワーカー
//
// ・ネットワーク優先：オンラインなら毎回最新のファイルを取り、キャッシュも入れ替える。
//   そのため、アプリを更新して GitHub に反映するだけで、次に開いたときから新しい版になる。
// ・オフラインのときは、キャッシュに保存しておいたファイルで表示する。
// ・保存するファイル（PRECACHE）を増やしたり減らしたりしたときは、VERSION を上げる（例: power-v2）。
//   新しい版が動き始めると、古い版のキャッシュは自動で削除される。

const VERSION = 'power-v1';
const CACHE_PREFIX = 'power-';
const PRECACHE = ['./', 'index.html', 'manifest.json', 'icons/icon-192.png', 'icons/icon-512.png'];

// このファイルが置かれているフォルダ（例: https://example.github.io/web-apps/power/）
const SCOPE = new URL('./', self.location).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // GitHub Pages のブラウザキャッシュ（10分）を飛ばして、必ず最新を保存する
    await cache.addAll(PRECACHE.map(path => new Request(path, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter(name => name.startsWith(CACHE_PREFIX) && name !== VERSION)
      .map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // 同じサイトの、このフォルダの中のファイルだけを扱う（メニューやほかのアプリには触らない）
  if (req.method !== 'GET' || !req.url.startsWith(SCOPE)) return;

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) await cache.put(req, res.clone());
      return res;
    } catch (e) {
      // オフライン：保存しておいたファイルを返す。画面の表示ならアプリ本体を返す
      const cached = await cache.match(req, { ignoreSearch: req.mode === 'navigate' });
      if (cached) return cached;
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});

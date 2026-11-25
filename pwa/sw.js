/**
 * Bani の Service Worker。ビルド時に pwa/plugin.ts が
 * 事前キャッシュするファイルの一覧と、その内容から作った版を下の 2 つの定数に埋め込む。
 *
 * - インストール時にアプリのファイルをすべて取り込み、以後はネットワークなしで動く
 * - 同じオリジンへの GET はキャッシュを優先する（ファイル名にハッシュが付くので古くならない）
 * - 画面遷移は常に index.html を返す（hash ルーティングなので 1 枚で足りる）
 * - 別オリジン（サービス切り替えのスクリプトなど）には関わらない。オフラインでは読めずに消えるだけ
 *
 * 新しい版は、古い版を開いているタブがすべて閉じてから有効になる（skipWaiting しない）。
 * 開いている画面が古い版のファイルを読みに行って失敗することを避けるため。
 */
const PRECACHE = self.__BANI_PRECACHE__
const VERSION = self.__BANI_VERSION__
const CACHE_PREFIX = 'bani-'
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`
const INDEX_URL = new URL('index.html', self.registration.scope).href

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // 途中で失敗したら版ごと入れない（半端なキャッシュでオフライン起動させない）
      cache.addAll(PRECACHE.map((path) => new URL(path, self.registration.scope).href))
    )
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(INDEX_URL).then((cached) => cached ?? fetch(request))
    )
    return
  }

  event.respondWith(
    caches.match(request).then((cached) => cached ?? fetch(request))
  )
})

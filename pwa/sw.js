/**
 * Bani の Service Worker。ビルド時に pwa/plugin.ts が
 * 事前キャッシュするファイルの一覧と、その内容から作った版を下の 2 つの定数に埋め込む。
 *
 * - インストール時にアプリのファイルを取り込み、以後はネットワークなしで動く
 * - HEIC・7z・RAR を読む WASM（LAZY）だけは事前に取らず、初めて使ったときにキャッシュへ入れる。
 *   一度使えば以後はオフラインでも動く。新しい版になっても同じファイル（同じハッシュ）なら引き継ぐ
 * - 同じオリジンへの GET はキャッシュを優先する（ファイル名にハッシュが付くので古くならない）
 * - 画面遷移は常に index.html を返す（hash ルーティングなので 1 枚で足りる）
 * - 別オリジン（サービス切り替えのスクリプトなど）には関わらない。オフラインでは読めずに消えるだけ
 *
 * 新しい版は、古い版を開いているタブがすべて閉じてから有効になる（skipWaiting しない）。
 * 開いている画面が古い版のファイルを読みに行って失敗することを避けるため。
 */
/**
 * キャッシュを引くときは Vary を見ない。ES モジュールの読み込みは Origin ヘッダ付きで来るが、
 * インストール時の addAll は付けないので、Vary: Origin を返すサーバーでは一致せず、
 * オフラインで起動すると全モジュールの読み込みが失敗して真っ白になる。
 * ここに入れるのはハッシュ付きの静的ファイルだけなので、Vary を無視しても取り違えない
 */
const MATCH = { ignoreVary: true }
const PRECACHE = self.__BANI_PRECACHE__
const LAZY = self.__BANI_LAZY__
const VERSION = self.__BANI_VERSION__
const CACHE_PREFIX = 'bani-'
const CACHE_NAME = `${CACHE_PREFIX}${VERSION}`
const INDEX_URL = new URL('index.html', self.registration.scope).href
const toUrl = (path) => new URL(path, self.registration.scope).href
const LAZY_URLS = new Set(LAZY.map(toUrl))

/** 古い版のキャッシュに同じファイルがあれば、消す前に新しい版へ写す（取り直さずに済む） */
async function carryOverLazy(cache) {
  await Promise.all(
    [...LAZY_URLS].map(async (url) => {
      if (await cache.match(url, MATCH)) return
      const previous = await caches.match(url, MATCH)
      if (previous) await cache.put(url, previous)
    })
  )
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      // 途中で失敗したら版ごと入れない（半端なキャッシュでオフライン起動させない）
      cache.addAll(PRECACHE.map(toUrl))
    )
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then(carryOverLazy)
      .then(() => caches.keys())
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
      caches.match(INDEX_URL, MATCH).then((cached) => cached ?? fetch(request))
    )
    return
  }

  if (LAZY_URLS.has(url.href)) {
    event.respondWith(
      caches.match(request, MATCH).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            // 取れたものだけを入れる。オフラインで取れなければそのまま失敗させ、画面が案内を出す
            if (response.ok) {
              const copy = response.clone()
              event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)))
            }
            return response
          })
      )
    )
    return
  }

  event.respondWith(
    caches.match(request, MATCH).then((cached) => cached ?? fetch(request))
  )
})

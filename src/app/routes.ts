/** Bani が扱うメディアの種類。画面（ルート）もこの単位で分ける */
export type MediaKind = 'video' | 'audio' | 'image' | 'gif' | 'pdf' | 'text' | 'archive'

export const MEDIA_KINDS: readonly MediaKind[] = [
  'video',
  'audio',
  'image',
  // アニメーション GIF（と APNG・アニメーション WebP）。1 枚だけの GIF は画像として開く
  'gif',
  'pdf',
  'text',
  'archive',
]

/**
 * 画面の一覧。単体編集（1 ファイルを開いて非破壊編集して書き出す）と
 * 一括変換（複数ファイルを同じ設定で書き出す）はルートを分ける。
 */
export type Route =
  | { name: 'hub' }
  | { name: 'edit'; kind: MediaKind }
  | { name: 'convert' }
  /** Bani について（何をするか・版・ライセンスの一覧） */
  | { name: 'about' }
  /** path は `/a/b` の形に正規化してある */
  | { name: 'notFound'; path: string }

const isMediaKind = (value: string): value is MediaKind =>
  (MEDIA_KINDS as readonly string[]).includes(value)

/** `#/edit/video` のような hash を画面に読み替える。前後の `/` や空の区切りは無視する */
export function parseHash(hash: string): Route {
  const segments = hash
    .replace(/^#/, '')
    .split('/')
    .filter((segment) => segment !== '')

  if (segments.length === 0) return { name: 'hub' }
  if (segments.length === 1 && segments[0] === 'convert') return { name: 'convert' }
  if (segments.length === 1 && segments[0] === 'about') return { name: 'about' }
  if (segments.length === 2 && segments[0] === 'edit' && isMediaKind(segments[1])) {
    return { name: 'edit', kind: segments[1] }
  }
  return { name: 'notFound', path: `/${segments.join('/')}` }
}

/** 画面を hash に戻す。parseHash と往復させると同じ画面になる */
export function formatRoute(route: Route): string {
  switch (route.name) {
    case 'hub':
      return '#/'
    case 'edit':
      return `#/edit/${route.kind}`
    case 'convert':
      return '#/convert'
    case 'about':
      return '#/about'
    case 'notFound':
      return `#${route.path}`
  }
}

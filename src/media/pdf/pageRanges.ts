/**
 * 「1-3, 5, 8-」のようなページ範囲の指定。分割・抽出の入力欄で使う。
 * pdf-lib などには依存しない純粋な計算だけを置く。
 */

/** 1 始まり・両端を含むページ範囲。start <= end */
export interface PageRange {
  readonly start: number
  readonly end: number
}

/**
 * 読めなかった理由。表示文言は呼び出し側（i18n）で決めるので、ここでは種類と該当箇所だけを返す
 */
export type PageRangeError =
  | { code: 'empty' }
  | { code: 'syntax'; token: string }
  | { code: 'outOfRange'; token: string }
  | { code: 'reversed'; token: string }

export type ParsePageRangesResult =
  | { ok: true; ranges: PageRange[] }
  | { ok: false; error: PageRangeError }

// 全角の数字や記号は NFKC で半角になる。読点と範囲によく使われるダッシュ類だけは別に寄せる
const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .replace(/[、，]/g, ',')
    .replace(/[‐‑‒–—―−~〜]/g, '-')

const TOKEN = /^(\d+)?(-)?(\d+)?$/

/**
 * ページ範囲を読む。終わりがページ数を超えるときはページ数で切り詰める（「8-」も同じ扱い）。
 * 始まりがページの外にある・逆順・読めない書き方は、黙って捨てずに誤りとして返す。
 * 範囲の重なりや順序はそのまま残す（分割では 1 範囲が 1 ファイルになるため）。
 */
export function parsePageRanges(text: string, pageCount: number): ParsePageRangesResult {
  // 「1,,2」や末尾のカンマは打ちかけでよく出るので、空の区切りは読み飛ばす
  const tokens = normalize(text)
    .split(',')
    .map((token) => token.replace(/\s+/g, ''))
    .filter((token) => token !== '')
  if (tokens.length === 0) return { ok: false, error: { code: 'empty' } }

  const ranges: PageRange[] = []
  for (const token of tokens) {
    const match = TOKEN.exec(token)
    // 「-」単独は意図が読めないので、全体指定とはみなさない
    if (!match || (match[1] === undefined && match[3] === undefined)) {
      return { ok: false, error: { code: 'syntax', token } }
    }
    const isRange = match[2] !== undefined

    const start = match[1] === undefined ? 1 : Number(match[1])
    const end = isRange ? (match[3] === undefined ? pageCount : Number(match[3])) : start
    if (start < 1 || start > pageCount || end < 1) {
      return { ok: false, error: { code: 'outOfRange', token } }
    }
    if (end < start) return { ok: false, error: { code: 'reversed', token } }
    ranges.push({ start, end: Math.min(end, pageCount) })
  }
  return { ok: true, ranges }
}

/** parsePageRanges で読み戻せる形に書く。1 ページだけの範囲は「5」と書く */
export function formatPageRanges(ranges: readonly PageRange[]): string {
  return ranges
    .map(({ start, end }) => (start === end ? `${start}` : `${start}-${end}`))
    .join(', ')
}

/** 範囲を 0 始まりのページ番号の列に広げる。範囲の順序と重なりはそのまま */
export function pageRangesToIndices(ranges: readonly PageRange[]): number[] {
  return ranges.flatMap(({ start, end }) =>
    Array.from({ length: end - start + 1 }, (_, offset) => start - 1 + offset)
  )
}

/** size ページずつに区切った範囲。「1 ページずつ分割」などに使う */
export function chunkPageRanges(pageCount: number, size: number): PageRange[] {
  const step = Math.max(1, Math.floor(size))
  const ranges: PageRange[] = []
  for (let start = 1; start <= pageCount; start += step) {
    ranges.push({ start, end: Math.min(pageCount, start + step - 1) })
  }
  return ranges
}

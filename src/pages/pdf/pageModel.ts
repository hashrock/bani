/**
 * ページ一覧の選択と並べ替えの計算。React には依存しない純粋な関数だけを置く。
 * レシピの編集は「いまの並びでの位置」で指すが、位置は並べ替えや取り消しで変わるので、
 * 選択は位置ではなく安定した鍵で持ち、操作の直前に位置へ引き直す。
 */
import type { PdfPageRef } from '../../media/pdf'

/**
 * 並びの中の各ページの鍵。同じ入力の同じページが何度出てきても区別できるよう、
 * 何度目の登場か（occurrence）を足す。回転は鍵に含めない（回しても選択と描画済みの絵を保つため）。
 */
export function pageKeys(pages: readonly Pick<PdfPageRef, 'source' | 'page'>[]): string[] {
  const seen = new Map<string, number>()
  return pages.map(({ source, page }) => {
    const base = `${source}:${page}`
    const occurrence = seen.get(base) ?? 0
    seen.set(base, occurrence + 1)
    return `${base}:${occurrence}`
  })
}

export interface Selection {
  readonly keys: ReadonlySet<string>
  /** Shift で範囲を選ぶときの起点。最後に単独で押した（または ⌘ で足した）ページ */
  readonly anchor: string | null
}

export const emptySelection: Selection = { keys: new Set(), anchor: null }

export interface ClickModifiers {
  /** 範囲選択（Shift） */
  shift?: boolean
  /** 1 つずつ足し引きする（macOS は ⌘、ほかは Ctrl） */
  toggle?: boolean
}

/**
 * ページを押したときの選択。ファイルの一覧などと同じ約束にそろえる:
 * - そのまま押す: そのページだけ
 * - ⌘ / Ctrl: そのページを足し引きする
 * - Shift: 起点からそのページまで（⌘ も押していれば今の選択に足す）
 */
export function clickSelection(
  selection: Selection,
  keys: readonly string[],
  index: number,
  modifiers: ClickModifiers = {}
): Selection {
  const key = keys[index]
  if (key === undefined) return selection
  const anchorIndex = selection.anchor === null ? -1 : keys.indexOf(selection.anchor)

  if (modifiers.shift && anchorIndex >= 0) {
    const [from, to] = anchorIndex <= index ? [anchorIndex, index] : [index, anchorIndex]
    const next = new Set(modifiers.toggle ? selection.keys : [])
    for (let position = from; position <= to; position++) next.add(keys[position])
    // 起点は動かさない。続けて Shift で押すと、同じ起点から範囲を取り直せる
    return { keys: next, anchor: selection.anchor }
  }
  if (modifiers.toggle) {
    const next = new Set(selection.keys)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return { keys: next, anchor: key }
  }
  return { keys: new Set([key]), anchor: key }
}

export const selectAll = (keys: readonly string[]): Selection => ({
  keys: new Set(keys),
  anchor: keys[0] ?? null,
})

/** 選択中のページの位置（昇順）。並びにない鍵は無視する */
export function selectedIndices(selection: Selection, keys: readonly string[]): number[] {
  return keys.flatMap((key, index) => (selection.keys.has(key) ? [index] : []))
}

/** 削除や取り消しで並びから消えた鍵を落とす。変わらなければ同じオブジェクトを返す */
export function pruneSelection(selection: Selection, keys: readonly string[]): Selection {
  const present = new Set(keys)
  const kept = [...selection.keys].filter((key) => present.has(key))
  const anchor = selection.anchor !== null && present.has(selection.anchor) ? selection.anchor : null
  if (kept.length === selection.keys.size && anchor === selection.anchor) return selection
  return { keys: new Set(kept), anchor }
}

/** 鍵の位置で選び直す（キーボードで前後に動いたときなど） */
export const selectOnly = (keys: readonly string[], index: number): Selection =>
  keys[index] === undefined ? emptySelection : { keys: new Set([keys[index]]), anchor: keys[index] }

/**
 * ドロップした「すき間」（0 なら先頭の前、length なら末尾の後ろ）を、
 * applyPdfEdit の move が受け取る to（選んだページを抜いた残りの並びでの位置）に直す。
 * すき間より前にある選択中のページの数だけ前に詰める。
 */
export function dropSlotToMoveTarget(slot: number, indices: readonly number[]): number {
  const moving = new Set(indices)
  let before = 0
  for (const index of moving) if (index < slot) before++
  return Math.max(0, slot - before)
}

/**
 * 選んだページを 1 つ左（-1）か右（+1）へ動かすときの to。ドラッグの代わりのキーボード操作に使う。
 * 離れた選択はひとまとめにして、左なら先頭の 1 つ前、右なら末尾の 1 つ後ろへ置く。
 * それ以上動けないときは null（履歴に無駄な段を積まないよう、呼び出し側は何もしない）。
 */
export function stepMoveTarget(
  indices: readonly number[],
  delta: -1 | 1,
  length: number
): number | null {
  const sorted = [...new Set(indices)]
    .filter((index) => Number.isInteger(index) && index >= 0 && index < length)
    .sort((a, b) => a - b)
  if (sorted.length === 0) return null
  const first = sorted[0]
  const last = sorted[sorted.length - 1]
  const contiguous = last - first + 1 === sorted.length
  const restLength = length - sorted.length
  if (delta < 0) {
    // ひとまとまりで先頭にあれば動けない。離れていれば、まず先頭に寄せるだけでも動いたことになる
    if (first === 0 && contiguous) return null
    return Math.max(0, first - 1)
  }
  if (last === length - 1 && contiguous) return null
  // 末尾のページの後ろにある残りのページのうち 1 つを越える
  return Math.min(restLength, last + 1 - sorted.length + 1)
}

/**
 * ポインタがページの左半分にあればそのページの前、右半分なら後ろのすき間。
 * 格子が折り返しても、同じ行の中で左右を比べれば足りる。
 */
export function slotFromPointer(index: number, offsetX: number, width: number): number {
  return offsetX < width / 2 ? index : index + 1
}

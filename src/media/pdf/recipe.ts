import type { PageRange } from './pageRanges'

/**
 * PDF の非破壊編集。出力する文書を「どの入力の何ページ目を、どれだけ回して並べるか」の
 * 列だけで表す。並べ替え・削除・回転・抽出・複数 PDF の結合はすべてこの 1 つの形で済む。
 * 元ファイルは持たないので、入力ファイルの配列は呼び出し側が順序を保って持つ。
 */

export type PdfRotation = 0 | 90 | 180 | 270

export interface PdfPageRef {
  /** 入力ファイルの配列での位置 */
  readonly source: number
  /** その入力での 0 始まりのページ番号 */
  readonly page: number
  /** 元のページに付いている回転に、さらに足す時計回りの角度 */
  readonly rotate: PdfRotation
}

export interface PdfRecipe {
  readonly pages: readonly PdfPageRef[]
}

/** 編集に必要な入力の情報。ページ数だけあればよい */
export interface PdfSourceShape {
  readonly pageCount: number
}

/**
 * 編集操作。indices は出力側（いまのレシピ）での 0 始まりの位置。
 * 範囲外や重複した位置は無視する（選択状態が古くなっていても壊れないように）。
 */
export type PdfEdit =
  /** 選んだページを相対順を保ったまま、残りのページ列の to の位置へ差し込む */
  | { type: 'move'; indices: readonly number[]; to: number }
  | { type: 'remove'; indices: readonly number[] }
  | { type: 'rotate'; indices: readonly number[]; by: PdfRotation | -90 }
  /** 入力 1 つ分の全ページを末尾に足す（結合） */
  | { type: 'appendSource'; source: number }
  /** 1 始まりの範囲に入るページだけを残す（抽出）。順序はいまのまま */
  | { type: 'keepRanges'; ranges: readonly PageRange[] }

const sourcePages = (source: number, pageCount: number): PdfPageRef[] =>
  Array.from({ length: pageCount }, (_, page) => ({ source, page, rotate: 0 }))

/** 入力を渡された順にすべてつないだレシピ。1 つだけなら「元のまま」になる */
export function createPdfRecipe(sources: readonly PdfSourceShape[]): PdfRecipe {
  return { pages: sources.flatMap((info, source) => sourcePages(source, info.pageCount)) }
}

export const normalizeRotation = (degrees: number): PdfRotation =>
  ((((Math.round(degrees / 90) * 90) % 360) + 360) % 360) as PdfRotation

/** 有効な位置だけを昇順・重複なしにそろえる */
function selection(indices: readonly number[], length: number): Set<number> {
  return new Set(indices.filter((index) => Number.isInteger(index) && index >= 0 && index < length))
}

/** 中身が変わらないときは元のオブジェクトを返し、履歴に無駄な段を積まないようにする */
function withPages(recipe: PdfRecipe, pages: PdfPageRef[]): PdfRecipe {
  const unchanged =
    pages.length === recipe.pages.length && pages.every((page, index) => page === recipe.pages[index])
  return unchanged ? recipe : { pages }
}

/**
 * 編集を 1 つ適用した新しいレシピを返す純粋関数。
 * 入力にないページを指すレシピは作らない（不正な appendSource は無視する）。
 */
export function applyPdfEdit(
  recipe: PdfRecipe,
  edit: PdfEdit,
  sources: readonly PdfSourceShape[]
): PdfRecipe {
  const { pages } = recipe
  switch (edit.type) {
    case 'move': {
      const selected = selection(edit.indices, pages.length)
      if (selected.size === 0) return recipe
      const moving = pages.filter((_, index) => selected.has(index))
      const rest = pages.filter((_, index) => !selected.has(index))
      const to = Math.max(0, Math.min(rest.length, Math.trunc(edit.to)))
      return withPages(recipe, [...rest.slice(0, to), ...moving, ...rest.slice(to)])
    }
    case 'remove': {
      const selected = selection(edit.indices, pages.length)
      return withPages(
        recipe,
        pages.filter((_, index) => !selected.has(index))
      )
    }
    case 'rotate': {
      const selected = selection(edit.indices, pages.length)
      const by = normalizeRotation(edit.by)
      if (selected.size === 0 || by === 0) return recipe
      return withPages(
        recipe,
        pages.map((page, index) =>
          selected.has(index) ? { ...page, rotate: normalizeRotation(page.rotate + by) } : page
        )
      )
    }
    case 'appendSource': {
      const info = sources[edit.source]
      if (!Number.isInteger(edit.source) || !info || info.pageCount <= 0) return recipe
      return { pages: [...pages, ...sourcePages(edit.source, info.pageCount)] }
    }
    case 'keepRanges': {
      const kept = new Set<number>()
      for (const { start, end } of edit.ranges) {
        for (let position = Math.max(1, start); position <= Math.min(end, pages.length); position++) {
          kept.add(position - 1)
        }
      }
      return withPages(
        recipe,
        pages.filter((_, index) => kept.has(index))
      )
    }
  }
}

/** レシピのすべてのページが入力の中にあるか。書き出しの前に確かめる */
export function isPdfRecipeValid(recipe: PdfRecipe, sources: readonly PdfSourceShape[]): boolean {
  return recipe.pages.every(
    ({ source, page }) =>
      Number.isInteger(source) &&
      Number.isInteger(page) &&
      source >= 0 &&
      source < sources.length &&
      page >= 0 &&
      page < sources[source].pageCount
  )
}

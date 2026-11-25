import { basename, createPathRegistry, dirname, joinPath, sanitizePath, sanitizeSegment } from './names'

/**
 * ZIP を作るときの中身の指定（非破壊編集のレシピ）。元ファイルそのものは持たず id で指し、
 * 作るときに id → Blob の対応を渡す。レシピを軽いまま履歴に積め、保存もしやすい。
 */

/** 0 は無圧縮、9 がいちばん縮む（遅い）。zip・gzip の deflate の段階そのまま */
export type CompressionLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9

export const DEFAULT_COMPRESSION_LEVEL: CompressionLevel = 6

export interface ArchiveItem {
  /** 元ファイルを指す id。作るときに渡す sources のキー */
  id: string
  /** 圧縮ファイルの中のパス。無害化済みで、レシピの中で一意（大文字小文字の違いも同じとみなす） */
  path: string
  /** 一覧に大きさを出すため、追加したときの元ファイルの大きさを控えておく */
  size: number
  /** 中のファイルの更新日時（ミリ秒） */
  lastModified: number
}

export interface ArchiveRecipe {
  /** できあがる圧縮ファイルの名前（拡張子なし） */
  name: string
  level: CompressionLevel
  /** 圧縮ファイルに入れる順 */
  items: readonly ArchiveItem[]
}

export type ArchiveEdit =
  /** 末尾に足す。パスが重なれば「名前 (2).拡張子」にずらす。すでにある id は無視する */
  | { type: 'add'; items: readonly ArchiveItem[] }
  | { type: 'remove'; ids: readonly string[] }
  /** ファイル名だけを変える（フォルダはそのまま） */
  | { type: 'rename'; id: string; name: string }
  /** フォルダへ移す。'' は根。'a/b' のように入れ子も指定でき、なければ作る */
  | { type: 'move'; ids: readonly string[]; folder: string }
  | { type: 'setLevel'; level: number }
  | { type: 'setName'; name: string }

export function createArchiveRecipe(name = 'archive'): ArchiveRecipe {
  return { name, level: DEFAULT_COMPRESSION_LEVEL, items: [] }
}

const clampLevel = (level: number): CompressionLevel =>
  (Number.isFinite(level) ? Math.min(9, Math.max(0, Math.round(level))) : DEFAULT_COMPRESSION_LEVEL) as CompressionLevel

/**
 * items を先頭から順に並べ直したときのパス。changed の項目だけ新しいパスを希望として出し、
 * ほかの項目は今のパスのまま先に確保する（動かしていないものの名前が変わらないように）。
 */
function placeItems(items: readonly ArchiveItem[], desired: ReadonlyMap<string, string>): ArchiveItem[] {
  const registry = createPathRegistry()
  const placed = new Map<string, string>()
  for (const item of items) if (!desired.has(item.id)) placed.set(item.id, registry.claimFile(item.path))
  for (const item of items) {
    const wish = desired.get(item.id)
    if (wish !== undefined) placed.set(item.id, registry.claimFile(sanitizePath(wish) || 'untitled'))
  }
  return items.map((item) => {
    const path = placed.get(item.id)!
    return path === item.path ? item : { ...item, path }
  })
}

const unchanged = (before: readonly ArchiveItem[], after: readonly ArchiveItem[]) =>
  before.length === after.length && before.every((item, i) => item === after[i])

/**
 * 編集を 1 つ当てた新しいレシピを返す純粋関数。
 * 何も変わらない編集は同じオブジェクトを返すので、そのまま pushHistory に渡してよい。
 */
export function applyArchiveEdit(recipe: ArchiveRecipe, edit: ArchiveEdit): ArchiveRecipe {
  switch (edit.type) {
    case 'add': {
      const known = new Set(recipe.items.map((item) => item.id))
      // 同じ id が 2 回来ても 1 つだけ入れる
      const added = edit.items.filter((item) => !known.has(item.id) && known.add(item.id))
      if (added.length === 0) return recipe
      const items = placeItems([...recipe.items, ...added], new Map(added.map((item) => [item.id, item.path])))
      return { ...recipe, items }
    }
    case 'remove': {
      const ids = new Set(edit.ids)
      const items = recipe.items.filter((item) => !ids.has(item.id))
      return items.length === recipe.items.length ? recipe : { ...recipe, items }
    }
    case 'rename': {
      const item = recipe.items.find((candidate) => candidate.id === edit.id)
      const name = sanitizeSegment(edit.name)
      if (!item || name === '') return recipe
      const items = placeItems(recipe.items, new Map([[item.id, joinPath(dirname(item.path), name)]]))
      return unchanged(recipe.items, items) ? recipe : { ...recipe, items }
    }
    case 'move': {
      const folder = sanitizePath(edit.folder)
      const ids = new Set(edit.ids)
      const desired = new Map(
        recipe.items.filter((item) => ids.has(item.id)).map((item) => [item.id, joinPath(folder, basename(item.path))])
      )
      if (desired.size === 0) return recipe
      const items = placeItems(recipe.items, desired)
      return unchanged(recipe.items, items) ? recipe : { ...recipe, items }
    }
    case 'setLevel': {
      const level = clampLevel(edit.level)
      return level === recipe.level ? recipe : { ...recipe, level }
    }
    case 'setName': {
      const name = sanitizeSegment(edit.name)
      return name === '' || name === recipe.name ? recipe : { ...recipe, name }
    }
  }
}

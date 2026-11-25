import type { TextEncodingName } from './encoding'
import { supportsBom } from './encoding'

/**
 * テキストの非破壊編集。レシピは不変オブジェクトで、元の文字列は持たない。
 * 本文への変換（transformText）も、書き出し先の決定（resolveTextOutput）も純粋関数にしておき、
 * 画面の下見と書き出しで同じ結果になることを保証する。
 */

export type NewlineSetting = 'keep' | 'lf' | 'crlf' | 'cr'
export type BomSetting = 'keep' | 'add' | 'remove'

export interface TextReplacement {
  /** 並べ替えや削除で指す名前。画面側で一意なものを作って渡す */
  readonly id: string
  readonly find: string
  readonly replace: string
  /** true なら find を正規表現（u・m フラグ付き）、replace の $1 などを置換パターンとして扱う */
  readonly regex: boolean
  readonly caseSensitive: boolean
}

export interface TextRecipe {
  /** keep は読み込んだときの文字コードのまま */
  readonly encoding: 'keep' | TextEncodingName
  readonly bom: BomSetting
  readonly newline: NewlineSetting
  /** 各行末の空白（全角空白・タブを含む）を落とす */
  readonly trimTrailingWhitespace: boolean
  /** 全角の英数字・記号（U+FF01〜U+FF5E）を半角にする。全角空白は字下げに使われるので残す */
  readonly halfwidthAscii: boolean
  /** 半角カナを全角にする（濁点は 1 文字にまとめる） */
  readonly fullwidthKana: boolean
  /** 上から順に適用する */
  readonly replacements: readonly TextReplacement[]
}

/** 何もしないレシピ。読んだものをそのまま書き出す */
export const DEFAULT_TEXT_RECIPE: TextRecipe = {
  encoding: 'keep',
  bom: 'keep',
  newline: 'keep',
  trimTrailingWhitespace: false,
  halfwidthAscii: false,
  fullwidthKana: false,
  replacements: [],
}

export type TextEdit =
  | { type: 'setEncoding'; encoding: TextRecipe['encoding'] }
  | { type: 'setBom'; bom: BomSetting }
  | { type: 'setNewline'; newline: NewlineSetting }
  | { type: 'setTrimTrailingWhitespace'; value: boolean }
  | { type: 'setHalfwidthAscii'; value: boolean }
  | { type: 'setFullwidthKana'; value: boolean }
  /** index を省くと末尾に足す。同じ id がすでにあれば何もしない */
  | { type: 'addReplacement'; replacement: TextReplacement; index?: number }
  | { type: 'updateReplacement'; id: string; patch: Partial<Omit<TextReplacement, 'id'>> }
  | { type: 'removeReplacement'; id: string }
  /** to は移動後の位置。範囲外は端に寄せる */
  | { type: 'moveReplacement'; id: string; to: number }
  | { type: 'reset' }

const setField = <K extends keyof TextRecipe>(recipe: TextRecipe, key: K, value: TextRecipe[K]): TextRecipe =>
  recipe[key] === value ? recipe : { ...recipe, [key]: value }

const clampIndex = (index: number, length: number) =>
  Math.max(0, Math.min(length, Number.isFinite(index) ? Math.trunc(index) : length))

/**
 * 編集を 1 つ適用した新しいレシピを返す。中身が変わらない編集では同じオブジェクトを返すので、
 * 履歴（pushHistory）に無駄な段が積まれない
 */
export function applyTextEdit(recipe: TextRecipe, edit: TextEdit): TextRecipe {
  switch (edit.type) {
    case 'setEncoding':
      return setField(recipe, 'encoding', edit.encoding)
    case 'setBom':
      return setField(recipe, 'bom', edit.bom)
    case 'setNewline':
      return setField(recipe, 'newline', edit.newline)
    case 'setTrimTrailingWhitespace':
      return setField(recipe, 'trimTrailingWhitespace', edit.value)
    case 'setHalfwidthAscii':
      return setField(recipe, 'halfwidthAscii', edit.value)
    case 'setFullwidthKana':
      return setField(recipe, 'fullwidthKana', edit.value)
    case 'addReplacement': {
      if (recipe.replacements.some((r) => r.id === edit.replacement.id)) return recipe
      const list = [...recipe.replacements]
      list.splice(clampIndex(edit.index ?? list.length, list.length), 0, edit.replacement)
      return { ...recipe, replacements: list }
    }
    case 'updateReplacement': {
      const index = recipe.replacements.findIndex((r) => r.id === edit.id)
      if (index < 0) return recipe
      const current = recipe.replacements[index]
      const next = { ...current, ...edit.patch, id: current.id }
      const same = (Object.keys(next) as (keyof TextReplacement)[]).every((k) => next[k] === current[k])
      if (same) return recipe
      const list = [...recipe.replacements]
      list[index] = next
      return { ...recipe, replacements: list }
    }
    case 'removeReplacement': {
      if (!recipe.replacements.some((r) => r.id === edit.id)) return recipe
      return { ...recipe, replacements: recipe.replacements.filter((r) => r.id !== edit.id) }
    }
    case 'moveReplacement': {
      const from = recipe.replacements.findIndex((r) => r.id === edit.id)
      if (from < 0) return recipe
      const list = [...recipe.replacements]
      const [item] = list.splice(from, 1)
      const to = clampIndex(edit.to, list.length)
      if (to === from) return recipe
      list.splice(to, 0, item)
      return { ...recipe, replacements: list }
    }
    case 'reset':
      return isDefaultTextRecipe(recipe) ? recipe : DEFAULT_TEXT_RECIPE
  }
}

/** 何も変えないレシピか（置換は 1 つもない状態のみ。無効な置換が残っていても「編集あり」とする） */
export function isDefaultTextRecipe(recipe: TextRecipe): boolean {
  return (
    recipe.encoding === 'keep' &&
    recipe.bom === 'keep' &&
    recipe.newline === 'keep' &&
    !recipe.trimTrailingWhitespace &&
    !recipe.halfwidthAscii &&
    !recipe.fullwidthKana &&
    recipe.replacements.length === 0
  )
}

/** 読み込んだときの状態。'keep' の解決に使う */
export interface TextSource {
  encoding: TextEncodingName
  bom: boolean
}

/**
 * 実際に書き出す文字コードと BOM の有無。BOM を持てない文字コードでは指定にかかわらず付けない。
 * 'keep' で元に BOM があれば、Unicode 系の別の文字コードへ変えても BOM を保つ
 */
export function resolveTextOutput(recipe: TextRecipe, source: TextSource): TextSource {
  const encoding = recipe.encoding === 'keep' ? source.encoding : recipe.encoding
  const wanted = recipe.bom === 'keep' ? source.bom : recipe.bom === 'add'
  return { encoding, bom: wanted && supportsBom(encoding) }
}

export type CompiledReplacement =
  | { ok: true; pattern: RegExp | null }
  | { ok: false; error: string }

// u フラグでは構文文字と / 以外のエスケープが不正になるので、それだけを逃がす
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')

/**
 * 置換を正規表現にする。正規表現として不正なものは例外にせず理由を返す。
 * 空の検索語（正規表現モード以外）は「何もしない」とし、pattern を null にする
 */
export function compileReplacement(replacement: TextReplacement): CompiledReplacement {
  const flags = replacement.caseSensitive ? 'gmu' : 'gimu'
  if (!replacement.regex) {
    if (replacement.find === '') return { ok: true, pattern: null }
    return { ok: true, pattern: new RegExp(escapeRegExp(replacement.find), flags) }
  }
  try {
    return { ok: true, pattern: new RegExp(replacement.find, flags) }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

export type ReplacementOutcome =
  | { id: string; ok: true; count: number }
  | { id: string; ok: false; error: string }

export interface TextTransformResult {
  text: string
  /** 置換ごとの結果。不正な正規表現は飛ばして、ここで知らせる */
  replacements: ReplacementOutcome[]
}

/** 全角英数字・記号（U+FF01〜U+FF5E）は ASCII と同じ並びなので、差を引くだけで半角になる */
const toHalfwidthAscii = (text: string) =>
  text.replace(/[\uff01-\uff5e]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))

/** 半角カナは NFKC で全角になり、後続の濁点・半濁点も 1 文字に合成される */
const toFullwidthKana = (text: string) => text.replace(/[\uff61-\uff9f]+/g, (s) => s.normalize('NFKC'))

/** 行末の空白。\s から改行だけを除いた集合 */
const TRAILING_WHITESPACE = /[^\S\r\n]+$/

/**
 * 各行の末尾の空白を落とす。CR だけの改行と LF の間にある空白だけの行を空にすると、
 * CR と LF がくっついて CRLF 1 つに化け、行が減ってしまう。その行だけは触らない
 */
function trimTrailingWhitespace(text: string): string {
  // 分割の結果は 行, 改行, 行, 改行, … の順に並ぶ
  const parts = text.split(/(\r\n|\r|\n)/)
  for (let i = 0; i < parts.length; i += 2) {
    const trimmed = parts[i].replace(TRAILING_WHITESPACE, '')
    if (trimmed === '' && parts[i - 1] === '\r' && parts[i + 1]?.startsWith('\n')) continue
    parts[i] = trimmed
  }
  return parts.join('')
}

const NEWLINE = /\r\n|\r|\n/g
const NEWLINE_CHARS = { lf: '\n', crlf: '\r\n', cr: '\r' } as const

export function convertNewlines(text: string, newline: NewlineSetting): string {
  return newline === 'keep' ? text : text.replace(NEWLINE, NEWLINE_CHARS[newline])
}

function applyReplacement(text: string, replacement: TextReplacement): { text: string; outcome: ReplacementOutcome } {
  const compiled = compileReplacement(replacement)
  const { id } = replacement
  if (!compiled.ok) return { text, outcome: { id, ok: false, error: compiled.error } }
  if (!compiled.pattern) return { text, outcome: { id, ok: true, count: 0 } }
  const pattern = compiled.pattern
  if (replacement.regex) {
    // $1 などの展開は標準の replace に任せ、件数だけ先に数える
    const count = text.match(pattern)?.length ?? 0
    return { text: count === 0 ? text : text.replace(pattern, replacement.replace), outcome: { id, ok: true, count } }
  }
  // 文字どおりの置換では replace の $ を展開させない
  let count = 0
  const next = text.replace(pattern, () => {
    count++
    return replacement.replace
  })
  return { text: count === 0 ? text : next, outcome: { id, ok: true, count } }
}

/**
 * レシピを本文に当てる。順序は 幅の統一 → 置換（上から）→ 行末の空白 → 改行コード。
 * 置換は元の改行コードのままの本文を見る（改行を含む検索語は元のファイルに合わせて書く）。
 * 例外は投げず、不正な置換は飛ばして結果に含める
 */
export function transformText(text: string, recipe: TextRecipe): TextTransformResult {
  let out = text
  if (recipe.halfwidthAscii) out = toHalfwidthAscii(out)
  if (recipe.fullwidthKana) out = toFullwidthKana(out)
  const replacements: ReplacementOutcome[] = []
  for (const replacement of recipe.replacements) {
    const result = applyReplacement(out, replacement)
    out = result.text
    replacements.push(result.outcome)
  }
  if (recipe.trimTrailingWhitespace) out = trimTrailingWhitespace(out)
  out = convertNewlines(out, recipe.newline)
  return { text: out, replacements }
}

/** 書き出しの前に見せる、置換の不備の一覧 */
export function invalidReplacements(recipe: TextRecipe): { id: string; error: string }[] {
  return recipe.replacements.flatMap((r) => {
    const compiled = compileReplacement(r)
    return compiled.ok ? [] : [{ id: r.id, error: compiled.error }]
  })
}

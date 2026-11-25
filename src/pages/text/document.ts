import type {
  NewlineCounts,
  NewlineStyle,
  TextEncodingName,
  TextRecipe,
  UnrepresentableChar,
} from '../../media/text'
import {
  DEFAULT_TEXT_RECIPE,
  UnrepresentableCharactersError,
  convertNewlines,
  encodeText,
  mimeTypeFor,
  resolveTextOutput,
  srtToVtt,
  transformText,
  vttToSrt,
} from '../../media/text'
import type { SubtitleKind } from './language'
import { withExtension } from './language'

/**
 * エディタの本文と、保存するファイルのあいだの約束事。
 *
 * エディタ（CodeMirror）は改行を \n にそろえて持つので、元の改行コードは本文から消える。
 * そこで「どう書くか」（文字コード・BOM・改行）は基準（TextBase）とレシピで持ち、保存のときに当てる。
 * 保存したら、保存した中身が次の基準になる（上書きしても画面は作り直さない）
 */

export type Newline = 'lf' | 'crlf' | 'cr'

export interface TextBase {
  /** 保存するときの名前 */
  name: string
  /** 元の MIME（charset は除く）。書き出しの Blob の種類に使う */
  type: string
  encoding: TextEncodingName
  bom: boolean
  /** 保存で使う改行。混在・改行なしのファイルは、いちばん多いもの（なければ LF）に決めておく */
  newline: Newline
  /** 読み込んだときの改行の様子（表示用） */
  newlineDetected: NewlineStyle
  /** 字幕なら形式 */
  subtitle: SubtitleKind | null
}

/** いちばん多い改行。同数なら LF → CRLF → CR の順に選ぶ */
export function dominantNewline(counts: NewlineCounts): Newline {
  const order: Newline[] = ['lf', 'crlf', 'cr']
  return order.reduce((best, kind) => (counts[kind] > counts[best] ? kind : best), 'lf')
}

export function outputNewline(recipe: TextRecipe, base: TextBase): Newline {
  return recipe.newline === 'keep' ? base.newline : recipe.newline
}

/** 書き方（文字コード・BOM・改行・字幕の形式）が、基準から変わっているか */
export function isFormatChanged(base: TextBase, recipe: TextRecipe, subtitleTarget: SubtitleKind | null): boolean {
  const output = resolveTextOutput(recipe, base)
  return (
    output.encoding !== base.encoding ||
    output.bom !== base.bom ||
    outputNewline(recipe, base) !== base.newline ||
    (base.subtitle !== null && subtitleTarget !== null && subtitleTarget !== base.subtitle)
  )
}

/**
 * 本文が保存したときから変わったか。長さが違えばすぐにわかるので、同じ長さのときだけ中身を比べる
 * （数 MB の本文で、打鍵のたびに全体を比べないため）
 */
export function isDocModified<T extends { length: number; eq(other: T): boolean }>(current: T, saved: T): boolean {
  if (current === saved) return false
  if (current.length !== saved.length) return true
  return !current.eq(saved)
}

/** 保存の前に本文へ当てる整理。エディタの本文にも当てて、画面と保存した中身を一致させる */
export interface ContentTools {
  trimTrailingWhitespace: boolean
  halfwidthAscii: boolean
  fullwidthKana: boolean
}

export function applyContentTools(text: string, tools: Partial<ContentTools>): string {
  return transformText(text, {
    ...DEFAULT_TEXT_RECIPE,
    trimTrailingWhitespace: tools.trimTrailingWhitespace ?? false,
    halfwidthAscii: tools.halfwidthAscii ?? false,
    fullwidthKana: tools.fullwidthKana ?? false,
  }).text
}

/**
 * a を b にする最小の差し替え（共通の先頭と末尾を除いた範囲）。
 * 全体を差し替えるとカーソルや折りたたみが先頭に飛ぶので、変わった範囲だけを渡す
 */
export function minimalChange(a: string, b: string): { from: number; to: number; insert: string } | null {
  if (a === b) return null
  let start = 0
  const limit = Math.min(a.length, b.length)
  while (start < limit && a.charCodeAt(start) === b.charCodeAt(start)) start++
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a.charCodeAt(endA - 1) === b.charCodeAt(endB - 1)) {
    endA--
    endB--
  }
  return { from: start, to: endA, insert: b.slice(start, endB) }
}

const SUBTITLE_MIME: Record<SubtitleKind, string> = { srt: 'application/x-subrip', vtt: 'text/vtt' }

export interface PreparedText {
  /** 保存する文字列（改行は書き出す改行コード） */
  text: string
  /** エディタに置く形の本文（改行は \n）。字幕の形式を変えたときはエディタもこれに差し替える */
  editorText: string
  filename: string
  type: string
  encoding: TextEncodingName
  bom: boolean
  newline: Newline
  subtitle: SubtitleKind | null
  /** 字幕の形式を変えたときに、読めずに落としたブロックの数 */
  droppedBlocks: number
}

/** エディタの本文（改行は \n）を、保存する文字列にする（文字コードにする前まで） */
export function prepareText(
  editorText: string,
  base: TextBase,
  recipe: TextRecipe,
  subtitleTarget: SubtitleKind | null
): PreparedText {
  let body = editorText
  let filename = base.name
  let type = base.type
  let subtitle = base.subtitle
  let droppedBlocks = 0
  if (base.subtitle && subtitleTarget && subtitleTarget !== base.subtitle) {
    const converted = base.subtitle === 'srt' ? srtToVtt(body) : vttToSrt(body)
    body = convertNewlines(converted.text, 'lf')
    droppedBlocks = converted.errors.length
    filename = withExtension(base.name, subtitleTarget)
    type = SUBTITLE_MIME[subtitleTarget]
    subtitle = subtitleTarget
  }
  const newline = outputNewline(recipe, base)
  const output = resolveTextOutput(recipe, base)
  return {
    text: convertNewlines(body, newline),
    editorText: body,
    filename,
    type,
    encoding: output.encoding,
    bom: output.bom,
    newline,
    subtitle,
    droppedBlocks,
  }
}

export interface EncodedOutput {
  blob: Blob
  unrepresentable: UnrepresentableChar[]
}

/**
 * 文字コードにして Blob にする。表せない文字があれば、置き換えを許されていない限り
 * UnrepresentableCharactersError で止める（黙って ? に化けさせない）
 */
export function encodePrepared(prepared: PreparedText, options: { replaceUnrepresentable: boolean }): EncodedOutput {
  const { bytes, unrepresentable } = encodeText(prepared.text, prepared.encoding, prepared.bom)
  if (unrepresentable.length > 0 && !options.replaceUnrepresentable) {
    throw new UnrepresentableCharactersError(prepared.encoding, unrepresentable)
  }
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], {
    type: mimeTypeFor(prepared.encoding, prepared.type || 'text/plain'),
  })
  return { blob, unrepresentable }
}

/** 保存したあとの基準。保存した中身の書き方がそのまま次の基準になる */
export function baseAfterSave(base: TextBase, prepared: PreparedText, savedName?: string): TextBase {
  return {
    ...base,
    name: savedName ?? prepared.filename,
    type: prepared.type,
    encoding: prepared.encoding,
    bom: prepared.bom,
    newline: prepared.newline,
    newlineDetected: prepared.newline,
    subtitle: prepared.subtitle,
  }
}

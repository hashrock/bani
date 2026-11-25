import type { RenderOptions, RenderedFile } from '../types'
import type { UnrepresentableChar } from './encoding'
import { encodeText, mimeTypeFor } from './encoding'
import { probeText } from './probe'
import type { ReplacementOutcome, TextRecipe } from './recipe'
import { resolveTextOutput, transformText } from './recipe'

export interface TextRenderOptions extends RenderOptions {
  /**
   * 書き出し先で表せない文字があったときの扱い。
   * 'error'（既定）は書き出さずに UnrepresentableCharactersError で止める。
   * 'replace' は `?` に置き換えて書き出し、結果の unrepresentable で知らせる
   */
  unrepresentable?: 'error' | 'replace'
}

export interface RenderedText extends RenderedFile {
  unrepresentable: UnrepresentableChar[]
  /** 置換ごとの件数と、不正で飛ばした置換 */
  replacements: ReplacementOutcome[]
}

/** 表せない文字のせいで書き出しを止めた。一覧を画面に出して、文字コードを変えるか置き換えを選んでもらう */
export class UnrepresentableCharactersError extends Error {
  readonly characters: UnrepresentableChar[]
  readonly encoding: string

  constructor(encoding: string, characters: UnrepresentableChar[]) {
    super(`${characters.length} character(s) cannot be represented in ${encoding}`)
    this.name = 'UnrepresentableCharactersError'
    this.encoding = encoding
    this.characters = characters
  }
}

/**
 * 元ファイル + レシピ から書き出す。ファイル名は変えない（中身の文字コードが変わるだけなので）。
 * 不正な正規表現は例外にせず、飛ばしたうえで結果の replacements で知らせる
 */
export async function renderText(
  file: File,
  recipe: TextRecipe,
  options: TextRenderOptions = {}
): Promise<RenderedText> {
  const { signal, onProgress } = options
  signal?.throwIfAborted()
  onProgress?.(0)
  const info = await probeText(file)
  signal?.throwIfAborted()
  onProgress?.(0.4)

  const { text, replacements } = transformText(info.text, recipe)
  signal?.throwIfAborted()
  onProgress?.(0.7)

  const output = resolveTextOutput(recipe, info)
  const { bytes, unrepresentable } = encodeText(text, output.encoding, output.bom)
  if (unrepresentable.length > 0 && (options.unrepresentable ?? 'error') === 'error') {
    throw new UnrepresentableCharactersError(output.encoding, unrepresentable)
  }
  signal?.throwIfAborted()
  onProgress?.(1)

  // 元の種類（text/csv など）は保ち、charset だけ付け直す
  const baseType = file.type.split(';')[0].trim() || 'text/plain'
  return {
    blob: new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeTypeFor(output.encoding, baseType) }),
    filename: file.name,
    unrepresentable,
    replacements,
  }
}

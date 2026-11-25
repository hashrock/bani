import type { TextEncodingName } from './encoding'
import { decodeBytes, detectEncoding, looksBinary } from './encoding'

export type NewlineStyle = 'lf' | 'crlf' | 'cr' | 'mixed' | 'none'

export interface NewlineCounts {
  lf: number
  crlf: number
  cr: number
}

export interface TextInfo {
  encoding: TextEncodingName
  bom: boolean
  newline: NewlineStyle
  newlineCounts: NewlineCounts
  /** BOM を除いた本文 */
  text: string
  /** 末尾が改行で終わる場合、その後ろの空行は数えない（エディタの行数表示と同じ） */
  lineCount: number
  /** 読めないバイトを U+FFFD に置き換えた */
  hasDecodeErrors: boolean
  /** NUL や制御文字が多く、文章ではなさそう */
  likelyBinary: boolean
}

export function countNewlines(text: string): NewlineCounts {
  const counts = { lf: 0, crlf: 0, cr: 0 }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x0d) {
      if (text.charCodeAt(i + 1) === 0x0a) {
        counts.crlf++
        i++
      } else counts.cr++
    } else if (c === 0x0a) counts.lf++
  }
  return counts
}

export function newlineStyle(counts: NewlineCounts): NewlineStyle {
  const kinds = (['lf', 'crlf', 'cr'] as const).filter((k) => counts[k] > 0)
  if (kinds.length === 0) return 'none'
  return kinds.length === 1 ? kinds[0] : 'mixed'
}

export function countLines(text: string, counts = countNewlines(text)): number {
  if (text.length === 0) return 0
  const breaks = counts.lf + counts.crlf + counts.cr
  const endsWithBreak = text.endsWith('\n') || text.endsWith('\r')
  return endsWithBreak ? breaks : breaks + 1
}

/** バイト列から読み取れる情報。ファイル読み込みと切り離して、フィクスチャで確かめられるようにする */
export function probeTextBytes(bytes: Uint8Array): TextInfo {
  const { encoding, bom } = detectEncoding(bytes)
  const { text, hasDecodeErrors } = decodeBytes(bytes, encoding)
  const newlineCounts = countNewlines(text)
  return {
    encoding,
    bom,
    newline: newlineStyle(newlineCounts),
    newlineCounts,
    text,
    lineCount: countLines(text, newlineCounts),
    hasDecodeErrors,
    likelyBinary: looksBinary(text),
  }
}

export async function probeText(file: Blob): Promise<TextInfo> {
  return probeTextBytes(new Uint8Array(await file.arrayBuffer()))
}

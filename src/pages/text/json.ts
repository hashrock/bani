/**
 * JSON の整形と圧縮。JSON.parse → JSON.stringify では、大きな整数の桁落ち（2^53 超）・
 * 1.0 → 1・\u エスケープの展開・重複キーの消失が起きて「整形しただけで中身が変わる」ので、
 * 字句をそのまま並べ直す自前の走査にする。エラーの位置もブラウザごとに文言が違う
 * JSON.parse のメッセージに頼らず、ここで決める
 */

export type JsonErrorReason =
  | 'unexpected-end'
  | 'unexpected-character'
  | 'invalid-string'
  | 'invalid-number'
  | 'trailing-content'
  | 'too-deep'

export interface JsonError {
  reason: JsonErrorReason
  /** 文字列の中の位置（UTF-16 単位）。エディタの位置にそのまま使える */
  offset: number
  /** 1 始まり */
  line: number
  /** 1 始まり。列はコードポイント単位（エディタの表示と合わせる） */
  column: number
}

export type JsonFormatResult = { ok: true; text: string } | { ok: false; error: JsonError }

/** 入れ子の上限。これを超える JSON は再帰でスタックを使い切るので、壊れたものとして断る */
const MAX_DEPTH = 2000

class JsonSyntaxError extends Error {
  readonly reason: JsonErrorReason
  readonly offset: number
  constructor(reason: JsonErrorReason, offset: number) {
    super(reason)
    this.reason = reason
    this.offset = offset
  }
}

/** オフセットを行と列にする。改行は \n・\r\n・\r のどれも 1 つと数える */
export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1
  let lineStart = 0
  for (let i = 0; i < offset && i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0x0a || (c === 0x0d && text.charCodeAt(i + 1) !== 0x0a)) {
      line++
      lineStart = i + 1
    }
  }
  // サロゲートペアは 1 文字と数える
  const column = [...text.slice(lineStart, Math.min(offset, text.length))].length + 1
  return { line, column }
}

const isWhitespace = (c: number) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d
const isDigit = (c: number) => c >= 0x30 && c <= 0x39
const isHex = (c: number) => isDigit(c) || (c >= 0x41 && c <= 0x46) || (c >= 0x61 && c <= 0x66)

/**
 * 文字列を走査し、値ごとに並べ直す。indent が null なら空白を一切入れない（圧縮）。
 * 空の {} と [] は整形しても 1 行のまま残す
 */
function reformat(text: string, indent: string | null): string {
  let pos = 0
  const out: string[] = []
  const newline = (depth: number) => {
    if (indent !== null) out.push('\n', indent.repeat(depth))
  }

  const skipWhitespace = () => {
    while (pos < text.length && isWhitespace(text.charCodeAt(pos))) pos++
  }
  const fail = (reason: JsonErrorReason, at = pos): never => {
    throw new JsonSyntaxError(at >= text.length && reason === 'unexpected-character' ? 'unexpected-end' : reason, at)
  }
  const expect = (char: string) => {
    if (text[pos] !== char) fail('unexpected-character')
    pos++
  }

  const readString = () => {
    const start = pos
    pos++ // 開きの "
    while (true) {
      if (pos >= text.length) fail('unexpected-end')
      const c = text.charCodeAt(pos)
      if (c === 0x22) break
      if (c < 0x20) fail('invalid-string')
      if (c === 0x5c) {
        const next = text[pos + 1]
        if (next === 'u') {
          for (let i = 2; i < 6; i++) {
            if (!isHex(text.charCodeAt(pos + i))) fail('invalid-string', Math.min(pos + i, text.length))
          }
          pos += 6
          continue
        }
        if (next === undefined) fail('unexpected-end', pos + 1)
        if (!'"\\/bfnrt'.includes(next)) fail('invalid-string', pos + 1)
        pos += 2
        continue
      }
      pos++
    }
    pos++ // 閉じの "
    out.push(text.slice(start, pos))
  }

  const readNumber = () => {
    const start = pos
    if (text[pos] === '-') pos++
    if (text[pos] === '0') pos++
    else if (isDigit(text.charCodeAt(pos))) while (isDigit(text.charCodeAt(pos))) pos++
    else fail(pos >= text.length ? 'unexpected-end' : 'invalid-number')
    if (text[pos] === '.') {
      pos++
      if (!isDigit(text.charCodeAt(pos))) fail('invalid-number')
      while (isDigit(text.charCodeAt(pos))) pos++
    }
    if (text[pos] === 'e' || text[pos] === 'E') {
      pos++
      if (text[pos] === '+' || text[pos] === '-') pos++
      if (!isDigit(text.charCodeAt(pos))) fail('invalid-number')
      while (isDigit(text.charCodeAt(pos))) pos++
    }
    out.push(text.slice(start, pos))
  }

  const readLiteral = (word: string) => {
    for (let i = 0; i < word.length; i++) {
      if (text[pos + i] !== word[i]) fail('unexpected-character', pos + i)
    }
    pos += word.length
    out.push(word)
  }

  const readValue = (depth: number) => {
    if (depth > MAX_DEPTH) fail('too-deep')
    skipWhitespace()
    const c = text[pos]
    if (c === undefined) fail('unexpected-end')
    if (c === '{') return readContainer('{', '}', depth, true)
    if (c === '[') return readContainer('[', ']', depth, false)
    if (c === '"') return readString()
    if (c === '-' || isDigit(text.charCodeAt(pos))) return readNumber()
    if (c === 't') return readLiteral('true')
    if (c === 'f') return readLiteral('false')
    if (c === 'n') return readLiteral('null')
    fail('unexpected-character')
  }

  const readContainer = (open: string, close: string, depth: number, isObject: boolean) => {
    pos++
    out.push(open)
    skipWhitespace()
    if (text[pos] === close) {
      pos++
      out.push(close)
      return
    }
    while (true) {
      newline(depth + 1)
      if (isObject) {
        skipWhitespace()
        if (text[pos] !== '"') fail('unexpected-character')
        readString()
        skipWhitespace()
        expect(':')
        out.push(indent === null ? ':' : ': ')
      }
      readValue(depth + 1)
      skipWhitespace()
      if (text[pos] === ',') {
        pos++
        out.push(',')
        continue
      }
      if (text[pos] === close) {
        pos++
        newline(depth)
        out.push(close)
        return
      }
      fail('unexpected-character')
    }
  }

  readValue(0)
  skipWhitespace()
  if (pos < text.length) fail('trailing-content')
  return out.join('')
}

function run(text: string, indent: string | null): JsonFormatResult {
  try {
    return { ok: true, text: reformat(text, indent) }
  } catch (error) {
    if (!(error instanceof JsonSyntaxError)) throw error
    const offset = Math.min(error.offset, text.length)
    return { ok: false, error: { reason: error.reason, offset, ...offsetToLineColumn(text, offset) } }
  }
}

/** 整形する。字下げは空白の数（既定 2）かタブ */
export function formatJson(text: string, indent: number | '\t' = 2): JsonFormatResult {
  return run(text, indent === '\t' ? '\t' : ' '.repeat(indent))
}

/** 空白をすべて落として 1 行にする */
export function minifyJson(text: string): JsonFormatResult {
  return run(text, null)
}

/** 文法として正しいかだけを見る。正しければ null */
export function validateJson(text: string): JsonError | null {
  const result = minifyJson(text)
  return result.ok ? null : result.error
}

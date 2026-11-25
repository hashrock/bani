import Encoding from 'encoding-japanese'

/**
 * 文字コードの判定・読み・書き。どれも Uint8Array / 文字列の上の純粋な計算で、ファイルには触れない。
 *
 * 読みは TextDecoder（WHATWG Encoding 準拠。ブラウザで実際に動く解釈と一致させる）、
 * 書きは TextEncoder が UTF-8 しか出せないので、日本語の各コードは encoding-japanese に任せる。
 */

/** 名前は WHATWG のラベルにそろえ、そのまま TextDecoder に渡せるようにする */
export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'shift_jis' | 'euc-jp' | 'iso-2022-jp'

export const TEXT_ENCODINGS: readonly TextEncodingName[] = [
  'utf-8',
  'utf-16le',
  'utf-16be',
  'shift_jis',
  'euc-jp',
  'iso-2022-jp',
]

/** BOM を持てるのは Unicode 系だけ */
export function supportsBom(encoding: TextEncodingName): boolean {
  return encoding === 'utf-8' || encoding === 'utf-16le' || encoding === 'utf-16be'
}

const BOMS: Partial<Record<TextEncodingName, readonly number[]>> = {
  'utf-8': [0xef, 0xbb, 0xbf],
  'utf-16le': [0xff, 0xfe],
  'utf-16be': [0xfe, 0xff],
}

export interface DetectedEncoding {
  encoding: TextEncodingName
  bom: boolean
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) =>
  bytes.length >= prefix.length && prefix.every((b, i) => bytes[i] === b)

/** 判定に使う先頭の長さ。巨大なファイルでも判定の手間を一定にする */
const SAMPLE_BYTES = 64 * 1024

/**
 * バイト列の文字コードを推定する。決め手の強いものから順に見る:
 * BOM → BOM なし UTF-16 → ISO-2022-JP（7 ビット + ESC）→ UTF-8 → Shift_JIS と EUC-JP の比較。
 * 何も決め手がない（空・ASCII のみ）ときは UTF-8 とみなす。
 */
export function detectEncoding(bytes: Uint8Array): DetectedEncoding {
  for (const encoding of ['utf-8', 'utf-16le', 'utf-16be'] as const) {
    if (startsWith(bytes, BOMS[encoding]!)) return { encoding, bom: true }
  }

  const sample = bytes.length > SAMPLE_BYTES ? bytes.subarray(0, SAMPLE_BYTES) : bytes
  const utf16 = guessUtf16WithoutBom(sample)
  if (utf16 && isValid(bytes, utf16)) return { encoding: utf16, bom: false }

  if (sample.every((b) => b < 0x80)) {
    // ESC $ B などの切り替えがあれば ISO-2022-JP。なければ ASCII なので UTF-8 で困らない
    if (hasIso2022JpEscape(sample) && isValid(bytes, 'iso-2022-jp')) return { encoding: 'iso-2022-jp', bom: false }
    return { encoding: 'utf-8', bom: false }
  }

  if (isValid(bytes, 'utf-8')) return { encoding: 'utf-8', bom: false }

  const sjisValid = isValid(sample, 'shift_jis', true)
  const eucValid = isValid(sample, 'euc-jp', true)
  if (sjisValid !== eucValid) return { encoding: sjisValid ? 'shift_jis' : 'euc-jp', bom: false }
  // どちらとしても読める（または読めない）ときは、日本語らしい文字が多く出るほうを採る。
  // 同点は利用者の多い Shift_JIS に倒す
  const sjisScore = japaneseScore(decodeLoose(sample, 'shift_jis'))
  const eucScore = japaneseScore(decodeLoose(sample, 'euc-jp'))
  return { encoding: eucScore > sjisScore ? 'euc-jp' : 'shift_jis', bom: false }
}

/**
 * BOM のない UTF-16 は、ASCII 部分の上位バイトが 0 になる偏りで見分ける。
 * 日本語だけの UTF-16 は偏りが出ないので取りこぼすが、その場合は他の判定で読めずに残る
 */
function guessUtf16WithoutBom(bytes: Uint8Array): TextEncodingName | null {
  const pairs = Math.floor(bytes.length / 2)
  if (pairs < 2) return null
  let evenZeros = 0
  let oddZeros = 0
  for (let i = 0; i < pairs * 2; i += 2) {
    if (bytes[i] === 0) evenZeros++
    if (bytes[i + 1] === 0) oddZeros++
  }
  if (oddZeros >= pairs * 0.3 && evenZeros <= pairs * 0.05) return 'utf-16le'
  if (evenZeros >= pairs * 0.3 && oddZeros <= pairs * 0.05) return 'utf-16be'
  return null
}

function hasIso2022JpEscape(bytes: Uint8Array): boolean {
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] !== 0x1b) continue
    const [a, b] = [bytes[i + 1], bytes[i + 2]]
    // ESC $ @ / ESC $ B（JIS X 0208）、ESC ( J / ESC ( I（ローマ字・半角カナ）
    if ((a === 0x24 && (b === 0x40 || b === 0x42)) || (a === 0x28 && (b === 0x4a || b === 0x49))) return true
  }
  return false
}

/**
 * 厳密に読めるか。sample=true のときは先頭を切り出した都合で末尾の文字が
 * 途中で切れている可能性があるので、末尾数バイトの不完全さは見逃す
 */
function isValid(bytes: Uint8Array, encoding: TextEncodingName, sample = false): boolean {
  const decoder = new TextDecoder(encoding, { fatal: true })
  try {
    if (sample && bytes.length === SAMPLE_BYTES) decoder.decode(bytes, { stream: true })
    else decoder.decode(bytes)
    return true
  } catch {
    return false
  }
}

function decodeLoose(bytes: Uint8Array, encoding: TextEncodingName): string {
  return new TextDecoder(encoding).decode(bytes)
}

/** 日本語の文章として自然かどうかの点数。誤った解釈では半角カナや置換文字が増える */
function japaneseScore(text: string): number {
  let score = 0
  for (const char of text) {
    const c = char.codePointAt(0)!
    if (c >= 0x3041 && c <= 0x30ff) score += 2 // ひらがな・カタカナ
    else if (c >= 0x4e00 && c <= 0x9fff) score += 1 // CJK 統合漢字
    else if (c >= 0x3000 && c <= 0x303f) score += 1 // 和文の句読点
    else if (c >= 0xff61 && c <= 0xff9f) score -= 1 // 半角カナ
    else if (c === 0xfffd) score -= 3
    else if (c >= 0xe000 && c <= 0xf8ff) score -= 2 // 私用領域
  }
  return score
}

export interface DecodedText {
  /** BOM は取り除いた本文 */
  text: string
  /** 読めないバイトがあり、置換文字（U+FFFD）に置き換えた */
  hasDecodeErrors: boolean
}

/** 指定した文字コードで読む。読めないバイトは止まらずに U+FFFD にして、その事実を返す */
export function decodeBytes(bytes: Uint8Array, encoding: TextEncodingName): DecodedText {
  try {
    return { text: new TextDecoder(encoding, { fatal: true }).decode(bytes), hasDecodeErrors: false }
  } catch {
    return { text: new TextDecoder(encoding).decode(bytes), hasDecodeErrors: true }
  }
}

/**
 * NUL や制御文字が目立つなら、文章ではなくバイナリを読んだとみなす。
 * タブ・改行・改ページ・ESC（ISO-2022-JP の名残）は文章でも普通に出るので数えない
 */
export function looksBinary(text: string): boolean {
  if (text.length === 0) return false
  let controls = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c === 0) return true
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d && c !== 0x0c && c !== 0x0b && c !== 0x1b) controls++
  }
  return controls > text.length * 0.01
}

/** 書き出し先の文字コードで表せない文字。同じ文字はまとめて 1 件にする */
export interface UnrepresentableChar {
  char: string
  codePoint: number
  count: number
  /** 最初に出てきた位置（1 始まり。列はコードポイント単位） */
  line: number
  column: number
}

export interface EncodedText {
  bytes: Uint8Array
  /** 表せずに `?`（Unicode 系では U+FFFD）へ置き換えた文字 */
  unrepresentable: UnrepresentableChar[]
}

const LIBRARY_NAMES = { shift_jis: 'SJIS', 'euc-jp': 'EUCJP', 'iso-2022-jp': 'JIS' } as const
type JapaneseEncoding = keyof typeof LIBRARY_NAMES

const isJapanese = (encoding: TextEncodingName): encoding is JapaneseEncoding => encoding in LIBRARY_NAMES

/** 文字ごとの判定は同じ文字の繰り返しが多いので覚えておく */
const representableCache = new Map<JapaneseEncoding, Map<number, boolean>>()

function representableInJapanese(encoding: JapaneseEncoding, char: string): boolean {
  const codePoint = char.codePointAt(0)!
  let cache = representableCache.get(encoding)
  if (!cache) representableCache.set(encoding, (cache = new Map()))
  const known = cache.get(codePoint)
  if (known !== undefined) return known
  let ok: boolean
  try {
    const bytes = Encoding.convert(Encoding.stringToCode(char), {
      to: LIBRARY_NAMES[encoding],
      from: 'UNICODE',
      type: 'array',
      fallback: 'error',
    })
    // JIS X 0212（ESC $ ( D）は ISO-2022-JP の範囲外で、ブラウザもメールソフトもほぼ読めない
    ok = !(encoding === 'iso-2022-jp' && bytes.some((b, i) => b === 0x1b && bytes[i + 1] === 0x24 && bytes[i + 2] === 0x28))
  } catch {
    ok = false
  }
  cache.set(codePoint, ok)
  return ok
}

const isLoneSurrogate = (char: string) => {
  const c = char.charCodeAt(0)
  return char.length === 1 && c >= 0xd800 && c <= 0xdfff
}

/**
 * 表せない文字を数え、置き換えた文字列を作る。ASCII はどの文字コードでも表せるので素通しする。
 * 対応の取れないサロゲート（壊れた UTF-16）はどの文字コードでも正しく書けないので報告に含める
 */
function sanitize(
  text: string,
  canRepresent: (char: string) => boolean,
  substitute: string
): { text: string; unrepresentable: UnrepresentableChar[] } {
  const found = new Map<number, UnrepresentableChar>()
  let out = ''
  let changed = false
  let line = 1
  let column = 0
  let previous = ''
  for (const char of text) {
    // 位置は「改行の直後から数え直す」。CRLF は 1 つの改行として扱う
    if (previous === '\r' && char === '\n') {
      previous = char
      out += char
      continue
    }
    if (previous === '\r' || previous === '\n') {
      line++
      column = 0
    }
    column++
    previous = char
    if (char.charCodeAt(0) < 0x80 || (!isLoneSurrogate(char) && canRepresent(char))) {
      out += char
      continue
    }
    changed = true
    out += substitute
    const codePoint = char.codePointAt(0)!
    const entry = found.get(codePoint)
    if (entry) entry.count++
    else found.set(codePoint, { char, codePoint, count: 1, line, column })
  }
  return { text: changed ? out : text, unrepresentable: [...found.values()] }
}

/** 書き出すと失われる文字だけを調べる。書き出す前に画面で知らせるために使う */
export function findUnrepresentable(text: string, encoding: TextEncodingName): UnrepresentableChar[] {
  return encodeText(text, encoding, false).unrepresentable
}

/**
 * 文字列を指定の文字コードのバイト列にする。表せない文字は黙って化けさせず、
 * 置き換えたうえで一覧を返す（書き出しを止めるかどうかは呼び出し側が決める）
 */
export function encodeText(text: string, encoding: TextEncodingName, bom: boolean): EncodedText {
  const prefix = bom && supportsBom(encoding) ? BOMS[encoding]! : []

  if (isJapanese(encoding)) {
    const { text: safe, unrepresentable } = sanitize(text, (c) => representableInJapanese(encoding, c), '?')
    const body = Encoding.convert(Encoding.stringToCode(safe), {
      to: LIBRARY_NAMES[encoding],
      from: 'UNICODE',
      type: 'array',
    })
    return { bytes: new Uint8Array(body), unrepresentable }
  }

  // Unicode 系で表せないのは壊れたサロゲートだけ
  const { text: safe, unrepresentable } = sanitize(text, () => true, '\ufffd')
  if (encoding === 'utf-8') {
    const body = new TextEncoder().encode(safe)
    const bytes = new Uint8Array(prefix.length + body.length)
    bytes.set(prefix)
    bytes.set(body, prefix.length)
    return { bytes, unrepresentable }
  }

  const bytes = new Uint8Array(prefix.length + safe.length * 2)
  bytes.set(prefix)
  const view = new DataView(bytes.buffer)
  const littleEndian = encoding === 'utf-16le'
  for (let i = 0; i < safe.length; i++) view.setUint16(prefix.length + i * 2, safe.charCodeAt(i), littleEndian)
  return { bytes, unrepresentable }
}

/** Blob の type に付ける charset。WHATWG のラベルがそのまま使える */
export function mimeTypeFor(encoding: TextEncodingName, baseType = 'text/plain'): string {
  return `${baseType};charset=${encoding}`
}

/**
 * RAR5 のヘッダーだけを読む小さな読み手。展開は libarchive（WASM）に任せるが、
 * 同梱している libarchive は RAR5 の「パスワード付きのファイル」を見分けられず、
 * 更新日時も取り出せない（libarchive.js が秒の部分を公開していない）ので、その 2 つだけをここで補う。
 * ヘッダーは暗号化されていなければ平文で並んでいるので、中身を展開せずに読める。
 *
 * 形式: https://www.rarlab.com/technote.htm （RAR 5.0 archive format）
 */

const SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]

const HEADER_FILE = 2
const HEADER_ENCRYPTION = 4
const HEADER_END = 5

const FLAG_EXTRA = 0x0001
const FLAG_DATA = 0x0002

const FILE_DIRECTORY = 0x0001
const FILE_UNIX_TIME = 0x0002
const FILE_CRC = 0x0004

const EXTRA_ENCRYPTION = 0x01
const EXTRA_TIME = 0x03
const TIME_UNIX = 0x0001
const TIME_MTIME = 0x0002

/** Windows の FILETIME（1601 年からの 100ns 刻み）と Unix 時刻の差（ミリ秒） */
const FILETIME_EPOCH_MS = 11644473600000

export interface Rar5FileInfo {
  encrypted: boolean
  modified: Date | null
}

export type Rar5Scan =
  /** ヘッダーまで暗号化されていて、名前すら読めない */
  | { headerEncrypted: true }
  /** 中のパス（RAR5 は UTF-8・'/' 区切り。フォルダは末尾の '/' なし）→ 情報 */
  | { headerEncrypted: false; files: Map<string, Rar5FileInfo> }

export const isRar5 = (bytes: Uint8Array) => SIGNATURE.every((byte, i) => bytes[i] === byte)

class Cursor {
  private readonly bytes: Uint8Array
  private readonly end: number
  p: number

  constructor(bytes: Uint8Array, p: number, end: number) {
    this.bytes = bytes
    this.p = p
    this.end = end
  }

  /** 7 ビットずつの可変長整数。2^53 を超える値は読めないものとして扱う */
  vint(): number {
    let value = 0
    let scale = 1
    for (let i = 0; i < 10; i++) {
      if (this.p >= this.end) throw new RangeError('vint')
      const byte = this.bytes[this.p++]
      value += (byte & 0x7f) * scale
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(value)) throw new RangeError('vint')
        return value
      }
      scale *= 128
    }
    throw new RangeError('vint')
  }

  uint32(): number {
    if (this.p + 4 > this.end) throw new RangeError('uint32')
    const b = this.bytes
    const value = (b[this.p] | (b[this.p + 1] << 8) | (b[this.p + 2] << 16)) + b[this.p + 3] * 0x1000000
    this.p += 4
    return value
  }

  take(length: number): Uint8Array {
    if (length < 0 || this.p + length > this.end) throw new RangeError('take')
    const out = this.bytes.subarray(this.p, this.p + length)
    this.p += length
    return out
  }
}

const utf8 = new TextDecoder('utf-8')

/** 高精度の時刻の記録（追加領域の 0x03）。更新日時だけを読む */
function readTimeRecord(cursor: Cursor): Date | null {
  const flags = cursor.vint()
  if ((flags & TIME_MTIME) === 0) return null
  if (flags & TIME_UNIX) return new Date(cursor.uint32() * 1000)
  const low = cursor.uint32()
  const high = cursor.uint32()
  const date = new Date((high * 0x100000000 + low) / 10000 - FILETIME_EPOCH_MS)
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * RAR5 のヘッダーをたどり、ファイルごとのパスワードの有無と更新日時を返す。
 * 壊れていても例外にはせず、読めたところまでを返す（壊れていることは libarchive が知らせる）。
 */
export function scanRar5(bytes: Uint8Array): Rar5Scan {
  const files = new Map<string, Rar5FileInfo>()
  let p = SIGNATURE.length
  try {
    while (p < bytes.length) {
      // 先頭の CRC32（4 バイト）は確かめない。壊れていれば libarchive が展開で気づく
      const cursor = new Cursor(bytes, p + 4, bytes.length)
      const headerSize = cursor.vint()
      const headerStart = cursor.p
      const headerEnd = headerStart + headerSize
      if (headerSize === 0 || headerEnd > bytes.length) break
      const header = new Cursor(bytes, headerStart, headerEnd)
      const type = header.vint()
      const flags = header.vint()
      const extraSize = flags & FLAG_EXTRA ? header.vint() : 0
      const dataSize = flags & FLAG_DATA ? header.vint() : 0

      if (type === HEADER_ENCRYPTION) return { headerEncrypted: true }
      if (type === HEADER_END) break
      if (type === HEADER_FILE) {
        const fileFlags = header.vint()
        header.vint() // 展開後の大きさ（libarchive から取る）
        header.vint() // 属性
        let modified = fileFlags & FILE_UNIX_TIME ? new Date(header.uint32() * 1000) : null
        if (fileFlags & FILE_CRC) header.uint32()
        header.vint() // 圧縮の情報
        header.vint() // 作成した OS
        const name = utf8.decode(header.take(header.vint())).replace(/\/+$/, '')
        let encrypted = false
        // 追加領域はヘッダーの末尾 extraSize バイト。「大きさ・種類・中身」の記録が並ぶ
        const extra = new Cursor(bytes, headerEnd - extraSize, headerEnd)
        while (extra.p < headerEnd) {
          const recordSize = extra.vint()
          const recordEnd = extra.p + recordSize
          if (recordSize === 0 || recordEnd > headerEnd) break
          const record = new Cursor(bytes, extra.p, recordEnd)
          const recordType = record.vint()
          if (recordType === EXTRA_ENCRYPTION) encrypted = true
          if (recordType === EXTRA_TIME) modified = readTimeRecord(record) ?? modified
          extra.p = recordEnd
        }
        if ((fileFlags & FILE_DIRECTORY) === 0 || !files.has(name)) files.set(name, { encrypted, modified })
      }
      p = headerEnd + dataSize
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    // 途中で切れている。読めた分だけ返す
  }
  return { headerEncrypted: false, files }
}

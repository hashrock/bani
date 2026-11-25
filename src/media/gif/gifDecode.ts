/**
 * GIF を全フレームの RGBA に読む純粋な TypeScript のデコーダ。
 * ImageDecoder（WebCodecs）のないブラウザ（いまは Firefox の一部など）の予備で、node でも動くので見本で確かめる。
 *
 * - 各フレームは「その時点で画面に見えている絵」（キャンバス全体、重ね合わせと後始末を反映済み）で返す。
 *   ImageDecoder も同じ形で返すので、画面の側は出どころを区別しない
 * - 後始末（disposal）の 2 は背景色ではなく透明に戻す（主要なブラウザと同じ）
 * - 表示時間が 20ms 未満（0・10ms）のフレームは 100ms として扱う（主要なブラウザと同じ）
 */
import { lzwDecode } from './lzw'
import type { DecodedAnimation } from './types'

/** ブラウザが「速すぎる」とみなして 100ms に読み替える境目 */
const MIN_BROWSER_DELAY = 20
const FALLBACK_DELAY = 100

export class GifDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GifDecodeError'
  }
}

interface Reader {
  bytes: Uint8Array
  pos: number
}

const u8 = (r: Reader) => {
  if (r.pos >= r.bytes.length) throw new RangeError('eof')
  return r.bytes[r.pos++]
}
const u16 = (r: Reader) => u8(r) | (u8(r) << 8)

/** サブブロック（長さ + 中身 の並び、長さ 0 で終わり）を 1 つにつなぐ */
function readSubBlocks(r: Reader): Uint8Array {
  const parts: Uint8Array[] = []
  let total = 0
  for (;;) {
    const size = u8(r)
    if (size === 0) break
    const end = r.pos + size
    if (end > r.bytes.length) throw new RangeError('eof')
    parts.push(r.bytes.subarray(r.pos, end))
    total += size
    r.pos = end
  }
  const joined = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    joined.set(part, offset)
    offset += part.length
  }
  return joined
}

function skipSubBlocks(r: Reader) {
  for (;;) {
    const size = u8(r)
    if (size === 0) return
    r.pos += size
  }
}

function readColorTable(r: Reader, size: number): Uint8Array {
  const end = r.pos + size * 3
  if (end > r.bytes.length) throw new RangeError('eof')
  const table = r.bytes.slice(r.pos, end)
  r.pos = end
  return table
}

/** 飛び越し（interlace）の行の並び。4 回に分けて 8・8・4・2 行おきに来る */
function interlacedRows(height: number): number[] {
  const rows: number[] = []
  for (const [start, step] of [
    [0, 8],
    [4, 8],
    [2, 4],
    [1, 2],
  ]) {
    for (let y = start; y < height; y += step) rows.push(y)
  }
  return rows
}

export const isGif = (bytes: Uint8Array) =>
  bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38

/**
 * GIF を読む。途中で切れたファイルは、読めたフレームまでを返す（1 枚も読めなければ例外）。
 * plays は再生する回数（0 は無限）。NETSCAPE 拡張がなければ 1 回、ループ回数 n なら n + 1 回
 */
export function decodeGif(bytes: Uint8Array): DecodedAnimation {
  if (!isGif(bytes)) throw new GifDecodeError('Not a GIF file')
  const r: Reader = { bytes, pos: 6 }
  let width: number
  let height: number
  let globalTable: Uint8Array | null = null
  try {
    width = u16(r)
    height = u16(r)
    const packed = u8(r)
    r.pos += 2 // 背景色の番号と画素の縦横比（使わない）
    if (packed & 0x80) globalTable = readColorTable(r, 1 << ((packed & 7) + 1))
  } catch {
    throw new GifDecodeError('Truncated GIF header')
  }
  if (width === 0 || height === 0) throw new GifDecodeError('GIF has no size')

  const canvas = new Uint8ClampedArray(width * height * 4)
  const frames: DecodedAnimation['frames'] = []
  let plays = 1
  // 次のフレームに効く制御（Graphic Control Extension）
  let disposal = 0
  let delay = 0
  let transparent = -1

  try {
    for (;;) {
      if (r.pos >= bytes.length) break
      const introducer = u8(r)
      if (introducer === 0x3b) break
      if (introducer === 0x21) {
        const label = u8(r)
        if (label === 0xf9) {
          const block = readSubBlocks(r)
          if (block.length >= 4) {
            disposal = (block[0] >> 2) & 7
            transparent = block[0] & 1 ? block[3] : -1
            delay = (block[1] | (block[2] << 8)) * 10
          }
        } else if (label === 0xff) {
          const block = readSubBlocks(r)
          const id = String.fromCharCode(...block.subarray(0, 11))
          // NETSCAPE2.0 / ANIMEXTS1.0 のあとに [1, 回数（下位, 上位）]
          if ((id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0') && block.length >= 14 && block[11] === 1) {
            const loops = block[12] | (block[13] << 8)
            plays = loops === 0 ? 0 : loops + 1
          }
        } else {
          skipSubBlocks(r)
        }
        continue
      }
      if (introducer !== 0x2c) break // 知らないブロック。ここまでで止める

      const left = u16(r)
      const top = u16(r)
      const w = u16(r)
      const h = u16(r)
      const packed = u8(r)
      const table = packed & 0x80 ? readColorTable(r, 1 << ((packed & 7) + 1)) : globalTable
      const interlaced = (packed & 0x40) !== 0
      const minCodeSize = u8(r)
      const data = readSubBlocks(r)
      const indices = lzwDecode(data, minCodeSize, w * h)

      // 後始末 3（前の絵に戻す）のために、描く前の絵を取っておく
      const saved = disposal === 3 ? canvas.slice() : null
      if (table) {
        const rows = interlaced ? interlacedRows(h) : null
        for (let row = 0; row < h; row++) {
          const y = top + (rows ? rows[row] : row)
          if (y >= height) continue
          for (let x = 0; x < w; x++) {
            const px = left + x
            if (px >= width) continue
            const index = indices[row * w + x]
            if (index === transparent || index * 3 + 2 >= table.length) continue
            const o = (y * width + px) * 4
            canvas[o] = table[index * 3]
            canvas[o + 1] = table[index * 3 + 1]
            canvas[o + 2] = table[index * 3 + 2]
            canvas[o + 3] = 255
          }
        }
      }
      frames.push({ rgba: canvas.slice(), duration: delay < MIN_BROWSER_DELAY ? FALLBACK_DELAY : delay })

      if (disposal === 2) {
        for (let y = top; y < Math.min(height, top + h); y++) {
          canvas.fill(0, (y * width + left) * 4, (y * width + Math.min(width, left + w)) * 4)
        }
      } else if (saved) {
        canvas.set(saved)
      }
      disposal = 0
      delay = 0
      transparent = -1
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error
    // 途中で切れている。読めたところまでを返す
  }

  if (frames.length === 0) throw new GifDecodeError('GIF has no frames')
  return { width, height, plays, frames }
}

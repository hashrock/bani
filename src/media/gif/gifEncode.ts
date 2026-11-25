/**
 * GIF のエンコーダ（純粋な TypeScript）。Worker（encodeWorker.ts）で動かし、node でも往復で確かめる。
 *
 * gif.js（動画の画面の GIF 書き出しが使う）は色数を選べず、フレームごとの表示時間も揃える前提なので、
 * この画面ではエンコーダを自前で持つ:
 * - 色数（2〜256）、ディザ（なし・Floyd–Steinberg・ordered）、パレット（全体で 1 つ・フレームごと）を選べる
 * - 色の数が上限以内なら減色しない（GIF を開いて表示時間だけ変えて保存しても色が変わらない）
 * - 全体パレットで透過がなければ、前のフレームから変わった矩形だけを書く（大きさを抑える）
 * - 透過があれば各フレームを全面で書き、後始末を「透明に戻す」にする（前の絵が透けないように）
 */
import { lzwEncode } from './lzw'
import {
  addToHistogram,
  collectExactColors,
  createHistogram,
  exactPalette,
  hasTransparency,
  mapExact,
  mapToPalette,
  medianCut,
  NearestColor,
} from './quantize'
import type { GifEncodeFrame, GifEncodeOptions } from './types'

/** 全体パレットのヒストグラムで数える画素の目安。超えたら間引く */
const HISTOGRAM_SAMPLE = 4_000_000
/** GIF の表示時間はセンチ秒の 16 ビット */
const MAX_DELAY_CS = 0xffff

class ByteWriter {
  private bytes = new Uint8Array(1 << 16)
  length = 0

  private ensure(extra: number) {
    if (this.length + extra <= this.bytes.length) return
    let size = this.bytes.length * 2
    while (size < this.length + extra) size *= 2
    const grown = new Uint8Array(size)
    grown.set(this.bytes.subarray(0, this.length))
    this.bytes = grown
  }

  byte(value: number) {
    this.ensure(1)
    this.bytes[this.length++] = value & 0xff
  }

  u16(value: number) {
    this.byte(value)
    this.byte(value >> 8)
  }

  ascii(text: string) {
    for (let i = 0; i < text.length; i++) this.byte(text.charCodeAt(i))
  }

  array(values: Uint8Array) {
    this.ensure(values.length)
    this.bytes.set(values, this.length)
    this.length += values.length
  }

  finish(): Uint8Array {
    return this.bytes.slice(0, this.length)
  }
}

/** 色の表の大きさ（2 のべき乗、2〜256）と、そのビット数 */
function tableBits(colors: number): number {
  let bits = 1
  while (1 << bits < colors) bits++
  return bits
}

function writeColorTable(writer: ByteWriter, palette: Uint8Array, bits: number) {
  const table = new Uint8Array((1 << bits) * 3)
  table.set(palette.subarray(0, Math.min(palette.length, table.length)))
  writer.array(table)
}

/** 表示時間（ミリ秒）をセンチ秒に。2 未満はブラウザが 100ms に読み替えるので 2（20ms）にとどめる */
export const delayToCentiseconds = (duration: number) =>
  Math.max(2, Math.min(MAX_DELAY_CS, Math.round((Number.isFinite(duration) ? duration : 100) / 10)))

interface Palette {
  palette: Uint8Array
  /** 不透明な色の数（この後ろに透明の 1 色を置く） */
  count: number
  map: (rgba: Uint8ClampedArray) => Uint8Array
}

/** 画素の並びからパレットを作り、番号へ置き換える関数と組にする */
function buildPalette(
  sources: readonly Uint8ClampedArray[],
  limit: number,
  options: GifEncodeOptions,
  transparentIndex: (count: number) => number | null
): Palette {
  let lookup: Map<number, number> | null = new Map()
  for (const rgba of sources) {
    lookup = collectExactColors(rgba, limit, lookup)
    if (!lookup) break
  }
  if (lookup) {
    const exact = exactPalette(lookup)
    const count = Math.max(1, lookup.size)
    const transparent = transparentIndex(count)
    return { palette: exact.palette, count, map: (rgba) => mapExact(rgba, exact, transparent) }
  }
  const histogram = createHistogram()
  const total = sources.reduce((sum, rgba) => sum + rgba.length / 4, 0)
  const step = Math.max(1, Math.ceil(total / HISTOGRAM_SAMPLE))
  for (const rgba of sources) addToHistogram(histogram, rgba, step)
  const palette = medianCut(histogram, limit)
  const count = palette.length / 3
  const transparent = transparentIndex(count)
  const nearest = new NearestColor(palette)
  return {
    palette,
    count,
    map: (rgba) => mapToPalette(rgba, options.width, options.height, palette, options.dither, transparent, nearest),
  }
}

/** 前のフレームと番号が違う画素を囲む矩形。同じなら null */
function changedRect(previous: Uint8Array, current: Uint8Array, width: number, height: number) {
  let top = -1
  let bottom = -1
  let left = width
  let right = -1
  for (let y = 0; y < height; y++) {
    const row = y * width
    let first = -1
    let last = -1
    for (let x = 0; x < width; x++) {
      if (previous[row + x] !== current[row + x]) {
        if (first < 0) first = x
        last = x
      }
    }
    if (first < 0) continue
    if (top < 0) top = y
    bottom = y
    if (first < left) left = first
    if (last > right) right = last
  }
  if (top < 0) return null
  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

function cropIndices(indices: Uint8Array, width: number, rect: { x: number; y: number; width: number; height: number }) {
  const out = new Uint8Array(rect.width * rect.height)
  for (let y = 0; y < rect.height; y++) {
    const start = (rect.y + y) * width + rect.x
    out.set(indices.subarray(start, start + rect.width), y * rect.width)
  }
  return out
}

/**
 * フレームの並びを GIF にする。onProgress は 0〜1（1 フレーム書くたび）。
 * 各フレームの rgba は width × height × 4 であること
 */
export function encodeGif(
  frames: readonly GifEncodeFrame[],
  options: GifEncodeOptions,
  onProgress?: (progress: number) => void
): Uint8Array {
  const { width, height } = options
  if (!(width > 0 && height > 0 && width <= 0xffff && height <= 0xffff)) throw new RangeError('GIF の寸法が範囲外です')
  if (frames.length === 0) throw new RangeError('フレームがありません')
  for (const frame of frames) {
    if (frame.rgba.length !== width * height * 4) throw new RangeError('フレームの大きさがそろっていません')
  }

  const colors = Math.max(2, Math.min(256, Math.floor(options.colors) || 256))
  const transparency = frames.some((frame) => hasTransparency(frame.rgba))
  // 透過があれば 1 色を透明に取っておく
  const opaqueLimit = transparency ? colors - 1 : colors
  const transparentIndex = (count: number) => (transparency ? count : null)
  const global = options.palette === 'global'

  const writer = new ByteWriter()
  writer.ascii('GIF89a')
  writer.u16(width)
  writer.u16(height)

  let globalPalette: Palette | null = null
  let globalBits = 0
  if (global) {
    globalPalette = buildPalette(
      frames.map((frame) => frame.rgba),
      opaqueLimit,
      options,
      transparentIndex
    )
    globalBits = tableBits(globalPalette.count + (transparency ? 1 : 0))
    writer.byte(0x80 | (7 << 4) | (globalBits - 1))
    writer.byte(0) // 背景色の番号
    writer.byte(0) // 画素の縦横比
    writeColorTable(writer, globalPalette.palette, globalBits)
  } else {
    writer.byte(7 << 4)
    writer.byte(0)
    writer.byte(0)
  }

  // ループ（NETSCAPE2.0）。1 回だけ再生するなら書かない（書くと多くのブラウザで 2 回になる）
  const plays = Math.max(0, Math.floor(options.plays) || 0)
  if (plays !== 1) {
    writer.byte(0x21)
    writer.byte(0xff)
    writer.byte(11)
    writer.ascii('NETSCAPE2.0')
    writer.byte(3)
    writer.byte(1)
    writer.u16(plays === 0 ? 0 : Math.min(0xffff, plays - 1))
    writer.byte(0)
  }

  let previous: Uint8Array | null = null
  frames.forEach((frame, index) => {
    const palette = globalPalette ?? buildPalette([frame.rgba], opaqueLimit, options, transparentIndex)
    const bits = global ? globalBits : tableBits(palette.count + (transparency ? 1 : 0))
    const indices = palette.map(frame.rgba)

    // 全体パレットで透過がなければ、変わったところだけを書く（番号で比べるので、書いた結果は全面と同じ絵になる）
    let rect = { x: 0, y: 0, width, height }
    if (global && !transparency && previous) {
      rect = changedRect(previous, indices, width, height) ?? { x: 0, y: 0, width: 1, height: 1 }
    }
    previous = global && !transparency ? indices : null

    // Graphic Control Extension: 後始末（透過ありなら 2 = 透明に戻す、なしなら 1 = そのまま残す）、表示時間、透明の番号
    const disposal = transparency ? 2 : 1
    writer.byte(0x21)
    writer.byte(0xf9)
    writer.byte(4)
    writer.byte((disposal << 2) | (transparency ? 1 : 0))
    writer.u16(delayToCentiseconds(frame.duration))
    writer.byte(transparency ? palette.count : 0)
    writer.byte(0)

    // Image Descriptor
    writer.byte(0x2c)
    writer.u16(rect.x)
    writer.u16(rect.y)
    writer.u16(rect.width)
    writer.u16(rect.height)
    if (global) {
      writer.byte(0)
    } else {
      writer.byte(0x80 | (bits - 1))
      writeColorTable(writer, palette.palette, bits)
    }

    const minCodeSize = Math.max(2, bits)
    writer.byte(minCodeSize)
    const data = lzwEncode(rect.width === width && rect.height === height ? indices : cropIndices(indices, width, rect), minCodeSize)
    for (let offset = 0; offset < data.length; offset += 255) {
      const chunk = data.subarray(offset, Math.min(data.length, offset + 255))
      writer.byte(chunk.length)
      writer.array(chunk)
    }
    writer.byte(0)
    onProgress?.((index + 1) / frames.length)
  })

  writer.byte(0x3b)
  return writer.finish()
}

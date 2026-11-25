/**
 * 減色（パレットづくり）と、画素をパレットの番号に置き換える処理。ブラウザに依存しない。
 *
 * - パレットは 5 ビットずつ（32768 色）のヒストグラムからメディアンカットで作る。
 *   全フレームをまとめて数えれば全体で 1 つのパレット、1 枚ずつ数えればフレームごとのパレットになる
 * - 近い色の引きは 5 ビットの色ごとに覚えておき、同じ色を何度も探さない
 * - 透過は アルファ < 128 を透明とみなす（GIF は 1 ビットの透過しか持てない）
 */
import type { GifDither } from './types'

const BINS = 1 << 15
export const ALPHA_THRESHOLD = 128

const keyOf = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)

export interface Histogram {
  counts: Uint32Array
  /** 箱の代表色を 8 ビットで出すための合計 */
  sums: Float64Array
}

export const createHistogram = (): Histogram => ({ counts: new Uint32Array(BINS), sums: new Float64Array(BINS * 3) })

/** 不透明な画素を数える。step 画素おきに間引いてもよい（大きな画像で速くするため） */
export function addToHistogram(histogram: Histogram, rgba: Uint8ClampedArray, step = 1): void {
  const { counts, sums } = histogram
  const stride = Math.max(1, Math.floor(step)) * 4
  for (let i = 0; i < rgba.length; i += stride) {
    if (rgba[i + 3] < ALPHA_THRESHOLD) continue
    const r = rgba[i]
    const g = rgba[i + 1]
    const b = rgba[i + 2]
    const key = keyOf(r, g, b)
    counts[key]++
    sums[key * 3] += r
    sums[key * 3 + 1] += g
    sums[key * 3 + 2] += b
  }
}

export function hasTransparency(rgba: Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < ALPHA_THRESHOLD) return true
  return false
}

interface Box {
  start: number
  end: number
  count: number
  /** 一番長い軸（0: r, 1: g, 2: b）とその長さ */
  axis: number
  range: number
}

const component = (key: number, axis: number) => (key >> (10 - axis * 5)) & 31

function measure(bins: Int32Array, counts: Uint32Array, start: number, end: number): Box {
  const min = [31, 31, 31]
  const max = [0, 0, 0]
  let count = 0
  for (let i = start; i < end; i++) {
    const key = bins[i]
    count += counts[key]
    for (let axis = 0; axis < 3; axis++) {
      const value = component(key, axis)
      if (value < min[axis]) min[axis] = value
      if (value > max[axis]) max[axis] = value
    }
  }
  const ranges = [max[0] - min[0], max[1] - min[1], max[2] - min[2]]
  // 人の目は緑の差に敏感なので、同じ長さなら緑 → 赤 → 青の順に割る
  const axis = ranges[1] >= ranges[0] && ranges[1] >= ranges[2] ? 1 : ranges[0] >= ranges[2] ? 0 : 2
  return { start, end, count, axis, range: ranges[axis] }
}

/**
 * メディアンカットで最大 maxColors 色のパレット（RGB の並び）を作る。
 * 色の数が maxColors 以下ならその色をそのまま使う（減色しない）。
 * 不透明な画素が 1 つもなければ黒 1 色。
 */
export function medianCut(histogram: Histogram, maxColors: number): Uint8Array {
  const { counts, sums } = histogram
  const limit = Math.max(1, Math.min(256, Math.floor(maxColors)))
  const used: number[] = []
  for (let key = 0; key < BINS; key++) if (counts[key] > 0) used.push(key)
  if (used.length === 0) return new Uint8Array(3)
  const bins = Int32Array.from(used)

  const boxes: Box[] = [measure(bins, counts, 0, bins.length)]
  while (boxes.length < limit) {
    // 画素が多く、色の幅も広い箱から割る
    let best = -1
    let bestScore = 0
    boxes.forEach((box, index) => {
      if (box.end - box.start < 2) return
      const score = box.count * (box.range + 1)
      if (score > bestScore) {
        bestScore = score
        best = index
      }
    })
    if (best < 0) break
    const box = boxes[best]
    const slice = bins.subarray(box.start, box.end)
    slice.sort((a, b) => component(a, box.axis) - component(b, box.axis))
    // 画素数で半分になるところで割る（どちらも空にはしない）
    let accumulated = 0
    let split = box.start + 1
    for (let i = box.start; i < box.end - 1; i++) {
      accumulated += counts[bins[i]]
      split = i + 1
      if (accumulated * 2 >= box.count) break
    }
    boxes.splice(best, 1, measure(bins, counts, box.start, split), measure(bins, counts, split, box.end))
  }

  const palette = new Uint8Array(boxes.length * 3)
  boxes.forEach((box, index) => {
    let r = 0
    let g = 0
    let b = 0
    let count = 0
    for (let i = box.start; i < box.end; i++) {
      const key = bins[i]
      r += sums[key * 3]
      g += sums[key * 3 + 1]
      b += sums[key * 3 + 2]
      count += counts[key]
    }
    palette[index * 3] = Math.round(r / count)
    palette[index * 3 + 1] = Math.round(g / count)
    palette[index * 3 + 2] = Math.round(b / count)
  })
  return palette
}

/** パレットのいちばん近い色の番号。5 ビットの色ごとに覚えておく */
export class NearestColor {
  private cache = new Int16Array(BINS).fill(-1)
  private readonly size: number
  private readonly palette: Uint8Array

  constructor(palette: Uint8Array) {
    this.palette = palette
    this.size = palette.length / 3
  }

  find(r: number, g: number, b: number): number {
    const key = keyOf(r, g, b)
    const cached = this.cache[key]
    if (cached >= 0) return cached
    // 箱の中心の色で探す（同じ箱の色は同じ番号になる）
    const cr = ((key >> 10) << 3) | 4
    const cg = (((key >> 5) & 31) << 3) | 4
    const cb = ((key & 31) << 3) | 4
    let best = 0
    let bestDistance = Infinity
    const p = this.palette
    for (let i = 0; i < this.size; i++) {
      const dr = p[i * 3] - cr
      const dg = p[i * 3 + 1] - cg
      const db = p[i * 3 + 2] - cb
      // 人の目の感じ方に寄せた重み（緑を重く、青を軽く）
      const distance = 2 * dr * dr + 4 * dg * dg + 3 * db * db
      if (distance < bestDistance) {
        bestDistance = distance
        best = i
        if (distance === 0) break
      }
    }
    this.cache[key] = best
    return best
  }
}

/** 4×4 の Bayer 行列（0〜15）。並びの決まったディザで、フレーム間でちらつきにくい */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

const clamp255 = (value: number) => (value < 0 ? 0 : value > 255 ? 255 : value)

/**
 * 画素をパレットの番号にする。透明な画素は transparentIndex（なければ近い色）にする。
 * Floyd–Steinberg は誤差を右・下へ配り、ordered は位置で決まる揺らぎを足してから近い色を引く。
 */
export function mapToPalette(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  palette: Uint8Array,
  dither: GifDither,
  transparentIndex: number | null,
  nearest: NearestColor = new NearestColor(palette)
): Uint8Array {
  const out = new Uint8Array(width * height)
  const count = palette.length / 3
  if (dither === 'floydSteinberg') {
    // 誤差は今の行と次の行の 2 本だけ持つ
    let current = new Float32Array((width + 2) * 3)
    let next = new Float32Array((width + 2) * 3)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        const pixel = y * width + x
        if (rgba[i + 3] < ALPHA_THRESHOLD && transparentIndex !== null) {
          out[pixel] = transparentIndex
          continue
        }
        const e = (x + 1) * 3
        const r = clamp255(rgba[i] + current[e])
        const g = clamp255(rgba[i + 1] + current[e + 1])
        const b = clamp255(rgba[i + 2] + current[e + 2])
        const index = nearest.find(r, g, b)
        out[pixel] = index
        const er = r - palette[index * 3]
        const eg = g - palette[index * 3 + 1]
        const eb = b - palette[index * 3 + 2]
        // 右 7/16、左下 3/16、下 5/16、右下 1/16
        current[e + 3] += (er * 7) / 16
        current[e + 4] += (eg * 7) / 16
        current[e + 5] += (eb * 7) / 16
        next[e - 3] += (er * 3) / 16
        next[e - 2] += (eg * 3) / 16
        next[e - 1] += (eb * 3) / 16
        next[e] += (er * 5) / 16
        next[e + 1] += (eg * 5) / 16
        next[e + 2] += (eb * 5) / 16
        next[e + 3] += er / 16
        next[e + 4] += eg / 16
        next[e + 5] += eb / 16
      }
      const swap = current
      current = next
      next = swap
      next.fill(0)
    }
    return out
  }

  // 揺らぎの幅は、1 軸あたりの色の間隔くらいにする（色が少ないほど大きく揺らす）
  const amplitude = dither === 'ordered' ? 255 / Math.max(1.5, Math.cbrt(count)) : 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const pixel = y * width + x
      if (rgba[i + 3] < ALPHA_THRESHOLD && transparentIndex !== null) {
        out[pixel] = transparentIndex
        continue
      }
      if (amplitude === 0) {
        out[pixel] = nearest.find(rgba[i], rgba[i + 1], rgba[i + 2])
        continue
      }
      const offset = ((BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * amplitude
      out[pixel] = nearest.find(clamp255(rgba[i] + offset), clamp255(rgba[i + 1] + offset), clamp255(rgba[i + 2] + offset))
    }
  }
  return out
}

/** 色をそのまま使えるときのパレット。色の数が上限以内なら減色せずに済み、GIF を開いて保存し直しても色が変わらない */
export interface ExactPalette {
  palette: Uint8Array
  /** 0xRRGGBB → 番号 */
  lookup: Map<number, number>
}

/**
 * 不透明な画素の色が limit 色以内なら、その色だけのパレットを返す。超えたら null（メディアンカットに回す）。
 * 既にある lookup に足していけば、複数のフレームで 1 つのパレットにできる
 */
export function collectExactColors(
  rgba: Uint8ClampedArray,
  limit: number,
  lookup: Map<number, number> = new Map()
): Map<number, number> | null {
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < ALPHA_THRESHOLD) continue
    const color = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]
    if (lookup.has(color)) continue
    if (lookup.size >= limit) return null
    lookup.set(color, lookup.size)
  }
  return lookup
}

export function exactPalette(lookup: Map<number, number>): ExactPalette {
  const palette = new Uint8Array(Math.max(1, lookup.size) * 3)
  for (const [color, index] of lookup) {
    palette[index * 3] = color >> 16
    palette[index * 3 + 1] = (color >> 8) & 0xff
    palette[index * 3 + 2] = color & 0xff
  }
  return { palette, lookup }
}

/** 色をそのまま番号にする（ExactPalette 用。ディザは要らない） */
export function mapExact(rgba: Uint8ClampedArray, exact: ExactPalette, transparentIndex: number | null): Uint8Array {
  const out = new Uint8Array(rgba.length / 4)
  for (let i = 0, pixel = 0; i < rgba.length; i += 4, pixel++) {
    if (rgba[i + 3] < ALPHA_THRESHOLD) {
      out[pixel] = transparentIndex ?? 0
      continue
    }
    out[pixel] = exact.lookup.get((rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]) ?? 0
  }
  return out
}

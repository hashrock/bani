import { throwIfAborted } from '../../utils/abort'

/**
 * 画像の書き出し設定と、目標サイズに収める品質の探索。
 * エンコーダは引数で受け取るので、ここはブラウザなしで確かめられる。
 */

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'avif'

export interface ImageFormatInfo {
  mime: string
  extension: string
  /** 品質の指定が効くか（PNG は可逆なので効かない） */
  lossy: boolean
  /** 透過を残せるか。残せない形式は背景色（未指定なら白）で塗る */
  alpha: boolean
}

export const IMAGE_FORMATS: Record<ImageFormat, ImageFormatInfo> = {
  png: { mime: 'image/png', extension: 'png', lossy: false, alpha: true },
  jpeg: { mime: 'image/jpeg', extension: 'jpg', lossy: true, alpha: false },
  webp: { mime: 'image/webp', extension: 'webp', lossy: true, alpha: true },
  avif: { mime: 'image/avif', extension: 'avif', lossy: true, alpha: true },
}

export interface ImageOutput {
  format: ImageFormat
  /** 1〜100。可逆形式では無視する */
  quality: number
  /**
   * 書き出しの上限バイト数。指定すると quality を上限として、収まる範囲で最も高い品質を探す。
   * serviceLimits.json の maxSize をそのまま渡せる。可逆形式では無視する
   */
  targetBytes: number | null
}

/**
 * 出力形式の既定。元と同じ形式を書き出せるならそれにする（PNG を開いて ⌘S なら劣化なしの上書きになる）。
 * 書き出せない形式（GIF・BMP・HEIC など）なら、どこでも書き出せて劣化しない PNG にする
 */
export function defaultImageFormat(sourceMime: string, writable: readonly ImageFormat[]): ImageFormat {
  const same = (Object.keys(IMAGE_FORMATS) as ImageFormat[]).find(
    (format) => IMAGE_FORMATS[format].mime === sourceMime.toLowerCase()
  )
  return same && writable.includes(same) ? same : 'png'
}

export const MIN_QUALITY = 1
export const MAX_QUALITY = 100

export function createImageOutput(format: ImageFormat = 'webp'): ImageOutput {
  return { format, quality: 85, targetBytes: null }
}

/** 品質を 1〜100 の整数に収める。読めない値は既定の 85 */
export function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) return 85
  return Math.min(MAX_QUALITY, Math.max(MIN_QUALITY, Math.round(quality)))
}

/** 書き出し後のファイル名。拡張子がなければ足す */
export function outputImageFilename(name: string, format: ImageFormat): string {
  const extension = IMAGE_FORMATS[format].extension
  const base = name.replace(/\.[^./\\]+$/, '')
  return `${base || 'image'}.${extension}`
}

export interface QualitySearchResult<T> {
  quality: number
  encoded: T
  size: number
  /** 目標に収まったか。最低品質でも収まらなければ false で、最低品質の結果を返す */
  fits: boolean
  /** エンコードした回数 */
  attempts: number
}

/**
 * 目標バイト数に収まる最も高い品質を二分探索で探す。
 * まず maxQuality を試し、収まればそれで終わる（大半の画像は一度で済む）。
 *
 * 実際のエンコーダは品質に対してサイズが単調とは限らないので、探索の途中で
 * 収まった結果のうち品質が最も高いものを返す。単調なら最良の品質に一致する。
 * エンコード回数は高々 2 + ceil(log2(maxQuality - minQuality + 1))。
 */
export async function searchQualityForTarget<T>(
  encode: (quality: number) => Promise<{ encoded: T; size: number }>,
  targetBytes: number,
  options: { minQuality?: number; maxQuality?: number; signal?: AbortSignal } = {}
): Promise<QualitySearchResult<T>> {
  const min = clampQuality(options.minQuality ?? MIN_QUALITY)
  const max = Math.max(min, clampQuality(options.maxQuality ?? MAX_QUALITY))
  let attempts = 0
  const run = async (quality: number) => {
    throwIfAborted(options.signal)
    attempts++
    const result = await encode(quality)
    return { quality, ...result }
  }

  const top = await run(max)
  if (top.size <= targetBytes) return { ...top, fits: true, attempts }
  if (min === max) return { ...top, fits: false, attempts }

  const bottom = await run(min)
  if (bottom.size > targetBytes) return { ...bottom, fits: false, attempts }

  // 不変条件: lo は収まる品質、hi は収まらない品質
  let best = bottom
  let lo = min
  let hi = max
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    const result = await run(mid)
    if (result.size <= targetBytes) {
      lo = mid
      if (result.quality > best.quality) best = result
    } else {
      hi = mid
    }
  }
  return { ...best, fits: true, attempts }
}

/**
 * SVG を画素にする。消毒（svg.ts）したものを blob: の <img> として読み、Canvas に描く。
 * <img> として描く SVG はスクリプトを動かさず外部も読みに行かないので、消毒と二重の守りになる。
 * foreignObject は消毒で取り除くので、Canvas が汚れて（tainted）書き出せなくなることもない。
 *
 * ブラウザの API だけでできていて、vitest（node）では動かさない。Image を使うので Worker でも動かない。
 */
import { throwIfAborted } from '../../utils/abort'
import { MAX_DIMENSION } from './recipe'
import { sanitizeSvg } from './svg'
import type { SvgRasterOptions, SvgRemovals, SvgSize } from './svg'

export interface RasterizedSvg {
  bitmap: ImageBitmap
  /** SVG が持っている大きさ（px） */
  intrinsic: SvgSize
  removed: SvgRemovals
}

export class SvgTooLargeError extends Error {
  readonly size: SvgSize
  constructor(size: SvgSize) {
    super(`The SVG is too large to rasterize (${size.width}×${size.height}, up to ${MAX_DIMENSION}px per side)`)
    this.name = 'SvgTooLargeError'
    this.size = size
  }
}

/** SVG の文字列か Blob を、指定の大きさの ImageBitmap にする。呼び出し側が close する */
export async function rasterizeSvg(
  source: string | Blob,
  options: SvgRasterOptions = {},
  signal?: AbortSignal
): Promise<RasterizedSvg> {
  const text = typeof source === 'string' ? source : await source.text()
  throwIfAborted(signal)
  const { markup, size, intrinsic, removed } = sanitizeSvg(text, options)
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) throw new SvgTooLargeError(size)

  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
  try {
    const image = await loadImage(url)
    throwIfAborted(signal)
    const canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas を用意できませんでした')
    // ルートに描く大きさを書き込んであるので、拡大して描いてもぼけない（ベクタのまま描かれる）
    ctx.drawImage(image, 0, 0, size.width, size.height)
    return { bitmap: await createImageBitmap(canvas), intrinsic, removed }
  } finally {
    URL.revokeObjectURL(url)
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('SVG を描けませんでした（XML として読めない可能性があります）'))
    image.src = url
  })
}

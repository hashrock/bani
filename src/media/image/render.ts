/**
 * 画像の書き出し。createImageBitmap でデコードし、Canvas に描いてエンコードし直す。
 *
 * Canvas を経由すると EXIF・GPS・XMP・テキストチャンクなどの付帯情報はすべて落ちる
 * （画素だけが残る）。つまり renderImage の結果は常に位置情報を含まない。
 * EXIF の向きはデコード時に画素へ反映してから落とすので、見た目は変わらない。
 * ICC プロファイルも落ちるため、広色域の写真は sRGB 相当で書き出される。
 *
 * このファイルはブラウザの API だけでできていて、vitest（node）では動かさない。
 * 座標の計算は computeDrawPlan、品質の探索は searchQualityForTarget に寄せてあり、そちらはテスト済み。
 */
import { throwIfAborted } from '../../utils/abort'
import type { RenderOptions, RenderedFile } from '../types'
import { IMAGE_FORMATS, clampQuality, outputImageFilename, searchQualityForTarget } from './output'
import type { ImageFormat, ImageOutput } from './output'
import { MAX_DIMENSION, computeDrawPlan, fitRecipeToImage } from './recipe'
import type { ImageDrawPlan, ImageRecipe } from './recipe'

export interface RenderedImage extends RenderedFile {
  width: number
  height: number
  /** 実際に使った品質。可逆形式では null */
  quality: number | null
  /** 目標サイズに収まったか。目標を指定していなければ null */
  fitsTarget: boolean | null
}

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
type AnyContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

/**
 * 元ファイル + レシピ + 出力設定 から画像を書き出す。付帯情報は残らない（ファイル冒頭の説明を参照）。
 * 寸法は実際にデコードした画素から取り直し、切り抜きがはみ出していれば収め直す。
 */
export async function renderImage(
  file: Blob,
  recipe: ImageRecipe,
  output: ImageOutput,
  options: RenderOptions = {}
): Promise<RenderedImage> {
  const { signal, onProgress } = options
  throwIfAborted(signal)
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  try {
    throwIfAborted(signal)
    onProgress?.(0.2)
    const size = { width: bitmap.width, height: bitmap.height }
    const plan = computeDrawPlan(size, fitRecipeToImage(recipe, size))
    const canvas = drawToCanvas(bitmap, plan, recipe.background, IMAGE_FORMATS[output.format].alpha)
    onProgress?.(0.4)

    const filename = outputImageFilename(file instanceof File ? file.name : 'image', output.format)
    const base = { filename, width: plan.canvasWidth, height: plan.canvasHeight }
    const format = IMAGE_FORMATS[output.format]
    if (!format.lossy) {
      const blob = await encodeCanvas(canvas, output.format)
      onProgress?.(1)
      return { ...base, blob, quality: null, fitsTarget: null }
    }

    const quality = clampQuality(output.quality)
    if (output.targetBytes === null) {
      const blob = await encodeCanvas(canvas, output.format, quality)
      onProgress?.(1)
      return { ...base, blob, quality, fitsTarget: null }
    }
    const result = await searchQualityForTarget(
      async (q) => {
        const blob = await encodeCanvas(canvas, output.format, q)
        return { encoded: blob, size: blob.size }
      },
      output.targetBytes,
      { maxQuality: quality, signal }
    )
    onProgress?.(1)
    return { ...base, blob: result.encoded, quality: result.quality, fitsTarget: result.fits }
  } finally {
    bitmap.close()
  }
}

export type BatchImageResult =
  | { file: File; ok: true; rendered: RenderedImage }
  | { file: File; ok: false; error: unknown }

/**
 * 同じレシピと出力設定を複数の画像に順に当てる。切り抜きは画像ごとに収め直すので、
 * 一括処理では切り抜きなし + keepAspect のリサイズのような、寸法に依らないレシピが向く。
 * 1 枚の失敗では止めず、結果に残す。中断されたときだけ例外を投げる。
 * 同時に 1 枚ずつにしているのは、大きな画像のデコードでメモリを使い切らないため。
 */
export async function renderImageBatch(
  files: readonly File[],
  recipe: ImageRecipe,
  output: ImageOutput,
  options: RenderOptions & { onFileDone?: (result: BatchImageResult, index: number) => void } = {}
): Promise<BatchImageResult[]> {
  const results: BatchImageResult[] = []
  for (const [index, file] of files.entries()) {
    throwIfAborted(options.signal)
    let result: BatchImageResult
    try {
      const rendered = await renderImage(file, recipe, output, {
        signal: options.signal,
        onProgress: (p) => options.onProgress?.((index + p) / files.length),
      })
      result = { file, ok: true, rendered }
    } catch (error) {
      if (options.signal?.aborted) throw error
      result = { file, ok: false, error }
    }
    results.push(result)
    options.onFileDone?.(result, index)
  }
  options.onProgress?.(1)
  return results
}

let encodableFormats: Promise<ImageFormat[]> | null = null

/**
 * このブラウザで書き出せる形式。PNG / JPEG / WebP は多くのブラウザで使えるが、
 * 対応していない形式を Canvas に頼むと黙って PNG になるので、実際に 1px を書き出して確かめる。
 * AVIF はここで書き出せると分かったときだけ選べるようにする。結果は使い回す。
 */
export function detectEncodableFormats(): Promise<ImageFormat[]> {
  encodableFormats ??= (async () => {
    const formats: ImageFormat[] = []
    for (const format of Object.keys(IMAGE_FORMATS) as ImageFormat[]) {
      try {
        const canvas = createCanvas(1, 1)
        // 描画コンテキストを一度も作っていない Canvas は、Chrome では書き出し自体を拒む
        const ctx = canvas.getContext('2d') as AnyContext | null
        if (!ctx) continue
        ctx.fillRect(0, 0, 1, 1)
        await encodeCanvas(canvas, format, 80)
        formats.push(format)
      } catch {
        // 書き出せない形式は候補から外すだけ
      }
    }
    return formats
  })()
  return encodableFormats
}

// --- Canvas まわり ---

function drawToCanvas(
  bitmap: ImageBitmap,
  plan: ImageDrawPlan,
  background: string | null,
  keepsAlpha: boolean
): AnyCanvas {
  if (plan.canvasWidth > MAX_DIMENSION || plan.canvasHeight > MAX_DIMENSION) {
    throw new Error(`書き出し寸法が大きすぎます（1 辺 ${MAX_DIMENSION}px まで）`)
  }
  const canvas = createCanvas(plan.canvasWidth, plan.canvasHeight)
  const ctx = canvas.getContext('2d') as AnyContext | null
  if (!ctx) throw new Error('Canvas を用意できませんでした')

  // 透過を持てない形式では、何もしないと透過部分が黒になるので白を敷く
  if (!keepsAlpha) fill(ctx, '#ffffff', plan)
  if (background !== null) fill(ctx, background, plan)

  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(plan.centerX, plan.centerY)
  ctx.scale(plan.scaleX, plan.scaleY)
  ctx.rotate((plan.rotation * Math.PI) / 180)
  const { source } = plan
  ctx.drawImage(
    bitmap,
    source.x,
    source.y,
    source.width,
    source.height,
    -plan.drawWidth / 2,
    -plan.drawHeight / 2,
    plan.drawWidth,
    plan.drawHeight
  )
  return canvas
}

function fill(ctx: AnyContext, color: string, plan: ImageDrawPlan) {
  ctx.fillStyle = color
  ctx.fillRect(0, 0, plan.canvasWidth, plan.canvasHeight)
}

/** Worker でも使えるように OffscreenCanvas を優先し、ない環境では DOM の canvas に倒す */
function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** 指定の形式で書き出す。ブラウザが別の形式に差し替えたら失敗として扱う */
async function encodeCanvas(canvas: AnyCanvas, format: ImageFormat, quality?: number): Promise<Blob> {
  const { mime, lossy } = IMAGE_FORMATS[format]
  const q = lossy && quality !== undefined ? quality / 100 : undefined
  const blob =
    // Worker には HTMLCanvasElement がないので instanceof ではなくメソッドの有無で分ける
    'toBlob' in canvas
      ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, q))
      : await canvas.convertToBlob({ type: mime, quality: q })
  if (!blob) throw new Error(`${mime} で書き出せませんでした`)
  if (blob.type !== mime) throw new Error(`このブラウザは ${mime} の書き出しに対応していません`)
  return blob
}

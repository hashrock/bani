/**
 * レシピ + 読んだ入力 から書き出す。ブラウザの API（OffscreenCanvas・WebCodecs）に頼る。
 *
 * 各フレームの描き方（プレビューと書き出しで同じ）:
 * 1. 入力の絵をキャンバス（recipe.width × height）に収めて真ん中に置く。大きさが同じならそのまま
 * 2. 全フレームに同じ画像のレシピ（切り抜き・回転・サイズ変更）をかける（computeDrawPlan）
 *
 * - GIF: 各フレームの RGBA を Worker（encodeWorker.ts）に渡して自前のエンコーダで書く
 * - WebP: 各フレームを Canvas で静止画の WebP にし、アニメーション WebP に組み立てる（webp.ts）
 * - MP4 / WebM: mediabunny の CanvasSource で、フレームごとの表示時間のまま書く（透過は白で塗る）
 */
import {
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  getFirstEncodableVideoCodec,
} from 'mediabunny'
import { computeDrawPlan, fitRecipeToImage } from '../image/recipe'
import type { ImageDrawPlan } from '../image/recipe'
import type { RenderOptions, RenderedFile } from '../types'
import { createWorkerClient, type WorkerClient } from '../workerClient'
import { createAbortError, throwIfAborted } from '../../utils/abort'
import type { GifEncodeRequest } from './encodeWorker'
import { encodeGif } from './gifEncode'
import { ANIMATION_FORMATS, animationFilename, videoDimension } from './output'
import type { AnimationFormat, AnimationOutput } from './output'
import type { GifRecipe } from './recipe'
import { muxAnimatedWebp } from './webp'

/** フレームの絵を引く。入力の番号とその中のフレーム番号から */
export type FrameLookup = (source: number, frame: number) => ImageBitmap | null

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement
type AnyContext = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D

const createCanvas = (width: number, height: number): AnyCanvas => {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

/** 書き出しの寸法と描き方。キャンバスがまだなければ null */
export function animationPlan(recipe: GifRecipe): ImageDrawPlan | null {
  if (recipe.width < 1 || recipe.height < 1) return null
  const size = { width: recipe.width, height: recipe.height }
  return computeDrawPlan(size, fitRecipeToImage(recipe.image, size))
}

/**
 * 入力の絵をキャンバスの大きさにそろえる（収めて真ん中へ）。同じ大きさならそのまま返す。
 * 大きさの違う画像を足したときにだけ描き直す
 */
export function fitToCanvas(bitmap: CanvasImageSource & { width: number; height: number }, width: number, height: number) {
  if (bitmap.width === width && bitmap.height === height) return bitmap
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d') as AnyContext | null
  if (!ctx) throw new Error('Canvas を用意できませんでした')
  const scale = Math.min(width / bitmap.width, height / bitmap.height)
  const w = bitmap.width * scale
  const h = bitmap.height * scale
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, (width - w) / 2, (height - h) / 2, w, h)
  return canvas
}

/**
 * 1 フレームを描く。ctx の変換は呼び出し側の倍率（プレビューの縮小）をかけた状態で渡してよい。
 * opaque なら先に白を敷く（透過を持てない動画のため）
 */
export function drawAnimationFrame(
  ctx: AnyContext,
  bitmap: CanvasImageSource & { width: number; height: number },
  recipe: GifRecipe,
  plan: ImageDrawPlan,
  opaque: boolean
) {
  ctx.save()
  ctx.clearRect(0, 0, plan.canvasWidth, plan.canvasHeight)
  if (opaque) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, plan.canvasWidth, plan.canvasHeight)
  }
  const fitted = fitToCanvas(bitmap, recipe.width, recipe.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(plan.centerX, plan.centerY)
  ctx.scale(plan.scaleX, plan.scaleY)
  ctx.rotate((plan.rotation * Math.PI) / 180)
  const { source } = plan
  ctx.drawImage(
    fitted,
    source.x,
    source.y,
    source.width,
    source.height,
    -plan.drawWidth / 2,
    -plan.drawHeight / 2,
    plan.drawWidth,
    plan.drawHeight
  )
  ctx.restore()
}

let gifClient: WorkerClient<GifEncodeRequest, Uint8Array> | null = null

async function encodeGifBytes(request: GifEncodeRequest, options: RenderOptions): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') return encodeGif(request.frames, request.options, options.onProgress)
  gifClient ??= createWorkerClient({
    create: () => new Worker(new URL('./encodeWorker.ts', import.meta.url), { type: 'module' }),
  })
  return gifClient.call(request, options)
}

export interface RenderAnimationOptions extends RenderOptions {
  /** 保存名の元（開いたファイルの名前） */
  name: string | null
}

/** フレームを 1 枚ずつ canvas に描いて draw に渡す。opaque なら透過を白で塗る */
async function eachFrame(
  recipe: GifRecipe,
  lookup: FrameLookup,
  canvas: AnyCanvas,
  opaque: boolean,
  signal: AbortSignal | undefined,
  draw: (ctx: AnyContext, index: number) => Promise<void> | void
) {
  const plan = animationPlan(recipe)
  if (!plan) throw new Error('フレームがありません')
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as AnyContext | null
  if (!ctx) throw new Error('Canvas を用意できませんでした')
  for (let index = 0; index < recipe.frames.length; index++) {
    throwIfAborted(signal)
    const ref = recipe.frames[index]
    const bitmap = lookup(ref.source, ref.frame)
    if (!bitmap) throw new Error(`フレーム ${index + 1} の絵がありません`)
    if (opaque) {
      // 動画で偶数にそろえた寸法の余り（右と下に 1px まで）も白にする
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }
    drawAnimationFrame(ctx, bitmap, recipe, plan, opaque)
    await draw(ctx, index)
  }
}

/** 全体の進み具合のうち、フレームを描く段が占める割合（GIF は残りをエンコードに使う） */
const DRAW_SHARE = 0.3

async function renderGif(recipe: GifRecipe, lookup: FrameLookup, output: AnimationOutput, options: RenderOptions) {
  const plan = animationPlan(recipe)!
  const frames: GifEncodeRequest['frames'] = []
  const canvas = createCanvas(plan.canvasWidth, plan.canvasHeight)
  await eachFrame(recipe, lookup, canvas, false, options.signal, (ctx, index) => {
    frames.push({ rgba: ctx.getImageData(0, 0, plan.canvasWidth, plan.canvasHeight).data, duration: recipe.frames[index].duration })
    options.onProgress?.(((index + 1) / recipe.frames.length) * DRAW_SHARE)
  })
  const bytes = await encodeGifBytes(
    {
      frames,
      options: {
        width: plan.canvasWidth,
        height: plan.canvasHeight,
        plays: recipe.plays,
        colors: output.colors,
        dither: output.dither,
        palette: output.palette,
      },
    },
    { signal: options.signal, onProgress: (p) => options.onProgress?.(DRAW_SHARE + p * (1 - DRAW_SHARE)) }
  )
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/gif' })
}

const canvasToBlob = (canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> =>
  canvas instanceof HTMLCanvasElement
    ? new Promise((resolve, reject) =>
        canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas を書き出せませんでした'))), type, quality)
      )
    : canvas.convertToBlob({ type, quality })

async function renderWebp(recipe: GifRecipe, lookup: FrameLookup, output: AnimationOutput, options: RenderOptions) {
  const plan = animationPlan(recipe)!
  const frames: { webp: Uint8Array; duration: number }[] = []
  // 100 は可逆（VP8L）。Chrome は quality 1 で可逆になる
  const quality = Math.max(0.01, Math.min(1, output.quality / 100))
  const canvas = createCanvas(plan.canvasWidth, plan.canvasHeight)
  await eachFrame(recipe, lookup, canvas, false, options.signal, async (_ctx, index) => {
    const blob = await canvasToBlob(canvas, 'image/webp', quality)
    if (blob.type !== 'image/webp') throw new Error('このブラウザは WebP を書き出せません')
    frames.push({ webp: new Uint8Array(await blob.arrayBuffer()), duration: recipe.frames[index].duration })
    options.onProgress?.((index + 1) / recipe.frames.length)
  })
  const bytes = muxAnimatedWebp(frames, { width: plan.canvasWidth, height: plan.canvasHeight, plays: recipe.plays })
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'image/webp' })
}

async function renderVideo(recipe: GifRecipe, lookup: FrameLookup, format: 'mp4' | 'webm', options: RenderOptions) {
  const plan = animationPlan(recipe)!
  const width = videoDimension(plan.canvasWidth)
  const height = videoDimension(plan.canvasHeight)
  const outputFormat = format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat()
  const codec = await getFirstEncodableVideoCodec(outputFormat.getSupportedVideoCodecs(), { width, height })
  if (!codec) throw new Error(`このブラウザは ${format.toUpperCase()} の映像を書き出せません`)
  const target = new BufferTarget()
  const out = new Output({ format: outputFormat, target })
  const canvas = createCanvas(width, height)
  const source = new CanvasSource(canvas, { codec, quality: QUALITY_HIGH })
  out.addVideoTrack(source)
  await out.start()
  const cancel = () => void out.cancel()
  options.signal?.addEventListener('abort', cancel, { once: true })
  try {
    let time = 0
    await eachFrame(recipe, lookup, canvas, true, options.signal, async (_ctx, index) => {
      const duration = recipe.frames[index].duration / 1000
      await source.add(time, duration)
      time += duration
      options.onProgress?.(((index + 1) / recipe.frames.length) * 0.95)
    })
    await out.finalize()
  } catch (error) {
    throwIfAborted(options.signal)
    if (out.state !== 'canceled') await out.cancel().catch(() => undefined)
    throw error
  } finally {
    options.signal?.removeEventListener('abort', cancel)
  }
  throwIfAborted(options.signal)
  if (!target.buffer) throw new Error('No buffer available after encoding')
  return new Blob([target.buffer], { type: ANIMATION_FORMATS[format].mime })
}

/** レシピどおりに書き出す。中断すると AbortError */
export async function renderAnimation(
  recipe: GifRecipe,
  lookup: FrameLookup,
  output: AnimationOutput,
  options: RenderAnimationOptions
): Promise<RenderedFile> {
  throwIfAborted(options.signal)
  if (recipe.frames.length === 0 || !animationPlan(recipe)) throw new Error('フレームがありません')
  const blob = await renderBlob(recipe, lookup, output.format, output, options)
  if (options.signal?.aborted) throw createAbortError()
  options.onProgress?.(1)
  return { blob, filename: animationFilename(options.name, output.format) }
}

function renderBlob(
  recipe: GifRecipe,
  lookup: FrameLookup,
  format: AnimationFormat,
  output: AnimationOutput,
  options: RenderOptions
): Promise<Blob> {
  switch (format) {
    case 'gif':
      return renderGif(recipe, lookup, output, options)
    case 'webp':
      return renderWebp(recipe, lookup, output, options)
    case 'mp4':
    case 'webm':
      return renderVideo(recipe, lookup, format, options)
  }
}

/** このブラウザで書き出せる形式。GIF はいつでも書ける（自前のエンコーダ） */
export async function detectAnimationFormats(): Promise<AnimationFormat[]> {
  const found: AnimationFormat[] = ['gif']
  try {
    const canvas = createCanvas(1, 1)
    // 描く用意（context）のない OffscreenCanvas は書き出せないので、先に作っておく
    canvas.getContext('2d')
    const blob = await canvasToBlob(canvas, 'image/webp', 0.8)
    if (blob.type === 'image/webp') found.push('webp')
  } catch {
    // WebP を書けないブラウザ（Safari）
  }
  for (const format of ['mp4', 'webm'] as const) {
    try {
      const outputFormat = format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat()
      if (typeof VideoEncoder === 'undefined') continue
      const codec = await getFirstEncodableVideoCodec(outputFormat.getSupportedVideoCodecs(), { width: 320, height: 240 })
      if (codec) found.push(format)
    } catch {
      // WebCodecs のないブラウザ
    }
  }
  return found
}

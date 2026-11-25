import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  WebMOutputFormat,
} from 'mediabunny'
import type { ConversionOptions, ConversionVideoOptions, VideoSample } from 'mediabunny'
import { throwIfAborted } from '../../utils/abort'
import type { Trim } from '../../types'
import type { RenderOptions, RenderedFile } from '../types'
import {
  TARGET_AUDIO_BITRATE,
  VIDEO_MIME_TYPES,
  resolveMaxShortSide,
  usesTargetSize,
  videoBitrate,
  videoFilename,
} from './output'
import { editedSize, rotatedCrop } from './recipe'
import type { VideoInfo, VideoOutput, VideoRecipe } from './types'

/**
 * mediabunny の Conversion で MP4 / WebM に書き出す。
 * 回転・切り抜き・拡大縮小・音声の除去は Conversion の機能で、反転だけは機能がないので
 * process フックで 1 フレームずつ Canvas に鏡写しにして行う（mediabunny は回転 → 切り抜き →
 * 拡大縮小 → process の順に掛けるので、反転は最後になり、レシピの順と食い違わない）。
 */
export async function transcodeVideo(
  file: Blob & { name?: string },
  recipe: VideoRecipe | null,
  info: Pick<VideoInfo, 'dimensions'> | null,
  output: VideoOutput,
  trim: Trim | null,
  options: RenderOptions & { duration?: number } = {}
): Promise<RenderedFile> {
  const { signal, onProgress } = options
  throwIfAborted(signal)
  const format = output.format === 'webm' ? 'webm' : 'mp4'
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const muted = !!recipe?.muted

  // 短い辺の上限は寸法がわかってから幅・高さに直す。一括変換では info がないので映像トラックから読む
  let sized = output
  if (output.maxShortSide && !output.width && !output.height) {
    const track = info?.dimensions ? null : await input.getPrimaryVideoTrack()
    const dimensions =
      info?.dimensions ??
      (track ? { width: await track.getDisplayWidth(), height: await track.getDisplayHeight() } : null)
    const edited = dimensions && recipe ? editedSize({ dimensions }, recipe) : dimensions
    sized = edited ? resolveMaxShortSide(output, edited) : output
  }

  // 目標サイズは長さから決まるビットレートで狙う。音声も TARGET_AUDIO_BITRATE で作り直し、
  // 元の音声をそのまま写して見積もりより大きくなるのを防ぐ
  const targeted = usesTargetSize(output)
  let bitrate = videoBitrate(output)
  let hasAudio = false
  if (targeted) {
    const duration = options.duration ?? (trim ? trim.end - trim.start : await input.computeDuration())
    hasAudio = !muted && (await input.getPrimaryAudioTrack()) !== null
    bitrate = videoBitrate(output, duration, hasAudio)
  }

  const video: ConversionVideoOptions = {
    ...(sized.width && { width: sized.width }),
    ...(sized.height && { height: sized.height }),
    ...(sized.width && sized.height && { fit: 'contain' as const }),
    quality: new Quality({ bitrate }),
    ...(targeted && { forceTranscode: true }),
  }
  if (recipe && recipe.rotation !== 0) {
    video.rotate = recipe.rotation
    // 回転をメタデータだけで済ませると、向きを読まないプレーヤーや投稿先で横倒しになる。画素に焼き込む
    video.allowRotationMetadata = false
  }
  const crop = recipe && info?.dimensions ? rotatedCrop(recipe, info.dimensions) : null
  if (crop) video.crop = crop
  if (recipe && (recipe.flipH || recipe.flipV)) video.process = mirror(recipe.flipH, recipe.flipV)

  const target = new BufferTarget()
  const conversionOptions: ConversionOptions = {
    input,
    output: new Output({
      target,
      format: format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat(),
    }),
    video,
    ...(muted
      ? { audio: { discard: true } }
      : hasAudio && { audio: { quality: new Quality({ bitrate: TARGET_AUDIO_BITRATE }), forceTranscode: true } }),
    ...(trim && { trim }),
    showWarnings: false,
  }

  const conversion = await Conversion.init(conversionOptions)
  if (!conversion.isValid) {
    throw new Error(
      'Conversion is invalid: ' + conversion.discardedTracks.map((track) => track.reason).join(', ')
    )
  }

  const cancel = () => void conversion.cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    conversion.onProgress = (progress) => onProgress?.(progress)
    await conversion.execute()
    // cancel() 後も execute() は正常に解決しうるので、ここで中断を確定させる
    throwIfAborted(signal)
  } catch (error) {
    // 中断で cancel() すると execute() は ConversionCanceledError で落ちる。呼び出し側には AbortError で揃える
    throwIfAborted(signal)
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
  }

  const buffer = target.buffer
  if (!buffer) throw new Error('No buffer available after conversion')

  onProgress?.(1)
  return {
    blob: new Blob([buffer], { type: VIDEO_MIME_TYPES[format] }),
    filename: videoFilename(file.name ?? 'video', format),
  }
}

/** フレームを左右・上下に鏡写しにする process。Canvas は使い回す（返した Canvas はすぐに VideoFrame へ写される） */
function mirror(flipH: boolean, flipV: boolean) {
  let canvas: OffscreenCanvas | null = null
  let context: OffscreenCanvasRenderingContext2D | null = null
  return (sample: VideoSample) => {
    const width = sample.displayWidth
    const height = sample.displayHeight
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height)
      context = canvas.getContext('2d')
    }
    if (!context) throw new Error('Failed to create a 2D canvas context')
    context.setTransform(flipH ? -1 : 1, 0, 0, flipV ? -1 : 1, flipH ? width : 0, flipV ? height : 0)
    sample.draw(context, 0, 0, width, height)
    return canvas
  }
}

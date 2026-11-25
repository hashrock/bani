import { replaceExtension } from '../../utils/format'
import { editedSize, sourceRect } from './recipe'
import type { VideoSize } from './recipe'
import type { VideoCropRect, VideoFormat, VideoInfo, VideoOutput, VideoRecipe, VideoRotation } from './types'

/**
 * 出力設定（形式・画質・解像度）と、そこから決まる寸法。純粋な計算だけを置く。
 */

export const DEFAULT_GIF_FPS = 10
/** quality 100% のときのビットレート */
export const MAX_VIDEO_BITRATE = 5_000_000

export const DEFAULT_VIDEO_OUTPUT: VideoOutput = { format: 'mp4', quality: 80 }

export const VIDEO_MIME_TYPES: Readonly<Record<VideoFormat, string>> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  gif: 'image/gif',
}

/** 解像度のプリセット（短い辺の画素数） */
export const RESOLUTION_PRESETS = [1080, 720, 480, 360] as const

export function videoBitrate(output: Pick<VideoOutput, 'quality'>): number {
  const quality = Number.isFinite(output.quality) ? Math.min(100, Math.max(1, output.quality)) : 80
  return Math.round((quality / 100) * MAX_VIDEO_BITRATE)
}

export function videoFilename(name: string, format: VideoFormat): string {
  return replaceExtension(name, format)
}

/**
 * 書き出しの寸法。mediabunny の Conversion が width / height から寸法を決める規則
 * （片方だけなら縦横比から求め、どちらも 2 の倍数に切り上げる）をそのまま写している。
 * 両方を指定したときは、その枠に収めて余りを黒で埋める（fit: 'contain'）。
 */
export function videoOutputSize(edited: VideoSize, output: Pick<VideoOutput, 'width' | 'height'>): VideoSize {
  const width = positive(output.width)
  const height = positive(output.height)
  const aspect = edited.width / edited.height
  if (width !== null && height === null) {
    const w = ceilToEven(width)
    return { width: w, height: ceilToEven(Math.round(w / aspect)) }
  }
  if (width === null && height !== null) {
    const h = ceilToEven(height)
    return { width: ceilToEven(Math.round(h * aspect)), height: h }
  }
  if (width !== null && height !== null) return { width: ceilToEven(width), height: ceilToEven(height) }
  return { width: edited.width, height: edited.height }
}

/** プリセットを当てたときの解像度。短い辺をプリセットの値にし、長い辺は縦横比から決めさせる */
export function applyResolutionPreset(
  output: VideoOutput,
  edited: VideoSize,
  preset: number
): VideoOutput {
  return edited.width >= edited.height
    ? { ...output, width: undefined, height: preset }
    : { ...output, width: preset, height: undefined }
}

export function isResolutionPresetActive(output: VideoOutput, edited: VideoSize, preset: number): boolean {
  return edited.width >= edited.height
    ? !positive(output.width) && output.height === preset
    : !positive(output.height) && output.width === preset
}

/** その映像で意味のあるプリセット（元より小さくなるもの） */
export function resolutionPresetsFor(edited: VideoSize): number[] {
  const short = Math.min(edited.width, edited.height)
  return RESOLUTION_PRESETS.filter((preset) => preset < short)
}

/**
 * Canvas に 1 フレームを描くための手順（GIF と静止画の書き出しで使う）。次の順に呼べばレシピどおりの絵になる:
 *   ctx.translate(canvasWidth / 2, canvasHeight / 2)
 *   ctx.scale(scaleX, scaleY)
 *   ctx.rotate(rotation * Math.PI / 180)
 *   ctx.drawImage(video, source.x, source.y, source.width, source.height,
 *                 -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
 * 両方の辺を指定したときは枠の中に縦横比を保って収め、余りは呼び出し側が塗った下地のまま残す。
 */
export interface FrameDrawPlan {
  canvasWidth: number
  canvasHeight: number
  source: VideoCropRect
  scaleX: 1 | -1
  scaleY: 1 | -1
  rotation: VideoRotation
  /** 回転前の向きでの描画寸法 */
  drawWidth: number
  drawHeight: number
}

/** output が null なら拡大縮小しない（切り抜き・回転後の原寸） */
export function computeFrameDrawPlan(
  info: Pick<VideoInfo, 'dimensions'>,
  recipe: VideoRecipe,
  output: Pick<VideoOutput, 'width' | 'height'> | null
): FrameDrawPlan | null {
  const edited = editedSize(info, recipe)
  if (!info.dimensions || !edited || edited.width <= 0 || edited.height <= 0) return null
  const canvas = output ? videoOutputSize(edited, output) : edited
  // 枠いっぱいに縦横比を保って収める（片方だけの指定や原寸なら枠と同じ大きさになる）
  const scale = Math.min(canvas.width / edited.width, canvas.height / edited.height)
  const content = {
    width: Math.max(1, Math.round(edited.width * scale)),
    height: Math.max(1, Math.round(edited.height * scale)),
  }
  const quarter = recipe.rotation % 180 !== 0
  return {
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    source: sourceRect(recipe, info.dimensions),
    scaleX: recipe.flipH ? -1 : 1,
    scaleY: recipe.flipV ? -1 : 1,
    rotation: recipe.rotation,
    drawWidth: quarter ? content.height : content.width,
    drawHeight: quarter ? content.width : content.height,
  }
}

function positive(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : null
}

function ceilToEven(value: number): number {
  return Math.max(2, Math.ceil(value / 2) * 2)
}

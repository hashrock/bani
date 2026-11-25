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

/**
 * 出力設定の既定。元と同じ入れ物（MP4 / WebM）にする。ほかの入れ物（MOV・MKV など）は MP4。
 * 動画は常に作り直すので、同じ形式でも別名で保存が主になる
 */
export function defaultVideoOutput(source: { name: string; type: string }): VideoOutput {
  const webm = source.type.toLowerCase() === 'video/webm' || /\.webm$/i.test(source.name)
  return { ...DEFAULT_VIDEO_OUTPUT, format: webm ? 'webm' : 'mp4' }
}

export const VIDEO_MIME_TYPES: Readonly<Record<VideoFormat, string>> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  gif: 'image/gif',
}

/** 解像度のプリセット（短い辺の画素数） */
export const RESOLUTION_PRESETS = [1080, 720, 480, 360] as const

/** 目標サイズに収めるとき、音声に見込むビットレート。音声も作り直してこの値に揃え、見積もりを外さないようにする */
export const TARGET_AUDIO_BITRATE = 128_000
/**
 * 目標サイズのうち映像と音声に使う割合。WebCodecs のエンコーダはビットレートを平均の目安としてしか守らず、
 * 入れ物の見出しや索引の分も載るので、上限ちょうどを狙うとはみ出す
 */
export const TARGET_SIZE_MARGIN = 0.9
/** 目標サイズから求めた映像のビットレートの下限。これより下げると見られる絵にならないので、収まらなくても止める */
export const MIN_TARGET_VIDEO_BITRATE = 100_000

/**
 * targetBytes に収めるための映像のビットレート（bps）。長さか目標が正でなければ null。
 * 音声のビットレートを先に差し引き、残りを映像に回す。下限は MIN_TARGET_VIDEO_BITRATE
 */
export function bitrateForTargetSize(
  targetBytes: number,
  durationSeconds: number,
  audioBitrate = 0
): number | null {
  if (!(targetBytes > 0) || !(durationSeconds > 0) || !Number.isFinite(targetBytes)) return null
  const total = (targetBytes * 8 * TARGET_SIZE_MARGIN) / durationSeconds
  const audio = Number.isFinite(audioBitrate) && audioBitrate > 0 ? audioBitrate : 0
  return Math.max(MIN_TARGET_VIDEO_BITRATE, Math.floor(total - audio))
}

/**
 * 映像のビットレート。目標サイズと長さ（秒）が揃っていれば、目標に収まるビットレートとの低いほう。
 * hasAudio は音声を残すか（目標サイズのときに音声の分を差し引くため）
 */
export function videoBitrate(
  output: Pick<VideoOutput, 'quality' | 'targetSize'>,
  durationSeconds?: number,
  hasAudio = true
): number {
  const quality = Number.isFinite(output.quality) ? Math.min(100, Math.max(1, output.quality)) : 80
  const byQuality = Math.round((quality / 100) * MAX_VIDEO_BITRATE)
  if (!output.targetSize || durationSeconds === undefined) return byQuality
  const byTarget = bitrateForTargetSize(output.targetSize, durationSeconds, hasAudio ? TARGET_AUDIO_BITRATE : 0)
  return byTarget === null ? byQuality : Math.min(byQuality, byTarget)
}

/** 入れ物の見出し・索引の分として足す割合（実測で 1〜2%） */
const CONTAINER_OVERHEAD = 1.02

/**
 * 目標サイズのビットレートが画質のビットレートより低く効くときの、出力サイズの見込み（バイト）。
 * 効かない（目標なし・GIF・画質のほうが低い）なら null で、呼び出し側は試しにエンコードして見積もる
 */
export function targetSizeEstimate(output: VideoOutput, durationSeconds: number, hasAudio: boolean): number | null {
  if (!usesTargetSize(output) || !(durationSeconds > 0)) return null
  const video = videoBitrate(output, durationSeconds, hasAudio)
  if (video >= videoBitrate({ quality: output.quality })) return null
  const audio = hasAudio ? TARGET_AUDIO_BITRATE : 0
  return Math.round((((video + audio) * durationSeconds) / 8) * CONTAINER_OVERHEAD)
}

/** 目標サイズに収めるために書き出しのビットレートを決め直すか（GIF は対象外） */
export function usesTargetSize(output: Pick<VideoOutput, 'format' | 'targetSize'>): boolean {
  return output.format !== 'gif' && !!output.targetSize && output.targetSize > 0
}

export function videoFilename(name: string, format: VideoFormat): string {
  return replaceExtension(name, format)
}

/**
 * 書き出しの寸法。mediabunny の Conversion が width / height から寸法を決める規則
 * （片方だけなら縦横比から求め、どちらも 2 の倍数に切り上げる）をそのまま写している。
 * 両方を指定したときは、その枠に収めて余りを黒で埋める（fit: 'contain'）。
 */
export function videoOutputSize(
  edited: VideoSize,
  output: Pick<VideoOutput, 'width' | 'height' | 'maxShortSide'>
): VideoSize {
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
  const cap = positive(output.maxShortSide)
  if (cap !== null && cap < Math.min(edited.width, edited.height)) {
    // 短い辺だけを指定したのと同じ（長い辺は縦横比から決まる）
    return videoOutputSize(edited, edited.width >= edited.height ? { height: cap } : { width: cap })
  }
  return { width: edited.width, height: edited.height }
}

/**
 * 短い辺の上限（maxShortSide）を、寸法がわかった映像に対して width / height に直す。
 * 元が上限以下なら原寸のまま。width / height を指定済みならそちらを優先して上限は捨てる
 */
export function resolveMaxShortSide(output: VideoOutput, edited: VideoSize): VideoOutput {
  const { maxShortSide, ...rest } = output
  const cap = positive(maxShortSide)
  if (cap === null || positive(output.width) !== null || positive(output.height) !== null) return rest
  return cap < Math.min(edited.width, edited.height) ? applyResolutionPreset(rest, edited, cap) : rest
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
  output: Pick<VideoOutput, 'width' | 'height' | 'maxShortSide'> | null
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

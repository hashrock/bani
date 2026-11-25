import { trimDuration } from '../../state/trim'
import { DEFAULT_GIF_FPS, computeFrameDrawPlan } from './output'
import { renderVideo } from './render'
import type { VideoInfo, VideoOutput, VideoRecipe } from './types'

/** 実測に使う先頭サンプルの長さ（秒） */
const SAMPLE_DURATION = 1.0
/** GIF の 1 ピクセル・1 フレームあたりの推定バイト数 */
const GIF_BYTES_PER_PIXEL = 0.3

export interface EstimateOptions {
  file: File
  recipe: VideoRecipe
  output: VideoOutput
  info: VideoInfo
  signal?: AbortSignal
}

/** 出力サイズの推定値をバイト単位で返す */
export async function estimateVideoSize({
  file,
  recipe,
  output,
  info,
  signal,
}: EstimateOptions): Promise<number> {
  const { start, end } = recipe.trim
  const duration = trimDuration(recipe.trim)
  if (duration === 0) return 0

  if (output.format === 'gif') return estimateGifSize(recipe, output, info, duration)

  // 先頭の一部だけを実際にエンコードし、その結果を区間全体へ引き伸ばす
  const sampleEnd = Math.min(start + SAMPLE_DURATION, end)
  const sampleDuration = sampleEnd - start
  if (sampleDuration <= 0) return 0

  const { blob } = await renderVideo(file, recipe, output, {
    info,
    trim: { start, end: sampleEnd },
    signal,
  })
  return Math.round((blob.size / sampleDuration) * duration)
}

/** GIF は部分エンコードしても全体の傾向を映さないため、解像度とフレーム数から概算する */
export function estimateGifSize(
  recipe: VideoRecipe,
  output: VideoOutput,
  info: Pick<VideoInfo, 'dimensions'>,
  duration: number
): number {
  const plan = computeFrameDrawPlan(info, recipe, output)
  if (!plan) return 0
  const frames = Math.ceil(duration * (output.fps ?? DEFAULT_GIF_FPS))
  return Math.round(plan.canvasWidth * plan.canvasHeight * frames * GIF_BYTES_PER_PIXEL)
}

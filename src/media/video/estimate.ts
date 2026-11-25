import { trimDuration } from '../../state/trim'
import { outputDuration } from './timing'
import { DEFAULT_GIF_FPS, computeFrameDrawPlan, targetSizeEstimate } from './output'
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
  // 大きさは書き出す長さで決まる（2 倍速なら半分の長さ）
  const played = outputDuration(recipe)

  if (output.format === 'gif') return estimateGifSize(recipe, output, info, played)

  // 目標サイズのビットレートが効くときは、エンコーダはその平均に寄せる。先頭 1 秒は最初のキーフレームと
  // レート制御の立ち上がりで重く、引き伸ばすと大きく見積もりすぎるので、ビットレートから求める
  const targeted = targetSizeEstimate(output, played, !!info.audioCodec && !recipe.muted)
  if (targeted !== null) return targeted

  // 先頭の一部だけを実際にエンコードし、その結果を区間全体へ引き伸ばす。
  // 試すのは書き出しで SAMPLE_DURATION 秒になる分（速いほど元の長い区間を使う）。
  // 元の長さの比で引き伸ばせば、速さによらず「書き出し 1 秒あたりの大きさ × 書き出しの長さ」になる
  const sampleEnd = Math.min(start + SAMPLE_DURATION * recipe.speed, end)
  const sampleDuration = sampleEnd - start
  if (sampleDuration <= 0) return 0

  const { blob } = await renderVideo(file, recipe, output, {
    info,
    trim: { start, end: sampleEnd },
    // 目標サイズのビットレートは試す 1 秒ではなく区間全体の長さで決める
    duration,
    signal,
  })
  return Math.round((blob.size / sampleDuration) * duration)
}

/** GIF は部分エンコードしても全体の傾向を映さないため、解像度とフレーム数から概算する。duration は書き出しの長さ */
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

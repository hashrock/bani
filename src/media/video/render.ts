import type { RenderOptions, RenderedFile } from '../types'
import { encodeGif } from './gif'
import { encodeTrim } from './recipe'
import { transcodeVideo } from './transcode'
import type { VideoInfo, VideoOutput, VideoRecipe } from './types'
import type { Trim } from '../../types'

export interface RenderVideoOptions extends RenderOptions {
  /** probeVideo の結果。切り抜きの座標変換と区間の判定に使う。recipe が null なら不要 */
  info?: VideoInfo | null
  /** レシピの区間の代わりに使う区間（見積もりで先頭だけを試すときなど） */
  trim?: Trim | null
  /**
   * 目標サイズ（output.targetSize）からビットレートを決めるときの長さ（秒）。
   * 見積もりで先頭だけを試すときも、書き出す区間全体の長さを渡す。未指定なら書き出す区間の長さ
   */
  duration?: number
}

/**
 * 元ファイル + レシピ + 出力設定 から動画（または GIF）を書き出す。
 * recipe が null なら編集なし（全体をそのまま形式だけ変える）。一括変換はこちらを使う。
 * 中断すると AbortError で落ちる。
 */
export function renderVideo(
  file: Blob & { name?: string },
  recipe: VideoRecipe | null,
  output: VideoOutput,
  options: RenderVideoOptions = {}
): Promise<RenderedFile> {
  const { info = null, trim: trimOverride, duration, ...renderOptions } = options
  const trim =
    trimOverride !== undefined
      ? trimOverride
      : recipe
        ? encodeTrim(recipe, { duration: info?.duration ?? 0 })
        : null
  return output.format === 'gif'
    ? encodeGif(file, recipe, output, trim, renderOptions)
    : transcodeVideo(file, recipe, info, output, trim, { ...renderOptions, duration })
}

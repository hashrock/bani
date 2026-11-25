/*
 * 動画の画面と状態遷移（src/state）が共有する型。メディアごとの型は src/media/<kind>/types.ts に置く。
 */

export interface ConversionResult {
  blob: Blob
  originalSize: number
  convertedSize: number
  filename: string
}

export interface PreviewEstimate {
  estimatedSize: number
  isEstimating: boolean
}

/** 入力ファイルから切り出す区間（秒） */
export interface Trim {
  start: number
  end: number
}

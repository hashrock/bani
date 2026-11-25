import { DEFAULT_VIDEO_OUTPUT } from './media/video/output'
import type { VideoFormat, VideoInfo, VideoOutput } from './media/video/types'

/** @deprecated VideoFormat（src/media/video）を使う。一括変換の画面が移るまで残す */
export type OutputFormat = VideoFormat

/**
 * 一括変換で使う動画の出力設定。編集（トリム・切り抜きなど）は VideoRecipe に分けたので、
 * ここに残るのは形式・画質・解像度・フレームレートだけ。
 * @deprecated VideoOutput（src/media/video）を使う。App.tsx と一括変換の画面が移るまで残す
 */
export type ConversionSettings = VideoOutput

/** @deprecated DEFAULT_VIDEO_OUTPUT（src/media/video）を使う */
export const DEFAULT_SETTINGS: ConversionSettings = DEFAULT_VIDEO_OUTPUT

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

interface BatchFileBase {
  file: File
  /** 変換の進み具合（0〜100） */
  progress: number
}

/**
 * バッチ変換 1 件の状態。取りうる形をユニオンで閉じているので
 * 「失敗したのに結果がある」といった組み合わせは表現できない。
 * 出力そのものは書き出し先へ保存済みなので、ここには表示に使う大きさだけを残す。
 */
export type BatchFileStatus =
  | (BatchFileBase & { status: 'pending' })
  | (BatchFileBase & { status: 'converting' })
  | (BatchFileBase & { status: 'completed'; convertedSize: number })
  | (BatchFileBase & { status: 'error'; error: string })

/** 入力ファイルから読み取ったメディア情報。常にまとめて取得・破棄する */
export type MediaInfo = VideoInfo

/** 入力ファイルから切り出す区間（秒） */
export interface Trim {
  start: number
  end: number
}

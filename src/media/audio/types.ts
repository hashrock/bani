import type { AudioCodec, MetadataTags } from 'mediabunny'

/** 元ファイルから読んだ音声トラックの情報。動画ファイルなら最初の音声トラックを指す */
export interface AudioInfo {
  /** 秒。ファイル全体の尺（動画なら映像も含めた尺） */
  duration: number
  sampleRate: number
  channels: number
  /** mediabunny が判別できなかった場合は null */
  codec: AudioCodec | null
  /** タグが読めなかった場合は null */
  tags: MetadataTags | null
  /** 映像トラックを持つか。動画から音声だけを抜き出す場面の判断に使う */
  hasVideo: boolean
}

export interface AudioTrim {
  start: number
  end: number
}

/**
 * 音声の非破壊編集の内容。不変オブジェクトで、applyAudioEdit を通してのみ作り替える。
 * trim は元ファイルの時間軸の秒、フェードは切り出した区間の中での長さ（秒）。
 */
export interface AudioRecipe {
  readonly trim: Readonly<AudioTrim>
  /** 秒。切り出した区間の先頭からの長さ */
  readonly fadeIn: number
  /** 秒。切り出した区間の末尾までの長さ */
  readonly fadeOut: number
  /** デシベル。normalize と併用したときは、ノーマライズ後にさらに掛ける */
  readonly gainDb: number
  /** 区間のピークを NORMALIZE_TARGET_DB に揃える */
  readonly normalize: boolean
  /** 全チャンネルを平均して 1 チャンネルにする */
  readonly mono: boolean
}

export type AudioEdit =
  | { type: 'setTrimStart'; time: number }
  | { type: 'setTrimEnd'; time: number }
  | { type: 'resetTrim' }
  | { type: 'setFadeIn'; seconds: number }
  | { type: 'setFadeOut'; seconds: number }
  | { type: 'setGain'; db: number }
  | { type: 'setNormalize'; enabled: boolean }
  | { type: 'setMono'; enabled: boolean }
  | { type: 'reset' }

export type AudioFormat = 'mp3' | 'm4a' | 'opus' | 'wav' | 'flac'

export interface AudioOutput {
  format: AudioFormat
  /** bps。可逆形式（WAV / FLAC）では使わない */
  bitrate: number
  /** Hz。null なら元のサンプルレートを（形式が許す範囲で）保つ */
  sampleRate: number | null
}

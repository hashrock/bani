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

/** 秒の範囲 [start, end) */
export interface TimeRange {
  start: number
  end: number
}

/**
 * 無音カットの設定。切っているあいだも値は残し、入れ直したら前の設定に戻れるようにする。
 * 検出と削り方は silence.ts、つなぎ方は splice.ts
 */
export interface AudioSilence {
  readonly enabled: boolean
  /** dBFS。窓のピークがこれを下回ると無音とみなす */
  readonly thresholdDb: number
  /** 秒。これより短い無音は削らない（息継ぎや言葉の間を残す） */
  readonly minDuration: number
  /** 秒。削る無音の両側に残す長さ（言葉の頭・尻が切れないように） */
  readonly padding: number
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
  /**
   * 区間の中の無音を削る。適用の順は「区間で切り出す → 無音を削ってつなぐ → フェード・音量」。
   * フェードは削ったあとの（書き出しの）時間軸の頭と尻に掛かる
   */
  readonly silence: AudioSilence
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
  | { type: 'setSilence'; silence: Partial<AudioSilence> }
  | { type: 'reset' }

export type AudioFormat = 'mp3' | 'm4a' | 'opus' | 'wav' | 'flac'

export interface AudioOutput {
  format: AudioFormat
  /** bps。可逆形式（WAV / FLAC）では使わない */
  bitrate: number
  /** Hz。null なら元のサンプルレートを（形式が許す範囲で）保つ */
  sampleRate: number | null
}

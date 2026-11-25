import type { AudioCodec } from 'mediabunny'
import { AUDIO_FORMATS, AUDIO_FORMAT_LIST, changeAudioFormat, createAudioOutput } from '../../media/audio/output'
import { dbToGain, fadeEnvelope, normalizeGain } from '../../media/audio/dsp'
import { trimmedLength } from '../../media/audio/recipe'
import type { AudioFormat, AudioOutput, AudioRecipe } from '../../media/audio/types'

/**
 * 音声の編集画面の純粋な計算。React にも Web Audio にも触れない。
 */

/**
 * 書き出し・試聴に使うレシピ。ノーマライズ中は音量を掛けない。
 * ノーマライズ後にさらに持ち上げると割れるので、画面でも音量を触れなくしてある。
 * 値そのものはレシピに残し、ノーマライズを切ったら元の音量に戻れるようにする。
 */
export function effectiveRecipe(recipe: AudioRecipe): AudioRecipe {
  return recipe.normalize && recipe.gainDb !== 0 ? { ...recipe, gainDb: 0 } : recipe
}

/** ファイル名の拡張子（小文字、ドットなし）。なければ空文字 */
function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

/** 出力形式ごとに「同じ形式」とみなす元のコンテナ（拡張子と MIME） */
const CONTAINERS: Record<AudioFormat, { extensions: string[]; mimes: string[] }> = {
  mp3: { extensions: ['mp3'], mimes: ['audio/mpeg', 'audio/mp3'] },
  m4a: { extensions: ['m4a', 'mp4'], mimes: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'] },
  opus: { extensions: ['opus', 'ogg'], mimes: ['audio/ogg', 'audio/opus'] },
  wav: { extensions: ['wav', 'wave'], mimes: ['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'] },
  flac: { extensions: ['flac'], mimes: ['audio/flac', 'audio/x-flac'] },
}

/**
 * 元ファイルと同じ形式で書き出すか（上書き保存を主にしてよいかの判断に使う）。
 * コーデックとコンテナの両方が一致したときだけ真。
 * WAV は書き出しが 16bit 固定なので、24bit や浮動小数の WAV は同じ形式とみなさない（劣化するため）。
 */
export function isSameAudioFormat(
  source: { name: string; type: string; codec: AudioCodec | null },
  format: AudioFormat
): boolean {
  if (source.codec !== AUDIO_FORMATS[format].codec) return false
  const container = CONTAINERS[format]
  const extension = extensionOf(source.name)
  if (extension !== '') return container.extensions.includes(extension)
  return container.mimes.includes(source.type.toLowerCase())
}

/**
 * 出力設定の既定。元と同じ形式を書き出せるならそれにする（WAV・FLAC を開いて ⌘S なら劣化なしの上書き）。
 * 書き出せない・わからないときは MP3。書き出せるかの確認がまだ（supported が null）なら元の形式で仮に置く
 */
export function defaultAudioOutput(
  source: { name: string; type: string; codec: AudioCodec | null },
  supported: Readonly<Record<AudioFormat, boolean>> | null
): AudioOutput {
  const same = AUDIO_FORMAT_LIST.find((format) => isSameAudioFormat(source, format))
  return createAudioOutput(same && (supported === null || supported[same]) ? same : 'mp3')
}

/** ビットレートの候補（bps）。よく使われる値から、形式が許す範囲のものだけを出す */
const COMMON_BITRATES = [32, 64, 96, 128, 160, 192, 256, 320].map((kbps) => kbps * 1000)

export function bitrateChoices(format: AudioFormat): number[] {
  const { lossless, bitrate } = AUDIO_FORMATS[format]
  if (lossless) return []
  return COMMON_BITRATES.filter((value) => value >= bitrate.min && value <= bitrate.max)
}

/**
 * いまの環境で書き出せる出力設定に直す。選んでいた形式が書き出せなければ、
 * 書き出せる最初の形式に替える（WAV は mediabunny 自身が書くので必ず残る）。
 * 対応状況がまだわからない（supported が null）うちは手を付けない。
 */
export function usableOutput(
  output: AudioOutput,
  supported: Readonly<Record<AudioFormat, boolean>> | null,
  order: readonly AudioFormat[]
): AudioOutput {
  if (!supported || supported[output.format]) return output
  const fallback = order.find((format) => supported[format])
  return fallback ? changeAudioFormat(output, fallback) : output
}

/**
 * ピーク列（ファイル全体を buckets 個に割ったもの）のうち、区間 [start, end) に掛かる最大値。
 * 試聴でのノーマライズの倍率をデコードし直さずに見積もるのに使う。
 */
export function peakInRange(peaks: Float32Array, duration: number, start: number, end: number): number {
  const n = peaks.length
  if (n === 0 || !(duration > 0) || !(end > start)) return 0
  const from = Math.max(0, Math.min(n - 1, Math.floor((start / duration) * n)))
  const to = Math.max(from + 1, Math.min(n, Math.ceil((end / duration) * n)))
  let peak = 0
  for (let i = from; i < to; i++) if (peaks[i] > peak) peak = peaks[i]
  return peak
}

/**
 * 試聴と波形の表示に掛ける一定の倍率（音量 × ノーマライズ）。
 * ノーマライズの倍率は波形のピークから見積もる。波形は全チャンネルを平均した値なので、
 * 左右で違う音では書き出しより少し大きめに持ち上がることがある（試聴なので割り切る）。
 */
export function previewBaseGain(
  recipe: AudioRecipe,
  peaks: Float32Array | null,
  duration: number
): number {
  const effective = effectiveRecipe(recipe)
  let gain = dbToGain(effective.gainDb)
  if (effective.normalize && peaks) {
    gain *= normalizeGain(peakInRange(peaks, duration, recipe.trim.start, recipe.trim.end))
  }
  return gain
}

/** 元ファイルの時刻 time（秒）での試聴の倍率。区間の外は書き出されないので 0 */
export function previewGainAt(recipe: AudioRecipe, time: number, baseGain: number): number {
  const { start, end } = recipe.trim
  if (!(time >= start && time <= end)) return 0
  return baseGain * fadeEnvelope(time - start, trimmedLength(recipe), recipe.fadeIn, recipe.fadeOut)
}

/**
 * ピーク列を描画する列数に畳む。列 x には、その列に掛かるバケツの最大値を入れる。
 * バケツより列が多ければ、同じバケツを複数の列で引く。
 */
export function columnPeaks(peaks: Float32Array, columns: number): Float32Array {
  const count = Number.isFinite(columns) && columns > 0 ? Math.floor(columns) : 0
  const out = new Float32Array(count)
  const n = peaks.length
  if (n === 0) return out
  for (let x = 0; x < count; x++) {
    const from = Math.floor((x * n) / count)
    const to = Math.max(from + 1, Math.floor(((x + 1) * n) / count))
    let peak = 0
    for (let i = from; i < to; i++) if (peaks[i] > peak) peak = peaks[i]
    out[x] = peak
  }
  return out
}

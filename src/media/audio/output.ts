import type { AudioCodec } from 'mediabunny'
import type { AudioFormat, AudioInfo, AudioOutput, AudioRecipe } from './types'
import { trimmedLength } from './recipe'

/**
 * 出力形式ごとの決まりごと。mediabunny の出力形式・コーデックとの対応と、
 * 選べるビットレート・サンプルレートの範囲をここに集める。
 */
export interface AudioFormatSpec {
  codec: AudioCodec
  extension: string
  mimeType: string
  lossless: boolean
  /** 選べるサンプルレート（昇順） */
  sampleRates: readonly number[]
  /** 書き出せるチャンネル数の上限 */
  maxChannels: number
  /** bps。可逆形式では使わない */
  bitrate: { min: number; max: number; default: number }
}

/** MPEG-1/2/2.5 Layer III が持てるサンプルレート。LAME もこれ以外は受け付けない */
const MP3_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]
/** WebCodecs の AAC エンコーダが実装を問わず受け付けるのはこの 2 つ */
const AAC_SAMPLE_RATES = [44100, 48000]
/** Opus は内部で常に 48kHz で符号化するので、入力も 48kHz に揃える */
const OPUS_SAMPLE_RATES = [48000]
/** libFLAC / WAV で一般的に使われるもの */
const PCM_SAMPLE_RATES = [8000, 11025, 16000, 22050, 32000, 44100, 48000, 88200, 96000]

/** 可逆形式で bitrate を持たないことを表す */
const NO_BITRATE = { min: 0, max: 0, default: 0 }

export const AUDIO_FORMATS: Readonly<Record<AudioFormat, AudioFormatSpec>> = {
  mp3: {
    codec: 'mp3',
    extension: 'mp3',
    mimeType: 'audio/mpeg',
    lossless: false,
    sampleRates: MP3_SAMPLE_RATES,
    maxChannels: 2,
    bitrate: { min: 32_000, max: 320_000, default: 192_000 },
  },
  m4a: {
    codec: 'aac',
    extension: 'm4a',
    mimeType: 'audio/mp4',
    lossless: false,
    sampleRates: AAC_SAMPLE_RATES,
    maxChannels: 2,
    bitrate: { min: 64_000, max: 256_000, default: 160_000 },
  },
  opus: {
    codec: 'opus',
    extension: 'opus',
    mimeType: 'audio/ogg',
    lossless: false,
    sampleRates: OPUS_SAMPLE_RATES,
    maxChannels: 2,
    bitrate: { min: 16_000, max: 256_000, default: 128_000 },
  },
  wav: {
    codec: 'pcm-s16',
    extension: 'wav',
    mimeType: 'audio/wav',
    lossless: true,
    sampleRates: PCM_SAMPLE_RATES,
    maxChannels: 8,
    bitrate: NO_BITRATE,
  },
  flac: {
    codec: 'flac',
    extension: 'flac',
    mimeType: 'audio/flac',
    lossless: true,
    sampleRates: PCM_SAMPLE_RATES,
    maxChannels: 8,
    bitrate: NO_BITRATE,
  },
}

export const AUDIO_FORMAT_LIST = Object.keys(AUDIO_FORMATS) as AudioFormat[]

export function createAudioOutput(format: AudioFormat): AudioOutput {
  return { format, bitrate: AUDIO_FORMATS[format].bitrate.default, sampleRate: null }
}

/** 形式を変えたとき、ビットレートは新しい形式の範囲に収め直し、サンプルレートは選び直させる */
export function changeAudioFormat(output: AudioOutput, format: AudioFormat): AudioOutput {
  if (output.format === format) return output
  return { format, bitrate: clampBitrate(format, output.bitrate), sampleRate: null }
}

export function clampBitrate(format: AudioFormat, bitrate: number): number {
  const range = AUDIO_FORMATS[format].bitrate
  if (AUDIO_FORMATS[format].lossless) return 0
  if (!Number.isFinite(bitrate)) return range.default
  return Math.min(range.max, Math.max(range.min, Math.round(bitrate)))
}

/**
 * 実際に書き出すサンプルレート。指定（なければ元のレート）が形式で使えなければ、
 * いちばん近いものを選ぶ。同じだけ離れていれば高い方を採って音質を落とさない
 */
export function resolveSampleRate(output: AudioOutput, info: Pick<AudioInfo, 'sampleRate'>): number {
  const wanted = output.sampleRate ?? info.sampleRate
  const rates = AUDIO_FORMATS[output.format].sampleRates
  if (!Number.isFinite(wanted) || wanted <= 0) return rates[rates.length - 1]
  let best = rates[0]
  for (const rate of rates) {
    if (Math.abs(rate - wanted) <= Math.abs(best - wanted)) best = rate
  }
  return best
}

/** 実際に書き出すチャンネル数 */
export function resolveChannels(
  output: AudioOutput,
  recipe: Pick<AudioRecipe, 'mono'>,
  info: Pick<AudioInfo, 'channels'>
): number {
  if (recipe.mono) return 1
  const channels = Number.isInteger(info.channels) && info.channels > 0 ? info.channels : 2
  return Math.min(channels, AUDIO_FORMATS[output.format].maxChannels)
}

/** WAV のヘッダ（RIFF + fmt + data） */
const WAV_HEADER_BYTES = 44
/** FLAC は音源次第で 40〜70% 程度に縮む。見積もりなので中ほどを採る */
const FLAC_RATIO = 0.6
/** 非可逆形式のコンテナ・フレームヘッダぶんの上乗せ */
const LOSSY_OVERHEAD = 1.02

/**
 * 書き出しの大きさの見積もり（バイト）。
 * 非可逆形式はビットレート × 長さ、WAV は正確に、FLAC は大まかな圧縮率で見積もる。
 */
export function estimateAudioSize(
  output: AudioOutput,
  duration: number,
  /** 可逆形式の見積もりに使う。未指定なら 44.1kHz ステレオとみなす */
  pcm: { sampleRate: number; channels: number } = { sampleRate: 44100, channels: 2 }
): number {
  if (!(duration > 0) || !Number.isFinite(duration)) return 0
  const spec = AUDIO_FORMATS[output.format]
  if (!spec.lossless) {
    return Math.round(((clampBitrate(output.format, output.bitrate) * duration) / 8) * LOSSY_OVERHEAD)
  }
  const pcmBytes = Math.round(duration * pcm.sampleRate) * pcm.channels * 2
  return output.format === 'wav' ? WAV_HEADER_BYTES + pcmBytes : Math.round(pcmBytes * FLAC_RATIO)
}

/**
 * レシピと元の情報から書き出しの大きさを見積もる。
 * @param length 書き出しの長さ（秒）。無音カットで短くなるときに渡す。省略すると区間の長さ
 */
export function estimateRenderSize(
  output: AudioOutput,
  recipe: AudioRecipe,
  info: AudioInfo,
  length = trimmedLength(recipe)
): number {
  return estimateAudioSize(output, length, {
    sampleRate: resolveSampleRate(output, info),
    channels: resolveChannels(output, recipe, info),
  })
}

/** 拡張子を出力形式のものに付け替える。拡張子がなければ付け足す */
export function audioFilename(name: string, format: AudioFormat): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  return `${base || 'audio'}.${AUDIO_FORMATS[format].extension}`
}

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  FlacOutputFormat,
  Input,
  Mp3OutputFormat,
  Mp4OutputFormat,
  OggOutputFormat,
  Output,
  Quality,
  WavOutputFormat,
} from 'mediabunny'
import type { AudioSample, ConversionAudioOptions, OutputFormat } from 'mediabunny'
import { throwIfAborted } from '../../utils/abort'
import type { RenderOptions, RenderedFile } from '../types'
import { dbToGain, floatToInt16, normalizeGain, peakOf, processPlanes } from './dsp'
import { ensureAudioEncoder } from './encoders'
import { AUDIO_FORMATS, audioFilename, clampBitrate, resolveChannels, resolveSampleRate } from './output'
import { probeAudio } from './probe'
import { trimmedLength } from './recipe'
import { decodeRange, planesToSample, primaryAudioTrack, readPlanes } from './samples'
import type { AudioFormat, AudioOutput, AudioRecipe } from './types'

/** その環境で選んだ形式のエンコーダが使えないとき（例: AAC を持たない OS の Firefox） */
export class UnsupportedAudioFormatError extends Error {
  readonly format: AudioFormat

  constructor(format: AudioFormat, detail: string) {
    super(`Cannot encode ${format} in this browser: ${detail}`)
    this.format = format
    this.name = 'UnsupportedAudioFormatError'
  }
}

/** ノーマライズのためのピーク計測（1 回目のデコード）が全体の進み具合に占める割合 */
const MEASURE_SHARE = 0.25

/**
 * 元ファイル + レシピ + 出力設定から音声ファイルを書き出す。動画ファイルなら音声だけを抜き出す。
 *
 * ノーマライズ時は 2 回デコードする（1 回目で区間のピークを測り、2 回目で書き出す）。
 * 音量・フェード・モノラル化は mediabunny の Conversion の process フックで、
 * dsp.ts の純粋関数をデコード済みのサンプルに掛けて行う。
 *
 * node（vitest）で通しで試せるのは WebCodecs を使わない経路（WAV 入力 → WAV / FLAC / MP3）だけ。
 * WAV 以外の入力のデコードと AAC / Opus の書き出しはブラウザでしか動かない。
 */
export async function renderAudio(
  file: File,
  recipe: AudioRecipe,
  output: AudioOutput,
  options: RenderOptions = {}
): Promise<RenderedFile> {
  const { signal, onProgress } = options
  throwIfAborted(signal)
  await ensureAudioEncoder(output.format)

  const info = await probeAudio(file)
  const spec = AUDIO_FORMATS[output.format]
  const sampleRate = resolveSampleRate(output, info)
  const channels = resolveChannels(output, recipe, info)
  const length = trimmedLength(recipe)
  const whole = recipe.trim.start <= 0 && recipe.trim.end >= info.duration

  let gain = dbToGain(recipe.gainDb)
  if (recipe.normalize) {
    const peak = await measurePeak(file, recipe, channels, signal, (p) => onProgress?.(p * MEASURE_SHARE))
    gain *= normalizeGain(peak)
  }
  const progressBase = recipe.normalize ? MEASURE_SHARE : 0
  throwIfAborted(signal)

  const needsProcessing =
    recipe.fadeIn > 0 || recipe.fadeOut > 0 || gain !== 1 || channels !== info.channels
  // FLAC は 32bit 浮動小数のまま渡すと 24bit で書かれて大きくなるので、16bit に揃える
  const int16 = output.format === 'flac'

  const process = (sample: AudioSample): AudioSample => {
    const planes = processPlanes(readPlanes(sample), {
      startTime: sample.timestamp,
      sampleRate: sample.sampleRate,
      length,
      fadeIn: recipe.fadeIn,
      fadeOut: recipe.fadeOut,
      gain,
      channels,
    })
    return planesToSample(int16 ? planes.map(floatToInt16) : planes, sample.sampleRate, sample.timestamp)
  }

  const audio: ConversionAudioOptions = {
    codec: spec.codec,
    ...(!spec.lossless && { quality: new Quality({ bitrate: clampBitrate(output.format, output.bitrate) }) }),
    ...(sampleRate !== info.sampleRate && { sampleRate }),
    ...(int16 && { sampleFormat: 's16' as const }),
    ...(needsProcessing
      ? { process, processedNumberOfChannels: channels, processedSampleRate: sampleRate }
      : { numberOfChannels: channels }),
  }

  const target = new BufferTarget()
  const conversion = await Conversion.init({
    input: new Input({ source: new BlobSource(file), formats: ALL_FORMATS }),
    output: new Output({ target, format: createOutputFormat(output.format) }),
    tracks: 'primary',
    video: { discard: true },
    audio,
    ...(!whole && { trim: { start: recipe.trim.start, end: recipe.trim.end } }),
    showWarnings: false,
  })
  if (!conversion.isValid) {
    const reasons = conversion.discardedTracks.map((track) => track.reason)
    if (reasons.includes('no_encodable_target_codec')) {
      throw new UnsupportedAudioFormatError(output.format, reasons.join(', '))
    }
    throw new Error('Audio conversion is invalid: ' + reasons.join(', '))
  }

  const cancel = () => void conversion.cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    conversion.onProgress = (progress) => onProgress?.(progressBase + progress * (1 - progressBase))
    await conversion.execute()
    // cancel() 後も execute() は正常に解決しうるので、ここで中断を確定させる
    throwIfAborted(signal)
  } catch (error) {
    // 中断で cancel() すると execute() は ConversionCanceledError で落ちる。呼び出し側には AbortError で揃える
    throwIfAborted(signal)
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
  }

  const buffer = target.buffer
  if (!buffer) throw new Error('No buffer available after conversion')
  onProgress?.(1)
  return {
    blob: new Blob([buffer], { type: spec.mimeType }),
    filename: audioFilename(file.name, output.format),
  }
}

function createOutputFormat(format: AudioFormat): OutputFormat {
  switch (format) {
    case 'mp3':
      return new Mp3OutputFormat()
    case 'm4a':
      // 音声だけでも MP4 コンテナでよい。先頭に moov を置いて読み込みを速くする
      return new Mp4OutputFormat({ fastStart: 'in-memory' })
    case 'opus':
      return new OggOutputFormat()
    case 'wav':
      return new WavOutputFormat()
    case 'flac':
      return new FlacOutputFormat()
  }
}

/**
 * 書き出しと同じ処理（チャンネル合わせ・フェード）を掛けた信号の、区間内のピーク。
 * 音量は掛けない（掛ける倍率をこれから決めるため）。
 */
async function measurePeak(
  file: File,
  recipe: AudioRecipe,
  channels: number,
  signal: AbortSignal | undefined,
  onProgress: (progress: number) => void
): Promise<number> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await primaryAudioTrack(input)
    const length = trimmedLength(recipe)
    let peak = 0
    for await (const block of decodeRange(track, recipe.trim.start, recipe.trim.end, signal)) {
      const processed = processPlanes(
        block.planes,
        {
          startTime: block.offset,
          sampleRate: block.sampleRate,
          length,
          fadeIn: recipe.fadeIn,
          fadeOut: recipe.fadeOut,
          gain: 1,
          channels,
        },
        false
      )
      peak = Math.max(peak, peakOf(processed))
      if (length > 0) onProgress(Math.min(1, block.offset / length))
    }
    throwIfAborted(signal)
    onProgress(1)
    return peak
  } finally {
    input.dispose()
  }
}

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
import { SILENCE_CROSSFADE, createLevelAccumulator, keptLength, levelWindowFrames, planKeptRanges } from './silence'
import { createTimedSplicer } from './splice'
import type { AudioFormat, AudioOutput, AudioRecipe, TimeRange } from './types'

/** その環境で選んだ形式のエンコーダが使えないとき（例: AAC を持たない OS の Firefox） */
export class UnsupportedAudioFormatError extends Error {
  readonly format: AudioFormat

  constructor(format: AudioFormat, detail: string) {
    super(`Cannot encode ${format} in this browser: ${detail}`)
    this.format = format
    this.name = 'UnsupportedAudioFormatError'
  }
}

/** 無音の検出・ノーマライズのピーク計測（書き出しの前のデコード）が、それぞれ全体の進み具合に占める割合 */
const PREPASS_SHARE = 0.2

/**
 * 元ファイル + レシピ + 出力設定から音声ファイルを書き出す。動画ファイルなら音声だけを抜き出す。
 *
 * 書き出しの前に、必要なら区間をデコードし直して下ごしらえをする（それぞれ 1 回ずつ）:
 * 1. 無音カット: 音量の包絡を取り、残す範囲を決める（silence.ts）
 * 2. ノーマライズ: 書き出しと同じ処理（つなぎ合わせ・チャンネル合わせ・フェード）を掛けたピークを測る
 * 書き出しでは mediabunny の Conversion の process フックで、
 * 区間で切り出す（Conversion の trim）→ 無音を削ってつなぐ（splice.ts）→ チャンネル合わせ・フェード・音量（dsp.ts）
 * の順に掛ける。フェードは削ったあとの時間軸の頭と尻に掛かる。
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

  let progressBase = 0
  const prepassProgress = (p: number) => onProgress?.(progressBase + p * PREPASS_SHARE)

  // 削るものがなければ（全体が無音・無音が見つからない）つなぎ合わせを通さない
  let kept: TimeRange[] | null = null
  if (recipe.silence.enabled) {
    const planned = await detectKeptRanges(file, recipe, signal, prepassProgress)
    if (planned.length > 1 || keptLength(planned) < length) kept = planned
    progressBase += PREPASS_SHARE
  }
  const outputLength = kept ? keptLength(kept) : length

  let gain = dbToGain(recipe.gainDb)
  if (recipe.normalize) {
    const peak = await measurePeak(file, recipe, kept, outputLength, channels, signal, prepassProgress)
    gain *= normalizeGain(peak)
    progressBase += PREPASS_SHARE
  }
  throwIfAborted(signal)

  const needsProcessing =
    kept !== null || recipe.fadeIn > 0 || recipe.fadeOut > 0 || gain !== 1 || channels !== info.channels
  // FLAC は 32bit 浮動小数のまま渡すと 24bit で書かれて大きくなるので、16bit に揃える
  const int16 = output.format === 'flac'

  const finish = (planes: Float32Array[], time: number, sampleRate: number): AudioSample => {
    const processed = processPlanes(planes, {
      startTime: time,
      sampleRate,
      length: outputLength,
      fadeIn: recipe.fadeIn,
      fadeOut: recipe.fadeOut,
      gain,
      channels,
    })
    return planesToSample(int16 ? processed.map(floatToInt16) : processed, sampleRate, time)
  }
  // process に届くのは区間の先頭を 0 とした、変換後のサンプルレートのブロック
  const splice = kept ? createTimedSplicer(kept, recipe.trim.start, SILENCE_CROSSFADE) : null
  const process = (sample: AudioSample): AudioSample | AudioSample[] | null => {
    if (!splice) return finish(readPlanes(sample), sample.timestamp, sample.sampleRate)
    const chunks = splice(readPlanes(sample), sample.timestamp, sample.sampleRate)
    return chunks.length > 0 ? chunks.map((chunk) => finish(chunk.planes, chunk.time, sample.sampleRate)) : null
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
 * 区間の音量の包絡を取り、無音カットで残す範囲を決める。
 * 包絡の窓はファイルの先頭から刻むので、区間の頭を含む窓の頭から読み始め、
 * 画面（ファイル全体から取った包絡）と同じ窓に同じ値が入るようにする。
 */
async function detectKeptRanges(
  file: File,
  recipe: AudioRecipe,
  signal: AbortSignal | undefined,
  onProgress: (progress: number) => void
): Promise<TimeRange[]> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await primaryAudioTrack(input)
    const sampleRate = await track.getSampleRate()
    const size = levelWindowFrames(sampleRate)
    const startFrame = Math.floor(Math.round(recipe.trim.start * sampleRate) / size) * size
    const from = startFrame / sampleRate
    const to = recipe.trim.end + size / sampleRate
    const accumulator = createLevelAccumulator(sampleRate, startFrame)
    const span = to - from
    for await (const block of decodeRange(track, from, to, signal)) {
      accumulator.push(block.planes)
      if (span > 0) onProgress(Math.min(1, block.offset / span))
    }
    throwIfAborted(signal)
    onProgress(1)
    return planKeptRanges(recipe, accumulator.result())
  } finally {
    input.dispose()
  }
}

/**
 * 書き出しと同じ処理（つなぎ合わせ・チャンネル合わせ・フェード）を掛けた信号の、区間内のピーク。
 * 音量は掛けない（掛ける倍率をこれから決めるため）。
 */
async function measurePeak(
  file: File,
  recipe: AudioRecipe,
  kept: readonly TimeRange[] | null,
  outputLength: number,
  channels: number,
  signal: AbortSignal | undefined,
  onProgress: (progress: number) => void
): Promise<number> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await primaryAudioTrack(input)
    const length = trimmedLength(recipe)
    const splice = kept ? createTimedSplicer(kept, recipe.trim.start, SILENCE_CROSSFADE) : null
    let peak = 0
    for await (const block of decodeRange(track, recipe.trim.start, recipe.trim.end, signal)) {
      const chunks = splice
        ? splice(block.planes, block.offset, block.sampleRate)
        : [{ planes: block.planes, time: block.offset }]
      for (const chunk of chunks) {
        const processed = processPlanes(
          chunk.planes,
          {
            startTime: chunk.time,
            sampleRate: block.sampleRate,
            length: outputLength,
            fadeIn: recipe.fadeIn,
            fadeOut: recipe.fadeOut,
            gain: 1,
            channels,
          },
          false
        )
        peak = Math.max(peak, peakOf(processed))
      }
      if (length > 0) onProgress(Math.min(1, block.offset / length))
    }
    throwIfAborted(signal)
    onProgress(1)
    return peak
  } finally {
    input.dispose()
  }
}

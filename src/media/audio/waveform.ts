import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import type { RenderOptions } from '../types'
import { remixChannels } from './dsp'
import { createPeakAccumulator } from './peaks'
import { decodeRange, primaryAudioTrack } from './samples'
import { createLevelAccumulator } from './silence'
import type { LevelEnvelope } from './silence'

export interface AudioAnalysis {
  /** 波形表示用のピーク列（全チャンネルを平均した 1 本） */
  peaks: Float32Array
  /** 無音カットの検出に使う音量の包絡（全チャンネルの絶対値の最大）。ファイルの先頭から刻む */
  levels: LevelEnvelope
}

/**
 * ファイル全体を 1 度だけデコードして、波形のピーク列と無音検出用の包絡を同時に作る。
 * 全サンプルをメモリに溜めず、デコードしながらバケツ・窓へ振り分ける。
 *
 * ブラウザ（WebCodecs）が前提。PCM（WAV）以外は vitest の node 環境ではデコードできない。
 */
export async function analyzeAudio(
  file: Blob,
  buckets: number,
  options: RenderOptions = {}
): Promise<AudioAnalysis> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await primaryAudioTrack(input)
    const [duration, sampleRate] = await Promise.all([input.computeDuration(), track.getSampleRate()])
    const peaks = createPeakAccumulator(buckets, duration * sampleRate)
    const levels = createLevelAccumulator(sampleRate, 0)
    for await (const block of decodeRange(track, 0, duration, options.signal)) {
      peaks.push(remixChannels(block.planes, 1)[0])
      levels.push(block.planes)
      if (duration > 0) options.onProgress?.(Math.min(1, block.offset / duration))
    }
    options.onProgress?.(1)
    return { peaks: peaks.result(), levels: levels.result() }
  } finally {
    input.dispose()
  }
}

/** 波形表示用に、ファイル全体を 1 チャンネルに畳んだピーク列を作る */
export async function loadWaveform(
  file: Blob,
  buckets: number,
  options: RenderOptions = {}
): Promise<Float32Array> {
  return (await analyzeAudio(file, buckets, options)).peaks
}

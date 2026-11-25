import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import type { RenderOptions } from '../types'
import { remixChannels } from './dsp'
import { createPeakAccumulator } from './peaks'
import { decodeRange, primaryAudioTrack } from './samples'

/**
 * 波形表示用に、ファイル全体を 1 チャンネルに畳んだピーク列を作る。
 * 全サンプルをメモリに溜めず、デコードしながらバケツへ振り分ける。
 *
 * ブラウザ（WebCodecs）が前提。PCM（WAV）以外は vitest の node 環境ではデコードできない。
 */
export async function loadWaveform(
  file: Blob,
  buckets: number,
  options: RenderOptions = {}
): Promise<Float32Array> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await primaryAudioTrack(input)
    const [duration, sampleRate] = await Promise.all([input.computeDuration(), track.getSampleRate()])
    const accumulator = createPeakAccumulator(buckets, duration * sampleRate)
    for await (const block of decodeRange(track, 0, duration, options.signal)) {
      accumulator.push(remixChannels(block.planes, 1)[0])
      if (duration > 0) options.onProgress?.(Math.min(1, block.offset / duration))
    }
    options.onProgress?.(1)
    return accumulator.result()
  } finally {
    input.dispose()
  }
}

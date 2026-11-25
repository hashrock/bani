import { AudioSample, AudioSampleSink } from 'mediabunny'
import type { Input, InputAudioTrack } from 'mediabunny'
import { throwIfAborted } from '../../utils/abort'
import { NoAudioTrackError } from './probe'

/**
 * mediabunny の AudioSample と、dsp.ts が扱う Float32Array の列との橋渡し。
 * デコード自体は WebCodecs（PCM 以外）に頼るので、ブラウザでしか通しで動かない。
 */

/** チャンネルごとの Float32Array に読み出す。元の形式（s16 やインターリーブ）は問わない */
export function readPlanes(sample: AudioSample): Float32Array[] {
  return Array.from({ length: sample.numberOfChannels }, (_, planeIndex) => {
    const plane = new Float32Array(sample.numberOfFrames)
    sample.copyTo(plane, { planeIndex, format: 'f32-planar' })
    return plane
  })
}

/** チャンネルごとの配列から AudioSample を作る。16bit を指定すると整数に丸めてから渡す */
export function planesToSample(
  planes: readonly (Float32Array | Int16Array)[],
  sampleRate: number,
  timestamp: number
): AudioSample {
  const frames = planes[0]?.length ?? 0
  const isInt16 = planes[0] instanceof Int16Array
  const data = isInt16 ? new Int16Array(frames * planes.length) : new Float32Array(frames * planes.length)
  planes.forEach((plane, channel) => data.set(plane, channel * frames))
  return new AudioSample({
    data,
    format: isInt16 ? 's16-planar' : 'f32-planar',
    numberOfChannels: planes.length,
    sampleRate,
    timestamp,
  })
}

/**
 * [start, end) 秒に入るぶんだけを、チャンネルごとの配列としてブロック単位で流す。
 * はみ出したサンプルは mediabunny の Conversion と同じ丸め方で切り落とし、
 * ここで測ったピークと書き出す信号の範囲を揃える。
 * offset は区間の先頭からの秒。
 */
export async function* decodeRange(
  track: InputAudioTrack,
  start: number,
  end: number,
  signal?: AbortSignal
): AsyncGenerator<{ planes: Float32Array[]; offset: number; sampleRate: number }> {
  const sink = new AudioSampleSink(track)
  for await (const sample of sink.samples(start, end)) {
    try {
      throwIfAborted(signal)
      const from = sample.timestamp < start ? Math.round((start - sample.timestamp) * sample.sampleRate) : 0
      const to =
        sample.timestamp + sample.duration > end
          ? Math.round((end - sample.timestamp) * sample.sampleRate)
          : sample.numberOfFrames
      if (to <= from) continue
      const planes = readPlanes(sample).map((plane) => plane.subarray(from, to))
      yield {
        planes,
        offset: sample.timestamp + from / sample.sampleRate - start,
        sampleRate: sample.sampleRate,
      }
    } finally {
      sample.close()
    }
  }
}

export async function primaryAudioTrack(input: Input): Promise<InputAudioTrack> {
  const track = await input.getPrimaryAudioTrack()
  if (!track) throw new NoAudioTrackError()
  return track
}

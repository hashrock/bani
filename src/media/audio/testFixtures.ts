import fc from 'fast-check'
import { MIN_TRIM_LENGTH, applyAudioEdit, createAudioRecipe } from './recipe'
import type { AudioEdit, AudioInfo, AudioRecipe } from './types'

/**
 * 音声のテストだけが使う道具（任意値の生成と、テスト用の WAV）。アプリからは読み込まない。
 */

export const audioInfoWith = (duration: number, channels = 2, sampleRate = 44100): AudioInfo => ({
  duration,
  sampleRate,
  channels,
  codec: 'pcm-s16',
  tags: null,
  hasVideo: false,
})

/** 区間を詰められる長さの尺 */
export const trimmableDuration = fc.double({ min: MIN_TRIM_LENGTH, max: 1e4, noNaN: true })

/** 尺が取れなかった・極端に短いファイル。不変条件が崩れないかを見るために混ぜる */
export const degenerateDuration = fc.oneof(
  fc.double({ min: 0, max: MIN_TRIM_LENGTH, noNaN: true }),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, -1)
)

/** 画面から来うる値に加えて、範囲外・非有限の値も混ぜる */
const wildNumber = fc.oneof(
  { weight: 8, arbitrary: fc.double({ min: -100, max: 2e4, noNaN: true }) },
  { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY) }
)

export const audioEdit: fc.Arbitrary<AudioEdit> = fc.oneof(
  wildNumber.map((time) => ({ type: 'setTrimStart', time }) as const),
  wildNumber.map((time) => ({ type: 'setTrimEnd', time }) as const),
  fc.constant({ type: 'resetTrim' } as const),
  wildNumber.map((seconds) => ({ type: 'setFadeIn', seconds }) as const),
  wildNumber.map((seconds) => ({ type: 'setFadeOut', seconds }) as const),
  wildNumber.map((db) => ({ type: 'setGain', db }) as const),
  fc
    .record(
      { enabled: fc.boolean(), thresholdDb: wildNumber, minDuration: wildNumber, padding: wildNumber },
      { requiredKeys: [] }
    )
    .map((silence) => ({ type: 'setSilence', silence }) as const),
  fc.boolean().map((enabled) => ({ type: 'setNormalize', enabled }) as const),
  fc.boolean().map((enabled) => ({ type: 'setMono', enabled }) as const),
  fc.constant({ type: 'reset' } as const)
)

export const audioEditSequence = fc.array(audioEdit, { maxLength: 30 })

export function reachableRecipe(info: AudioInfo, edits: readonly AudioEdit[]): AudioRecipe {
  return edits.reduce((recipe, edit) => applyAudioEdit(recipe, edit, info), createAudioRecipe(info))
}

/** -1〜1 のサンプル列 */
export const unitSamples = (maxLength = 2000) =>
  fc.float32Array({ min: -1, max: 1, noNaN: true, maxLength })

/**
 * 16bit PCM の WAV を組み立てる。WAV は mediabunny が WebCodecs なしで読み書きできるので、
 * node でも書き出しを通しで試せる
 */
export function makeWav(
  samples: (frame: number, channel: number) => number,
  { seconds, sampleRate = 8000, channels = 2, name = 'tone.wav' }: {
    seconds: number
    sampleRate?: number
    channels?: number
    name?: string
  }
): File {
  const frames = Math.round(seconds * sampleRate)
  const dataBytes = frames * channels * 2
  const view = new DataView(new ArrayBuffer(44 + dataBytes))
  const ascii = (offset: number, text: string) =>
    [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let frame = 0; frame < frames; frame++) {
    for (let channel = 0; channel < channels; channel++) {
      const value = Math.max(-1, Math.min(1, samples(frame, channel)))
      view.setInt16(44 + (frame * channels + channel) * 2, Math.round(value * 0x7fff), true)
    }
  }
  return new File([view.buffer], name, { type: 'audio/wav' })
}

import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { AUDIO_FORMATS, AUDIO_FORMAT_LIST, createAudioOutput } from '../../media/audio/output'
import { dbToGain, normalizeGain } from '../../media/audio/dsp'
import { createAudioRecipe } from '../../media/audio/recipe'
import { audioInfoWith } from '../../media/audio/testFixtures'
import type { AudioFormat, AudioRecipe } from '../../media/audio/types'
import {
  bitrateChoices,
  defaultAudioOutput,
  columnPeaks,
  effectiveRecipe,
  isSameAudioFormat,
  peakInRange,
  previewBaseGain,
  previewGainAt,
  usableOutput,
} from './logic'

const recipeWith = (patch: Partial<AudioRecipe>, duration = 10): AudioRecipe => ({
  ...createAudioRecipe(audioInfoWith(duration)),
  ...patch,
})

describe('effectiveRecipe', () => {
  test('ノーマライズ中は音量を 0 dB にし、ほかは触らない', () => {
    const recipe = recipeWith({ normalize: true, gainDb: 6, fadeIn: 1 })
    expect(effectiveRecipe(recipe)).toEqual({ ...recipe, gainDb: 0 })
  })

  test('ノーマライズしていなければ同じオブジェクトを返す', () => {
    const recipe = recipeWith({ gainDb: 6 })
    expect(effectiveRecipe(recipe)).toBe(recipe)
  })
})

describe('isSameAudioFormat', () => {
  const same = (name: string, codec: Parameters<typeof isSameAudioFormat>[0]['codec'], format: AudioFormat, type = '') =>
    isSameAudioFormat({ name, type, codec }, format)

  test('コーデックとコンテナが一致したときだけ同じ形式', () => {
    expect(same('a.mp3', 'mp3', 'mp3')).toBe(true)
    expect(same('a.wav', 'pcm-s16', 'wav')).toBe(true)
    expect(same('a.flac', 'flac', 'flac')).toBe(true)
    expect(same('a.m4a', 'aac', 'm4a')).toBe(true)
    expect(same('a.ogg', 'opus', 'opus')).toBe(true)
  })

  test('コンテナが違えば同じコーデックでも別の形式', () => {
    expect(same('a.aac', 'aac', 'm4a')).toBe(false)
    expect(same('a.webm', 'opus', 'opus')).toBe(false)
  })

  test('16bit 以外の WAV は同じ形式とみなさない', () => {
    expect(same('a.wav', 'pcm-s24', 'wav')).toBe(false)
    expect(same('a.wav', 'pcm-f32', 'wav')).toBe(false)
  })

  test('拡張子がなければ MIME で判断する', () => {
    expect(same('audio', 'mp3', 'mp3', 'audio/mpeg')).toBe(true)
    expect(same('audio', 'mp3', 'mp3', '')).toBe(false)
  })

  test('コーデックがわからなければ同じ形式とはしない', () => {
    for (const format of AUDIO_FORMAT_LIST) {
      expect(same(`a.${AUDIO_FORMATS[format].extension}`, null, format)).toBe(false)
    }
  })
})

describe('defaultAudioOutput', () => {
  const all = Object.fromEntries(AUDIO_FORMAT_LIST.map((format) => [format, true])) as Record<AudioFormat, boolean>

  test('元と同じ形式を書き出せるならそれにする', () => {
    expect(defaultAudioOutput({ name: 'a.wav', type: '', codec: 'pcm-s16' }, all).format).toBe('wav')
    expect(defaultAudioOutput({ name: 'a.flac', type: '', codec: 'flac' }, all).format).toBe('flac')
    expect(defaultAudioOutput({ name: 'a.mp3', type: '', codec: 'mp3' }, all).format).toBe('mp3')
  })

  test('書き出せない・同じ形式がないときは MP3', () => {
    expect(defaultAudioOutput({ name: 'a.m4a', type: '', codec: 'aac' }, { ...all, m4a: false }).format).toBe('mp3')
    expect(defaultAudioOutput({ name: 'a.wav', type: '', codec: 'pcm-s24' }, all).format).toBe('mp3')
  })
})

describe('bitrateChoices', () => {
  test('可逆形式には候補がなく、非可逆形式の候補は範囲内で昇順', () => {
    for (const format of AUDIO_FORMAT_LIST) {
      const choices = bitrateChoices(format)
      const { lossless, bitrate } = AUDIO_FORMATS[format]
      if (lossless) {
        expect(choices).toEqual([])
        continue
      }
      expect(choices.length).toBeGreaterThan(0)
      expect([...choices].sort((a, b) => a - b)).toEqual(choices)
      for (const value of choices) {
        expect(value).toBeGreaterThanOrEqual(bitrate.min)
        expect(value).toBeLessThanOrEqual(bitrate.max)
      }
    }
  })
})

describe('usableOutput', () => {
  const all = (value: boolean) =>
    Object.fromEntries(AUDIO_FORMAT_LIST.map((format) => [format, value])) as Record<AudioFormat, boolean>

  test('対応がわからないうち・書き出せる形式なら同じオブジェクトを返す', () => {
    const output = createAudioOutput('m4a')
    expect(usableOutput(output, null, AUDIO_FORMAT_LIST)).toBe(output)
    expect(usableOutput(output, all(true), AUDIO_FORMAT_LIST)).toBe(output)
  })

  test('書き出せない形式は、書き出せる最初の形式に替える', () => {
    const supported = { ...all(true), m4a: false, mp3: false }
    expect(usableOutput(createAudioOutput('m4a'), supported, AUDIO_FORMAT_LIST).format).toBe('opus')
  })
})

describe('peakInRange', () => {
  test('区間に掛かるバケツの最大値', () => {
    const peaks = new Float32Array([0.1, 0.9, 0.2, 0.5])
    expect(peakInRange(peaks, 4, 0, 4)).toBeCloseTo(0.9)
    expect(peakInRange(peaks, 4, 2, 4)).toBeCloseTo(0.5)
    // 端がバケツの途中でも、掛かるバケツは含める
    expect(peakInRange(peaks, 4, 2.5, 3.1)).toBeCloseTo(0.5)
  })

  test('空・不正な入力では 0', () => {
    expect(peakInRange(new Float32Array(0), 4, 0, 4)).toBe(0)
    expect(peakInRange(new Float32Array([1]), 0, 0, 4)).toBe(0)
    expect(peakInRange(new Float32Array([1]), 4, 3, 3)).toBe(0)
  })

  test('結果はいつも区間全体のピーク以下で、0 以上', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 64 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (values, a, b) => {
          const peaks = Float32Array.from(values)
          const whole = Math.max(...peaks)
          const peak = peakInRange(peaks, 10, Math.min(a, b) * 10, Math.max(a, b) * 10)
          expect(peak).toBeGreaterThanOrEqual(0)
          expect(peak).toBeLessThanOrEqual(whole)
        }
      )
    )
  })
})

describe('previewBaseGain / previewGainAt', () => {
  test('音量だけなら dB を倍率にしたもの', () => {
    expect(previewBaseGain(recipeWith({ gainDb: 6 }), null, 10)).toBeCloseTo(dbToGain(6))
  })

  test('ノーマライズ中は音量を無視し、区間のピークから倍率を決める', () => {
    const peaks = new Float32Array([0.25, 0.5, 0.25, 0.25])
    const recipe = recipeWith({ normalize: true, gainDb: 12 }, 4)
    expect(previewBaseGain(recipe, peaks, 4)).toBeCloseTo(normalizeGain(0.5))
  })

  test('区間の外は 0、フェードの途中は直線で上がる', () => {
    const recipe = recipeWith({ trim: { start: 2, end: 8 }, fadeIn: 2, fadeOut: 2 })
    expect(previewGainAt(recipe, 1, 1)).toBe(0)
    expect(previewGainAt(recipe, 3, 1)).toBeCloseTo(0.5)
    expect(previewGainAt(recipe, 5, 2)).toBeCloseTo(2)
    expect(previewGainAt(recipe, 7, 1)).toBeCloseTo(0.5)
    expect(previewGainAt(recipe, 9, 1)).toBe(0)
  })

  test('無音カットで削る範囲は 0、フェードは削ったあとの時間軸に掛かる', () => {
    const recipe = recipeWith({ trim: { start: 0, end: 10 }, fadeIn: 0, fadeOut: 2 })
    const kept = [
      { start: 0, end: 3 },
      { start: 7, end: 10 },
    ]
    expect(previewGainAt(recipe, 5, 1, kept)).toBe(0)
    // 書き出しの長さは 6 秒。尻の 2 秒（元の 8〜10 秒）でフェードアウトする
    expect(previewGainAt(recipe, 2.5, 1, kept)).toBeCloseTo(1)
    expect(previewGainAt(recipe, 9, 1, kept)).toBeCloseTo(0.5)
  })

  test('ノーマライズの倍率は残す範囲のピークから決める', () => {
    const peaks = new Float32Array([0.25, 1, 0.5, 0.25])
    const recipe = recipeWith({ normalize: true }, 4)
    const kept = [
      { start: 0, end: 1 },
      { start: 2, end: 4 },
    ]
    expect(previewBaseGain(recipe, peaks, 4, kept)).toBeCloseTo(normalizeGain(0.5))
  })

  test('倍率は 0 以上で、一定の倍率を超えない', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 10, noNaN: true }),
        fc.double({ min: 0, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 3, noNaN: true }),
        fc.double({ min: 0, max: 4, noNaN: true }),
        (time, fadeIn, fadeOut, base) => {
          const recipe = recipeWith({ fadeIn, fadeOut })
          const gain = previewGainAt(recipe, time, base)
          expect(gain).toBeGreaterThanOrEqual(0)
          expect(gain).toBeLessThanOrEqual(base + 1e-9)
        }
      )
    )
  })
})

describe('columnPeaks', () => {
  test('列が少なければ掛かるバケツの最大値に畳む', () => {
    expect(Array.from(columnPeaks(new Float32Array([0.1, 0.4, 0.3, 0.2]), 2))).toEqual([
      Math.fround(0.4),
      Math.fround(0.3),
    ])
  })

  test('列が多ければ同じバケツを引き伸ばす', () => {
    expect(Array.from(columnPeaks(new Float32Array([0.5, 1]), 4))).toEqual([0.5, 0.5, 1, 1])
  })

  test('どの列もピーク列の最大値を超えず、最大値はどこかの列に残る', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 200 }),
        fc.integer({ min: 1, max: 500 }),
        (values, columns) => {
          const peaks = Float32Array.from(values)
          const out = columnPeaks(peaks, columns)
          expect(out.length).toBe(columns)
          const max = Math.max(...peaks)
          expect(Math.max(...out)).toBeLessThanOrEqual(max)
          if (columns <= peaks.length) expect(Math.max(...out)).toBe(max)
        }
      )
    )
  })
})

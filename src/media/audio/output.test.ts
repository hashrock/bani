import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  AUDIO_FORMATS,
  AUDIO_FORMAT_LIST,
  audioFilename,
  changeAudioFormat,
  clampBitrate,
  createAudioOutput,
  estimateAudioSize,
  resolveChannels,
  resolveSampleRate,
} from './output'
import type { AudioFormat, AudioOutput } from './types'

const format = fc.constantFrom(...AUDIO_FORMAT_LIST)
const lossyFormat = fc.constantFrom<AudioFormat>('mp3', 'm4a', 'opus')
const anyNumber = fc.oneof(
  fc.double({ min: -1e6, max: 1e6, noNaN: true }),
  fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY)
)
const output: fc.Arbitrary<AudioOutput> = fc.record({
  format,
  bitrate: anyNumber,
  sampleRate: fc.option(anyNumber, { nil: null }),
})
const duration = fc.double({ min: 0, max: 1e5, noNaN: true })

describe('resolveSampleRate', () => {
  test('どんな指定でも、その形式で使えるサンプルレートになる', () => {
    fc.assert(
      fc.property(output, anyNumber, (out, source) => {
        expect(AUDIO_FORMATS[out.format].sampleRates).toContain(resolveSampleRate(out, { sampleRate: source }))
      })
    )
  })

  test('使えるサンプルレートを指定すればそのまま、未指定なら元のレートを保つ', () => {
    fc.assert(
      fc.property(format, fc.nat(), (f, index) => {
        const rates = AUDIO_FORMATS[f].sampleRates
        const rate = rates[index % rates.length]
        expect(resolveSampleRate({ ...createAudioOutput(f), sampleRate: rate }, { sampleRate: 1 })).toBe(rate)
        expect(resolveSampleRate(createAudioOutput(f), { sampleRate: rate })).toBe(rate)
      })
    )
  })
})

describe('resolveChannels', () => {
  test('1 以上で形式の上限以下。モノラル指定なら 1', () => {
    fc.assert(
      fc.property(format, fc.boolean(), fc.integer({ min: -2, max: 16 }), (f, mono, channels) => {
        const resolved = resolveChannels(createAudioOutput(f), { mono }, { channels })
        expect(resolved).toBeGreaterThanOrEqual(1)
        expect(resolved).toBeLessThanOrEqual(AUDIO_FORMATS[f].maxChannels)
        if (mono) expect(resolved).toBe(1)
      })
    )
  })
})

describe('clampBitrate / changeAudioFormat', () => {
  test('非可逆形式では範囲内の整数、可逆形式では 0', () => {
    fc.assert(
      fc.property(format, anyNumber, (f, bitrate) => {
        const clamped = clampBitrate(f, bitrate)
        const range = AUDIO_FORMATS[f].bitrate
        if (AUDIO_FORMATS[f].lossless) {
          expect(clamped).toBe(0)
        } else {
          expect(Number.isInteger(clamped)).toBe(true)
          expect(clamped).toBeGreaterThanOrEqual(range.min)
          expect(clamped).toBeLessThanOrEqual(range.max)
        }
      })
    )
  })

  test('形式を変えるとビットレートは新しい範囲に収まり、同じ形式なら何もしない', () => {
    fc.assert(
      fc.property(output, format, (out, next) => {
        const changed = changeAudioFormat(out, next)
        if (out.format === next) {
          expect(changed).toBe(out)
        } else {
          expect(changed.format).toBe(next)
          expect(changed.bitrate).toBe(clampBitrate(next, changed.bitrate))
        }
      })
    )
  })
})

describe('estimateAudioSize', () => {
  test('0 以上の整数で、長さが伸びれば小さくならない', () => {
    fc.assert(
      fc.property(output, duration, duration, (out, a, b) => {
        const [short, long] = a <= b ? [a, b] : [b, a]
        const small = estimateAudioSize(out, short)
        expect(Number.isInteger(small)).toBe(true)
        expect(small).toBeGreaterThanOrEqual(0)
        expect(estimateAudioSize(out, long)).toBeGreaterThanOrEqual(small)
      })
    )
  })

  test('長さが 0・負・非有限なら 0', () => {
    fc.assert(
      fc.property(output, fc.constantFrom(0, -1, Number.NaN, Number.POSITIVE_INFINITY), (out, d) => {
        expect(estimateAudioSize(out, d)).toBe(0)
      })
    )
  })

  test('非可逆形式ではビットレートが高いほど大きく、およそビットレート × 長さ', () => {
    fc.assert(
      fc.property(lossyFormat, anyNumber, anyNumber, fc.double({ min: 1, max: 1e4, noNaN: true }), (f, a, b, d) => {
        const [low, high] = [clampBitrate(f, a), clampBitrate(f, b)].sort((x, y) => x - y)
        const size = (bitrate: number) => estimateAudioSize({ format: f, bitrate, sampleRate: null }, d)
        expect(size(low)).toBeLessThanOrEqual(size(high))
        const raw = (high * d) / 8
        expect(size(high)).toBeGreaterThanOrEqual(raw)
        expect(size(high)).toBeLessThanOrEqual(raw * 1.05)
      })
    )
  })

  test('WAV はヘッダ + 16bit PCM ちょうど', () => {
    expect(
      estimateAudioSize(createAudioOutput('wav'), 1.5, { sampleRate: 8000, channels: 1 })
    ).toBe(44 + 1.5 * 8000 * 2)
  })

  test('FLAC は同じ条件の WAV より小さく見積もる', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.01, max: 1e4, noNaN: true }), (d) => {
        expect(estimateAudioSize(createAudioOutput('flac'), d)).toBeLessThan(
          estimateAudioSize(createAudioOutput('wav'), d)
        )
      })
    )
  })
})

describe('audioFilename', () => {
  test('拡張子は出力形式のものになり、元の名前の本体は残る', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), format, (name, f) => {
        const filename = audioFilename(name, f)
        expect(filename.endsWith(`.${AUDIO_FORMATS[f].extension}`)).toBe(true)
        expect(filename.length).toBeGreaterThan(AUDIO_FORMATS[f].extension.length + 1)
      })
    )
    expect(audioFilename('song.final.wav', 'mp3')).toBe('song.final.mp3')
    expect(audioFilename('movie.mp4', 'm4a')).toBe('movie.m4a')
    expect(audioFilename('noext', 'flac')).toBe('noext.flac')
  })
})

import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { peakOf } from './dsp'
import { computePeaks, createPeakAccumulator } from './peaks'
import { unitSamples } from './testFixtures'

const buckets = fc.integer({ min: 0, max: 500 })
/** 1 を超える値・NaN も混ぜる（デコーダは -1〜1 を保証しない） */
const anySamples = fc.float32Array({ maxLength: 2000 })

describe('computePeaks', () => {
  test('長さはバケツ数で、値は 0〜1', () => {
    fc.assert(
      fc.property(anySamples, buckets, (samples, count) => {
        const peaks = computePeaks(samples, count)
        expect(peaks.length).toBe(count)
        for (const value of peaks) {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
      })
    )
  })

  test('バケツ数が整数でない・負・非有限なら、切り捨てるか空にする', () => {
    const samples = new Float32Array([0.5, -0.5])
    expect(computePeaks(samples, 3.7).length).toBe(3)
    for (const count of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(computePeaks(samples, count).length).toBe(0)
    }
  })

  test('どのサンプルもどれかのバケツに入るので、全体の最大は信号のピークと一致する', () => {
    fc.assert(
      fc.property(unitSamples(), fc.integer({ min: 1, max: 500 }), (samples, count) => {
        const peaks = computePeaks(samples, count)
        expect(Math.max(0, ...peaks)).toBeCloseTo(peakOf([samples]), 6)
      })
    )
  })

  test('符号を反転しても波形は同じ', () => {
    fc.assert(
      fc.property(unitSamples(), buckets, (samples, count) => {
        expect(computePeaks(samples.map((x) => -x), count)).toEqual(computePeaks(samples, count))
      })
    )
  })

  test('1 つだけ鳴っているサンプルは、その位置に対応するバケツにだけ現れる', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2000 }),
        fc.integer({ min: 1, max: 500 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.float({ min: Math.fround(0.01), max: 1, noNaN: true }),
        (length, count, position, amplitude) => {
          const index = Math.min(length - 1, Math.floor(position * length))
          const samples = new Float32Array(length)
          samples[index] = amplitude
          const peaks = computePeaks(samples, count)
          const expected = Math.floor((index * count) / length)
          peaks.forEach((value, bucket) => expect(value).toBe(bucket === expected ? amplitude : 0))
        }
      )
    )
  })

  test('空の信号は全部 0', () => {
    fc.assert(
      fc.property(buckets, (count) => {
        expect([...computePeaks(new Float32Array(0), count)].every((v) => v === 0)).toBe(true)
      })
    )
  })
})

describe('createPeakAccumulator', () => {
  test('どう区切って渡しても、まとめて計算したのと同じ波形になる', () => {
    fc.assert(
      fc.property(anySamples, buckets, fc.array(fc.nat(), { maxLength: 10 }), (samples, count, cuts) => {
        const points = [...new Set(cuts.map((cut) => cut % (samples.length + 1)))].sort((a, b) => a - b)
        const accumulator = createPeakAccumulator(count, samples.length)
        let from = 0
        for (const point of [...points, samples.length]) {
          accumulator.push(samples.subarray(from, point))
          from = point
        }
        expect(accumulator.result()).toEqual(computePeaks(samples, count))
      })
    )
  })

  test('見込みより多く届いても長さは変わらず、はみ出しは最後のバケツに寄る', () => {
    fc.assert(
      fc.property(unitSamples(), fc.integer({ min: 1, max: 100 }), (samples, count) => {
        fc.pre(samples.length > 0)
        const accumulator = createPeakAccumulator(count, Math.max(1, Math.floor(samples.length / 2)))
        accumulator.push(samples)
        accumulator.push(new Float32Array([1]))
        const peaks = accumulator.result()
        expect(peaks.length).toBe(count)
        expect(peaks[count - 1]).toBe(1)
      })
    )
  })

  test('返した配列はその後の push で書き換わらない', () => {
    const accumulator = createPeakAccumulator(2, 4)
    const first = accumulator.result()
    accumulator.push(new Float32Array([1, 1, 1, 1]))
    expect([...first]).toEqual([0, 0])
  })
})

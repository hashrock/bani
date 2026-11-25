import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  NORMALIZE_TARGET_DB,
  SILENCE_PEAK,
  dbToGain,
  fadeEnvelope,
  floatToInt16,
  gainToDb,
  normalizeGain,
  peakOf,
  processPlanes,
  remixChannels,
} from './dsp'
import type { ProcessParams } from './dsp'
import { unitSamples } from './testFixtures'

const EPSILON = 1e-6

/** 同じ長さのチャンネルを 1〜6 本 */
const planesArb = fc
  .tuple(fc.integer({ min: 1, max: 6 }), fc.nat({ max: 400 }))
  .chain(([channels, frames]) =>
    fc.array(fc.float32Array({ min: -1, max: 1, noNaN: true, minLength: frames, maxLength: frames }), {
      minLength: channels,
      maxLength: channels,
    })
  )

/** 0〜1 の比。非正規化数のような極小値でフェードの和が丸めで区間を超えないよう、刻みを粗くする */
const coarseRatio = fc.integer({ min: 0, max: 1000 }).map((n) => n / 1000)

/** 区間の長さと、そこに収まるフェード */
const fadeArb = fc
  .tuple(fc.double({ min: 0.1, max: 1e3, noNaN: true }), coarseRatio, coarseRatio)
  .map(([length, a, b]) => {
    const fadeIn = a * length
    return { length, fadeIn, fadeOut: b * (length - fadeIn) }
  })

const plain = (channels: number, overrides: Partial<ProcessParams> = {}): ProcessParams => ({
  startTime: 0,
  sampleRate: 8000,
  length: 1e6,
  fadeIn: 0,
  fadeOut: 0,
  gain: 1,
  channels,
  ...overrides,
})

describe('dbToGain / gainToDb', () => {
  test('往復で元に戻る', () => {
    fc.assert(
      fc.property(fc.double({ min: -120, max: 40, noNaN: true }), (db) => {
        expect(gainToDb(dbToGain(db))).toBeCloseTo(db, 9)
      })
    )
  })

  test('0dB は等倍、+6dB はおよそ 2 倍', () => {
    expect(dbToGain(0)).toBe(1)
    expect(dbToGain(6)).toBeCloseTo(2, 2)
  })
})

describe('normalizeGain', () => {
  test('無音でなければ、掛けた後のピークが目標に揃う', () => {
    fc.assert(
      fc.property(fc.double({ min: SILENCE_PEAK * 2, max: 10, noNaN: true }), (peak) => {
        expect(gainToDb(peak * normalizeGain(peak))).toBeCloseTo(NORMALIZE_TARGET_DB, 9)
      })
    )
  })

  test('無音・不正な値なら持ち上げない', () => {
    for (const peak of [0, SILENCE_PEAK / 2, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalizeGain(peak)).toBe(1)
    }
  })

  test('ピークが大きいほど倍率は小さい（単調）', () => {
    const peak = fc.double({ min: SILENCE_PEAK * 2, max: 10, noNaN: true })
    fc.assert(
      fc.property(peak, peak, (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a]
        expect(normalizeGain(high)).toBeLessThanOrEqual(normalizeGain(low))
      })
    )
  })
})

describe('fadeEnvelope', () => {
  test('倍率は常に 0〜1', () => {
    fc.assert(
      fc.property(fadeArb, fc.double({ min: -10, max: 2e3, noNaN: true }), ({ length, fadeIn, fadeOut }, t) => {
        const value = fadeEnvelope(t, length, fadeIn, fadeOut)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      })
    )
  })

  test('フェードの外側では等倍', () => {
    fc.assert(
      fc.property(fadeArb, fc.double({ min: 0, max: 1, noNaN: true }), ({ length, fadeIn, fadeOut }, ratio) => {
        const t = fadeIn + ratio * (length - fadeOut - fadeIn)
        // 端の桁落ちで t がフェードの中へ入り込んだ組み合わせは外す（差そのもので判定する）
        fc.pre(t - fadeIn >= 0 && length - t >= fadeOut)
        expect(fadeEnvelope(t, length, fadeIn, fadeOut)).toBeCloseTo(1, 9)
      })
    )
  })

  test('フェードがあれば区間の端で 0 になる', () => {
    fc.assert(
      fc.property(fadeArb, ({ length, fadeIn, fadeOut }) => {
        if (fadeIn > 0) expect(fadeEnvelope(0, length, fadeIn, fadeOut)).toBe(0)
        if (fadeOut > 0) expect(fadeEnvelope(length, length, fadeIn, fadeOut)).toBeCloseTo(0, 9)
      })
    )
  })

  test('フェードインの間は上がる一方、フェードアウトの間は下がる一方', () => {
    const ratio = fc.double({ min: 0, max: 1, noNaN: true })
    fc.assert(
      fc.property(fadeArb, ratio, ratio, ({ length, fadeIn, fadeOut }, a, b) => {
        const [early, late] = a <= b ? [a, b] : [b, a]
        expect(fadeEnvelope(early * fadeIn, length, fadeIn, fadeOut)).toBeLessThanOrEqual(
          fadeEnvelope(late * fadeIn, length, fadeIn, fadeOut) + EPSILON
        )
        // フェードイン・アウトが接しているときは、フェードインが終わってから見る
        const outStart = Math.max(length - fadeOut, fadeIn)
        expect(fadeEnvelope(outStart + early * (length - outStart), length, fadeIn, fadeOut) + EPSILON).toBeGreaterThanOrEqual(
          fadeEnvelope(outStart + late * (length - outStart), length, fadeIn, fadeOut)
        )
      })
    )
  })
})

describe('remixChannels', () => {
  test('チャンネル数は指定どおりで、長さは変わらず、入力は書き換えない', () => {
    fc.assert(
      fc.property(planesArb, fc.integer({ min: 1, max: 8 }), (planes, target) => {
        const snapshot = planes.map((plane) => plane.slice())
        const mixed = remixChannels(planes, target)
        expect(mixed).toHaveLength(target)
        for (const plane of mixed) expect(plane.length).toBe(planes[0].length)
        expect(planes).toEqual(snapshot)
      })
    )
  })

  test('モノラル化は平均なので、ピークは元の最大を超えない', () => {
    fc.assert(
      fc.property(planesArb, (planes) => {
        expect(peakOf(remixChannels(planes, 1))).toBeLessThanOrEqual(peakOf(planes) + EPSILON)
      })
    )
  })

  test('全チャンネルが同じ信号なら、モノラル化してもその信号のまま', () => {
    fc.assert(
      fc.property(unitSamples(400), fc.integer({ min: 1, max: 6 }), (samples, channels) => {
        const [mono] = remixChannels(Array.from({ length: channels }, () => samples), 1)
        mono.forEach((value, i) => expect(value).toBeCloseTo(samples[i], 5))
      })
    )
  })

  test('5.1 をステレオに畳むとセンターが左右に残る', () => {
    const one = (value: number) => new Float32Array([value])
    // L, R, C, LFE, SL, SR
    const [left, right] = remixChannels([one(0.1), one(0.2), one(0.3), one(1), one(0.4), one(0.5)], 2)
    expect(left[0]).toBeCloseTo(0.1 + Math.SQRT1_2 * (0.3 + 0.4), 6)
    expect(right[0]).toBeCloseTo(0.2 + Math.SQRT1_2 * (0.3 + 0.5), 6)
  })
})

describe('processPlanes', () => {
  test('フェードなし・等倍・チャンネル数そのままなら、信号は変わらない', () => {
    fc.assert(
      fc.property(planesArb, (planes) => {
        expect(processPlanes(planes, plain(planes.length))).toEqual(planes)
      })
    )
  })

  test('どんな倍率を掛けても、書き出す値は -1〜1 に収まる', () => {
    fc.assert(
      fc.property(planesArb, fc.double({ min: 0, max: 100, noNaN: true }), (planes, gain) => {
        expect(peakOf(processPlanes(planes, plain(planes.length, { gain })))).toBeLessThanOrEqual(1)
      })
    )
  })

  test('切り詰めなければ、倍率に比例してピークが変わる（線形性）', () => {
    fc.assert(
      fc.property(planesArb, fc.double({ min: 0, max: 100, noNaN: true }), (planes, gain) => {
        const scaled = peakOf(processPlanes(planes, plain(planes.length, { gain }), false))
        expect(scaled).toBeCloseTo(peakOf(planes) * gain, 4)
      })
    )
  })

  test('フェードは信号を大きくしない', () => {
    fc.assert(
      fc.property(planesArb, fadeArb, fc.double({ min: 0, max: 1e3, noNaN: true }), (planes, fade, startTime) => {
        const faded = processPlanes(planes, plain(planes.length, { ...fade, startTime }))
        faded.forEach((plane, c) =>
          plane.forEach((value, i) => expect(Math.abs(value)).toBeLessThanOrEqual(Math.abs(planes[c][i]) + EPSILON))
        )
      })
    )
  })
})

describe('floatToInt16', () => {
  test('範囲外は端に、NaN は 0 に丸め、符号を保つ', () => {
    const anyFloat = fc.float32Array({ maxLength: 200 })
    fc.assert(
      fc.property(anyFloat, (samples) => {
        const out = floatToInt16(samples)
        expect(out.length).toBe(samples.length)
        samples.forEach((value, i) => {
          if (Number.isNaN(value)) expect(out[i]).toBe(0)
          else if (value > 0) expect(out[i]).toBeGreaterThanOrEqual(0)
          else if (value < 0) expect(out[i]).toBeLessThanOrEqual(0)
        })
      })
    )
    expect([...floatToInt16(new Float32Array([1, -1, 2, -2, 0]))]).toEqual([32767, -32768, 32767, -32768, 0])
  })

  test('大きい値ほど大きい整数になる（単調）', () => {
    const value = fc.float({ min: -1, max: 1, noNaN: true })
    fc.assert(
      fc.property(value, value, (a, b) => {
        const [low, high] = a <= b ? [a, b] : [b, a]
        const [x, y] = floatToInt16(new Float32Array([low, high]))
        expect(x).toBeLessThanOrEqual(y)
      })
    )
  })
})

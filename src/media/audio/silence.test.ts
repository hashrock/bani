import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { dbToGain } from './dsp'
import {
  LEVEL_WINDOW,
  SILENCE_CROSSFADE,
  createLevelAccumulator,
  detectSilence,
  keptLength,
  keptRanges,
  levelWindowFrames,
  outputTimeAt,
  planKeptRanges,
  playableTimeFrom,
  removedRanges,
} from './silence'
import type { LevelEnvelope } from './silence'
import { applyAudioEdit, createAudioRecipe } from './recipe'
import { audioInfoWith } from './testFixtures'
import type { TimeRange } from './types'

/** 端の足し引きの桁落ちを見逃す幅 */
const EPSILON = 1e-7
const THRESHOLD_DB = -40
const LOUD = dbToGain(THRESHOLD_DB) * 2

/** 無音（0）と音のある窓が入り混じった包絡。NaN も混ぜる */
const envelopeArb = fc
  .record({
    levels: fc.array(
      fc.oneof(
        { weight: 4, arbitrary: fc.constant(0) },
        { weight: 3, arbitrary: fc.constant(LOUD) },
        { weight: 2, arbitrary: fc.double({ min: 0, max: 1, noNaN: true }) },
        { weight: 1, arbitrary: fc.constant(Number.NaN) }
      ),
      { maxLength: 400 }
    ),
    startWindow: fc.nat(50),
  })
  .map(({ levels, startWindow }): LevelEnvelope => ({
    levels: Float32Array.from(levels),
    window: LEVEL_WINDOW,
    start: startWindow * LEVEL_WINDOW,
  }))

/** 包絡の端より外にはみ出すこともある区間 */
const rangeFor = (envelope: LevelEnvelope) =>
  fc
    .tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }))
    .map(([a, b]): TimeRange => {
      const span = envelope.levels.length * envelope.window + 0.2
      const from = Math.max(0, envelope.start - 0.1 + Math.min(a, b) * span)
      return { start: from, end: Math.max(from + 0.01, envelope.start - 0.1 + Math.max(a, b) * span) }
    })

const settingsArb = fc.record({
  thresholdDb: fc.constant(THRESHOLD_DB),
  minDuration: fc.double({ min: 0.01, max: 1, noNaN: true }),
  padding: fc.double({ min: 0, max: 0.5, noNaN: true }),
})

function expectSortedDisjointInside(ranges: readonly TimeRange[], range: TimeRange) {
  for (let i = 0; i < ranges.length; i++) {
    expect(ranges[i].end).toBeGreaterThan(ranges[i].start)
    expect(ranges[i].start).toBeGreaterThanOrEqual(range.start - EPSILON)
    expect(ranges[i].end).toBeLessThanOrEqual(range.end + EPSILON)
    if (i > 0) expect(ranges[i].start).toBeGreaterThanOrEqual(ranges[i - 1].end)
  }
}

const inside = (ranges: readonly TimeRange[], time: number) =>
  ranges.some((r) => time >= r.start - EPSILON && time <= r.end + EPSILON)

/** 包絡のうち音のある（しきい値以上か NaN の）窓の範囲 */
function loudWindows(envelope: LevelEnvelope): TimeRange[] {
  const threshold = dbToGain(THRESHOLD_DB)
  const out: TimeRange[] = []
  envelope.levels.forEach((level, k) => {
    if (!(level < threshold)) {
      out.push({ start: envelope.start + k * envelope.window, end: envelope.start + (k + 1) * envelope.window })
    }
  })
  return out
}

describe('detectSilence', () => {
  test('無音は昇順で重ならず、区間の中にあり、最短の長さ以上で、しきい値を下回る窓だけでできている', () => {
    fc.assert(
      fc.property(
        envelopeArb.chain((envelope) => fc.tuple(fc.constant(envelope), rangeFor(envelope), settingsArb)),
        ([envelope, range, settings]) => {
          const silences = detectSilence(envelope, settings, range)
          expectSortedDisjointInside(silences, range)
          for (const silence of silences) {
            expect(silence.end - silence.start).toBeGreaterThanOrEqual(settings.minDuration - EPSILON)
          }
          // 音のある窓の中ほどは、どの無音にも入らない
          for (const loud of loudWindows(envelope)) {
            const mid = (loud.start + loud.end) / 2
            expect(silences.some((s) => mid > s.start + EPSILON && mid < s.end - EPSILON)).toBe(false)
          }
        }
      )
    )
  })

  test('包絡が届いていない時刻は無音とみなさない', () => {
    const envelope: LevelEnvelope = { levels: new Float32Array(10), window: 0.01, start: 1 }
    expect(detectSilence(envelope, { thresholdDb: -40, minDuration: 0.01 }, { start: 0, end: 5 })).toEqual([
      { start: 1, end: 1.1 },
    ])
  })
})

describe('keptRanges', () => {
  test('残す範囲は昇順で重ならず区間の中にあり、空にならず、削る隙間はクロスフェードより長い', () => {
    fc.assert(
      fc.property(
        envelopeArb.chain((envelope) => fc.tuple(fc.constant(envelope), rangeFor(envelope), settingsArb)),
        ([envelope, range, settings]) => {
          const kept = keptRanges(detectSilence(envelope, settings, range), range, settings.padding)
          expectSortedDisjointInside(kept, range)
          expect(kept.length).toBeGreaterThan(0)
          for (const gap of removedRanges(kept, range)) {
            expect(gap.end - gap.start).toBeGreaterThanOrEqual(SILENCE_CROSSFADE - EPSILON)
          }
          expect(keptLength(kept)).toBeLessThanOrEqual(range.end - range.start + EPSILON)
        }
      )
    )
  })

  test('音のある窓と、その前後 padding（区間の中の分）は必ず残る', () => {
    fc.assert(
      fc.property(
        envelopeArb.chain((envelope) => fc.tuple(fc.constant(envelope), rangeFor(envelope), settingsArb)),
        ([envelope, range, settings]) => {
          const kept = keptRanges(detectSilence(envelope, settings, range), range, settings.padding)
          for (const loud of loudWindows(envelope)) {
            const from = Math.max(range.start, loud.start - settings.padding)
            const to = Math.min(range.end, loud.end + settings.padding)
            if (!(to > from)) continue
            for (const t of [from, (from + to) / 2, to]) {
              // 区間の端と重なる点は、隣の窓の分だけずれることがあるので内側に寄せて確かめる
              const probe = Math.min(to - EPSILON * 10, Math.max(from + EPSILON * 10, t))
              expect(inside(kept, probe)).toBe(true)
            }
          }
        }
      )
    )
  })

  test('全体が無音なら区間全体を残す（何も削らない）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), settingsArb, (windows, settings) => {
        const envelope: LevelEnvelope = { levels: new Float32Array(windows), window: LEVEL_WINDOW, start: 0 }
        const range = { start: 0, end: windows * LEVEL_WINDOW }
        expect(keptRanges(detectSilence(envelope, settings, range), range, settings.padding)).toEqual([range])
      })
    )
  })

  test('無音がなければ区間全体を残す', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 300 }), settingsArb, (windows, settings) => {
        const envelope: LevelEnvelope = {
          levels: new Float32Array(windows).fill(LOUD),
          window: LEVEL_WINDOW,
          start: 0,
        }
        const range = { start: 0, end: windows * LEVEL_WINDOW }
        expect(detectSilence(envelope, settings, range)).toEqual([])
        expect(keptRanges([], range, settings.padding)).toEqual([range])
      })
    )
  })

  test('音 1 秒・無音 2 秒・音 1 秒なら、無音の両側に padding を残して削る', () => {
    const levels = new Float32Array(400)
    levels.fill(LOUD, 0, 100)
    levels.fill(LOUD, 300, 400)
    const envelope: LevelEnvelope = { levels, window: 0.01, start: 0 }
    const range = { start: 0, end: 4 }
    const kept = keptRanges(detectSilence(envelope, { thresholdDb: THRESHOLD_DB, minDuration: 0.5 }, range), range, 0.1)
    expect(kept).toHaveLength(2)
    expect(kept[0].start).toBe(0)
    expect(kept[0].end).toBeCloseTo(1.1, 6)
    expect(kept[1].start).toBeCloseTo(2.9, 6)
    expect(kept[1].end).toBe(4)
    expect(keptLength(kept)).toBeCloseTo(2.2, 6)
  })

  test('区間の端に付いた無音は padding を残さずに削る', () => {
    const levels = new Float32Array(300)
    levels.fill(LOUD, 100, 200)
    const envelope: LevelEnvelope = { levels, window: 0.01, start: 0 }
    const range = { start: 0, end: 3 }
    const kept = keptRanges(detectSilence(envelope, { thresholdDb: THRESHOLD_DB, minDuration: 0.5 }, range), range, 0.1)
    expect(kept).toHaveLength(1)
    expect(kept[0].start).toBeCloseTo(0.9, 6)
    expect(kept[0].end).toBeCloseTo(2.1, 6)
  })
})

describe('planKeptRanges', () => {
  test('無音カットが切ってある・包絡がないときは区間全体', () => {
    const info = audioInfoWith(4)
    const recipe = applyAudioEdit(createAudioRecipe(info), { type: 'setTrimStart', time: 1 }, info)
    const envelope: LevelEnvelope = { levels: new Float32Array(400), window: 0.01, start: 0 }
    expect(planKeptRanges(recipe, envelope)).toEqual([{ start: 1, end: 4 }])
    const enabled = applyAudioEdit(recipe, { type: 'setSilence', silence: { enabled: true } }, info)
    expect(planKeptRanges(enabled, null)).toEqual([{ start: 1, end: 4 }])
  })
})

describe('createLevelAccumulator', () => {
  test('どんな区切り方で渡しても、窓ごとの最大は一括で測ったものと同じ', () => {
    fc.assert(
      fc.property(
        fc.array(fc.float({ min: -1, max: 1, noNaN: true }), { maxLength: 3000 }),
        fc.array(fc.integer({ min: 1, max: 500 }), { minLength: 1, maxLength: 20 }),
        fc.nat(2000),
        (values, cuts, startFrame) => {
          const samples = Float32Array.from(values)
          const sampleRate = 8000
          const size = levelWindowFrames(sampleRate)
          const once = createLevelAccumulator(sampleRate, startFrame)
          once.push([samples])
          const split = createLevelAccumulator(sampleRate, startFrame)
          let offset = 0
          for (let i = 0; offset < samples.length; i++) {
            const n = cuts[i % cuts.length]
            split.push([samples.subarray(offset, offset + n)])
            offset += n
          }
          const a = once.result()
          const b = split.result()
          expect(Array.from(b.levels)).toEqual(Array.from(a.levels))
          // 窓はファイルの先頭から刻む
          expect(a.start).toBeCloseTo((Math.floor(startFrame / size) * size) / sampleRate, 9)
          // 最初の窓の値は、渡したサンプルのうちその窓に入る分の最大
          if (samples.length > 0) {
            const firstEnd = Math.min(samples.length, (Math.floor(startFrame / size) + 1) * size - startFrame)
            const expected = Math.max(...Array.from(samples.subarray(0, firstEnd), Math.abs))
            expect(a.levels[0]).toBeCloseTo(expected, 6)
          }
        }
      )
    )
  })

  test('全チャンネルの絶対値の最大を取る（逆相で打ち消し合わない）', () => {
    const acc = createLevelAccumulator(100)
    acc.push([Float32Array.of(0.5), Float32Array.of(-0.5)])
    expect(acc.result().levels[0]).toBeCloseTo(0.5)
  })
})

describe('時間軸の写し', () => {
  const kept = [
    { start: 0, end: 1 },
    { start: 2, end: 3 },
  ]

  test('outputTimeAt は削った分を詰めた位置', () => {
    expect(outputTimeAt(kept, 0.5)).toBe(0.5)
    expect(outputTimeAt(kept, 1.5)).toBe(1)
    expect(outputTimeAt(kept, 2.5)).toBe(1.5)
    expect(outputTimeAt(kept, 9)).toBe(2)
  })

  test('playableTimeFrom は削る範囲を飛ばし、最後より後なら null', () => {
    expect(playableTimeFrom(kept, 0.5)).toBe(0.5)
    expect(playableTimeFrom(kept, 1.5)).toBe(2)
    expect(playableTimeFrom(kept, 3)).toBeNull()
  })

  test('outputTimeAt は単調に増え、残す範囲の合計を超えない', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -1, max: 5, noNaN: true }), { maxLength: 20 }), (times) => {
        const sorted = [...times].sort((a, b) => a - b)
        let previous = -Infinity
        for (const t of sorted) {
          const out = outputTimeAt(kept, t)
          expect(out).toBeGreaterThanOrEqual(previous)
          expect(out).toBeLessThanOrEqual(keptLength(kept))
          previous = out
        }
      })
    )
  })
})

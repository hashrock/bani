import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { shiftSubtitles } from '../text/subtitles'
import type { SubtitleCue } from '../text/subtitles'
import {
  MAX_VIDEO_SPEED,
  MIN_VIDEO_SPEED,
  activeCues,
  clampSpeed,
  cuesForOutput,
  effectiveSubtitleMode,
  outputDuration,
  outputToSourceTime,
  sourceToOutputTime,
} from './timing'

/** 元の動画の時間軸の字幕（ミリ秒）。重なりも、0 より前に押し出されるものも混ぜる */
const cue: fc.Arbitrary<SubtitleCue> = fc
  .tuple(fc.integer({ min: 0, max: 600_000 }), fc.integer({ min: 1, max: 20_000 }), fc.string({ maxLength: 8 }))
  .map(([start, length, text]) => ({ start, end: start + length, text }))

const cues = fc.array(cue, { maxLength: 30 }).map((list) => [...list].sort((a, b) => a.start - b.start))

const trim = fc
  .tuple(fc.double({ min: 0, max: 500, noNaN: true }), fc.double({ min: 0.1, max: 300, noNaN: true }))
  .map(([start, length]) => ({ start, end: start + length }))

const speed = fc.constantFrom(0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4)
const offset = fc.integer({ min: -60_000, max: 60_000 })

describe('clampSpeed', () => {
  test('どんな値も範囲の中の 0.05 刻みになり、範囲内の刻みの値はそのまま', () => {
    fc.assert(
      fc.property(fc.oneof(fc.double(), fc.constantFrom(Number.NaN, Infinity, -Infinity, 0, -1)), (value) => {
        const speed = clampSpeed(value)
        expect(speed).toBeGreaterThanOrEqual(MIN_VIDEO_SPEED)
        expect(speed).toBeLessThanOrEqual(MAX_VIDEO_SPEED)
        expect(Math.abs(speed * 20 - Math.round(speed * 20))).toBeLessThan(1e-9)
        expect(clampSpeed(speed)).toBe(speed)
      })
    )
    expect(clampSpeed(Number.NaN)).toBe(1)
    expect(clampSpeed(10)).toBe(4)
    expect(clampSpeed(0.1)).toBe(0.25)
  })
})

describe('時刻の行き来', () => {
  test('元 → 書き出し → 元 で戻り、書き出しの長さは区間 / speed', () => {
    fc.assert(
      fc.property(trim, speed, fc.double({ min: 0, max: 1, noNaN: true }), (range, s, ratio) => {
        const t = range.start + (range.end - range.start) * ratio
        const out = sourceToOutputTime(t, range, s)
        expect(outputToSourceTime(out, range, s)).toBeCloseTo(t, 6)
        expect(out).toBeGreaterThanOrEqual(-1e-9)
        expect(out).toBeLessThanOrEqual(outputDuration({ trim: range, speed: s }) + 1e-9)
      })
    )
  })
})

describe('cuesForOutput', () => {
  test('どの字幕も書き出しの長さの中に収まり、長さが正で、並び順を保つ', () => {
    fc.assert(
      fc.property(cues, offset, trim, speed, (list, ms, range, s) => {
        const out = cuesForOutput({ cues: list, offset: ms }, range, s)
        const limit = Math.round((outputDuration({ trim: range, speed: s }) * 1000))
        out.forEach((c, i) => {
          expect(c.start).toBeGreaterThanOrEqual(0)
          expect(c.end).toBeLessThanOrEqual(limit + 1)
          expect(c.end).toBeGreaterThan(c.start)
          if (i > 0) expect(c.start).toBeGreaterThanOrEqual(out[i - 1].start)
        })
        expect(out.length).toBeLessThanOrEqual(list.length)
      })
    )
  })

  test('全体・等速・ずらしなしなら、尺の中の字幕はそのまま', () => {
    fc.assert(
      fc.property(cues, (list) => {
        const range = { start: 0, end: 700 }
        expect(cuesForOutput({ cues: list, offset: 0 }, range, 1)).toEqual(list)
      })
    )
  })

  test('ずらしは shiftSubtitles で先にずらしたのと同じ', () => {
    fc.assert(
      fc.property(cues, offset, trim, speed, (list, ms, range, s) => {
        expect(cuesForOutput({ cues: list, offset: ms }, range, s)).toEqual(
          cuesForOutput({ cues: shiftSubtitles(list, ms), offset: 0 }, range, s)
        )
      })
    )
  })

  test('書き出しでの表示時間は、区間にかかる長さ / speed（丸めで ±1ms）', () => {
    fc.assert(
      fc.property(cues, offset, trim, speed, (list, ms, range, s) => {
        const out = cuesForOutput({ cues: list, offset: ms }, range, s)
        const overlapping = list
          .map((c) => ({
            start: Math.max(c.start + ms, range.start * 1000),
            end: Math.min(c.end + ms, range.end * 1000),
          }))
          .filter((c) => c.end > c.start)
        // 丸めで 0 になって落ちたものを除けば 1 対 1
        const kept = overlapping.filter((c) => Math.round((c.end - range.start * 1000) / s) > Math.round((c.start - range.start * 1000) / s))
        expect(out).toHaveLength(kept.length)
        out.forEach((c, i) => {
          expect(Math.abs(c.end - c.start - (kept[i].end - kept[i].start) / s)).toBeLessThanOrEqual(1.0001)
        })
      })
    )
  })

  test('元の時刻 t に出ている字幕は、書き出しの (t - start) / speed にも出ている（境目の 1ms は除く）', () => {
    fc.assert(
      fc.property(cues, offset, trim, speed, fc.double({ min: 0, max: 1, noNaN: true }), (list, ms, range, s, ratio) => {
        const t = (range.start + (range.end - range.start) * ratio) * 1000
        // 区間の終わりちょうどは書き出しに含まれない
        if (t >= range.end * 1000 - 2 * s) return
        const out = cuesForOutput({ cues: list, offset: ms }, range, s)
        const outTime = sourceToOutputTime(t / 1000, range, s) * 1000
        // 丸めで境目が 1ms 動くので、境目から離れた字幕だけで比べる
        const clear = (c: SubtitleCue, time: number, margin: number) =>
          time >= c.start + margin && time < c.end - margin
        const before = list.filter((c) => clear({ ...c, start: c.start + ms, end: c.end + ms }, t, 2 * s)).map((c) => c.text)
        const after = out.filter((c) => clear(c, outTime, 0)).map((c) => c.text)
        for (const text of before) expect(after).toContain(text)
      })
    )
  })

  test('区間の外の字幕は消え、かかるものは区間の端で切れる', () => {
    const list = [
      { start: 0, end: 1000, text: 'a' },
      { start: 1500, end: 4000, text: 'b' },
      { start: 9000, end: 9500, text: 'c' },
    ]
    expect(cuesForOutput({ cues: list, offset: 0 }, { start: 2, end: 8 }, 2)).toEqual([{ start: 0, end: 1000, text: 'b' }])
    expect(cuesForOutput({ cues: list, offset: 500 }, { start: 0, end: 10 }, 0.5)).toEqual([
      { start: 1000, end: 3000, text: 'a' },
      { start: 4000, end: 9000, text: 'b' },
      { start: 19000, end: 20000, text: 'c' },
    ])
  })
})

describe('activeCues', () => {
  test('始まりは含み、終わりは含まない。重なればどちらも', () => {
    const list = [
      { start: 0, end: 1000, text: 'a' },
      { start: 500, end: 1500, text: 'b' },
    ]
    expect(activeCues(list, 0).map((c) => c.text)).toEqual(['a'])
    expect(activeCues(list, 700).map((c) => c.text)).toEqual(['a', 'b'])
    expect(activeCues(list, 1000).map((c) => c.text)).toEqual(['b'])
    expect(activeCues(list, 1000, 200).map((c) => c.text)).toEqual(['a', 'b'])
  })
})

test('GIF では字幕を焼き込むしかない', () => {
  expect(effectiveSubtitleMode('embed', 'gif')).toBe('burn')
  expect(effectiveSubtitleMode('embed', 'mp4')).toBe('embed')
  expect(effectiveSubtitleMode('burn', 'webm')).toBe('burn')
})

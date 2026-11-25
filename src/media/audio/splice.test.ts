import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { createSplicer, createTimedSplicer, toFrameRanges } from './splice'
import type { FrameRange, SplicedChunk } from './splice'

/** 昇順で重ならないサンプル範囲（隙間 0 のものも混ぜる） */
const rangesArb = fc
  .array(fc.tuple(fc.integer({ min: 0, max: 40 }), fc.integer({ min: 1, max: 200 })), { minLength: 1, maxLength: 8 })
  .map((pairs) => {
    const ranges: FrameRange[] = []
    let cursor = 0
    for (const [gap, length] of pairs) {
      const start = cursor + gap
      ranges.push({ start, end: start + length })
      cursor = start + length
    }
    return toFrameRanges(
      ranges.map((r) => ({ start: r.start, end: r.end })),
      0,
      1
    )
  })

/** 信号を cuts の大きさで区切って流し、出てきたものを全部集める */
function run(
  ranges: FrameRange[],
  signal: (frame: number) => number,
  total: number,
  cuts: number[],
  crossfade: number,
  channels = 1
): SplicedChunk[] {
  const splicer = createSplicer(ranges, channels, crossfade)
  const chunks: SplicedChunk[] = []
  let offset = 0
  for (let i = 0; offset < total; i++) {
    const n = Math.min(cuts[i % cuts.length], total - offset)
    const planes = Array.from({ length: channels }, (_, c) =>
      Float32Array.from({ length: n }, (_, j) => signal(offset + j) * (c + 1))
    )
    chunks.push(...splicer.push(planes, offset))
    offset += n
  }
  return chunks
}

const concat = (chunks: SplicedChunk[], channel = 0) => {
  const out: number[] = []
  for (const chunk of chunks) out.push(...chunk.planes[channel])
  return out
}

const lengthOf = (ranges: FrameRange[]) => ranges.reduce((sum, r) => sum + r.end - r.start, 0)
const cutsArb = fc.array(fc.integer({ min: 1, max: 97 }), { minLength: 1, maxLength: 10 })

describe('createSplicer', () => {
  test('書き出しは 0 から隙間なく続き、長さは残す範囲の合計', () => {
    fc.assert(
      fc.property(rangesArb, cutsArb, fc.integer({ min: 0, max: 30 }), (ranges, cuts, crossfade) => {
        const total = ranges[ranges.length - 1].end + 20
        const chunks = run(ranges, () => 0.5, total, cuts, crossfade)
        let expected = 0
        for (const chunk of chunks) {
          expect(chunk.startFrame).toBe(expected)
          expected += chunk.planes[0].length
        }
        expect(expected).toBe(lengthOf(ranges))
      })
    )
  })

  test('一定の信号は、つなぎ目でも重みの合計が 1 なので一定のまま（プツッと鳴らない）', () => {
    fc.assert(
      fc.property(rangesArb, cutsArb, fc.integer({ min: 0, max: 30 }), (ranges, cuts, crossfade) => {
        const total = ranges[ranges.length - 1].end + 20
        for (const value of concat(run(ranges, () => 0.5, total, cuts, crossfade, 2), 1)) {
          // 2 本目のチャンネルは 2 倍の値で流している
          expect(value).toBeCloseTo(1, 5)
        }
      })
    )
  })

  test('区切り方を変えても書き出しは同じ', () => {
    fc.assert(
      fc.property(rangesArb, cutsArb, cutsArb, (ranges, a, b) => {
        const total = ranges[ranges.length - 1].end + 10
        const signal = (f: number) => Math.sin(f * 0.37)
        expect(concat(run(ranges, signal, total, a, 16))).toEqual(concat(run(ranges, signal, total, b, 16)))
      })
    )
  })

  test('クロスフェードの掛からない所は、残す範囲のサンプルがそのまま並ぶ', () => {
    fc.assert(
      fc.property(rangesArb, cutsArb, (ranges, cuts) => {
        const crossfade = 8
        const total = ranges[ranges.length - 1].end
        const out = concat(run(ranges, (f) => f / 1000, total, cuts, crossfade))
        let position = 0
        for (const range of ranges) {
          // 頭と尻の半分（4 サンプル）より内側を確かめる
          for (let f = range.start + crossfade / 2; f < range.end - crossfade / 2; f++) {
            expect(out[position + (f - range.start)]).toBeCloseTo(f / 1000, 6)
          }
          position += range.end - range.start
        }
      })
    )
  })

  test('前と重なるブロックは捨て、飛んだ分は無音として扱う', () => {
    const splicer = createSplicer([{ start: 0, end: 6 }], 1, 0)
    const first = splicer.push([Float32Array.of(1, 1, 1)], 0)
    const overlap = splicer.push([Float32Array.of(9, 2)], 2)
    const jump = splicer.push([Float32Array.of(3)], 5)
    const out = [...first, ...overlap, ...jump].flatMap((c) => [...c.planes[0]])
    expect(out).toEqual([1, 1, 1, 2, 0, 3])
  })

  test('範囲が 1 つなら元のまま流す', () => {
    fc.assert(
      fc.property(fc.array(fc.float({ min: -1, max: 1, noNaN: true }), { minLength: 1, maxLength: 500 }), cutsArb, (values, cuts) => {
        const out = concat(run([{ start: 0, end: values.length }], (f) => values[f], values.length, cuts, 16))
        // -0 と 0 は区別しない（足し合わせるので -0 は 0 になる）
        expect(out.map((v) => v + 0)).toEqual(Array.from(Float32Array.from(values), (v) => v + 0))
      })
    )
  })
})

describe('createTimedSplicer', () => {
  test('秒で渡した範囲を、届いたブロックのレートで切り出す', () => {
    const splice = createTimedSplicer(
      [
        { start: 1, end: 1.5 },
        { start: 2, end: 2.5 },
      ],
      1,
      0
    )
    const chunks = splice([new Float32Array(200).fill(1)], 0, 100)
    const total = chunks.reduce((sum, c) => sum + c.planes[0].length, 0)
    expect(total).toBe(100)
    expect(chunks[0].time).toBe(0)
  })
})

import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  chunkPageRanges,
  formatPageRanges,
  pageRangesToIndices,
  parsePageRanges,
  type PageRange,
} from './pageRanges'

const pageCount = fc.integer({ min: 1, max: 500 })

/** ページ数の中に収まる範囲の列 */
const rangesWithin = (count: number) =>
  fc.array(
    fc
      .tuple(fc.integer({ min: 1, max: count }), fc.integer({ min: 1, max: count }))
      .map(([a, b]): PageRange => ({ start: Math.min(a, b), end: Math.max(a, b) })),
    { minLength: 1, maxLength: 8 }
  )

const countAndRanges = pageCount.chain((count) => fc.tuple(fc.constant(count), rangesWithin(count)))

/** 人が打ちそうな文字だけで作った、読めるとは限らない入力 */
const typedText = fc
  .array(fc.constantFrom('1', '2', '3', '9', '0', '-', ',', ' ', '、', '１', 'a', '–'), {
    maxLength: 16,
  })
  .map((chars) => chars.join(''))

describe('parsePageRanges', () => {
  test('書いた範囲を読み戻すと元に戻る', () => {
    fc.assert(
      fc.property(countAndRanges, ([count, ranges]) => {
        expect(parsePageRanges(formatPageRanges(ranges), count)).toEqual({ ok: true, ranges })
      })
    )
  })

  test('読めた範囲はつねにページの中にあり、start <= end', () => {
    fc.assert(
      fc.property(typedText, pageCount, (text, count) => {
        const result = parsePageRanges(text, count)
        if (!result.ok) return
        expect(result.ranges.length).toBeGreaterThan(0)
        for (const { start, end } of result.ranges) {
          expect(Number.isInteger(start) && Number.isInteger(end)).toBe(true)
          expect(1 <= start && start <= end && end <= count).toBe(true)
        }
      })
    )
  })

  test('読めた入力を書き直して読んでも同じ範囲になる', () => {
    fc.assert(
      fc.property(typedText, pageCount, (text, count) => {
        const result = parsePageRanges(text, count)
        if (!result.ok) return
        expect(parsePageRanges(formatPageRanges(result.ranges), count)).toEqual(result)
      })
    )
  })

  test('区切りの前後の空白は結果に効かない', () => {
    fc.assert(
      fc.property(
        countAndRanges,
        fc.array(fc.constantFrom('', ' ', '  ', '\t'), { minLength: 1 }),
        ([count, ranges], spaces) => {
          const spaced = formatPageRanges(ranges)
            .split(', ')
            .map((token, index) => `${spaces[index % spaces.length]}${token}${spaces[0]}`)
            .join(',')
          expect(parsePageRanges(spaced, count)).toEqual({ ok: true, ranges })
        }
      )
    )
  })

  test('終わりがページ数を超える範囲と終わりのない範囲はページ数で切り詰める', () => {
    fc.assert(
      fc.property(pageCount, fc.integer({ min: 1, max: 500 }), fc.nat(1000), (count, start, extra) => {
        fc.pre(start <= count)
        const expected = { ok: true, ranges: [{ start, end: count }] }
        expect(parsePageRanges(`${start}-${count + extra}`, count)).toEqual(expected)
        expect(parsePageRanges(`${start}-`, count)).toEqual(expected)
      })
    )
  })

  test('始まりのない範囲は 1 ページ目から', () => {
    expect(parsePageRanges('-3', 10)).toEqual({ ok: true, ranges: [{ start: 1, end: 3 }] })
  })

  test('始まりがページ数を超える・0 ページ目は範囲外', () => {
    fc.assert(
      fc.property(pageCount, fc.integer({ min: 1, max: 100 }), (count, over) => {
        const token = `${count + over}`
        expect(parsePageRanges(`1, ${token}`, count)).toEqual({
          ok: false,
          error: { code: 'outOfRange', token },
        })
      })
    )
    expect(parsePageRanges('0-2', 5)).toEqual({ ok: false, error: { code: 'outOfRange', token: '0-2' } })
  })

  test('逆順の範囲は誤りとして返す', () => {
    expect(parsePageRanges('5-3', 10)).toEqual({ ok: false, error: { code: 'reversed', token: '5-3' } })
  })

  test('数字・区切り以外を含む入力は書き方の誤り', () => {
    fc.assert(
      fc.property(
        typedText,
        fc.constantFrom('a', 'x', '.', '/', '1-2-3', '--', '-'),
        pageCount,
        (text, junk, count) => {
          const result = parsePageRanges(`${text},${junk}`, count)
          // 前半で先に別の誤りが見つかることはある。読めてしまうことだけはない
          expect(result.ok).toBe(false)
        }
      )
    )
    expect(parsePageRanges('1, x', 5)).toEqual({ ok: false, error: { code: 'syntax', token: 'x' } })
  })

  test('空の入力・区切りだけの入力は空として返す', () => {
    for (const text of ['', '  ', ',', ' , ,']) {
      expect(parsePageRanges(text, 5)).toEqual({ ok: false, error: { code: 'empty' } })
    }
  })

  test('全角の数字・読点・ダッシュも読む', () => {
    expect(parsePageRanges('１－３、５', 10)).toEqual({
      ok: true,
      ranges: [
        { start: 1, end: 3 },
        { start: 5, end: 5 },
      ],
    })
  })
})

describe('pageRangesToIndices', () => {
  test('範囲の長さの合計だけ、0 始まりの番号を範囲の順に並べる', () => {
    fc.assert(
      fc.property(countAndRanges, ([, ranges]) => {
        const indices = pageRangesToIndices(ranges)
        expect(indices.length).toBe(ranges.reduce((sum, { start, end }) => sum + end - start + 1, 0))
        let offset = 0
        for (const { start, end } of ranges) {
          for (let page = start; page <= end; page++) expect(indices[offset++]).toBe(page - 1)
        }
      })
    )
  })
})

describe('chunkPageRanges', () => {
  test('すべてのページをちょうど 1 回ずつ、順に覆う', () => {
    fc.assert(
      fc.property(fc.nat(300), fc.integer({ min: -2, max: 50 }), (count, size) => {
        const indices = pageRangesToIndices(chunkPageRanges(count, size))
        expect(indices).toEqual(Array.from({ length: count }, (_, index) => index))
      })
    )
  })
})

import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import type { PdfPageRef } from '../../media/pdf'
import { targetPages } from './output'

const pages: PdfPageRef[] = [0, 1, 2, 3].map((page) => ({ source: 0, page, rotate: 0 }))

describe('targetPages', () => {
  test('すべてなら全ページを 1 から番号付けする', () => {
    expect(targetPages(pages, [1], 'all').numbers).toEqual([1, 2, 3, 4])
  })

  test('選んだページなら、その位置だけをいまの並びの番号で返す', () => {
    const target = targetPages(pages, [1, 3], 'selected')
    expect(target.numbers).toEqual([2, 4])
    expect(target.pages).toEqual([pages[1], pages[3]])
  })

  test('選んだページがなければ、すべてを書き出す', () => {
    expect(targetPages(pages, [], 'selected').numbers).toEqual([1, 2, 3, 4])
  })

  test('番号とページはいつも同じ数で、番号はページ数の中', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: -2, max: 6 })),
        fc.constantFrom('all' as const, 'selected' as const),
        (selected, scope) => {
          const target = targetPages(pages, selected, scope)
          expect(target.pages.length).toBe(target.numbers.length)
          target.numbers.forEach((number, index) => {
            expect(number).toBeGreaterThanOrEqual(1)
            expect(number).toBeLessThanOrEqual(pages.length)
            expect(target.pages[index]).toBe(pages[number - 1])
          })
        }
      )
    )
  })
})

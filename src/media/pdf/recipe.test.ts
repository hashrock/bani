import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  applyPdfEdit,
  createPdfRecipe,
  isPdfRecipeValid,
  normalizeRotation,
  type PdfEdit,
  type PdfPageRef,
  type PdfRecipe,
  type PdfSourceShape,
} from './recipe'

/** 入力 PDF の並び。ページ数 0 の入力も混ぜる */
const sources = fc.array(
  fc.integer({ min: 0, max: 6 }).map((pageCount): PdfSourceShape => ({ pageCount })),
  { minLength: 1, maxLength: 4 }
)

/** 古い選択状態から来る範囲外・負・重複した位置も混ぜる */
const indices = fc.array(fc.integer({ min: -2, max: 30 }), { maxLength: 6 })
const rotation = fc.constantFrom(0, 90, 180, 270, -90 as const)

const edit: fc.Arbitrary<PdfEdit> = fc.oneof(
  fc.record({ type: fc.constant('move' as const), indices, to: fc.integer({ min: -3, max: 30 }) }),
  fc.record({ type: fc.constant('remove' as const), indices }),
  fc.record({ type: fc.constant('rotate' as const), indices, by: rotation }),
  fc.record({ type: fc.constant('appendSource' as const), source: fc.integer({ min: -1, max: 5 }) }),
  fc.record({
    type: fc.constant('keepRanges' as const),
    ranges: fc.array(
      fc
        .tuple(fc.integer({ min: -1, max: 30 }), fc.integer({ min: -1, max: 30 }))
        .map(([a, b]) => ({ start: Math.min(a, b), end: Math.max(a, b) })),
      { maxLength: 3 }
    ),
  })
)

const replay = (shapes: readonly PdfSourceShape[], edits: readonly PdfEdit[]) =>
  edits.reduce((recipe, next) => applyPdfEdit(recipe, next, shapes), createPdfRecipe(shapes))

/** 入力と、そこから編集をたどって行き着いたレシピ */
const reachable = fc
  .tuple(sources, fc.array(edit, { maxLength: 12 }))
  .map(([shapes, edits]) => ({ shapes, recipe: replay(shapes, edits) }))

const key = (page: PdfPageRef) => `${page.source}:${page.page}:${page.rotate}`
const sorted = (pages: readonly PdfPageRef[]) => pages.map(key).sort()
const validIndices = (list: readonly number[], length: number) =>
  [...new Set(list)].filter((index) => index >= 0 && index < length).sort((a, b) => a - b)

describe('createPdfRecipe', () => {
  test('入力を渡された順に、全ページを回転なしでつなぐ', () => {
    fc.assert(
      fc.property(sources, (shapes) => {
        const { pages } = createPdfRecipe(shapes)
        const expected = shapes.flatMap((shape, source) =>
          Array.from({ length: shape.pageCount }, (_, page) => ({ source, page, rotate: 0 }))
        )
        expect(pages).toEqual(expected)
      })
    )
  })
})

describe('applyPdfEdit', () => {
  test('どんな編集をたどっても、すべてのページは入力にあるページを指す', () => {
    fc.assert(
      fc.property(reachable, ({ shapes, recipe }) => {
        expect(isPdfRecipeValid(recipe, shapes)).toBe(true)
        for (const page of recipe.pages) expect([0, 90, 180, 270]).toContain(page.rotate)
      })
    )
  })

  test('move は並べ替えにすぎず、選んだページは相対順のまま to の位置に、残りも相対順のまま並ぶ', () => {
    fc.assert(
      fc.property(reachable, indices, fc.integer({ min: -3, max: 30 }), ({ shapes, recipe }, list, to) => {
        const next = applyPdfEdit(recipe, { type: 'move', indices: list, to }, shapes)
        expect(sorted(next.pages)).toEqual(sorted(recipe.pages))

        const chosen = validIndices(list, recipe.pages.length)
        const moving = chosen.map((index) => recipe.pages[index])
        const rest = recipe.pages.filter((_, index) => !chosen.includes(index))
        const at = Math.max(0, Math.min(rest.length, to))
        expect(next.pages.slice(at, at + moving.length)).toEqual(moving)
        expect([...next.pages.slice(0, at), ...next.pages.slice(at + moving.length)]).toEqual(rest)
      })
    )
  })

  test('remove は選んだページだけを除き、残りの順序には触れない', () => {
    fc.assert(
      fc.property(reachable, indices, ({ shapes, recipe }, list) => {
        const next = applyPdfEdit(recipe, { type: 'remove', indices: list }, shapes)
        const chosen = validIndices(list, recipe.pages.length)
        expect(next.pages.length).toBe(recipe.pages.length - chosen.length)
        expect(next.pages).toEqual(recipe.pages.filter((_, index) => !chosen.includes(index)))
      })
    )
  })

  test('rotate は 360 を法として足し合わさる', () => {
    fc.assert(
      fc.property(reachable, indices, rotation, rotation, ({ shapes, recipe }, list, a, b) => {
        const twice = applyPdfEdit(
          applyPdfEdit(recipe, { type: 'rotate', indices: list, by: a }, shapes),
          { type: 'rotate', indices: list, by: b },
          shapes
        )
        const combined = normalizeRotation(a + b)
        const once =
          combined === 0 ? recipe : applyPdfEdit(recipe, { type: 'rotate', indices: list, by: combined }, shapes)
        expect(twice.pages).toEqual(once.pages)
      })
    )
  })

  test('rotate は選んだページの角度だけを変え、順序もどのページを指すかも変えない', () => {
    fc.assert(
      fc.property(reachable, indices, rotation, ({ shapes, recipe }, list, by) => {
        const next = applyPdfEdit(recipe, { type: 'rotate', indices: list, by }, shapes)
        const chosen = validIndices(list, recipe.pages.length)
        expect(next.pages.length).toBe(recipe.pages.length)
        next.pages.forEach((page, index) => {
          const before = recipe.pages[index]
          expect([page.source, page.page]).toEqual([before.source, before.page])
          expect(page.rotate).toBe(chosen.includes(index) ? normalizeRotation(before.rotate + by) : before.rotate)
        })
      })
    )
  })

  test('90 度を 4 回回すと元に戻る', () => {
    fc.assert(
      fc.property(reachable, indices, ({ shapes, recipe }, list) => {
        const rotate = (current: PdfRecipe) =>
          applyPdfEdit(current, { type: 'rotate', indices: list, by: 90 }, shapes)
        expect(rotate(rotate(rotate(rotate(recipe)))).pages).toEqual(recipe.pages)
      })
    )
  })

  test('appendSource はいまのページ列を残したまま、その入力の全ページを末尾に足す', () => {
    fc.assert(
      fc.property(reachable, fc.integer({ min: -1, max: 5 }), ({ shapes, recipe }, source) => {
        const next = applyPdfEdit(recipe, { type: 'appendSource', source }, shapes)
        const count = shapes[source]?.pageCount ?? 0
        expect(next.pages.slice(0, recipe.pages.length)).toEqual(recipe.pages)
        expect(next.pages.slice(recipe.pages.length)).toEqual(
          Array.from({ length: count }, (_, page) => ({ source, page, rotate: 0 }))
        )
      })
    )
  })

  test('keepRanges は範囲に入る位置のページだけを、いまの順序のまま残す', () => {
    fc.assert(
      fc.property(
        reachable,
        fc.array(
          fc.tuple(fc.integer({ min: -1, max: 30 }), fc.integer({ min: -1, max: 30 })).map(([a, b]) => ({
            start: Math.min(a, b),
            end: Math.max(a, b),
          })),
          { maxLength: 3 }
        ),
        ({ shapes, recipe }, ranges) => {
          const next = applyPdfEdit(recipe, { type: 'keepRanges', ranges }, shapes)
          const inRange = (position: number) =>
            ranges.some(({ start, end }) => start <= position && position <= end)
          expect(next.pages).toEqual(recipe.pages.filter((_, index) => inRange(index + 1)))
        }
      )
    )
  })

  test('何も変えない編集は同じオブジェクトを返す（履歴に段を積まない）', () => {
    fc.assert(
      fc.property(reachable, ({ shapes, recipe }) => {
        const noops: PdfEdit[] = [
          { type: 'move', indices: [], to: 0 },
          { type: 'remove', indices: [-1, 999] },
          { type: 'rotate', indices: [0], by: 0 },
          { type: 'appendSource', source: 99 },
          { type: 'keepRanges', ranges: [{ start: 1, end: recipe.pages.length }] },
        ]
        for (const noop of noops) expect(applyPdfEdit(recipe, noop, shapes)).toBe(recipe)
      })
    )
  })
})

describe('isPdfRecipeValid', () => {
  test('入力にないページを指すと無効', () => {
    const shapes = [{ pageCount: 2 }]
    expect(isPdfRecipeValid({ pages: [{ source: 0, page: 2, rotate: 0 }] }, shapes)).toBe(false)
    expect(isPdfRecipeValid({ pages: [{ source: 1, page: 0, rotate: 0 }] }, shapes)).toBe(false)
    expect(isPdfRecipeValid({ pages: [{ source: 0, page: 1, rotate: 90 }] }, shapes)).toBe(true)
  })
})

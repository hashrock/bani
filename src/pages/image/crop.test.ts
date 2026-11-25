import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { applyImageEdit, computeDrawPlan, computeOutputSize, createImageRecipe } from '../../media/image'
import type { ImageEdit, ImageRecipe, ImageSize, Rotation } from '../../media/image'
import {
  CORNER_HANDLES,
  EDGE_HANDLES,
  fitAspect,
  largestCenteredRect,
  moveRect,
  resizeRect,
  sourcePointToView,
  sourceRectToView,
  spanRect,
  viewPointToSource,
  viewRectToSource,
  viewSize,
} from './crop'
import type { Orientation, Rect } from './crop'

const EPS = 1e-6

const imageSize: fc.Arbitrary<ImageSize> = fc.record({
  width: fc.integer({ min: 4, max: 4000 }),
  height: fc.integer({ min: 4, max: 4000 }),
})

const orientation: fc.Arbitrary<Orientation> = fc.record({
  rotation: fc.constantFrom<Rotation>(0, 90, 180, 270),
  flipH: fc.boolean(),
  flipV: fc.boolean(),
})

const unit = fc.double({ min: 0, max: 1, noNaN: true })
const aspect = fc.option(fc.constantFrom(1, 4 / 3, 3 / 4, 16 / 9, 9 / 16, 3 / 2), { nil: null })

/** bounds の内側の矩形（0〜1 の比率から作る） */
const rectIn = (bounds: ImageSize): fc.Arbitrary<Rect> =>
  fc.tuple(unit, unit, unit, unit).map(([a, b, c, d]) => {
    const x0 = Math.min(a, b) * bounds.width
    const x1 = Math.max(a, b) * bounds.width
    const y0 = Math.min(c, d) * bounds.height
    const y1 = Math.max(c, d) * bounds.height
    return { x: x0, y: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }
  }).map((r) => moveRect(r, 0, 0, bounds))

const delta = fc.double({ min: -6000, max: 6000, noNaN: true })

function inside(rect: Rect, bounds: ImageSize) {
  expect(rect.x).toBeGreaterThanOrEqual(-EPS)
  expect(rect.y).toBeGreaterThanOrEqual(-EPS)
  expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.width + EPS)
  expect(rect.y + rect.height).toBeLessThanOrEqual(bounds.height + EPS)
}

describe('見た目と元画像の座標の行き来', () => {
  test('元 → 見た目 → 元 で点が戻る', () => {
    fc.assert(
      fc.property(imageSize, orientation, unit, unit, (info, o, u, v) => {
        const p = { x: u * info.width, y: v * info.height }
        const back = viewPointToSource(sourcePointToView(p, info, o), info, o)
        expect(back.x).toBeCloseTo(p.x, 6)
        expect(back.y).toBeCloseTo(p.y, 6)
      })
    )
  })

  test('画像の内側の矩形は、見た目でも見た目の寸法の内側に移る', () => {
    fc.assert(
      fc.property(
        imageSize.chain((info) => fc.tuple(fc.constant(info), rectIn(info))),
        orientation,
        ([info, rect], o) => {
          const view = sourceRectToView(rect, info, o)
          inside(view, viewSize(info, o.rotation))
          const back = viewRectToSource(view, info, o)
          expect(back.x).toBeCloseTo(rect.x, 6)
          expect(back.y).toBeCloseTo(rect.y, 6)
          expect(back.width).toBeCloseTo(rect.width, 6)
          expect(back.height).toBeCloseTo(rect.height, 6)
        }
      )
    )
  })

  // プレビューの切り抜き枠と書き出しの絵がずれないことを、描画の手順（computeDrawPlan）と突き合わせて確かめる
  test('computeDrawPlan の Canvas 変換と同じ点に写る', () => {
    const edits = fc.array(
      fc.constantFrom<ImageEdit>({ type: 'rotate', turns: 1 }, { type: 'rotate', turns: -1 }, { type: 'flipH' }, { type: 'flipV' }),
      { maxLength: 6 }
    )
    fc.assert(
      fc.property(imageSize, edits, unit, unit, (info, list, u, v) => {
        const recipe = list.reduce<ImageRecipe>((r, e) => applyImageEdit(r, e, info), createImageRecipe())
        const plan = computeDrawPlan(info, recipe)
        const p = { x: u * info.width, y: v * info.height }
        // drawImage は元画像の中心を原点に置き、拡大縮小なしで描く（リサイズ・余白なし）
        const lx = p.x - info.width / 2
        const ly = p.y - info.height / 2
        const angle = (plan.rotation * Math.PI) / 180
        const rx = lx * Math.cos(angle) - ly * Math.sin(angle)
        const ry = lx * Math.sin(angle) + ly * Math.cos(angle)
        const expected = { x: plan.centerX + plan.scaleX * rx, y: plan.centerY + plan.scaleY * ry }
        const actual = sourcePointToView(p, info, recipe)
        expect(actual.x).toBeCloseTo(expected.x, 6)
        expect(actual.y).toBeCloseTo(expected.y, 6)
      })
    )
  })

  test('見た目で選んだ範囲を crop にすると、書き出しの寸法は選んだ範囲の寸法になる', () => {
    fc.assert(
      fc.property(
        imageSize,
        orientation,
        fc.tuple(unit, unit, unit, unit),
        (info, o, [a, b, c, d]) => {
          const view = viewSize(info, o.rotation)
          const x0 = Math.round(Math.min(a, b) * (view.width - 1))
          const y0 = Math.round(Math.min(c, d) * (view.height - 1))
          const rect = {
            x: x0,
            y: y0,
            width: Math.max(1, Math.round(Math.abs(a - b) * view.width)),
            height: Math.max(1, Math.round(Math.abs(c - d) * view.height)),
          }
          const clipped = moveRect(
            { ...rect, width: Math.min(rect.width, view.width - x0), height: Math.min(rect.height, view.height - y0) },
            0,
            0,
            view
          )
          const recipe: ImageRecipe = { ...createImageRecipe(), ...o }
          const cropped = applyImageEdit(recipe, { type: 'crop', rect: viewRectToSource(clipped, info, o) }, info)
          const size = computeOutputSize(info, cropped)
          expect(size.width).toBe(clipped.width)
          expect(size.height).toBe(clipped.height)
        }
      )
    )
  })
})

describe('ドラッグ', () => {
  const boundsAndRect = imageSize.chain((bounds) => fc.tuple(fc.constant(bounds), rectIn(bounds)))

  test('移動は大きさを変えず、枠からはみ出さない', () => {
    fc.assert(
      fc.property(boundsAndRect, delta, delta, ([bounds, rect], dx, dy) => {
        const moved = moveRect(rect, dx, dy, bounds)
        expect(moved.width).toBe(rect.width)
        expect(moved.height).toBe(rect.height)
        inside(moved, bounds)
      })
    )
  })

  test('つまみをどう動かしても枠の内側で、1px 以上を保つ', () => {
    fc.assert(
      fc.property(
        boundsAndRect,
        fc.constantFrom(...CORNER_HANDLES, ...EDGE_HANDLES),
        delta,
        delta,
        aspect,
        ([bounds, rect], handle, dx, dy, ratio) => {
          const next = resizeRect(rect, handle, dx, dy, bounds, ratio)
          inside(next, bounds)
          expect(next.width).toBeGreaterThan(0)
          expect(next.height).toBeGreaterThan(0)
          if (ratio === null) {
            expect(next.width).toBeGreaterThanOrEqual(1 - EPS)
            expect(next.height).toBeGreaterThanOrEqual(1 - EPS)
          }
        }
      )
    )
  })

  test('縦横比を固定して角を動かすと、比率が保たれる', () => {
    fc.assert(
      fc.property(
        boundsAndRect,
        fc.constantFrom(...CORNER_HANDLES),
        delta,
        delta,
        fc.constantFrom(1, 4 / 3, 9 / 16, 16 / 9),
        ([bounds, rect], handle, dx, dy, ratio) => {
          const next = resizeRect(rect, handle, dx, dy, bounds, ratio)
          expect(next.width / next.height).toBeCloseTo(ratio, 6)
        }
      )
    )
  })

  test('縦横比を固定しているあいだ、辺のつまみは何もしない', () => {
    const rect = { x: 10, y: 10, width: 40, height: 30 }
    expect(resizeRect(rect, 'e', 20, 0, { width: 100, height: 100 }, 1)).toBe(rect)
  })

  test('角のつまみは対角を固定して動く', () => {
    const rect = { x: 10, y: 10, width: 40, height: 30 }
    expect(resizeRect(rect, 'se', 10, 5, { width: 100, height: 100 }, null)).toEqual({ x: 10, y: 10, width: 50, height: 35 })
    expect(resizeRect(rect, 'nw', -5, -5, { width: 100, height: 100 }, null)).toEqual({ x: 5, y: 5, width: 45, height: 35 })
  })

  test('辺のつまみが反対の辺を越えると向きが入れ替わる', () => {
    const rect = { x: 10, y: 10, width: 40, height: 30 }
    expect(resizeRect(rect, 'e', -60, 0, { width: 100, height: 100 }, null)).toEqual({ x: 0, y: 10, width: 10, height: 30 })
  })

  test('新しく描いた範囲は anchor から広がり、枠からはみ出さない', () => {
    const bounds = { width: 100, height: 80 }
    expect(spanRect({ x: 20, y: 20 }, { x: 50, y: 60 }, bounds, null)).toEqual({ x: 20, y: 20, width: 30, height: 40 })
    expect(spanRect({ x: 20, y: 20 }, { x: -50, y: 0 }, bounds, null)).toEqual({ x: 0, y: 0, width: 20, height: 20 })
    expect(spanRect({ x: 20, y: 20 }, { x: 60, y: 30 }, bounds, 1)).toEqual({ x: 20, y: 20, width: 40, height: 40 })
  })
})

describe('縦横比のプリセット', () => {
  test('最大の中央の矩形は枠に収まり、比率が合う', () => {
    fc.assert(
      fc.property(imageSize, fc.constantFrom(1, 4 / 3, 9 / 16, 16 / 9), (bounds, ratio) => {
        const rect = largestCenteredRect(bounds, ratio)
        inside(rect, bounds)
        expect(rect.width / rect.height).toBeCloseTo(ratio, 6)
        // どちらかの辺は枠いっぱい
        expect(Math.max(rect.width / bounds.width, rect.height / bounds.height)).toBeCloseTo(1, 6)
      })
    )
  })

  test('いまの範囲を比率に合わせ直しても枠に収まる', () => {
    fc.assert(
      fc.property(
        imageSize.chain((bounds) => fc.tuple(fc.constant(bounds), rectIn(bounds))),
        fc.constantFrom(1, 4 / 3, 9 / 16, 16 / 9),
        ([bounds, rect], ratio) => {
          const next = fitAspect(rect, bounds, ratio)
          inside(next, bounds)
          expect(next.width / next.height).toBeCloseTo(ratio, 6)
        }
      )
    )
  })
})

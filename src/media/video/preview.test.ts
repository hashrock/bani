import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { previewScale, previewTransform, screenDeltaToSource, sourceDeltaToScreen } from './preview'
import type { VideoRotation } from './types'

const orientation = fc.record({
  rotation: fc.constantFrom<VideoRotation>(0, 90, 180, 270),
  flipH: fc.boolean(),
  flipV: fc.boolean(),
})
const delta = fc.double({ min: -1e4, max: 1e4, noNaN: true })
const scale = fc.double({ min: 0.01, max: 10, noNaN: true })

describe('screenDeltaToSource', () => {
  test('元の座標 → 画面 → 元の座標 で移動量が戻る', () => {
    fc.assert(
      fc.property(orientation, delta, delta, scale, (recipe, dx, dy, s) => {
        const screen = sourceDeltaToScreen(dx, dy, recipe, s)
        const back = screenDeltaToSource(screen.dx, screen.dy, recipe, s)
        expect(back.dx).toBeCloseTo(dx, 6)
        expect(back.dy).toBeCloseTo(dy, 6)
      })
    )
  })

  test('CSS の transform と同じ向きに写す', () => {
    // 時計回りに 90 度: 元の右向きは画面の下向き
    expect(sourceDeltaToScreen(1, 0, { rotation: 90, flipH: false, flipV: false }, 1)).toEqual({ dx: -0, dy: 1 })
    // 回してから左右反転: 元の下向きは回転で画面の左向きになり、左右反転で右向きになる
    expect(sourceDeltaToScreen(0, 1, { rotation: 90, flipH: true, flipV: false }, 1)).toEqual({ dx: 1, dy: 0 })
    expect(previewTransform({ rotation: 90, flipH: true, flipV: false })).toBe('scale(-1, 1) rotate(90deg)')
  })

  test('拡大率が 0 以下なら動かさない', () => {
    expect(screenDeltaToSource(10, 10, { rotation: 0, flipH: false, flipV: false }, 0)).toEqual({ dx: 0, dy: 0 })
  })
})

describe('previewScale', () => {
  test('回転した映像が枠に収まる', () => {
    fc.assert(
      fc.property(
        fc.record({ width: fc.integer({ min: 1, max: 4000 }), height: fc.integer({ min: 1, max: 4000 }) }),
        fc.record({ width: fc.integer({ min: 1, max: 4000 }), height: fc.integer({ min: 1, max: 4000 }) }),
        fc.constantFrom<VideoRotation>(0, 90, 180, 270),
        (area, size, rotation) => {
          const s = previewScale(area, size, { rotation })
          const quarter = rotation % 180 !== 0
          const w = (quarter ? size.height : size.width) * s
          const h = (quarter ? size.width : size.height) * s
          expect(w).toBeLessThanOrEqual(area.width + 1e-6)
          expect(h).toBeLessThanOrEqual(area.height + 1e-6)
        }
      )
    )
  })
})

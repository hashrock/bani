import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  MAX_DIMENSION,
  MAX_PADDING,
  applyImageEdit,
  computeDrawPlan,
  computeOutputSize,
  createImageRecipe,
  fitRecipeToImage,
  isIdentityRecipe,
  normalizeHexColor,
} from './recipe'
import type { ImageDrawPlan, ImageEdit, ImageSize } from './recipe'

// --- 任意値 ---

const imageSize: fc.Arbitrary<ImageSize> = fc.record({
  width: fc.integer({ min: 1, max: 6000 }),
  height: fc.integer({ min: 1, max: 6000 }),
})

/** 画面から来うる値に加えて、負の値・巨大な値・NaN も混ぜる */
const anyNumber = fc.oneof(
  fc.integer({ min: -100, max: 7000 }),
  fc.double({ min: -1e4, max: 1e5 }),
  fc.constantFrom(NaN, Infinity, -Infinity, 1e9)
)
const sideOrNull = fc.option(anyNumber, { nil: null })

const visualEdit: fc.Arbitrary<ImageEdit> = fc.oneof(
  fc.integer({ min: -5, max: 5 }).map((turns) => ({ type: 'rotate', turns }) as const),
  fc.constant({ type: 'flipH' } as const),
  fc.constant({ type: 'flipV' } as const)
)

const anyEdit: fc.Arbitrary<ImageEdit> = fc.oneof(
  visualEdit,
  fc.option(fc.record({ x: anyNumber, y: anyNumber, width: anyNumber, height: anyNumber }), { nil: null }).map(
    (rect) => ({ type: 'crop', rect }) as const
  ),
  fc
    .option(fc.record({ width: sideOrNull, height: sideOrNull, keepAspect: fc.boolean(), allowUpscale: fc.boolean() }), {
      nil: null,
    })
    .map((resize) => ({ type: 'resize', resize }) as const),
  fc
    .record({ top: anyNumber, right: anyNumber, bottom: anyNumber, left: anyNumber })
    .map((padding) => ({ type: 'padding', padding }) as const),
  fc
    .option(fc.constantFrom('#fff', '#FF0000', '#00000080', 'red', '#12345', ''), { nil: null })
    .map((color) => ({ type: 'background', color }) as const),
  fc.constant({ type: 'reset' } as const)
)

const run = (info: ImageSize, edits: readonly ImageEdit[], start = createImageRecipe()) =>
  edits.reduce((recipe, edit) => applyImageEdit(recipe, edit, info), start)

const reachable = fc
  .tuple(imageSize, fc.array(anyEdit, { maxLength: 20 }))
  .map(([info, edits]) => ({ info, recipe: run(info, edits) }))

// --- 見た目の変換を 2x2 の整数行列で表す（y 軸は下向き）---

type Matrix = [number, number, number, number] // [a, b, c, d] = [[a, b], [c, d]]
const IDENTITY: Matrix = [1, 0, 0, 1]
const CLOCKWISE: Matrix = [0, -1, 1, 0]
const MIRROR_H: Matrix = [-1, 0, 0, 1]
const MIRROR_V: Matrix = [1, 0, 0, -1]

function multiply([a, b, c, d]: Matrix, [e, f, g, h]: Matrix): Matrix {
  // -0 と 0 を区別しないように 0 を足してそろえる
  return [a * e + b * g + 0, a * f + b * h + 0, c * e + d * g + 0, c * f + d * h + 0]
}

function power(m: Matrix, n: number): Matrix {
  let result = IDENTITY
  for (let i = 0; i < ((n % 4) + 4) % 4; i++) result = multiply(m, result)
  return result
}

/** 編集列の見た目の意味。後の操作ほど左から掛かる */
function visualMatrix(edits: readonly ImageEdit[]): Matrix {
  return edits.reduce<Matrix>((m, edit) => {
    switch (edit.type) {
      case 'rotate':
        return multiply(power(CLOCKWISE, edit.turns), m)
      case 'flipH':
        return multiply(MIRROR_H, m)
      case 'flipV':
        return multiply(MIRROR_V, m)
      default:
        return m
    }
  }, IDENTITY)
}

/** 描画手順が実際に施す線形変換: scale(sx, sy) · rotate(θ) */
function planMatrix(plan: ImageDrawPlan): Matrix {
  const rotation = power(CLOCKWISE, plan.rotation / 90)
  return multiply([plan.scaleX, 0, 0, plan.scaleY], rotation)
}

/** 元画像上の点が、書き出し後のどこに描かれるか */
function mapPoint(plan: ImageDrawPlan, x: number, y: number): [number, number] {
  const { source } = plan
  const px = ((x - source.x) / source.width) * plan.drawWidth - plan.drawWidth / 2
  const py = ((y - source.y) / source.height) * plan.drawHeight - plan.drawHeight / 2
  const [a, b, c, d] = planMatrix(plan)
  return [plan.centerX + a * px + b * py, plan.centerY + c * px + d * py]
}

describe('applyImageEdit', () => {
  test('どんな編集列をたどっても、レシピの値は範囲内の整数に収まる', () => {
    fc.assert(
      fc.property(reachable, ({ info, recipe }) => {
        if (recipe.crop) {
          const { x, y, width, height } = recipe.crop
          for (const v of [x, y, width, height]) expect(Number.isInteger(v)).toBe(true)
          expect(x).toBeGreaterThanOrEqual(0)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(width).toBeGreaterThanOrEqual(1)
          expect(height).toBeGreaterThanOrEqual(1)
          expect(x + width).toBeLessThanOrEqual(info.width)
          expect(y + height).toBeLessThanOrEqual(info.height)
          // 画像全体の切り抜きは「切り抜きなし」に寄せる
          expect(width === info.width && height === info.height).toBe(false)
        }
        expect([0, 90, 180, 270]).toContain(recipe.rotation)
        for (const v of Object.values(recipe.padding)) {
          expect(Number.isInteger(v)).toBe(true)
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThanOrEqual(MAX_PADDING)
        }
        if (recipe.resize) {
          expect(recipe.resize.width !== null || recipe.resize.height !== null).toBe(true)
          for (const v of [recipe.resize.width, recipe.resize.height]) {
            if (v !== null) {
              expect(Number.isInteger(v)).toBe(true)
              expect(v).toBeGreaterThanOrEqual(1)
              expect(v).toBeLessThanOrEqual(MAX_DIMENSION)
            }
          }
        }
        if (recipe.background !== null) expect(recipe.background).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/)
      })
    )
  })

  test('回転・反転の編集列は、見た目の変換の積と同じ向きを描く（反転と回転の入れ子も正しく畳む）', () => {
    fc.assert(
      fc.property(imageSize, fc.array(visualEdit, { maxLength: 30 }), (info, edits) => {
        const plan = computeDrawPlan(info, run(info, edits))
        expect(planMatrix(plan)).toEqual(visualMatrix(edits))
      })
    )
  })

  test('回転は 360 度を法として足し合わさる', () => {
    fc.assert(
      fc.property(reachable, fc.integer({ min: -9, max: 9 }), fc.integer({ min: -9, max: 9 }), ({ info, recipe }, a, b) => {
        const twice = run(info, [{ type: 'rotate', turns: a }, { type: 'rotate', turns: b }], recipe)
        expect(twice).toEqual(run(info, [{ type: 'rotate', turns: a + b }], recipe))
        expect(run(info, [{ type: 'rotate', turns: 4 }], recipe)).toBe(recipe)
      })
    )
  })

  test('同じ向きの反転を 2 回すると元に戻り、左右と上下の反転は順番によらない', () => {
    fc.assert(
      fc.property(reachable, ({ info, recipe }) => {
        expect(run(info, [{ type: 'flipH' }, { type: 'flipH' }], recipe)).toEqual(recipe)
        expect(run(info, [{ type: 'flipV' }, { type: 'flipV' }], recipe)).toEqual(recipe)
        expect(run(info, [{ type: 'flipH' }, { type: 'flipV' }], recipe)).toEqual(
          run(info, [{ type: 'flipV' }, { type: 'flipH' }], recipe)
        )
      })
    )
  })

  test('上下左右の両方を反転すると 180 度回転と同じ絵になる', () => {
    fc.assert(
      fc.property(reachable, ({ info, recipe }) => {
        const flipped = computeDrawPlan(info, run(info, [{ type: 'flipH' }, { type: 'flipV' }], recipe))
        const rotated = computeDrawPlan(info, run(info, [{ type: 'rotate', turns: 2 }], recipe))
        expect(planMatrix(flipped)).toEqual(planMatrix(rotated))
      })
    )
  })

  test('回転・反転しても切り抜き範囲（元画像の座標）は変わらない', () => {
    fc.assert(
      fc.property(reachable, fc.array(visualEdit, { maxLength: 10 }), ({ info, recipe }, edits) => {
        expect(run(info, edits, recipe).crop).toEqual(recipe.crop)
      })
    )
  })

  test('90 度回すと、余白を除いた書き出し寸法の縦横が入れ替わる', () => {
    fc.assert(
      fc.property(reachable, fc.constantFrom(1, 3, -1), ({ info, recipe }, turns) => {
        const before = computeOutputSize(info, recipe)
        const after = computeOutputSize(info, run(info, [{ type: 'rotate', turns }], recipe))
        expect([after.contentWidth, after.contentHeight]).toEqual([before.contentHeight, before.contentWidth])
      })
    )
  })

  test('数値として読めない編集は無視する', () => {
    fc.assert(
      fc.property(reachable, ({ info, recipe }) => {
        const edits: ImageEdit[] = [
          { type: 'crop', rect: { x: NaN, y: 0, width: 10, height: 10 } },
          { type: 'rotate', turns: NaN },
          { type: 'resize', resize: { width: NaN, height: 10, keepAspect: true, allowUpscale: false } },
          { type: 'padding', padding: { top: Infinity, right: 0, bottom: 0, left: 0 } },
          { type: 'background', color: 'not a color' },
        ]
        for (const edit of edits) expect(applyImageEdit(recipe, edit, info)).toBe(recipe)
      })
    )
  })

  test('「元に戻す」はどの状態からでも何もしないレシピに戻す', () => {
    fc.assert(
      fc.property(reachable, ({ info, recipe }) => {
        expect(isIdentityRecipe(run(info, [{ type: 'reset' }], recipe))).toBe(true)
      })
    )
  })
})

describe('computeOutputSize', () => {
  test('どんなレシピでも 1px 以上の整数で、余白の分だけ中身より大きい', () => {
    fc.assert(
      fc.property(reachable, ({ info, recipe }) => {
        const size = computeOutputSize(info, recipe)
        for (const v of [size.width, size.height, size.contentWidth, size.contentHeight]) {
          expect(Number.isInteger(v)).toBe(true)
          expect(v).toBeGreaterThanOrEqual(1)
        }
        const { top, right, bottom, left } = recipe.padding
        expect(size.width).toBe(size.contentWidth + left + right)
        expect(size.height).toBe(size.contentHeight + top + bottom)
      })
    )
  })

  test('縦横比を保つリサイズは枠に収まり、比率のずれは丸めの 1px 以内', () => {
    fc.assert(
      fc.property(
        imageSize,
        fc.integer({ min: 1, max: 4000 }),
        fc.integer({ min: 1, max: 4000 }),
        fc.boolean(),
        (info, width, height, allowUpscale) => {
          const recipe = run(info, [{ type: 'resize', resize: { width, height, keepAspect: true, allowUpscale } }])
          const size = computeOutputSize(info, recipe)
          expect(size.width).toBeLessThanOrEqual(Math.max(width, 1))
          expect(size.height).toBeLessThanOrEqual(Math.max(height, 1))
          if (!allowUpscale) {
            expect(size.width).toBeLessThanOrEqual(info.width)
            expect(size.height).toBeLessThanOrEqual(info.height)
          }
          // 片方の辺から比率どおりに求めた長さと、丸めの範囲で一致する
          if (size.width > 1 && size.height > 1) {
            expect(Math.abs(size.width * (info.height / info.width) - size.height)).toBeLessThanOrEqual(
              1 + info.height / info.width
            )
          }
        }
      )
    )
  })

  test('縦横比を保たないリサイズは指定どおりの寸法になり、指定のない辺は元のまま', () => {
    fc.assert(
      fc.property(imageSize, fc.integer({ min: 1, max: 4000 }), fc.option(fc.integer({ min: 1, max: 4000 }), { nil: null }), (info, width, height) => {
        const recipe = run(info, [{ type: 'resize', resize: { width, height, keepAspect: false, allowUpscale: false } }])
        const size = computeOutputSize(info, recipe)
        expect([size.width, size.height]).toEqual([width, height ?? info.height])
      })
    )
  })

  test('幅も高さも指定しないリサイズは、リサイズなしと同じ', () => {
    fc.assert(
      fc.property(reachable, fc.boolean(), ({ info, recipe }, keepAspect) => {
        const edited = run(info, [{ type: 'resize', resize: { width: null, height: null, keepAspect, allowUpscale: true } }], recipe)
        expect(edited.resize).toBeNull()
      })
    )
  })
})

describe('computeDrawPlan', () => {
  test('切り抜き範囲の四隅は、余白の内側の画像領域の四隅にちょうど写る', () => {
    fc.assert(
      fc.property(reachable, ({ info, recipe }) => {
        const plan = computeDrawPlan(info, recipe)
        const size = computeOutputSize(info, recipe)
        const { x, y, width, height } = plan.source
        const corners = [
          mapPoint(plan, x, y),
          mapPoint(plan, x + width, y),
          mapPoint(plan, x, y + height),
          mapPoint(plan, x + width, y + height),
        ].map(([px, py]) => `${Math.round(px * 1e6) / 1e6},${Math.round(py * 1e6) / 1e6}`)
        const { left, top } = recipe.padding
        const expected = [
          [left, top],
          [left + size.contentWidth, top],
          [left, top + size.contentHeight],
          [left + size.contentWidth, top + size.contentHeight],
        ].map(([px, py]) => `${px},${py}`)
        expect(corners.sort()).toEqual(expected.sort())
      })
    )
  })

  test('時計回りに 90 度回すと、元の左上は右上に来る', () => {
    const info = { width: 40, height: 30 }
    const plan = computeDrawPlan(info, run(info, [{ type: 'rotate', turns: 1 }]))
    expect([plan.canvasWidth, plan.canvasHeight]).toEqual([30, 40])
    expect(mapPoint(plan, 0, 0)).toEqual([30, 0])
  })

  test('左右反転してから時計回りに回すと、元の左上は右下に来る', () => {
    const info = { width: 40, height: 30 }
    const plan = computeDrawPlan(info, run(info, [{ type: 'flipH' }, { type: 'rotate', turns: 1 }]))
    // 反転で左上→右上(40,0)、時計回りで右上→右下
    expect(mapPoint(plan, 0, 0)).toEqual([30, 40])
  })
})

describe('fitRecipeToImage', () => {
  test('別の寸法の画像に当てても切り抜きは内側に収まり、もう一度当てても変わらない', () => {
    fc.assert(
      fc.property(reachable, imageSize, ({ recipe }, other) => {
        const fitted = fitRecipeToImage(recipe, other)
        if (fitted.crop) {
          expect(fitted.crop.x + fitted.crop.width).toBeLessThanOrEqual(other.width)
          expect(fitted.crop.y + fitted.crop.height).toBeLessThanOrEqual(other.height)
        }
        expect(fitRecipeToImage(fitted, other)).toBe(fitted)
      })
    )
  })

  test('同じ画像に当てるなら何も変えない', () => {
    fc.assert(
      fc.property(reachable, ({ info, recipe }) => {
        expect(fitRecipeToImage(recipe, info)).toBe(recipe)
      })
    )
  })
})

describe('normalizeHexColor', () => {
  test('3 桁・6 桁・8 桁の 16 進を小文字にそろえ、それ以外は読まない', () => {
    expect(normalizeHexColor('#FfF')).toBe('#ffffff')
    expect(normalizeHexColor(' #A0B1C2 ')).toBe('#a0b1c2')
    expect(normalizeHexColor('#00000080')).toBe('#00000080')
    expect(normalizeHexColor('red')).toBeNull()
    expect(normalizeHexColor('#12345')).toBeNull()
  })
})

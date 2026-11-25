import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { PAPER_SIZES, imagesToPdf, placeImage, type ImagesToPdfSettings } from './images'
import { probePdf } from './probe'
import { isPdfError } from './errors'

const fromBase64 = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))

// 1×1 の PNG と JPEG。pdf-lib は JPEG を復号せずヘッダーだけ読むので、この程度で足りる
const PNG = fromBase64(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
)
const JPEG = fromBase64(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
)

const imageSize = fc.record({
  width: fc.integer({ min: 1, max: 5000 }),
  height: fc.integer({ min: 1, max: 5000 }),
})
const settings: fc.Arbitrary<ImagesToPdfSettings> = fc.record({
  pageSize: fc.constantFrom('fit', 'a4', 'letter'),
  margin: fc.integer({ min: -10, max: 1000 }),
  orientation: fc.constantFrom('auto', 'portrait', 'landscape', undefined),
})

/** 用紙の端の計算に割り算が入るので、比較には桁落ち分の余裕を持たせる */
const EPSILON = 1e-6

describe('placeImage', () => {
  test('画像はページからはみ出さず、縦横比を保つ', () => {
    fc.assert(
      fc.property(imageSize, settings, (size, current) => {
        const { page, image } = placeImage(size, current)
        expect(image.x).toBeGreaterThanOrEqual(-EPSILON)
        expect(image.y).toBeGreaterThanOrEqual(-EPSILON)
        expect(image.x + image.width).toBeLessThanOrEqual(page.width + EPSILON)
        expect(image.y + image.height).toBeLessThanOrEqual(page.height + EPSILON)
        expect(image.width).toBeGreaterThan(0)
        expect(image.width / image.height).toBeCloseTo(size.width / size.height, 6)
      })
    )
  })

  test('用紙では中央に置き、少なくとも一方の向きで余白いっぱいまで広げる', () => {
    fc.assert(
      fc.property(imageSize, settings, (size, current) => {
        fc.pre(current.pageSize !== 'fit' && current.margin >= 0 && current.margin < 200)
        const { page, image } = placeImage(size, current)
        const paper = PAPER_SIZES[current.pageSize as 'a4' | 'letter']
        expect([page.width, page.height].sort()).toEqual([paper.width, paper.height].sort())
        expect(image.x * 2 + image.width).toBeCloseTo(page.width, 6)
        expect(image.y * 2 + image.height).toBeCloseTo(page.height, 6)
        const fills =
          Math.abs(image.width - (page.width - current.margin * 2)) < EPSILON ||
          Math.abs(image.height - (page.height - current.margin * 2)) < EPSILON
        expect(fills).toBe(true)
      })
    )
  })

  test('fit は画像の大きさに余白を足したページになる', () => {
    expect(placeImage({ width: 300, height: 200 }, { pageSize: 'fit', margin: 10 })).toEqual({
      page: { width: 320, height: 220 },
      image: { x: 10, y: 10, width: 300, height: 200 },
    })
  })

  test('auto では横長の画像を横置きの用紙に置く', () => {
    const { page } = placeImage({ width: 300, height: 200 }, { pageSize: 'a4', margin: 0 })
    expect(page).toEqual({ width: PAPER_SIZES.a4.height, height: PAPER_SIZES.a4.width })
  })
})

describe('imagesToPdf', () => {
  test('PNG と JPEG を渡した順に 1 枚 1 ページで埋め込む', async () => {
    const files = [new File([PNG], 'first.png'), new File([JPEG], 'second.jpg'), new File([PNG], 'third.png')]
    const rendered = await imagesToPdf(files, { pageSize: 'a4', margin: 36 })
    expect(rendered.filename).toBe('first.pdf')
    const info = await probePdf(rendered.blob)
    expect(info.pageCount).toBe(3)
    for (const page of info.pages) {
      expect([page.width, page.height]).toEqual([PAPER_SIZES.a4.width, PAPER_SIZES.a4.height])
    }
  })

  test('MIME 型や拡張子ではなく中身で形式を見分ける', async () => {
    const rendered = await imagesToPdf([new File([JPEG], 'wrong.png', { type: 'image/png' })], {
      pageSize: 'fit',
      margin: 0,
    })
    expect((await probePdf(rendered.blob)).pages[0]).toMatchObject({ width: 1, height: 1 })
  })

  test('ブラウザなしでは JPEG・PNG 以外を unsupportedImage で断る', async () => {
    const error = await imagesToPdf([new File(['GIF89a'], 'x.gif')], { pageSize: 'fit', margin: 0 }).catch(
      (caught) => caught
    )
    expect(isPdfError(error, 'unsupportedImage')).toBe(true)
  })

  test('画像がなければ empty で失敗する', async () => {
    const error = await imagesToPdf([], { pageSize: 'fit', margin: 0 }).catch((caught) => caught)
    expect(isPdfError(error, 'empty')).toBe(true)
  })
})

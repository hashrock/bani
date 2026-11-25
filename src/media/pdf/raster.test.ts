import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { PDFDocument } from 'pdf-lib'
import {
  MAX_CANVAS_AREA,
  MAX_CANVAS_SIDE,
  compressImageSettings,
  encoderQuality,
  extrapolateSize,
  pageImageNames,
  rasterSize,
  samplePositions,
  type PdfRasterResolution,
} from './raster'
import { createRasterPdfWriter } from './rasterPdf'

const A4 = { width: 595.28, height: 841.89 }

const pageSize = fc.record({
  width: fc.double({ min: 1, max: 20000, noNaN: true }),
  height: fc.double({ min: 1, max: 20000, noNaN: true }),
})
const resolution: fc.Arbitrary<PdfRasterResolution> = fc.oneof(
  fc.record({ kind: fc.constant('dpi' as const), dpi: fc.integer({ min: -100, max: 5000 }) }),
  fc.record({ kind: fc.constant('longEdge' as const), pixels: fc.integer({ min: -100, max: 100000 }) })
)

describe('rasterSize', () => {
  test('A4 を 72 DPI で描くと pt と同じ px、150 DPI ならその比になる', () => {
    expect(rasterSize(A4, { kind: 'dpi', dpi: 72 })).toMatchObject({ width: 595, height: 842, clamped: false })
    expect(rasterSize(A4, { kind: 'dpi', dpi: 150 })).toMatchObject({ width: 1240, height: 1754 })
  })

  test('長い辺の px を決めると、その辺がちょうどその長さになる', () => {
    expect(rasterSize(A4, { kind: 'longEdge', pixels: 2000 })).toMatchObject({ height: 2000, width: 1414 })
    expect(rasterSize({ width: 800, height: 400 }, { kind: 'longEdge', pixels: 1000 })).toMatchObject({
      width: 1000,
      height: 500,
    })
  })

  test('どんな指定でも 1px 以上、canvas の上限以下で、縦横比はほぼ保つ', () => {
    fc.assert(
      fc.property(pageSize, resolution, (page, current) => {
        const size = rasterSize(page, current)
        expect(size.width).toBeGreaterThanOrEqual(1)
        expect(size.height).toBeGreaterThanOrEqual(1)
        expect(size.width).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
        expect(size.height).toBeLessThanOrEqual(MAX_CANVAS_SIDE)
        expect(size.width * size.height).toBeLessThanOrEqual(MAX_CANVAS_AREA)
        expect(Number.isInteger(size.width) && Number.isInteger(size.height)).toBe(true)
        // どちらの辺も、同じ倍率を掛けた長さから丸めの 1px しかずれない（= 縦横比を保つ）
        expect(Math.abs(size.width - Math.max(1, page.width * size.scale))).toBeLessThanOrEqual(1)
        expect(Math.abs(size.height - Math.max(1, page.height * size.scale))).toBeLessThanOrEqual(1)
      })
    )
  })

  test('上限に当たったときだけ clamped になる', () => {
    expect(rasterSize(A4, { kind: 'dpi', dpi: 300 }).clamped).toBe(false)
    const huge = rasterSize(A4, { kind: 'dpi', dpi: 600 })
    expect(huge.clamped).toBe(true)
    expect(huge.width * huge.height).toBeLessThanOrEqual(MAX_CANVAS_AREA)
  })
})

describe('pageImageNames', () => {
  test('全体のページ数の桁に 0 を詰め、形式の拡張子を付ける', () => {
    expect(pageImageNames('report', [1, 2, 12], 12, 'png')).toEqual([
      'report-p01.png',
      'report-p02.png',
      'report-p12.png',
    ])
    expect(pageImageNames('a', [3], 5, 'jpeg')).toEqual(['a-p3.jpg'])
  })

  test('違うページ番号からは違う名前になり、名前の順はページの順と同じ', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({ min: 1, max: 5000 }), { minLength: 1 }), (numbers) => {
        const total = Math.max(...numbers)
        const names = pageImageNames('doc', numbers, total, 'png')
        expect(new Set(names).size).toBe(numbers.length)
        const byName = [...names].sort()
        const byNumber = [...numbers].sort((a, b) => a - b).map((n) => names[numbers.indexOf(n)])
        expect(byName).toEqual(byNumber)
      })
    )
  })
})

describe('samplePositions', () => {
  test('先頭・中ほど・末尾を取る', () => {
    expect(samplePositions(10)).toEqual([0, 5, 9])
    expect(samplePositions(2)).toEqual([0, 1])
    expect(samplePositions(0)).toEqual([])
  })

  test('範囲の中で、重ならず、昇順で、max を超えない', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10000 }), fc.integer({ min: 0, max: 10 }), (count, max) => {
        const positions = samplePositions(count, max)
        expect(positions.length).toBeLessThanOrEqual(Math.min(count, max))
        if (count > 0 && max > 0) expect(positions[0]).toBe(0)
        positions.forEach((position, index) => {
          expect(position).toBeGreaterThanOrEqual(0)
          expect(position).toBeLessThan(count)
          if (index > 0) expect(position).toBeGreaterThan(positions[index - 1])
        })
      })
    )
  })
})

describe('extrapolateSize', () => {
  test('画像は平均 × ページ数、PDF はそれに少し足す', () => {
    expect(extrapolateSize([100, 300], 10, false)).toBe(2000)
    expect(extrapolateSize([100, 300], 10, true)).toBeGreaterThan(2000)
    expect(extrapolateSize([], 10, true)).toBe(0)
  })

  test('ページが増えれば見込みも減らない', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1e7 }), { minLength: 1, maxLength: 5 }),
        fc.integer({ min: 1, max: 1000 }),
        fc.boolean(),
        (samples, count, asPdf) => {
          expect(extrapolateSize(samples, count + 1, asPdf)).toBeGreaterThanOrEqual(
            extrapolateSize(samples, count, asPdf)
          )
        }
      )
    )
  })
})

test('圧縮は JPEG を DPI で描く設定になり、画質は 0〜1 に収まる', () => {
  expect(compressImageSettings({ dpi: 150, quality: 70 })).toEqual({
    format: 'jpeg',
    quality: 70,
    resolution: { kind: 'dpi', dpi: 150 },
  })
  fc.assert(
    fc.property(fc.double({ noNaN: false }), (quality) => {
      const value = encoderQuality(quality)
      expect(value).toBeGreaterThanOrEqual(0.01)
      expect(value).toBeLessThanOrEqual(1)
    })
  )
})

const fromBase64 = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
// 1×1 の JPEG。pdf-lib は JPEG を復号せずヘッダーだけ読む
const JPEG = fromBase64(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA='
)

describe('createRasterPdfWriter', () => {
  test('足した順に、決めた大きさのページが並び、タイトルが残る', async () => {
    const writer = await createRasterPdfWriter({ title: '報告書', author: 'hashrock' })
    await writer.addPage(JPEG, A4.width, A4.height)
    await writer.addPage(JPEG, A4.height, A4.width)
    expect(writer.pageCount).toBe(2)
    const blob = await writer.save()
    expect(blob.type).toBe('application/pdf')
    const document = await PDFDocument.load(await blob.arrayBuffer())
    const sizes = document.getPages().map((page) => page.getSize())
    expect(sizes[0].width).toBeCloseTo(A4.width)
    expect(sizes[1].width).toBeCloseTo(A4.height)
    expect(document.getPages().every((page) => page.getRotation().angle === 0)).toBe(true)
    expect(document.getTitle()).toBe('報告書')
  })

  test('JPEG でないものは PdfError', async () => {
    const writer = await createRasterPdfWriter()
    await expect(writer.addPage(new Uint8Array([1, 2, 3]), 10, 10)).rejects.toMatchObject({ code: 'invalid' })
  })
})

import { describe, expect, test } from 'vitest'
import { svgRasterSize } from '../../media/image/svg'
import { DEFAULT_SVG_EXPORT, previewScale, rasterOptionsOf } from './svgExport'

describe('rasterOptionsOf', () => {
  const base = { width: 100, height: 40 }
  test('選んだ方式の値だけを使う', () => {
    const settings = { ...DEFAULT_SVG_EXPORT, scale: 4, width: 300, dpi: 192 }
    expect(svgRasterSize(base, rasterOptionsOf({ ...settings, sizeMode: 'scale' }))).toEqual({ width: 400, height: 160 })
    expect(svgRasterSize(base, rasterOptionsOf({ ...settings, sizeMode: 'width' }))).toEqual({ width: 300, height: 120 })
    expect(svgRasterSize(base, rasterOptionsOf({ ...settings, sizeMode: 'dpi' }))).toEqual({ width: 200, height: 80 })
  })
  test('幅が空欄なら元の大きさ', () => {
    expect(svgRasterSize(base, rasterOptionsOf({ ...DEFAULT_SVG_EXPORT, sizeMode: 'width', width: null }))).toEqual(base)
  })
})

describe('previewScale', () => {
  test('長いほうの辺を枠に合わせ、画素密度をかける', () => {
    expect(previewScale({ width: 1000, height: 500 }, 200, 2)).toBeCloseTo(0.4)
    expect(previewScale({ width: 16, height: 32 }, 160, 1)).toBeCloseTo(5)
  })
})

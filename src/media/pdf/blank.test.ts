import { describe, expect, test } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { BLANK_PAGE_KINDS, blankPageSize, blankPdfName, createBlankPdf, parseBlankPdfName } from './blank'

describe('白紙のページ', () => {
  test('名前から用紙と向きを読み戻せ、ほかの名前は白紙と見なさない', () => {
    for (const kind of BLANK_PAGE_KINDS) expect(parseBlankPdfName(blankPdfName(kind))).toEqual(kind)
    expect(parseBlankPdfName('blank-a3-portrait.pdf')).toBeNull()
    expect(parseBlankPdfName('report.pdf')).toBeNull()
  })

  test('横置きは縦置きの幅と高さを入れ替える', () => {
    expect(blankPageSize({ paper: 'a4', orientation: 'portrait' })).toEqual({ width: 595.28, height: 841.89 })
    expect(blankPageSize({ paper: 'letter', orientation: 'landscape' })).toEqual({ width: 792, height: 612 })
  })

  test('1 ページだけの、その大きさの PDF を作る', async () => {
    for (const kind of BLANK_PAGE_KINDS) {
      const file = await createBlankPdf(kind)
      expect(file.name).toBe(blankPdfName(kind))
      const document = await PDFDocument.load(await file.arrayBuffer())
      expect(document.getPageCount()).toBe(1)
      const size = document.getPage(0).getSize()
      const expected = blankPageSize(kind)
      expect(size.width).toBeCloseTo(expected.width, 1)
      expect(size.height).toBeCloseTo(expected.height, 1)
    }
  })
})

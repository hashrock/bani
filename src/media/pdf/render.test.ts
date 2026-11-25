import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { PDFDocument, degrees } from 'pdf-lib'
import { applyPdfEdit, createPdfRecipe, normalizeRotation, type PdfEdit, type PdfRecipe } from './recipe'
import { probePdf, type PdfInfo } from './probe'
import { renderPdf, splitPdf } from './render'
import { isPdfError } from './errors'

/**
 * どの入力の何ページ目かを、ページの大きさで見分けられる PDF を作る。
 * 幅 = 100 + ページ番号、高さ = 200 + 入力の番号。
 */
async function makePdf(
  source: number,
  pageCount: number,
  { title, rotations = [] }: { title?: string; rotations?: number[] } = {}
): Promise<File> {
  const document = await PDFDocument.create()
  if (title) document.setTitle(title)
  for (let page = 0; page < pageCount; page++) {
    const added = document.addPage([100 + page, 200 + source])
    added.drawText(`${source}:${page}`, { x: 10, y: 10, size: 8 })
    if (rotations[page]) added.setRotation(degrees(rotations[page]))
  }
  return new File([(await document.save()) as Uint8Array<ArrayBuffer>], `source${source}.pdf`, {
    type: 'application/pdf',
  })
}

const pageIdentity = (info: PdfInfo) =>
  info.pages.map(({ width, height, rotate }) => ({ source: height - 200, page: width - 100, rotate }))

/**
 * 最小の暗号化 PDF。pdf-lib は暗号化を作れないので手で書く。
 * 中身は暗号化していないが、トレーラーに /Encrypt があれば暗号化された PDF として扱われる。
 */
function encryptedPdf(): File {
  const text = [
    '%PDF-1.4',
    '1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj',
    '2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj',
    '3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >> endobj',
    '4 0 obj << /Filter /Standard /V 1 /R 2 /O (0123456789abcdef0123456789abcdef) /U (0123456789abcdef0123456789abcdef) /P -4 >> endobj',
    'trailer << /Size 5 /Root 1 0 R /Encrypt 4 0 R >>',
    '%%EOF',
  ].join('\n')
  return new File([text], 'locked.pdf', { type: 'application/pdf' })
}

describe('probePdf', () => {
  test('ページ数・大きさ・回転・タイトルを読む', async () => {
    const file = await makePdf(0, 3, { title: 'Hello', rotations: [0, 90, 0] })
    const info = await probePdf(file)
    expect(info.pageCount).toBe(3)
    expect(info.title).toBe('Hello')
    expect(info.encrypted).toBe(false)
    expect(pageIdentity(info)).toEqual([
      { source: 0, page: 0, rotate: 0 },
      { source: 0, page: 1, rotate: 90 },
      { source: 0, page: 2, rotate: 0 },
    ])
  })

  test('暗号化された PDF はページ数まで読み、encrypted を立てる', async () => {
    const info = await probePdf(encryptedPdf())
    expect(info.encrypted).toBe(true)
    expect(info.pageCount).toBe(1)
    expect(info.title).toBeUndefined()
  })

  test('PDF でないものは invalid で失敗する', async () => {
    const error = await probePdf(new File(['hello'], 'x.pdf')).catch((caught) => caught)
    expect(isPdfError(error, 'invalid')).toBe(true)
  })
})

const edit: fc.Arbitrary<PdfEdit> = fc.oneof(
  fc.record({
    type: fc.constant('move' as const),
    indices: fc.array(fc.nat(8), { maxLength: 3 }),
    to: fc.nat(8),
  }),
  fc.record({ type: fc.constant('remove' as const), indices: fc.array(fc.nat(8), { maxLength: 2 }) }),
  fc.record({
    type: fc.constant('rotate' as const),
    indices: fc.array(fc.nat(8), { maxLength: 3 }),
    by: fc.constantFrom(90, 180, 270, -90 as const),
  }),
  fc.record({ type: fc.constant('appendSource' as const), source: fc.nat(2) })
)

describe('renderPdf', () => {
  test('書き出した PDF はレシピどおりのページを、元の回転にレシピの回転を足して並べる', async () => {
    // 元から回っているページも混ぜて、回転が足し算になることを確かめる
    const files = await Promise.all([
      makePdf(0, 3, { rotations: [0, 90, 0] }),
      makePdf(1, 2, { rotations: [270, 0] }),
      makePdf(2, 1),
    ])
    const infos = await Promise.all(files.map(probePdf))
    await fc.assert(
      fc.asyncProperty(fc.array(edit, { maxLength: 8 }), async (edits) => {
        const recipe = edits.reduce(
          (current, next) => applyPdfEdit(current, next, infos),
          createPdfRecipe(infos)
        )
        fc.pre(recipe.pages.length > 0)
        const rendered = await renderPdf(files, recipe)
        expect(rendered.blob.type).toBe('application/pdf')
        const output = await probePdf(rendered.blob)
        expect(pageIdentity(output)).toEqual(
          recipe.pages.map((ref) => ({
            source: ref.source,
            page: ref.page,
            rotate: normalizeRotation(infos[ref.source].pages[ref.page].rotate + ref.rotate),
          }))
        )
      }),
      { numRuns: 30 }
    )
  })

  test('同じページを違う回転で 2 回使える', async () => {
    const files = [await makePdf(0, 1)]
    const recipe: PdfRecipe = {
      pages: [
        { source: 0, page: 0, rotate: 0 },
        { source: 0, page: 0, rotate: 90 },
      ],
    }
    const output = await probePdf((await renderPdf(files, recipe)).blob)
    expect(output.pages.map((page) => page.rotate)).toEqual([0, 90])
  })

  test('使わない入力は読まないので、壊れていても書き出せる', async () => {
    const files = [await makePdf(0, 2), new File(['broken'], 'broken.pdf')]
    const rendered = await renderPdf(files, createPdfRecipe([{ pageCount: 2 }]))
    expect((await probePdf(rendered.blob)).pageCount).toBe(2)
    expect(rendered.filename).toBe('source0-edited.pdf')
  })

  test('複数の入力を使うと結合の名前を付け、先頭のページの入力のタイトルを引き継ぐ', async () => {
    const files = [await makePdf(0, 1, { title: 'First' }), await makePdf(1, 1, { title: 'Second' })]
    const rendered = await renderPdf(files, createPdfRecipe([{ pageCount: 1 }, { pageCount: 1 }]))
    expect(rendered.filename).toBe('source0-merged.pdf')
    expect((await probePdf(rendered.blob)).title).toBe('First')
  })

  test('進み具合は 0〜1 で増えていき、最後は 1', async () => {
    const files = [await makePdf(0, 2), await makePdf(1, 2)]
    const progress: number[] = []
    await renderPdf(files, createPdfRecipe([{ pageCount: 2 }, { pageCount: 2 }]), {
      onProgress: (value) => progress.push(value),
    })
    expect(progress.at(-1)).toBe(1)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
    expect(progress.every((value) => value >= 0 && value <= 1)).toBe(true)
  })

  test('暗号化された入力は encrypted で失敗する', async () => {
    const error = await renderPdf([encryptedPdf()], createPdfRecipe([{ pageCount: 1 }])).catch(
      (caught) => caught
    )
    expect(isPdfError(error, 'encrypted')).toBe(true)
  })

  test('ページがない・入力にないページを指すレシピは書き出さない', async () => {
    const files = [await makePdf(0, 1)]
    const empty = await renderPdf(files, { pages: [] }).catch((caught) => caught)
    expect(isPdfError(empty, 'empty')).toBe(true)
    const outside = await renderPdf(files, { pages: [{ source: 0, page: 1, rotate: 0 }] }).catch(
      (caught) => caught
    )
    expect(isPdfError(outside, 'pageOutOfRange')).toBe(true)
    const missing = await renderPdf(files, { pages: [{ source: 1, page: 0, rotate: 0 }] }).catch(
      (caught) => caught
    )
    expect(isPdfError(missing, 'pageOutOfRange')).toBe(true)
  })

  test('中断すると AbortError で止まる', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await renderPdf([await makePdf(0, 1)], createPdfRecipe([{ pageCount: 1 }]), {
      signal: controller.signal,
    }).catch((caught) => caught)
    expect(error).toBeInstanceOf(DOMException)
    expect((error as DOMException).name).toBe('AbortError')
  })
})

describe('splitPdf', () => {
  test('範囲ごとに 1 ファイルずつ、その範囲のページを順に入れる', async () => {
    const file = await makePdf(0, 5)
    const files = await splitPdf(file, [
      { start: 1, end: 2 },
      { start: 4, end: 4 },
      { start: 2, end: 5 },
    ])
    expect(files.map((rendered) => rendered.filename)).toEqual([
      'source0-p1-2.pdf',
      'source0-p4.pdf',
      'source0-p2-5.pdf',
    ])
    const pages = await Promise.all(
      files.map(async (rendered) => pageIdentity(await probePdf(rendered.blob)).map((ref) => ref.page))
    )
    expect(pages).toEqual([[0, 1], [3], [1, 2, 3, 4]])
  })

  test('ページ数を超える範囲・空の範囲は失敗する', async () => {
    const file = await makePdf(0, 2)
    expect(isPdfError(await splitPdf(file, [{ start: 2, end: 3 }]).catch((e) => e), 'pageOutOfRange')).toBe(
      true
    )
    expect(isPdfError(await splitPdf(file, []).catch((e) => e), 'empty')).toBe(true)
  })
})

import { PDFDocument, degrees, type PDFPage } from 'pdf-lib'
import type { RenderOptions, RenderedFile } from '../types'
import { throwIfAborted } from '../../utils/abort'
import { PdfError } from './errors'
import { fileStem, loadEditablePdf, nameOf, saveAsBlob } from './document'
import { isPdfRecipeValid, normalizeRotation, type PdfPageRef, type PdfRecipe } from './recipe'
import { pageRangesToIndices, type PageRange } from './pageRanges'

// 保存（save）は 1 回で終わり途中経過を取れないので、進み具合の最後の 1 割をそこに当てる
const COPY_SHARE = 0.9

/**
 * ページの列から新しい文書を組む。
 * copyPages は呼ぶたびにフォントや画像を写し直すので、入力ごとに 1 回だけ呼んで使い回させる。
 * 同じページを何度使っても 1 枚ずつ別のページになるので、回転の違う複製も作れる。
 */
async function assemble(
  documents: readonly PDFDocument[],
  pages: readonly PdfPageRef[],
  options: RenderOptions
): Promise<PDFDocument> {
  const output = await PDFDocument.create()
  const copies = new Array<PDFPage>(pages.length)
  const sources = [...new Set(pages.map((ref) => ref.source))]
  for (const [done, source] of sources.entries()) {
    throwIfAborted(options.signal)
    const positions = pages.flatMap((ref, position) => (ref.source === source ? [position] : []))
    const copied = await output.copyPages(
      documents[source],
      positions.map((position) => pages[position].page)
    )
    positions.forEach((position, index) => (copies[position] = copied[index]))
    options.onProgress?.(((done + 1) / sources.length) * COPY_SHARE)
  }
  for (const [position, page] of copies.entries()) {
    // 元のページの回転に足し込む。元が 90 のページを「回転なし」に見せるには 270 を足す
    page.setRotation(degrees(normalizeRotation(page.getRotation().angle + pages[position].rotate)))
    output.addPage(page)
  }
  return output
}

function copyMetadata(from: PDFDocument, to: PDFDocument) {
  const title = from.getTitle()
  const author = from.getAuthor()
  if (title) to.setTitle(title)
  if (author) to.setAuthor(author)
}

/**
 * レシピどおりに 1 つの PDF を書き出す。sources はレシピの source が指す入力の配列。
 * 使われない入力は読まない。暗号化された入力を使っていれば PdfError('encrypted')。
 */
export async function renderPdf(
  sources: readonly Blob[],
  recipe: PdfRecipe,
  options: RenderOptions = {}
): Promise<RenderedFile> {
  if (recipe.pages.length === 0) throw new PdfError('empty', '出力するページがありません')

  // ページ数を知るために、使う入力だけを先に読む
  const used = [...new Set(recipe.pages.map((page) => page.source))]
  if (used.some((source) => !sources[source])) {
    throw new PdfError('pageOutOfRange', 'レシピがない入力ファイルを指しています')
  }
  const documents: PDFDocument[] = []
  for (const source of used) {
    throwIfAborted(options.signal)
    documents[source] = await loadEditablePdf(sources[source])
  }
  const shapes = sources.map((_, source) => ({ pageCount: documents[source]?.getPageCount() ?? 0 }))
  if (!isPdfRecipeValid(recipe, shapes)) {
    throw new PdfError('pageOutOfRange', 'レシピが入力にないページを指しています')
  }

  const output = await assemble(documents, recipe.pages, options)
  const first = recipe.pages[0].source
  copyMetadata(documents[first], output)
  const blob = await saveAsBlob(output)
  options.onProgress?.(1)

  const stem = fileStem(nameOf(sources[first]))
  return { blob, filename: `${stem}-${used.length > 1 ? 'merged' : 'edited'}.pdf` }
}

/**
 * 1 つの PDF を範囲ごとに別のファイルへ分ける。範囲は 1 始まり（parsePageRanges の結果）。
 * ページ数を超える範囲は PdfError('pageOutOfRange')。
 */
export async function splitPdf(
  source: Blob,
  ranges: readonly PageRange[],
  options: RenderOptions = {}
): Promise<RenderedFile[]> {
  if (ranges.length === 0) throw new PdfError('empty', '分割する範囲がありません')
  const document = await loadEditablePdf(source)
  const pageCount = document.getPageCount()
  if (ranges.some(({ start, end }) => start < 1 || end > pageCount || start > end)) {
    throw new PdfError('pageOutOfRange', '範囲が PDF のページ数を超えています')
  }

  const stem = fileStem(nameOf(source))
  const files: RenderedFile[] = []
  for (const [index, range] of ranges.entries()) {
    const pages = pageRangesToIndices([range]).map((page) => ({ source: 0, page, rotate: 0 }) as const)
    const output = await assemble([document], pages, {
      signal: options.signal,
      onProgress: (progress) => options.onProgress?.((index + progress) / ranges.length),
    })
    copyMetadata(document, output)
    const label = range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`
    files.push({ blob: await saveAsBlob(output), filename: `${stem}-p${label}.pdf` })
    options.onProgress?.((index + 1) / ranges.length)
  }
  return files
}

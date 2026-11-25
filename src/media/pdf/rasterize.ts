/**
 * ページを画像にする書き出し（PDF → 画像、圧縮）。pdf.js で描くのでブラウザ専用。
 * 大きさ・名前・見込みの計算は raster.ts、画像を並べた PDF は rasterPdf.ts にあり、そちらはテストできる。
 */
import type { RenderOptions, RenderedFile } from '../types'
import { throwIfAborted } from '../../utils/abort'
import { PdfError } from './errors'
import { createRasterPdfWriter } from './rasterPdf'
import {
  compressImageSettings,
  extrapolateSize,
  IMAGE_MIME,
  samplePositions,
  type PdfCompressSettings,
  type PdfImageSettings,
} from './raster'
import type { PdfPageRef } from './recipe'
import { openPdfThumbnailer, type PdfThumbnailer, type RenderedPageImage } from './thumbnail'

/**
 * いくつかの入力（結合した PDF）を開いたままにして、レシピのページを描く。
 * 入力は使うときに開き、同じ入力は開き直さない。使い終わったら destroy する。
 */
export interface PdfRasterizer {
  /** 入力の配列と同じ位置に入れる。入力は増えるだけで、位置は変わらない */
  setSource(source: number, file: Blob): void
  renderPage(ref: PdfPageRef, settings: PdfImageSettings): Promise<RenderedPageImage>
  destroy(): Promise<void>
}

export function createPdfRasterizer(sources: readonly Blob[] = []): PdfRasterizer {
  const files = [...sources]
  const opened = new Map<number, Promise<PdfThumbnailer>>()
  const open = (source: number) => {
    let thumbnailer = opened.get(source)
    if (!thumbnailer) {
      const file = files[source]
      if (!file) throw new PdfError('pageOutOfRange', 'レシピがない入力ファイルを指しています')
      thumbnailer = openPdfThumbnailer(file)
      // 開けなかったものは覚えておかない（次に頼まれたときに開き直す）
      thumbnailer.catch(() => opened.delete(source))
      opened.set(source, thumbnailer)
    }
    return thumbnailer
  }
  return {
    setSource(source, file) {
      if (files[source] === file) return
      files[source] = file
      const previous = opened.get(source)
      opened.delete(source)
      void previous?.then((thumbnailer) => thumbnailer.destroy(), () => undefined)
    },
    async renderPage(ref, settings) {
      const thumbnailer = await open(ref.source)
      if (ref.page < 0 || ref.page >= thumbnailer.pageCount) {
        throw new PdfError('pageOutOfRange', 'レシピが入力にないページを指しています')
      }
      return thumbnailer.renderImage(ref.page, settings, ref.rotate)
    },
    async destroy() {
      const all = [...opened.values()]
      opened.clear()
      await Promise.all(all.map((pending) => pending.then((thumbnailer) => thumbnailer.destroy(), () => undefined)))
    },
  }
}

/**
 * ページを 1 枚ずつ画像ファイルにする。filenames は pages と同じ並び（raster.ts の pageImageNames で作る）。
 * 1 枚ずつ描いては手放すので、ページが多くても描きかけの canvas は 1 つで済む。
 */
export async function renderPagesToImages(
  rasterizer: PdfRasterizer,
  pages: readonly PdfPageRef[],
  settings: PdfImageSettings,
  filenames: readonly string[],
  options: RenderOptions = {}
): Promise<RenderedFile[]> {
  if (pages.length === 0) throw new PdfError('empty', '書き出すページがありません')
  const files: RenderedFile[] = []
  for (const [index, ref] of pages.entries()) {
    throwIfAborted(options.signal)
    const { blob } = await rasterizer.renderPage(ref, settings)
    files.push({ blob, filename: filenames[index] })
    options.onProgress?.((index + 1) / pages.length)
  }
  return files
}

/** 1 ページを画像のファイルにする（「このページを画像の画面で開く」） */
export async function renderPageToImageFile(
  rasterizer: PdfRasterizer,
  ref: PdfPageRef,
  settings: PdfImageSettings,
  filename: string
): Promise<File> {
  const { blob } = await rasterizer.renderPage(ref, settings)
  return new File([blob], filename, { type: IMAGE_MIME[settings.format] })
}

// 画像を描き終えてから保存（save）するまでの分。保存は 1 回で終わり途中経過を取れない
const RASTER_SHARE = 0.95

/**
 * ページを JPEG に描き直して、画像だけの PDF に組み直す（簡易の圧縮）。
 * 文字や図形も画像になるので、文字の選択・検索・リンクはなくなる。
 */
export async function compressPdf(
  rasterizer: PdfRasterizer,
  pages: readonly PdfPageRef[],
  settings: PdfCompressSettings,
  filename: string,
  options: RenderOptions & { metadata?: { title?: string; author?: string } } = {}
): Promise<RenderedFile> {
  if (pages.length === 0) throw new PdfError('empty', '出力するページがありません')
  const writer = await createRasterPdfWriter(options.metadata)
  const image = compressImageSettings(settings)
  for (const [index, ref] of pages.entries()) {
    throwIfAborted(options.signal)
    const rendered = await rasterizer.renderPage(ref, image)
    await writer.addPage(new Uint8Array(await rendered.blob.arrayBuffer()), rendered.pointWidth, rendered.pointHeight)
    options.onProgress?.(((index + 1) / pages.length) * RASTER_SHARE)
  }
  throwIfAborted(options.signal)
  const blob = await writer.save()
  options.onProgress?.(1)
  return { blob, filename }
}

/**
 * 書き出しの大きさを、何ページかだけ描いて見込む。asPdf なら圧縮した PDF、そうでなければ画像の合計。
 * 描いたページの画像の大きさ（px）も返す（先頭のものを見込みに出す）
 */
export async function estimateRasterOutput(
  rasterizer: PdfRasterizer,
  pages: readonly PdfPageRef[],
  settings: PdfImageSettings,
  asPdf: boolean,
  signal?: AbortSignal
): Promise<{ bytes: number; first: { width: number; height: number } | null }> {
  const sizes: number[] = []
  let first: { width: number; height: number } | null = null
  for (const position of samplePositions(pages.length)) {
    throwIfAborted(signal)
    const rendered = await rasterizer.renderPage(pages[position], settings)
    sizes.push(rendered.blob.size)
    first ??= { width: rendered.width, height: rendered.height }
  }
  return { bytes: extrapolateSize(sizes, pages.length, asPdf), first }
}

import { PDFDocument, type PDFImage } from 'pdf-lib'
import type { RenderOptions, RenderedFile } from '../types'
import { throwIfAborted } from '../../utils/abort'
import { PdfError } from './errors'
import { fileStem, saveAsBlob } from './document'

/** 用紙の大きさ（pt, 縦置き） */
export const PAPER_SIZES = {
  a4: { width: 595.28, height: 841.89 },
  letter: { width: 612, height: 792 },
} as const

export interface ImagesToPdfSettings {
  /** fit は画像の大きさ（1px = 1pt）に余白を足したページ。それ以外は用紙に収まるよう縮小・拡大する */
  pageSize: 'fit' | 'a4' | 'letter'
  /** 四辺の余白（pt） */
  margin: number
  /** 用紙の向き。auto は画像が横長なら横置きにする。fit では使わない */
  orientation?: 'auto' | 'portrait' | 'landscape'
}

export interface PlacedImage {
  page: { width: number; height: number }
  image: { x: number; y: number; width: number; height: number }
}

/**
 * 画像をページのどこにどの大きさで置くか。縦横比を保ったまま、余白の内側に中央寄せで収める。
 * 余白が大きすぎて内側がなくなるときは、画像が消えないよう余白を詰める。
 */
export function placeImage(
  imageSize: { width: number; height: number },
  settings: ImagesToPdfSettings
): PlacedImage {
  const margin = Math.max(0, settings.margin)
  if (settings.pageSize === 'fit') {
    return {
      page: { width: imageSize.width + margin * 2, height: imageSize.height + margin * 2 },
      image: { x: margin, y: margin, ...imageSize },
    }
  }
  const paper = PAPER_SIZES[settings.pageSize]
  const orientation = settings.orientation ?? 'auto'
  const landscape =
    orientation === 'landscape' || (orientation === 'auto' && imageSize.width > imageSize.height)
  const page = landscape ? { width: paper.height, height: paper.width } : { ...paper }
  const inset = Math.min(margin, page.width / 2 - 1, page.height / 2 - 1)
  const scale = Math.min(
    (page.width - inset * 2) / imageSize.width,
    (page.height - inset * 2) / imageSize.height
  )
  const width = imageSize.width * scale
  const height = imageSize.height * scale
  return {
    page,
    image: { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height },
  }
}

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((byte, index) => bytes[index] === byte)

/** MIME 型は拡張子から推測されて当てにならないことがあるので、先頭のバイトで見分ける */
function sniff(bytes: Uint8Array): 'jpeg' | 'png' | 'other' {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png'
  return 'other'
}

/**
 * JPEG・PNG 以外（WebP・GIF・AVIF など）はブラウザで PNG に描き直してから埋め込む。
 * ブラウザ専用で、node のテストでは通らない。
 */
async function rasterizeToPng(file: Blob): Promise<Uint8Array> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas !== 'function') {
    throw new PdfError('unsupportedImage', 'この画像は PDF に埋め込めません')
  }
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch (cause) {
    throw new PdfError('unsupportedImage', 'この画像は読み込めません', { cause })
  }
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    const png = await canvas.convertToBlob({ type: 'image/png' })
    return new Uint8Array(await png.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

async function embed(document: PDFDocument, file: Blob): Promise<PDFImage> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const kind = sniff(bytes)
  try {
    // JPEG はそのまま埋め込めるので再圧縮で画質を落とさずに済む
    if (kind === 'jpeg') return await document.embedJpg(bytes)
    return await document.embedPng(kind === 'png' ? bytes : await rasterizeToPng(file))
  } catch (cause) {
    if (cause instanceof PdfError) throw cause
    throw new PdfError('unsupportedImage', 'この画像は PDF に埋め込めません', { cause })
  }
}

/** 画像 1 枚を 1 ページにして、渡された順に並べた PDF を作る */
export async function imagesToPdf(
  files: readonly Blob[],
  settings: ImagesToPdfSettings,
  options: RenderOptions = {}
): Promise<RenderedFile> {
  if (files.length === 0) throw new PdfError('empty', '画像がありません')
  const document = await PDFDocument.create()
  for (const [index, file] of files.entries()) {
    throwIfAborted(options.signal)
    const image = await embed(document, file)
    const placed = placeImage({ width: image.width, height: image.height }, settings)
    document.addPage([placed.page.width, placed.page.height]).drawImage(image, placed.image)
    options.onProgress?.(((index + 1) / files.length) * 0.9)
  }
  const blob = await saveAsBlob(document)
  options.onProgress?.(1)
  const first = files[0]
  return { blob, filename: `${fileStem(first instanceof File ? first.name : 'images')}.pdf` }
}

/**
 * pdf.js によるページのサムネイル。ブラウザ専用で、node のテストからは読み込まない。
 *
 * オフラインで動かすため、ワーカーも CMap も wasm もビルドに同梱したファイルから読む
 * （CDN には取りに行かない）。同梱したファイルはビルドの出力なので Service Worker が事前キャッシュする。
 * pdf.js 本体は大きいので、サムネイルを初めて描くときまで読み込まない。
 */
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { PdfError } from './errors'
import { normalizeRotation } from './recipe'
import { encoderQuality, IMAGE_MIME, rasterSize, type PdfImageSettings } from './raster'

// 日本語などの PDF は定義済みの CMap を参照することが多く、これがないと文字が描かれない。
// 小さいファイルが data URL として JS に埋め込まれると最初に読む JS が膨らむので、no-inline で必ずファイルにする
const cMapUrls = import.meta.glob('../../../node_modules/pdfjs-dist/cmaps/*.bcmap', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>
// JPEG 2000・JBIG2（スキャンした PDF に多い）と ICC プロファイルの復号に使う。
// フォームのスクリプト用（quickjs）は大きいうえサムネイルには要らないので入れない
const wasmUrls = import.meta.glob('../../../node_modules/pdfjs-dist/wasm/{openjpeg,jbig2,qcms_bg}.wasm', {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>

const byFilename = (urls: Record<string, string>) =>
  new Map(Object.entries(urls).map(([path, url]) => [path.slice(path.lastIndexOf('/') + 1), url]))

const bundled: Record<string, Map<string, string>> = {
  cMapUrl: byFilename(cMapUrls),
  wasmUrl: byFilename(wasmUrls),
}

/**
 * pdf.js は CMap などを「基準 URL + ファイル名」で取りに来るが、同梱したファイルは
 * ハッシュ付きの名前になるので、ファイル名から同梱先の URL を引く読み込み口に差し替える。
 * 標準フォントは同梱しない（ブラウザではシステムのフォントで代わりに描かれる）。
 */
class BundledDataFactory {
  async fetch({ kind, filename }: { kind: string; filename: string }): Promise<Uint8Array> {
    const url = bundled[kind]?.get(filename)
    if (!url) throw new Error(`${kind} ${filename} は同梱していません`)
    const response = await fetch(url)
    if (!response.ok) throw new Error(`${url} を読み込めません`)
    return new Uint8Array(await response.arrayBuffer())
  }
}

let pdfjs: Promise<typeof import('pdfjs-dist')> | undefined

function loadPdfjs() {
  pdfjs ??= import('pdfjs-dist').then((module) => {
    module.GlobalWorkerOptions.workerSrc = workerUrl
    return module
  })
  return pdfjs
}

export interface PdfThumbnailer {
  readonly pageCount: number
  /**
   * 0 始まりの pageIndex のページを、長い辺が maxSize px に収まる画像にする。
   * 高精細な画面向けには呼び出し側で devicePixelRatio を掛けて渡す。
   * rotate は元のページの回転に足す角度（レシピの rotate をそのまま渡せる）
   */
  render(pageIndex: number, maxSize: number, rotate?: number): Promise<Blob>
  /**
   * 書き出し用に、決めた解像度・形式で描く。ページの見た目の大きさ（pt, 回転後）も返すので、
   * 画像を並べ直した PDF のページの大きさに使える。canvas の上限を超える大きさは縮めて描く
   */
  renderImage(pageIndex: number, settings: PdfImageSettings, rotate?: number): Promise<RenderedPageImage>
  /** ワーカー側の文書を手放す。使い終わったら必ず呼ぶ */
  destroy(): Promise<void>
}

export interface RenderedPageImage {
  blob: Blob
  /** 画像の大きさ（px） */
  width: number
  height: number
  /** ページの見た目の大きさ（pt, 回転後） */
  pointWidth: number
  pointHeight: number
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('ページを画像にできません'))), type, quality)
  )

/** 1 つの PDF を開いたままにして、ページを順に描く。一覧のサムネイルはこちらを使う */
export async function openPdfThumbnailer(file: Blob): Promise<PdfThumbnailer> {
  const { getDocument } = await loadPdfjs()
  const task = getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    BinaryDataFactory: BundledDataFactory,
    useWorkerFetch: false,
  })
  let document: PDFDocumentProxy
  try {
    document = await task.promise
  } catch (cause) {
    await task.destroy()
    if (cause instanceof Error && cause.name === 'PasswordException') {
      throw new PdfError('encrypted', 'パスワードで保護された PDF は表示できません', { cause })
    }
    throw new PdfError('invalid', 'PDF として読めません', { cause })
  }

  const renderImage = async (
    pageIndex: number,
    settings: PdfImageSettings,
    rotate = 0
  ): Promise<RenderedPageImage> => {
    const page = await document.getPage(pageIndex + 1)
    const canvas = globalThis.document.createElement('canvas')
    try {
      const rotation = normalizeRotation(page.rotate + rotate)
      const natural = page.getViewport({ scale: 1, rotation })
      const size = rasterSize(natural, settings.resolution)
      const viewport = page.getViewport({ scale: size.scale, rotation })
      canvas.width = size.width
      canvas.height = size.height
      // 背景は pdf.js が白で塗る（JPEG に透明はなく、PNG でも紙の白のほうが自然）
      await page.render({ canvas, viewport }).promise
      const blob = await toBlob(canvas, IMAGE_MIME[settings.format], encoderQuality(settings.quality))
      return { blob, width: size.width, height: size.height, pointWidth: natural.width, pointHeight: natural.height }
    } finally {
      // Safari は使い終えた canvas の画素をすぐには手放さないので、大きさを 0 にして返す
      canvas.width = 0
      canvas.height = 0
      page.cleanup()
    }
  }

  return {
    pageCount: document.numPages,
    async render(pageIndex, maxSize, rotate = 0) {
      const settings = { format: 'jpeg', quality: 85, resolution: { kind: 'longEdge', pixels: maxSize } } as const
      return (await renderImage(pageIndex, settings, rotate)).blob
    },
    renderImage,
    destroy: () => task.destroy(),
  }
}

/** 1 ページだけ描く。何ページも描くなら openPdfThumbnailer で開いたまま使う */
export async function renderPageThumbnail(
  file: Blob,
  pageIndex: number,
  maxSize: number,
  rotate = 0
): Promise<Blob> {
  const thumbnailer = await openPdfThumbnailer(file)
  try {
    return await thumbnailer.render(pageIndex, maxSize, rotate)
  } finally {
    await thumbnailer.destroy()
  }
}

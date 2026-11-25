import { readPdfDocument } from './document'
import { normalizeRotation, type PdfRotation } from './recipe'

export interface PdfPageInfo {
  /** 回転を当てる前の CropBox の大きさ（pt） */
  readonly width: number
  readonly height: number
  /** 元のページに付いている回転 */
  readonly rotate: PdfRotation
}

export interface PdfInfo {
  readonly pageCount: number
  readonly pages: readonly PdfPageInfo[]
  /** 暗号化されているときは文字列も暗号化されていて読めないので、つねに undefined */
  readonly title?: string
  readonly author?: string
  /** true なら編集・書き出しはできない（renderPdf などは PdfError('encrypted') で失敗する） */
  readonly encrypted: boolean
}

/**
 * ページ数・ページの大きさ・タイトルなどを読む。
 * 暗号化された PDF でもページの木は平文なので、ページ数までは返して画面で事情を示せるようにする。
 * PDF として読めなければ PdfError('invalid')。
 */
export async function probePdf(file: Blob): Promise<PdfInfo> {
  const document = await readPdfDocument(file)
  const encrypted = document.isEncrypted
  const pages = document.getPages().map((page): PdfPageInfo => {
    const { width, height } = page.getCropBox()
    return { width, height, rotate: normalizeRotation(page.getRotation().angle) }
  })
  return {
    pageCount: pages.length,
    pages,
    title: encrypted ? undefined : document.getTitle() || undefined,
    author: encrypted ? undefined : document.getAuthor() || undefined,
    encrypted,
  }
}

/** 回転を当てたあとの見た目の大きさ。サムネイルの枠を先に取るときに使う */
export function displayedPageSize(page: PdfPageInfo, extraRotate: number = 0) {
  const sideways = normalizeRotation(page.rotate + extraRotate) % 180 !== 0
  return sideways
    ? { width: page.height, height: page.width }
    : { width: page.width, height: page.height }
}

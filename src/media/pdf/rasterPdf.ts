import { PDFDocument } from 'pdf-lib'
import { saveAsBlob } from './document'
import { PdfError } from './errors'

/**
 * JPEG にしたページを 1 枚ずつ積んで PDF にする（圧縮で使う）。
 * 描き終えたページから順に埋め込めるよう、文書を開いたまま持つ。
 */
export interface RasterPdfWriter {
  /** width・height はページの見た目の大きさ（pt）。画像はページいっぱいに引き伸ばす */
  addPage(jpeg: Uint8Array, width: number, height: number): Promise<void>
  readonly pageCount: number
  save(): Promise<Blob>
}

export async function createRasterPdfWriter(metadata: { title?: string; author?: string } = {}): Promise<RasterPdfWriter> {
  const document = await PDFDocument.create()
  // 元のタイトル・作成者は残す。ページが画像になっても、何の文書かはわかるように
  if (metadata.title) document.setTitle(metadata.title)
  if (metadata.author) document.setAuthor(metadata.author)
  return {
    async addPage(jpeg, width, height) {
      let image
      try {
        image = await document.embedJpg(jpeg)
      } catch (cause) {
        throw new PdfError('invalid', 'ページの画像を PDF に埋め込めません', { cause })
      }
      // 回転は画像に焼き込み済みなので、ページ自体は回転なしで見た目の向きに作る
      document.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height })
    },
    get pageCount() {
      return document.getPageCount()
    },
    save: () => saveAsBlob(document),
  }
}

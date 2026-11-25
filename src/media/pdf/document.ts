import { PDFDocument } from 'pdf-lib'
import { PdfError } from './errors'

/** 拡張子を除いた名前。出力ファイル名の元にする */
export const fileStem = (name: string) => name.replace(/\.[^.]+$/, '') || 'document'

export const nameOf = (file: Blob) => (file instanceof File ? file.name : 'document.pdf')

/** 暗号化されていても読み込みだけは通す。暗号化の判定は呼び出し側で行う */
export async function readPdfDocument(file: Blob): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(await file.arrayBuffer(), {
      ignoreEncryption: true,
      updateMetadata: false,
    })
  } catch (cause) {
    throw new PdfError('invalid', `${nameOf(file)} を PDF として読めません`, { cause })
  }
}

/**
 * 編集のために読み込む。暗号化された PDF はここで弾く。
 * ignoreEncryption なしだと暗号化を別の例外で見分けることになり、
 * ありのまま使うと暗号化されたままの中身を写して壊れた PDF を作ってしまうため。
 */
export async function loadEditablePdf(file: Blob): Promise<PDFDocument> {
  const document = await readPdfDocument(file)
  if (document.isEncrypted) {
    throw new PdfError('encrypted', `${nameOf(file)} は暗号化されているため編集できません`)
  }
  return document
}

export async function saveAsBlob(document: PDFDocument): Promise<Blob> {
  const bytes = await document.save()
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' })
}

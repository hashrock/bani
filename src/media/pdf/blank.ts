import { PDFDocument } from 'pdf-lib'
import { saveAsBlob } from './document'
import { PAPER_SIZES } from './images'

/**
 * 白紙のページ。レシピは「入力の何ページ目か」しか持たないので、白紙も 1 ページだけの小さな PDF を
 * 入力の 1 つとして作り、そのページを指させる。並べ替え・回転・書き出し・サムネイル・作業の保存が
 * ほかの PDF と同じ道を通るので、白紙のためだけの分岐を持たずに済む。
 */

export type BlankPaper = keyof typeof PAPER_SIZES
export type BlankOrientation = 'portrait' | 'landscape'

export interface BlankPageKind {
  paper: BlankPaper
  orientation: BlankOrientation
}

export const BLANK_PAGE_KINDS: readonly BlankPageKind[] = (['a4', 'letter'] as const).flatMap((paper) =>
  (['portrait', 'landscape'] as const).map((orientation) => ({ paper, orientation }))
)

/** 白紙のページの大きさ（pt） */
export function blankPageSize({ paper, orientation }: BlankPageKind): { width: number; height: number } {
  const { width, height } = PAPER_SIZES[paper]
  return orientation === 'portrait' ? { width, height } : { width: height, height: width }
}

/** 白紙の入力のファイル名。作業を再開したとき、名前から白紙の入力だと見分けて使い回す */
export const blankPdfName = ({ paper, orientation }: BlankPageKind) => `blank-${paper}-${orientation}.pdf`

const BLANK_NAME = /^blank-(a4|letter)-(portrait|landscape)\.pdf$/

export function parseBlankPdfName(name: string): BlankPageKind | null {
  const match = BLANK_NAME.exec(name)
  return match ? { paper: match[1] as BlankPaper, orientation: match[2] as BlankOrientation } : null
}

/** 白紙 1 ページだけの PDF を作る */
export async function createBlankPdf(kind: BlankPageKind): Promise<File> {
  const document = await PDFDocument.create()
  const { width, height } = blankPageSize(kind)
  document.addPage([width, height])
  const blob = await saveAsBlob(document)
  return new File([blob], blankPdfName(kind), { type: 'application/pdf' })
}

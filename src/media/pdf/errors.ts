/**
 * PDF の処理で起きる失敗の種類。文言は呼び出し側（i18n）で code から決める。
 */
export type PdfErrorCode =
  /** 暗号化されている。pdf-lib は復号できず、そのまま写すと中身が壊れた PDF になる */
  | 'encrypted'
  /** PDF として読めない */
  | 'invalid'
  /** 出力するページがない */
  | 'empty'
  /** レシピが入力にないページを指している */
  | 'pageOutOfRange'
  /** PDF に埋め込めない画像 */
  | 'unsupportedImage'

export class PdfError extends Error {
  readonly code: PdfErrorCode

  constructor(code: PdfErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'PdfError'
    this.code = code
  }
}

export const isPdfError = (error: unknown, code?: PdfErrorCode): error is PdfError =>
  error instanceof PdfError && (code === undefined || error.code === code)

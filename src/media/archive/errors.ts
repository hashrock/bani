/**
 * 圧縮ファイルを扱えなかった理由。画面側は code で文言を出し分ける
 * （message は開発者向けの手がかり）。
 */
export type ArchiveErrorCode =
  /** 形式が分からない、または 7z・RAR など扱わない形式 */
  | 'unsupported-format'
  /** パスワード付き。解読はしないので、はっきり断る */
  | 'encrypted'
  /** ZIP の中身が deflate・無圧縮以外の方式（bzip2・LZMA など）で縮められている */
  | 'unsupported-method'
  /** 壊れている・途中で切れている・CRC が合わない */
  | 'corrupt'
  /** 指定したパスが圧縮ファイルの中にない、または作成時に元ファイルが渡されていない */
  | 'not-found'
  /** 作成時: ZIP64 を書かないので 4GB 以上・65535 個を超えるものは ZIP にできない（tar.gz を使う） */
  | 'too-large'

export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode
  /** 問題のあった中のファイル。圧縮ファイル全体の問題なら undefined */
  readonly path?: string
  /** unsupported-format のときに分かった形式（'7z' など） */
  readonly format?: string

  constructor(code: ArchiveErrorCode, message: string, detail: { path?: string; format?: string } = {}) {
    super(message)
    this.name = 'ArchiveError'
    this.code = code
    this.path = detail.path
    this.format = detail.format
  }
}

export function isArchiveError(error: unknown, code?: ArchiveErrorCode): error is ArchiveError {
  return error instanceof ArchiveError && (code === undefined || error.code === code)
}

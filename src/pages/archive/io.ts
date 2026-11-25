import { isArchiveError } from '../../media/archive'
import type { ArchiveMessages } from './messages'

/** 画面に出すエラーの文言。圧縮ファイルの問題は code で出し分け、それ以外はそのまま見せる */
export function describeError(error: unknown, m: ArchiveMessages): string {
  if (isArchiveError(error)) {
    if (error.code === 'unsupported-format' && error.format && error.format !== 'unknown') {
      return m.unsupportedNamed(error.format.toUpperCase())
    }
    return m.errors[error.code]
  }
  return m.failed(error instanceof Error ? error.message : String(error))
}

/** 圧縮ファイルを受け付ける accept（開き直すとき用） */
export const ARCHIVE_ACCEPT = '.zip,.tar,.gz,.tgz,.7z,.rar,application/zip,application/gzip,application/x-tar'

/** ドロップ・フォルダ選択で受け取ったもの。path はフォルダ込みの相対パス */
export interface AddedFile {
  file: File
  path: string
}

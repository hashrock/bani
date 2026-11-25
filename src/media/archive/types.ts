import type { NameEncoding } from './names'

/**
 * 中身を一覧・展開できる形式。7z・RAR は読み取りだけで、WASM（libarchive）を開いたときに読み込む
 */
export type ArchiveFormat = 'zip' | 'tar' | 'tar.gz' | 'gzip' | '7z' | 'rar'

/** 先頭のバイト列から分かる形式。扱わない形式も名前を返し、画面ではっきり断れるようにする */
export type DetectedFormat = ArchiveFormat | 'bzip2' | 'xz' | 'zstd' | 'unknown'

/** 中のファイル 1 つ（またはフォルダ 1 つ） */
export interface ArchiveEntry {
  /**
   * 無害化済みの相対パス（'/' 区切り、末尾の '/' なし）。圧縮ファイルの中で一意で、
   * 展開先のフォルダの外を指すことはない。展開の指定にもこれを使う
   */
  path: string
  /** 展開後の大きさ（バイト） */
  size: number
  /**
   * 圧縮後の大きさ（バイト）。tar.gz・7z・RAR は 1 つずつの値が取れない（まとめて縮めることがある）ので null。
   * 全体の圧縮率は ArchiveInfo の archiveSize と totalSize から出す
   */
  compressedSize: number | null
  isDirectory: boolean
  /** 更新日時。記録がなければ null */
  modified: Date | null
  /** パスワード付き。一覧には出すが、展開しようとすると ArchiveError('encrypted') */
  encrypted: boolean
  /** ファイル名をどの文字コードとして読んだか。Shift_JIS と判定したことを画面で示すのに使う */
  nameEncoding: NameEncoding
}

export interface ArchiveInfo {
  format: ArchiveFormat
  /** 圧縮ファイル内の並び順のまま */
  entries: ArchiveEntry[]
  /** 圧縮ファイルそのものの大きさ */
  archiveSize: number
  /** 中のファイルの展開後の大きさの合計 */
  totalSize: number
  /** パスワード付きのファイルが 1 つでもあるか */
  hasEncryptedEntries: boolean
}

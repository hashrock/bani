/**
 * 7z・RAR の読み取り。libarchive の WASM（libarchive.js 同梱のもの）を直接呼ぶ。
 * libarchive.js の高水準の API は Worker・comlink 込みで、暗号化の印をファイルごとに返さず、
 * 中断もできないので使わず、Emscripten のモジュールだけを借りて必要な関数を自分で包む。
 *
 * このファイルは Worker（libarchiveWorker.ts）の中でも、Worker のない node のテストでも同じように動く。
 * モジュールの読み込み方は呼び出し側が決め、ここには読み込み済みのモジュールを渡す。
 *
 * 制約:
 * - 圧縮ファイル全体を WASM のメモリに写して読む。WASM のメモリは 2GB までなので、大きさに上限を設ける
 * - 更新日時は libarchive.js が秒を公開していないので取れない（RAR5 だけ rar5.ts で補う）
 * - RAR5 のパスワード付きのファイルは同梱の libarchive が見分けられないので rar5.ts で補う
 */
import { ArchiveError } from './errors'
import { decodeEntryName, type NameEncoding } from './names'
import { isRar5, scanRar5, type Rar5FileInfo } from './rar5'

/** Emscripten のモジュールのうち、ここで使う部分 */
export interface LibarchiveModule {
  cwrap(name: string, returns: 'number' | 'string' | null, args: string[]): (...args: unknown[]) => unknown
  HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(pointer: number): void
}

/**
 * 扱える圧縮ファイルの大きさ。WASM のメモリ（2GB）に圧縮ファイルと展開中の 1 ファイルが同時に載るので、
 * 余裕を見て 1GB までにする
 */
export const LIBARCHIVE_MAX_BYTES = 1024 * 1024 * 1024

/** libarchive が返す種類（stat の st_mode の上位ビット） */
const TYPE_FILE = 0o100000
const TYPE_DIRECTORY = 0o040000

export interface LibarchiveEntry {
  /** libarchive が返す並び順の番号（リンクなど一覧に出さないものも数える）。展開の指定に使う */
  index: number
  name: string
  nameEncoding: NameEncoding
  isDirectory: boolean
  size: number
  modified: Date | null
  encrypted: boolean
}

function bind(module: LibarchiveModule) {
  const fn = <T>(name: string, returns: 'number' | 'string' | null, args: string[]) =>
    module.cwrap(name, returns, args) as (...args: unknown[]) => T
  return {
    open: fn<number>('archive_open', 'number', ['number', 'number', 'string', 'string']),
    close: fn<void>('archive_close', null, ['number']),
    next: fn<number>('get_next_entry', 'number', ['number']),
    error: fn<string | null>('archive_error_string', 'string', ['number']),
    size: fn<number>('archive_entry_size', 'number', ['number']),
    type: fn<number>('archive_entry_filetype', 'number', ['number']),
    pathUtf8: fn<number>('archive_entry_pathname_utf8', 'number', ['number']),
    path: fn<number>('archive_entry_pathname', 'number', ['number']),
    encrypted: fn<number>('archive_entry_is_encrypted', 'number', ['number']),
    readData: fn<number>('get_filedata', 'number', ['number', 'number']),
    skip: fn<number>('archive_read_data_skip', 'number', ['number']),
  }
}

/** 「暗号化されているので読めない」ことを示す libarchive の文言 */
const ENCRYPTION_MESSAGE = /encrypt|passphrase|password/i

function failure(message: string | null, path?: string): ArchiveError {
  const text = message || '圧縮ファイルを読めませんでした'
  if (ENCRYPTION_MESSAGE.test(text)) {
    return path === undefined
      ? new ArchiveError('encrypted', `パスワード付きの圧縮ファイルは開けません（${text}）`)
      : new ArchiveError('encrypted', `パスワード付きのファイルは展開できません: ${path}`, { path })
  }
  return new ArchiveError('corrupt', path === undefined ? text : `${text}: ${path}`, { path })
}

/** WASM のメモリにある NUL 終端の文字列をバイト列で読む（文字コードの判定はこちらでする） */
function cString(module: LibarchiveModule, pointer: number): Uint8Array | null {
  if (!pointer) return null
  const heap = module.HEAPU8
  let end = pointer
  while (end < heap.length && heap[end] !== 0) end++
  return heap.slice(pointer, end)
}

const SEVEN_ZIP_SIGNATURE = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]
const RAR_SIGNATURE = [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]
const startsWith = (bytes: Uint8Array, signature: readonly number[]) => signature.every((byte, i) => bytes[i] === byte)

/**
 * 末尾が欠けているのが先頭だけで分かるか。libarchive は途中で切れた 7z・RAR を
 * 「中身のない圧縮ファイル」として黙って返すことがあるので、空の一覧を本物と見分けるのに使う。
 * 7z は先頭 32 バイトに目録の位置と長さがあるので、それがファイルに収まっているかを見る。
 */
function looksTruncated(bytes: Uint8Array): boolean {
  if (startsWith(bytes, SEVEN_ZIP_SIGNATURE)) {
    if (bytes.length < 32) return true
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const uint64 = (at: number) => view.getUint32(at, true) + view.getUint32(at + 4, true) * 0x100000000
    return 32 + uint64(12) + uint64(20) > bytes.length
  }
  if (startsWith(bytes, RAR4_SIGNATURE)) return rar4Truncated(bytes)
  return false
}

const RAR4_SIGNATURE = [...RAR_SIGNATURE, 0x00]

/**
 * RAR4 のブロック（CRC 2・種類 1・フラグ 2・長さ 2・中身の長さ 4（あれば））をたどり、
 * どれかがファイルの外まで続いていれば途中で切れている
 */
function rar4Truncated(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let p = RAR4_SIGNATURE.length
  while (p < bytes.length) {
    if (p + 7 > bytes.length) return true
    const type = bytes[p + 2]
    const flags = view.getUint16(p + 3, true)
    const headerSize = view.getUint16(p + 5, true)
    if (headerSize < 7) return true
    // ファイルの見出し（0x74）とフラグ 0x8000 の付いたブロックは、見出しの後ろに中身が続く
    const hasData = type === 0x74 || (flags & 0x8000) !== 0
    if (hasData && p + 11 > bytes.length) return true
    const dataSize = hasData ? view.getUint32(p + 7, true) : 0
    p += headerSize + dataSize
    if (p > bytes.length) return true
    // 終わりの印（0x7b）より後ろは見ない（署名やコメントが付くことがある）
    if (type === 0x7b) return false
  }
  return false
}

const validDate = (date: Date | null) => (date && !Number.isNaN(date.getTime()) ? date : null)

/**
 * 1 つの圧縮ファイルを開いたまま、一覧と展開を何度でも行える読み手。
 * 使い終わったら close して WASM のメモリを返す。
 */
export class LibarchiveReader {
  private readonly module: LibarchiveModule
  private readonly fns: ReturnType<typeof bind>
  private pointer: number
  private readonly length: number
  private readonly truncated: boolean
  private readonly isRar: boolean
  /** RAR5 で libarchive の足りないところを補う情報。RAR5 以外では null */
  private readonly rar5: Map<string, Rar5FileInfo> | null

  constructor(module: LibarchiveModule, bytes: Uint8Array) {
    this.module = module
    if (bytes.length > LIBARCHIVE_MAX_BYTES) {
      throw new ArchiveError('too-large-to-open', '7z・RAR は 1GB までしか開けません')
    }
    this.fns = bind(module)
    const scan = isRar5(bytes) ? scanRar5(bytes) : null
    if (scan?.headerEncrypted) {
      throw new ArchiveError('encrypted', 'ファイル名まで暗号化された RAR は開けません')
    }
    this.rar5 = scan ? scan.files : null
    this.length = bytes.length
    this.truncated = looksTruncated(bytes)
    this.isRar = startsWith(bytes, RAR_SIGNATURE)
    this.pointer = module._malloc(Math.max(1, bytes.length))
    if (!this.pointer) throw new ArchiveError('too-large-to-open', '圧縮ファイルを読み込むメモリが足りません')
    module.HEAPU8.set(bytes, this.pointer)
  }

  /**
   * 頭から順に見出しをたどる。visit が true を返したものは中身を読んで onData に渡し、
   * それ以外は読み飛ばす。visit が 'stop' を返したらそこで終える。
   */
  private walk(
    visit: (entry: LibarchiveEntry, type: number) => boolean | 'stop',
    onData?: (entry: LibarchiveEntry, data: Uint8Array) => void
  ) {
    if (!this.pointer) throw new Error('閉じた圧縮ファイルは読めません')
    const { fns, module } = this
    // 毎回開き直すのは、libarchive が頭へ戻る手段を持たないため（写したバイト列はそのまま使い回す）
    const archive = fns.open(this.pointer, this.length, null, 'en_US.UTF-8')
    if (!archive) throw new ArchiveError('corrupt', '圧縮ファイルを開けませんでした')
    try {
      for (let index = 0; ; index++) {
        const header = fns.next(archive)
        if (!header) {
          // 終わりに達したときは文言が空。そうでなければ壊れている・暗号化されている
          const message = fns.error(archive)
          if (message) throw failure(message)
          // 何も読めずに終わったのは、空の圧縮ファイルか、途中で切れているか。
          // RAR は空のものを作れない（WinRAR は 1 つもファイルがないと作らない）ので、空なら壊れているとみなす
          if (this.truncated || (index === 0 && this.isRar)) {
            throw new ArchiveError('corrupt', '圧縮ファイルが途中で切れています')
          }
          return
        }
        const type = fns.type(header)
        const raw = cString(module, fns.pathUtf8(header)) ?? cString(module, fns.path(header)) ?? new Uint8Array(0)
        // UTF-8 として読めない名前（古い RAR の Shift_JIS など）は ZIP と同じ規則で判定する
        const decoded = decodeEntryName(raw, false)
        const isDirectory = type === TYPE_DIRECTORY
        const extra = this.rar5?.get(decoded.name.replace(/\/+$/, ''))
        const entry: LibarchiveEntry = {
          index,
          name: decoded.name,
          nameEncoding: decoded.encoding,
          isDirectory,
          size: isDirectory ? 0 : fns.size(header),
          modified: validDate(extra?.modified ?? null),
          encrypted: fns.encrypted(header) > 0 || (extra?.encrypted ?? false),
        }
        const decision = visit(entry, type)
        if (decision === 'stop') return
        if (decision && onData) {
          onData(entry, this.readData(archive, entry))
        } else if (fns.skip(archive) < 0) {
          throw failure(fns.error(archive), entry.name)
        }
      }
    } finally {
      fns.close(archive)
    }
  }

  private readData(archive: number, entry: LibarchiveEntry): Uint8Array {
    const { fns, module } = this
    if (entry.size === 0) {
      fns.skip(archive)
      return new Uint8Array(0)
    }
    const data = fns.readData(archive, entry.size)
    if (data <= 0) throw failure(fns.error(archive), entry.name)
    try {
      // メモリが伸びると HEAPU8 は作り直されるので、読むたびに取り直す
      return module.HEAPU8.slice(data, data + entry.size)
    } finally {
      module._free(data)
    }
  }

  /**
   * 中のファイルとフォルダの一覧。シンボリックリンクや特殊ファイルは、tar と同じく
   * ブラウザで再現できないので出さない（番号は数えるので、展開の指定はずれない）
   */
  list(): LibarchiveEntry[] {
    const entries: LibarchiveEntry[] = []
    this.walk((entry, type) => {
      if (type === TYPE_FILE || type === TYPE_DIRECTORY) entries.push(entry)
      return false
    })
    return entries
  }

  /** 番号で指定したファイルを展開する。全部読み終えたら残りはたどらない */
  extract(indices: ReadonlySet<number>, onData: (index: number, data: Uint8Array) => void): void {
    let remaining = indices.size
    if (remaining === 0) return
    this.walk(
      (entry, type) => {
        if (remaining === 0) return 'stop'
        return type === TYPE_FILE && indices.has(entry.index)
      },
      (entry, data) => {
        remaining--
        onData(entry.index, data)
      }
    )
  }

  close(): void {
    if (!this.pointer) return
    this.module._free(this.pointer)
    this.pointer = 0
  }
}

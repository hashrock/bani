import { Inflate } from 'fflate'
import { throwIfAborted } from '../../utils/abort'
import { createCrc32, crc32 } from './crc32'
import { ArchiveError } from './errors'
import { decodeEntryName, type NameEncoding } from './names'
import { readBytes } from './streams'

/**
 * ZIP の読み取り。fflate の unzip は名前を決め打ちで読み、暗号化の印も教えてくれないので、
 * 目録（セントラルディレクトリ）は自前で読み、中身の展開だけ fflate に任せる。
 * 目録はファイルの末尾にまとまっているので、中身を読まずに一覧が作れる。
 */

const EOCD_SIGNATURE = 0x06054b50
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50
const ZIP64_EOCD_SIGNATURE = 0x06064b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** 終端レコード 22 バイト + コメントの最大長 */
const MAX_EOCD_SEARCH = 22 + 0xffff

const METHOD_STORED = 0
const METHOD_DEFLATE = 8
/** WinZip の AES 暗号化。方式番号そのものが暗号化の印 */
const METHOD_AES = 99

export interface ZipRecord {
  name: string
  nameEncoding: NameEncoding
  isDirectory: boolean
  size: number
  compressedSize: number
  modified: Date | null
  encrypted: boolean
  method: number
  crc: number
  localHeaderOffset: number
}

const corrupt = (message: string) => new ArchiveError('corrupt', message)

function view(bytes: Uint8Array) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

/** 64 ビットの長さ。Number で正確に表せる 2^53 までで十分（それを超える ZIP は扱えない） */
const getUint64 = (data: DataView, offset: number) =>
  data.getUint32(offset, true) + data.getUint32(offset + 4, true) * 0x100000000

/** MS-DOS 形式の日時（ローカル時刻、2 秒刻み）。0 は記録なし */
function dosDateTime(date: number, time: number): Date | null {
  if (date === 0) return null
  return new Date(
    (date >> 9) + 1980,
    ((date >> 5) & 0x0f) - 1,
    date & 0x1f,
    time >> 11,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2
  )
}

interface Directory {
  offset: number
  size: number
  count: number
}

async function findDirectory(file: Blob): Promise<Directory> {
  const tailStart = Math.max(0, file.size - MAX_EOCD_SEARCH)
  const tail = await readBytes(file, tailStart, file.size)
  const data = view(tail)
  let eocd = -1
  // コメントの中に偶然同じ並びがあることもあるので、後ろから探して長さの合うものを取る
  for (let i = tail.length - 22; i >= 0; i--) {
    if (data.getUint32(i, true) === EOCD_SIGNATURE && i + 22 + data.getUint16(i + 20, true) <= tail.length) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw corrupt('ZIP の終端レコードが見つかりません')

  if (data.getUint16(eocd + 4, true) !== 0 || data.getUint16(eocd + 6, true) !== 0) {
    throw new ArchiveError('unsupported-format', '分割された ZIP には対応していません', { format: 'zip' })
  }
  const count = data.getUint16(eocd + 10, true)
  const size = data.getUint32(eocd + 12, true)
  const offset = data.getUint32(eocd + 16, true)
  if (count !== 0xffff && size !== 0xffffffff && offset !== 0xffffffff) return { offset, size, count }

  // 4GB・65535 件を超える ZIP は ZIP64 の終端レコードに本当の値がある
  const locatorAt = tailStart + eocd - 20
  const locator = view(await readBytes(file, locatorAt, locatorAt + 20))
  if (locator.byteLength < 20 || locator.getUint32(0, true) !== ZIP64_LOCATOR_SIGNATURE) {
    throw corrupt('ZIP64 の終端レコードが見つかりません')
  }
  const zip64At = getUint64(locator, 8)
  const zip64 = view(await readBytes(file, zip64At, zip64At + 56))
  if (zip64.byteLength < 56 || zip64.getUint32(0, true) !== ZIP64_EOCD_SIGNATURE) {
    throw corrupt('ZIP64 の終端レコードが壊れています')
  }
  return { count: getUint64(zip64, 32), size: getUint64(zip64, 40), offset: getUint64(zip64, 48) }
}

/** 目録を読んで、中のファイルを並び順のまま返す */
export async function readZipRecords(file: Blob): Promise<ZipRecord[]> {
  const directory = await findDirectory(file)
  if (directory.offset + directory.size > file.size) throw corrupt('ZIP の目録がファイルの外を指しています')
  const bytes = await readBytes(file, directory.offset, directory.offset + directory.size)
  const data = view(bytes)
  const records: ZipRecord[] = []
  let p = 0
  // 件数は ZIP64 で偽れるので、目録の長さで止める
  while (p + 46 <= bytes.length && records.length < directory.count) {
    if (data.getUint32(p, true) !== CENTRAL_SIGNATURE) throw corrupt('ZIP の目録が壊れています')
    const madeBy = data.getUint16(p + 4, true) >> 8
    const flags = data.getUint16(p + 8, true)
    const method = data.getUint16(p + 10, true)
    let modified = dosDateTime(data.getUint16(p + 14, true), data.getUint16(p + 12, true))
    const crc = data.getUint32(p + 16, true)
    let compressedSize = data.getUint32(p + 20, true)
    let size = data.getUint32(p + 24, true)
    const nameLength = data.getUint16(p + 28, true)
    const extraLength = data.getUint16(p + 30, true)
    const commentLength = data.getUint16(p + 32, true)
    const externalAttributes = data.getUint32(p + 38, true)
    let localHeaderOffset = data.getUint32(p + 42, true)
    const nameBytes = bytes.subarray(p + 46, p + 46 + nameLength)
    let { name, encoding } = decodeEntryName(nameBytes, (flags & 0x0800) !== 0)

    const extraEnd = p + 46 + nameLength + extraLength
    for (let e = p + 46 + nameLength; e + 4 <= extraEnd; ) {
      const id = data.getUint16(e, true)
      const length = data.getUint16(e + 2, true)
      const body = e + 4
      if (body + length > extraEnd) break
      if (id === 0x0001) {
        // ZIP64: 0xFFFFFFFF になっている欄だけが、この順で入っている
        let q = body
        const next = () => {
          const value = q + 8 <= body + length ? getUint64(data, q) : null
          q += 8
          return value
        }
        if (size === 0xffffffff) size = next() ?? size
        if (compressedSize === 0xffffffff) compressedSize = next() ?? compressedSize
        if (localHeaderOffset === 0xffffffff) localHeaderOffset = next() ?? localHeaderOffset
      } else if (id === 0x7075 && length >= 5 && bytes[body] === 1) {
        // Info-ZIP の Unicode パス。元の名前の CRC が合うときだけ信じる（名前を後から変えたツール対策）
        if (data.getUint32(body + 1, true) === crc32(nameBytes)) {
          name = new TextDecoder().decode(bytes.subarray(body + 5, body + length))
          encoding = 'utf-8'
        }
      } else if (id === 0x5455 && length >= 5 && (bytes[body] & 1) !== 0) {
        // 拡張タイムスタンプ（UTC の秒）。DOS 形式より正確なのでこちらを使う
        modified = new Date(data.getUint32(body + 1, true) * 1000)
      }
      e = body + length
    }

    const isDirectory = /[/\\]$/.test(name) || (madeBy === 0 && (externalAttributes & 0x10) !== 0)
    records.push({
      name,
      nameEncoding: encoding,
      isDirectory,
      size: isDirectory ? 0 : size,
      compressedSize: isDirectory ? 0 : compressedSize,
      modified,
      encrypted: (flags & 0x0001) !== 0 || method === METHOD_AES,
      method,
      crc,
      localHeaderOffset,
    })
    p = extraEnd + commentLength
  }
  return records
}

export function isSupportedZipMethod(method: number): boolean {
  return method === METHOD_STORED || method === METHOD_DEFLATE
}

/**
 * 中のファイル 1 つを取り出す。無圧縮ならコピーせず元ファイルの切り出しを返す。
 * deflate は少しずつ展開し、CRC と大きさを確かめる（壊れた ZIP を黙って通さない）。
 */
export async function extractZipRecord(
  file: Blob,
  record: ZipRecord,
  type: string,
  signal: AbortSignal | undefined,
  onCompressedBytes: (bytes: number) => void
): Promise<Blob> {
  const local = view(await readBytes(file, record.localHeaderOffset, record.localHeaderOffset + 30))
  if (local.byteLength < 30 || local.getUint32(0, true) !== LOCAL_SIGNATURE) {
    throw corrupt(`ZIP の中のファイルの位置が壊れています: ${record.name}`)
  }
  // ローカルヘッダーの拡張欄は目録と長さが違うことがあるので、ここで読み直す
  const dataStart = record.localHeaderOffset + 30 + local.getUint16(26, true) + local.getUint16(28, true)
  const dataEnd = dataStart + record.compressedSize
  if (dataEnd > file.size) throw corrupt(`ZIP が途中で切れています: ${record.name}`)
  const compressed = file.slice(dataStart, dataEnd)

  if (record.method === METHOD_STORED) {
    onCompressedBytes(record.compressedSize)
    return compressed.slice(0, compressed.size, type)
  }

  const parts: Uint8Array[] = []
  const crc = createCrc32()
  let size = 0
  const inflate = new Inflate((chunk) => {
    crc.update(chunk)
    size += chunk.length
    parts.push(chunk)
  })
  const reader = compressed.stream().getReader()
  try {
    for (;;) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      inflate.push(value)
      onCompressedBytes(value.length)
    }
    inflate.push(new Uint8Array(0), true)
  } catch (error) {
    void reader.cancel().catch(() => {})
    if (error instanceof DOMException) throw error
    throw corrupt(`展開できません: ${record.name}: ${(error as Error).message}`)
  }
  if (size !== record.size || crc.value() !== record.crc) {
    throw corrupt(`中身が壊れています（CRC が合いません）: ${record.name}`)
  }
  return new Blob(parts as BlobPart[], { type })
}

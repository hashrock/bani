import { ArchiveError } from './errors'
import { isTarHeader, parseOctal } from './format'
import { decodeEntryName, type NameEncoding } from './names'
import type { SequentialReader } from './streams'

/**
 * tar の読み書き。ustar・POSIX pax・GNU の長い名前を読み、書くときは
 * 長い名前と ASCII 以外の名前を pax で書く（今の tar はどれも読める）。
 */

const BLOCK = 512

export interface TarRecord {
  name: string
  nameEncoding: NameEncoding
  isDirectory: boolean
  size: number
  modified: Date | null
  /** 中身の始まり（tar の流れの先頭からのバイト数） */
  dataOffset: number
}

const padding = (size: number) => (BLOCK - (size % BLOCK)) % BLOCK

/** NUL までのバイト列 */
function untilNul(bytes: Uint8Array): Uint8Array {
  const end = bytes.indexOf(0)
  return end < 0 ? bytes : bytes.subarray(0, end)
}

/** 大きさの欄。8GB を超えるものは GNU の 256 進表記（先頭ビットが 1）で書かれる */
function parseSize(field: Uint8Array): number | null {
  if ((field[0] & 0x80) === 0) return parseOctal(field)
  let value = field[0] & 0x7f
  for (let i = 1; i < field.length; i++) value = value * 256 + field[i]
  return value
}

/** pax の拡張ヘッダー。「長さ 名前=値\n」の並びで、値は UTF-8 */
function parsePax(bytes: Uint8Array): Map<string, string> {
  const records = new Map<string, string>()
  const decoder = new TextDecoder()
  let p = 0
  while (p < bytes.length) {
    const space = bytes.indexOf(0x20, p)
    if (space < 0) break
    const length = parseInt(decoder.decode(bytes.subarray(p, space)), 10)
    if (!Number.isFinite(length) || length <= 0) break
    const record = decoder.decode(bytes.subarray(space + 1, p + length)).replace(/\n$/, '')
    const equals = record.indexOf('=')
    if (equals > 0) records.set(record.slice(0, equals), record.slice(equals + 1))
    p += length
  }
  return records
}

const ustarMagic = (block: Uint8Array) =>
  // "ustar\0" は POSIX。GNU は "ustar  " で、prefix 欄を別の用途に使っているので区別する
  block[257] === 0x75 && block[262] === 0 && String.fromCharCode(...block.subarray(257, 262)) === 'ustar'

/**
 * tar のヘッダーを順にたどる。中身はファイルごとに onEntry へ読み手ごと渡し、
 * onEntry が読まなかった分（と端数の埋め草）はここで読み飛ばす。
 */
export async function readTar(
  reader: SequentialReader,
  onEntry: (record: TarRecord, reader: SequentialReader) => Promise<void> | void
): Promise<void> {
  let longName: Uint8Array | null = null
  let pax = new Map<string, string>()
  for (;;) {
    const block = await reader.read(BLOCK)
    // 終端の 0 ブロックを書かずに切る tar もあるので、ちょうど終わったなら受け入れる
    if (block.length === 0) return
    if (block.length < BLOCK) throw new ArchiveError('corrupt', 'tar が途中で切れています')
    if (block.every((byte) => byte === 0)) return
    if (!isTarHeader(block)) throw new ArchiveError('corrupt', 'tar のヘッダーが壊れています')

    const type = String.fromCharCode(block[156])
    const headerSize = parseSize(block.subarray(124, 136))
    if (headerSize === null) throw new ArchiveError('corrupt', 'tar の大きさの欄が壊れています')
    const size = pax.has('size') ? Number(pax.get('size')) : headerSize
    const dataOffset = reader.position

    if (type === 'L' || type === 'x' || type === 'g' || type === 'K') {
      const body = await reader.read(headerSize)
      await reader.skip(padding(headerSize))
      if (type === 'L') longName = untilNul(body)
      // 全体に効く 'g' は名前を持たないので読み捨てる
      if (type === 'x') pax = parsePax(body)
      continue
    }

    // 通常ファイル（'0'・古い tar の NUL・連続ファイル '7'）とフォルダだけを扱う。
    // リンクや特殊ファイルはブラウザで再現できないので一覧に出さない
    const isFile = type === '0' || type === '\0' || type === '7'
    const isFolder = type === '5'
    if (isFile || isFolder) {
      let decoded: { name: string; encoding: NameEncoding }
      const paxPath = pax.get('path')
      if (paxPath !== undefined) decoded = { name: paxPath, encoding: 'utf-8' }
      else if (longName) decoded = decodeEntryName(longName, false)
      else {
        const name = untilNul(block.subarray(0, 100))
        const prefix = ustarMagic(block) ? untilNul(block.subarray(345, 500)) : new Uint8Array(0)
        const joined = prefix.length > 0 ? new Uint8Array([...prefix, 0x2f, ...name]) : name
        decoded = decodeEntryName(joined, false)
      }
      const mtime = pax.has('mtime') ? Number(pax.get('mtime')) : parseOctal(block.subarray(136, 148))
      const isDirectory = isFolder || decoded.name.endsWith('/')
      await onEntry(
        {
          name: decoded.name,
          nameEncoding: decoded.encoding,
          isDirectory,
          size: isDirectory ? 0 : size,
          modified: mtime === null || !Number.isFinite(mtime) ? null : new Date(mtime * 1000),
          dataOffset,
        },
        reader
      )
    }
    const consumed = reader.position - dataOffset
    await reader.skip(size + padding(size) - consumed)
    longName = null
    pax = new Map()
  }
}

/* ---- 書き出し ---- */

const encoder = new TextEncoder()

function writeString(block: Uint8Array, offset: number, length: number, value: string) {
  block.set(encoder.encode(value).subarray(0, length), offset)
}

function writeOctal(block: Uint8Array, offset: number, length: number, value: number) {
  writeString(block, offset, length - 1, Math.floor(value).toString(8).padStart(length - 1, '0'))
}

/** 8 進 11 桁（8GB 未満）に収まるか。超えるものは pax の size で書く */
const MAX_OCTAL_SIZE = 8 ** 11 - 1

function header(name: string, size: number, mtimeSeconds: number, type: string): Uint8Array {
  const block = new Uint8Array(BLOCK)
  writeString(block, 0, 100, name)
  writeOctal(block, 100, 8, type === '5' ? 0o755 : 0o644)
  writeOctal(block, 108, 8, 0)
  writeOctal(block, 116, 8, 0)
  writeOctal(block, 124, 12, Math.min(size, MAX_OCTAL_SIZE))
  writeOctal(block, 136, 12, Math.max(0, mtimeSeconds))
  block[156] = type.charCodeAt(0)
  writeString(block, 257, 6, 'ustar')
  writeString(block, 263, 2, '00')
  let sum = 0
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]
  writeString(block, 148, 7, sum.toString(8).padStart(6, '0') + '\0')
  return block
}

function paxRecord(key: string, value: string): string {
  // 長さには長さの桁そのものも含むので、桁が増えたら数え直す
  const body = ` ${key}=${value}\n`
  let length = encoder.encode(body).length
  while (String(length).length + encoder.encode(body).length !== length) {
    length = String(length).length + encoder.encode(body).length
  }
  return `${length}${body}`
}

/**
 * 1 ファイル分のヘッダー（必要なら pax の拡張ヘッダーを前に付ける）。
 * 中身のあとには paddingFor(size) バイトの 0 を書くこと。
 */
export function tarFileHeader(path: string, size: number, modified: Date): Uint8Array {
  const mtime = Math.floor(modified.getTime() / 1000)
  const needsPaxPath = encoder.encode(path).length > 100 || /[^\x20-\x7e]/.test(path)
  const needsPaxSize = size > MAX_OCTAL_SIZE
  const main = header(needsPaxPath ? asciiFallback(path) : path, size, mtime, '0')
  if (!needsPaxPath && !needsPaxSize) return main
  let records = ''
  if (needsPaxPath) records += paxRecord('path', path)
  if (needsPaxSize) records += paxRecord('size', String(size))
  const body = encoder.encode(records)
  const extended = header(`PaxHeader/${asciiFallback(path)}`.slice(0, 99), body.length, mtime, 'x')
  const out = new Uint8Array(BLOCK + body.length + padding(body.length) + BLOCK)
  out.set(extended, 0)
  out.set(body, BLOCK)
  out.set(main, BLOCK + body.length + padding(body.length))
  return out
}

/** pax を読めない古い tar 向けの代わりの名前。ASCII 以外を '_' にして 100 バイトに収める */
function asciiFallback(path: string): string {
  return path.replace(/[^\x20-\x7e]/g, '_').slice(-99)
}

export const tarPadding = padding

/** 終端の 0 ブロック 2 つ */
export const TAR_END = new Uint8Array(BLOCK * 2)

import type { RenderedFile, RenderOptions } from '../types'
import { throwIfAborted } from '../../utils/abort'
import { ArchiveError } from './errors'
import { SNIFF_LENGTH, detectArchiveFormat, isTarHeader } from './format'
import { guessMimeType } from './mime'
import { basename, createPathRegistry, decodeEntryName, sanitizePath, type NameEncoding } from './names'
import { blobReader, gunzipReader, readBytes } from './streams'
import { readTar } from './tar'
import type { ArchiveEntry, ArchiveFormat, ArchiveInfo } from './types'
import { extractZipRecord, isSupportedZipMethod, readZipRecords, type ZipRecord } from './zip'

/** 形式ごとの読み取りの結果に共通する、名前を付ける前の中身 */
interface RawEntry {
  name: string
  nameEncoding: NameEncoding
  isDirectory: boolean
  size: number
  compressedSize: number | null
  modified: Date | null
  encrypted: boolean
}

/**
 * 中のパスを無害化し、重なりを解いて一意にする。並び順だけで決まるので、
 * 一覧を作ったときと展開するときで同じ中身に同じパスが付く。
 * 名前が空になるフォルダ（"./" など）は null を返して一覧から落とす。
 */
function createEntryNamer() {
  const registry = createPathRegistry()
  return (raw: RawEntry): ArchiveEntry | null => {
    const sanitized = sanitizePath(raw.name)
    let path: string
    if (raw.isDirectory) {
      if (sanitized === '') return null
      path = registry.claimFolder(sanitized)
    } else {
      path = registry.claimFile(sanitized === '' ? 'untitled' : sanitized)
    }
    return {
      path,
      size: raw.size,
      compressedSize: raw.compressedSize,
      isDirectory: raw.isDirectory,
      modified: raw.modified,
      encrypted: raw.encrypted,
      nameEncoding: raw.nameEncoding,
    }
  }
}

type Located =
  | { format: 'zip'; items: { entry: ArchiveEntry; record: ZipRecord }[] }
  | { format: 'tar'; items: { entry: ArchiveEntry; dataOffset: number }[] }
  | { format: 'tar.gz' }
  | { format: 'gzip'; entry: ArchiveEntry }

const fileName = (file: Blob) => (file instanceof File ? file.name : '')

async function sniff(file: Blob, signal?: AbortSignal): Promise<ArchiveFormat> {
  const detected = detectArchiveFormat(await readBytes(file, 0, SNIFF_LENGTH))
  switch (detected) {
    case 'zip':
    case 'tar':
      return detected
    case 'gzip': {
      // gzip の中身が tar かどうかは展開した先頭のブロックを見て決める
      const reader = gunzipReader(file, signal)
      try {
        const block = await reader.read(512)
        return block.length === 512 && (isTarHeader(block) || block.every((byte) => byte === 0)) ? 'tar.gz' : 'gzip'
      } finally {
        reader.close()
      }
    }
    case 'unknown':
      throw new ArchiveError('unsupported-format', '圧縮ファイルの形式が分かりません', { format: 'unknown' })
    default:
      throw new ArchiveError('unsupported-format', `${detected} 形式には対応していません`, { format: detected })
  }
}

/** gzip 1 つだけのファイル。中身の名前はヘッダーにあればそれ、なければ圧縮ファイルの名前から */
async function gzipEntry(file: Blob): Promise<ArchiveEntry> {
  const head = await readBytes(file, 0, 64 * 1024)
  const flags = head[3]
  const mtime = new DataView(head.buffer, head.byteOffset).getUint32(4, true)
  let name: { name: string; encoding: NameEncoding } | null = null
  let p = 10
  if (flags & 0x04) p += 2 + (head[p] | (head[p + 1] << 8))
  if (flags & 0x08) {
    const end = head.indexOf(0, p)
    if (end > p) name = decodeEntryName(head.subarray(p, end), false)
  }
  const fallback = basename(fileName(file)).replace(/\.gz$/i, '')
  name ??= { name: fallback || 'file', encoding: 'utf-8' }
  const tail = await readBytes(file, file.size - 4, file.size)
  // 展開後の大きさは末尾に 2^32 の剰余で入っている。4GB を超える中身では正しくない
  const size = tail.length === 4 ? new DataView(tail.buffer, tail.byteOffset).getUint32(0, true) : 0
  const entry = createEntryNamer()({
    name: basename(sanitizePath(name.name)) || 'file',
    nameEncoding: name.encoding,
    isDirectory: false,
    size,
    compressedSize: file.size,
    modified: mtime === 0 ? null : new Date(mtime * 1000),
    encrypted: false,
  })
  return entry!
}

async function locate(file: Blob, format: ArchiveFormat, signal?: AbortSignal): Promise<Located> {
  if (format === 'zip') {
    const namer = createEntryNamer()
    const items: { entry: ArchiveEntry; record: ZipRecord }[] = []
    for (const record of await readZipRecords(file)) {
      const entry = namer({ ...record })
      if (entry) items.push({ entry, record })
    }
    return { format, items }
  }
  if (format === 'tar') {
    const namer = createEntryNamer()
    const items: { entry: ArchiveEntry; dataOffset: number }[] = []
    await readTar(blobReader(file, signal), (record) => {
      const entry = namer({ ...record, compressedSize: record.size, encrypted: false })
      if (entry) items.push({ entry, dataOffset: record.dataOffset })
    })
    return { format, items }
  }
  if (format === 'gzip') return { format, entry: await gzipEntry(file) }
  return { format }
}

/** tar.gz は先頭から展開しながら読むしかないので、一覧と展開を 1 回の通しで行う */
async function walkTarGz(
  file: Blob,
  options: RenderOptions,
  onEntry: (entry: ArchiveEntry, read: () => Promise<Uint8Array[]>) => Promise<void> | void
): Promise<void> {
  const namer = createEntryNamer()
  const reader = gunzipReader(file, options.signal, (bytes) => options.onProgress?.(Math.min(1, bytes / file.size)))
  try {
    await readTar(reader, async (record, tarReader) => {
      const entry = namer({ ...record, compressedSize: null, encrypted: false })
      if (!entry) return
      await onEntry(entry, async () => {
        const parts: Uint8Array[] = []
        // 展開側の配列を使い回されても困らないように写しを持つ
        await tarReader.readChunks(record.size, (chunk) => parts.push(chunk.slice()))
        return parts
      })
    })
  } finally {
    reader.close()
  }
}

function summarize(format: ArchiveFormat, file: Blob, entries: ArchiveEntry[]): ArchiveInfo {
  return {
    format,
    entries,
    archiveSize: file.size,
    totalSize: entries.reduce((sum, entry) => sum + entry.size, 0),
    hasEncryptedEntries: entries.some((entry) => entry.encrypted),
  }
}

/**
 * 圧縮ファイルの形式と中身の一覧を読む。ZIP と tar は中身を展開せずに読めるが、
 * tar.gz は全体を展開しないと一覧が分からないので、時間がかかる（options で中断・進み具合）。
 * 7z・RAR などは ArchiveError('unsupported-format') で、format に形式名を入れて断る。
 */
export async function probeArchive(file: Blob, options: RenderOptions = {}): Promise<ArchiveInfo> {
  const format = await sniff(file, options.signal)
  const located = await locate(file, format, options.signal)
  switch (located.format) {
    case 'zip':
    case 'tar':
      return summarize(format, file, located.items.map((item) => item.entry))
    case 'gzip':
      return summarize(format, file, [located.entry])
    case 'tar.gz': {
      const entries: ArchiveEntry[] = []
      await walkTarGz(file, options, (entry) => void entries.push(entry))
      options.onProgress?.(1)
      return summarize(format, file, entries)
    }
  }
}

/**
 * 展開する範囲。中のパスを指定でき、フォルダを指定すればその下を全部含める。
 * 一覧にないパスを指定したら、黙って減らさずに not-found で知らせる。
 */
function createSelection(paths: readonly string[] | 'all') {
  const wanted = paths === 'all' ? null : paths.map((path) => path.replace(/\/+$/, ''))
  const seen = new Set<string>()
  return {
    includes(entry: ArchiveEntry): boolean {
      if (wanted === null || wanted.includes('')) return !entry.isDirectory
      let hit = false
      for (const path of wanted) {
        if (entry.path === path || entry.path.startsWith(`${path}/`)) {
          seen.add(path)
          hit = true
        }
      }
      return hit && !entry.isDirectory
    },
    assertAllFound() {
      const missing = wanted?.find((path) => path !== '' && !seen.has(path))
      if (missing !== undefined) {
        throw new ArchiveError('not-found', `圧縮ファイルの中にありません: ${missing}`, { path: missing })
      }
    },
  }
}

function assertExtractable(entry: ArchiveEntry, record?: ZipRecord) {
  if (entry.encrypted) {
    throw new ArchiveError('encrypted', `パスワード付きのファイルは展開できません: ${entry.path}`, { path: entry.path })
  }
  if (record && !isSupportedZipMethod(record.method)) {
    throw new ArchiveError('unsupported-method', `この圧縮方式（${record.method}）には対応していません: ${entry.path}`, {
      path: entry.path,
    })
  }
}

interface Extracted {
  entry: ArchiveEntry
  blob: Blob
}

async function extract(file: Blob, paths: readonly string[] | 'all', options: RenderOptions): Promise<Extracted[]> {
  const { signal, onProgress } = options
  const format = await sniff(file, signal)
  const located = await locate(file, format, signal)
  const selection = createSelection(paths)
  const results: Extracted[] = []

  if (located.format === 'tar.gz') {
    await walkTarGz(file, options, async (entry, read) => {
      if (!selection.includes(entry)) return
      results.push({ entry, blob: new Blob((await read()) as BlobPart[], { type: guessMimeType(entry.path) }) })
    })
    selection.assertAllFound()
    onProgress?.(1)
    return results
  }

  if (located.format === 'gzip') {
    const { entry } = located
    if (!selection.includes(entry)) {
      selection.assertAllFound()
      return results
    }
    const reader = gunzipReader(file, signal, (bytes) => onProgress?.(Math.min(1, bytes / file.size)))
    const parts: Uint8Array[] = []
    try {
      await reader.readChunks(Number.MAX_SAFE_INTEGER, (chunk) => parts.push(chunk.slice()))
    } finally {
      reader.close()
    }
    onProgress?.(1)
    return [{ entry, blob: new Blob(parts as BlobPart[], { type: guessMimeType(entry.path) }) }]
  }

  // ZIP と素の tar は位置が分かっているので、選んだものだけを読む
  const chosen = (located.items as { entry: ArchiveEntry; record?: ZipRecord; dataOffset?: number }[]).filter(
    (item) => selection.includes(item.entry)
  )
  selection.assertAllFound()
  // 一部だけ展開してから断るより、始める前に断るほうが分かりやすい
  for (const item of chosen) assertExtractable(item.entry, item.record)

  const total = chosen.reduce((sum, item) => sum + (item.entry.compressedSize ?? item.entry.size), 0)
  let done = 0
  const advance = (bytes: number) => {
    done += bytes
    onProgress?.(total === 0 ? 1 : Math.min(1, done / total))
  }
  for (const item of chosen) {
    throwIfAborted(signal)
    const type = guessMimeType(item.entry.path)
    if (item.record) {
      results.push({ entry: item.entry, blob: await extractZipRecord(file, item.record, type, signal, advance) })
    } else {
      // tar の中身は元ファイルの切り出しそのものなので写さない
      const start = item.dataOffset ?? 0
      results.push({ entry: item.entry, blob: file.slice(start, start + item.entry.size, type) })
      advance(item.entry.size)
    }
  }
  onProgress?.(1)
  return results
}

/**
 * 中のファイルを展開する。'all' か中のパス（probeArchive の entry.path）の並びを渡す。
 * フォルダのパスを渡すとその下を全部展開する。返す filename はフォルダ込みの中のパス（'a/b.txt'）で、
 * フォルダに保存するときはそのまま相対パスとして使える。フォルダそのものは返さない。
 * パスワード付き・未対応の圧縮方式が含まれていれば、展開を始める前に ArchiveError で断る。
 */
export async function extractEntries(
  file: Blob,
  paths: readonly string[] | 'all',
  options: RenderOptions = {}
): Promise<RenderedFile[]> {
  const extracted = await extract(file, paths, options)
  return extracted.map(({ entry, blob }) => ({ blob, filename: entry.path }))
}

/**
 * 中のファイルを 1 つ、Bani のほかの画面でそのまま開ける File にして返す。
 * 名前はファイル名だけ（フォルダは落とす）、type は拡張子から推す。
 */
export async function extractEntry(file: Blob, path: string, options: RenderOptions = {}): Promise<File> {
  const extracted = await extract(file, [path], options)
  const hit = extracted.find(({ entry }) => entry.path === path)
  if (!hit) throw new ArchiveError('not-found', `ファイルではありません: ${path}`, { path })
  return new File([hit.blob], basename(path), {
    type: hit.blob.type,
    lastModified: hit.entry.modified?.getTime() ?? Date.now(),
  })
}

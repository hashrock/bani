import { deflateSync, gzipSync } from 'fflate'
import type { RenderedFile, RenderOptions } from '../types'
import { throwIfAborted } from '../../utils/abort'
import { createCrc32 } from './crc32'
import { ArchiveError } from './errors'
import { isAlreadyCompressed } from './mime'
import { sanitizeSegment } from './names'
import { applyArchiveEdit, createArchiveRecipe, type ArchiveRecipe, type CompressionLevel } from './recipe'
import { TAR_END, tarFileHeader, tarPadding } from './tar'

/**
 * 作成側。fflate の流し込み型の圧縮（Deflate・Gzip・ZipDeflate）は入力によって壊れたデータを出す
 * （0.8.2・0.8.3 で確認。一括の deflateSync と展開側は問題ない）ので使わない。
 * ZIP の入れ物は自前で組み、圧縮は小さいファイルなら deflateSync（レベル指定が効く）、
 * 大きいファイルはメモリに載せきらないようブラウザ組み込みの CompressionStream（レベルは既定のみ）で行う。
 */

/** 作るときに渡す、レシピの id → 元ファイル */
export type ArchiveSources = ReadonlyMap<string, Blob>

/** これより大きいものはメモリに載せず、CompressionStream で流しながら縮める */
export const IN_MEMORY_LIMIT = 64 * 1024 * 1024

/** ZIP64 は書かないので、1 つのファイル・全体とも 4GB 未満まで */
const ZIP32_LIMIT = 0xffffffff

function resolveSources(recipe: ArchiveRecipe, sources: ArchiveSources): Blob[] {
  return recipe.items.map((item) => {
    const blob = sources.get(item.id)
    if (!blob) throw new ArchiveError('not-found', `元ファイルが渡されていません: ${item.path}`, { path: item.path })
    return blob
  })
}

function archiveFileName(name: string, extension: string): string {
  const base = sanitizeSegment(name) || 'archive'
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`
}

function progressTracker(total: number, onProgress?: (progress: number) => void) {
  let done = 0
  return (bytes: number) => {
    done += bytes
    onProgress?.(total === 0 ? 1 : Math.min(1, done / total))
  }
}

/** 流れる量を数え、中断を確かめるだけの素通しの変換 */
function meter(signal: AbortSignal | undefined, onChunk: (chunk: Uint8Array<ArrayBuffer>) => void) {
  return new TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>({
    transform(chunk, controller) {
      throwIfAborted(signal)
      onChunk(chunk)
      controller.enqueue(chunk)
    },
  })
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<Blob> {
  const parts: Uint8Array[] = []
  const reader = stream.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value)
  }
  return new Blob(parts as BlobPart[])
}

/* ---- ZIP ---- */

interface Packed {
  method: 0 | 8
  crc: number
  data: Blob
}

/**
 * 1 ファイル分を縮める。縮めても小さくならなければ無圧縮に切り替える（展開側も速い）。
 * 無圧縮のときは元の Blob をそのまま出力の部品にするので、中身を写さない。
 */
async function pack(
  blob: Blob,
  level: CompressionLevel,
  stored: boolean,
  inMemoryLimit: number,
  signal: AbortSignal | undefined,
  onBytes: (bytes: number) => void
): Promise<Packed> {
  const crc = createCrc32()
  if (stored) {
    await collectCrc(blob, crc, signal, onBytes)
    return { method: 0, crc: crc.value(), data: blob }
  }
  if (blob.size <= inMemoryLimit) {
    throwIfAborted(signal)
    const raw = new Uint8Array(await blob.arrayBuffer())
    crc.update(raw)
    const compressed = deflateSync(raw, { level })
    onBytes(blob.size)
    return compressed.length < raw.length
      ? { method: 8, crc: crc.value(), data: new Blob([compressed]) }
      : { method: 0, crc: crc.value(), data: blob }
  }
  const compressed = await collect(
    blob
      .stream()
      .pipeThrough(
        meter(signal, (chunk) => {
          crc.update(chunk)
          onBytes(chunk.length)
        })
      )
      .pipeThrough(new CompressionStream('deflate-raw'))
  )
  return compressed.size < blob.size
    ? { method: 8, crc: crc.value(), data: compressed }
    : { method: 0, crc: crc.value(), data: blob }
}

async function collectCrc(
  blob: Blob,
  crc: ReturnType<typeof createCrc32>,
  signal: AbortSignal | undefined,
  onBytes: (bytes: number) => void
) {
  const reader = blob.stream().getReader()
  for (;;) {
    throwIfAborted(signal)
    const { done, value } = await reader.read()
    if (done) break
    crc.update(value)
    onBytes(value.length)
  }
}

/** MS-DOS 形式の日時（ローカル時刻、2 秒刻み）。1980〜2107 年に寄せる */
function dosDateTime(ms: number): { date: number; time: number } {
  const min = new Date(1980, 0, 1).getTime()
  const max = new Date(2107, 11, 31, 23, 59, 58).getTime()
  const d = new Date(Math.min(max, Math.max(min, Number.isFinite(ms) ? ms : Date.now())))
  return {
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  }
}

const encoder = new TextEncoder()

/** 拡張タイムスタンプ（UTC の秒）。DOS 形式は時差と 2 秒刻みで日時がずれるので添える */
function timestampExtra(ms: number): Uint8Array {
  const extra = new Uint8Array(9)
  const view = new DataView(extra.buffer)
  view.setUint16(0, 0x5455, true)
  view.setUint16(2, 5, true)
  extra[4] = 1
  view.setUint32(5, Math.max(0, Math.min(0xffffffff, Math.floor(ms / 1000))), true)
  return extra
}

/** テストで流し込みの経路も通せるように、上限を差し替えられる中身 */
export async function writeZip(
  recipe: ArchiveRecipe,
  sources: ArchiveSources,
  options: RenderOptions,
  inMemoryLimit: number
): Promise<RenderedFile> {
  const { signal, onProgress } = options
  const blobs = resolveSources(recipe, sources)
  const advance = progressTracker(
    blobs.reduce((sum, blob) => sum + blob.size, 0),
    onProgress
  )
  const parts: BlobPart[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const [i, item] of recipe.items.entries()) {
    throwIfAborted(signal)
    const blob = blobs[i]
    if (blob.size >= ZIP32_LIMIT) {
      throw new ArchiveError('too-large', `4GB 以上のファイルは ZIP に入れられません: ${item.path}`, { path: item.path })
    }
    const stored = recipe.level === 0 || isAlreadyCompressed(item.path)
    const packed = await pack(blob, recipe.level, stored, inMemoryLimit, signal, advance)
    const name = encoder.encode(item.path)
    const extra = timestampExtra(item.lastModified)
    const { date, time } = dosDateTime(item.lastModified)

    // ローカルヘッダーと目録の共通部分（署名の直後から）。大きさが先に分かっているのでデータ記述子は使わない
    const common = (target: DataView, at: number) => {
      target.setUint16(at, 20, true) // 展開に要る版
      target.setUint16(at + 2, 0x0800, true) // 名前は UTF-8
      target.setUint16(at + 4, packed.method, true)
      target.setUint16(at + 6, time, true)
      target.setUint16(at + 8, date, true)
      target.setUint32(at + 10, packed.crc, true)
      target.setUint32(at + 14, packed.data.size, true)
      target.setUint32(at + 18, blob.size, true)
      target.setUint16(at + 22, name.length, true)
      target.setUint16(at + 24, extra.length, true)
    }

    const local = new Uint8Array(30 + name.length + extra.length)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034b50, true)
    common(localView, 4)
    local.set(name, 30)
    local.set(extra, 30 + name.length)

    const central = new Uint8Array(46 + name.length + extra.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014b50, true)
    // 作成元は UNIX 扱いにして、展開したファイルが macOS・Linux で読み書きできる権限（644）になるようにする
    centralView.setUint16(4, (3 << 8) | 20, true)
    common(centralView, 6)
    centralView.setUint32(38, (0o100644 << 16) >>> 0, true)
    centralView.setUint32(42, offset, true)
    central.set(name, 46)
    central.set(extra, 46 + name.length)

    parts.push(local as BlobPart, packed.data)
    centrals.push(central)
    offset += local.length + packed.data.size
    if (offset >= ZIP32_LIMIT) throw new ArchiveError('too-large', 'ZIP 全体が 4GB を超えます。tar.gz で作ってください')
  }

  const centralSize = centrals.reduce((sum, central) => sum + central.length, 0)
  if (recipe.items.length > 0xffff) throw new ArchiveError('too-large', 'ZIP に入れられるのは 65535 個までです')
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054b50, true)
  endView.setUint16(8, recipe.items.length, true)
  endView.setUint16(10, recipe.items.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)

  onProgress?.(1)
  return {
    blob: new Blob([...parts, ...(centrals as BlobPart[]), end as BlobPart], { type: 'application/zip' }),
    filename: archiveFileName(recipe.name, '.zip'),
  }
}

/**
 * レシピどおりに ZIP を作る。名前は UTF-8（印付き）で書くので、今の Windows・macOS でそのまま読める。
 * すでに縮められている形式（JPEG・MP4 など）と、縮めても小さくならないものは無圧縮で入れる。
 * 64MB を超えるファイルはブラウザ組み込みの圧縮で流しながら縮めるため、圧縮レベルの指定は効かない。
 * ZIP64 は書かないので、4GB 以上のファイル・全体は ArchiveError('too-large')（tar.gz を使う）。
 */
export function createZip(
  recipe: ArchiveRecipe,
  sources: ArchiveSources,
  options: RenderOptions = {}
): Promise<RenderedFile> {
  return writeZip(recipe, sources, options, IN_MEMORY_LIMIT)
}

/* ---- tar.gz ---- */

/** テストで流し込みの経路も通せるように、上限を差し替えられる中身 */
export async function writeTarGz(
  recipe: ArchiveRecipe,
  sources: ArchiveSources,
  options: RenderOptions,
  inMemoryLimit: number
): Promise<RenderedFile> {
  const { signal, onProgress } = options
  const blobs = resolveSources(recipe, sources)
  // Blob を組み合わせるだけなら元ファイルは写されないので、tar 全体をまず Blob として組む
  const parts: BlobPart[] = []
  for (const [i, item] of recipe.items.entries()) {
    const blob = blobs[i]
    parts.push(tarFileHeader(item.path, blob.size, new Date(item.lastModified)) as BlobPart, blob)
    parts.push(new Uint8Array(tarPadding(blob.size)))
  }
  parts.push(TAR_END)
  const tar = new Blob(parts)
  const advance = progressTracker(tar.size, onProgress)

  let blob: Blob
  if (tar.size <= inMemoryLimit) {
    throwIfAborted(signal)
    blob = new Blob([gzipSync(new Uint8Array(await tar.arrayBuffer()), { level: recipe.level })])
  } else {
    blob = await collect(
      tar
        .stream()
        .pipeThrough(meter(signal, (chunk) => advance(chunk.length)))
        .pipeThrough(new CompressionStream('gzip'))
    )
  }
  onProgress?.(1)
  return {
    blob: new Blob([blob], { type: 'application/gzip' }),
    filename: archiveFileName(recipe.name, '.tar.gz'),
  }
}

/**
 * レシピどおりに tar.gz を作る。4GB を超えるファイルをまとめるときや Mac・Linux 向けに。
 * 名前が長いもの・ASCII 以外のものは pax で書く。全体が 64MB を超えると圧縮レベルの指定は効かない。
 */
export function createTarGz(
  recipe: ArchiveRecipe,
  sources: ArchiveSources,
  options: RenderOptions = {}
): Promise<RenderedFile> {
  return writeTarGz(recipe, sources, options, IN_MEMORY_LIMIT)
}

/**
 * 一括変換の結果をまとめて 1 つの ZIP にする。filename はフォルダ込みでもよく、
 * 同じ名前が重なれば「名前 (2).拡張子」にずらす。
 */
export async function zipRenderedFiles(
  files: readonly RenderedFile[],
  name: string,
  options: RenderOptions = {}
): Promise<RenderedFile> {
  const now = Date.now()
  const recipe = applyArchiveEdit(createArchiveRecipe(name), {
    type: 'add',
    items: files.map((file, i) => ({ id: String(i), path: file.filename, size: file.blob.size, lastModified: now })),
  })
  const sources = new Map(files.map((file, i) => [String(i), file.blob]))
  return createZip(recipe, sources, options)
}

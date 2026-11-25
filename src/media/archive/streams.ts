import { Gunzip } from 'fflate'
import { throwIfAborted } from '../../utils/abort'
import { ArchiveError } from './errors'

/** Blob の一部をバイト列で読む。範囲外は短くなるだけで例外にはしない */
export async function readBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await blob.slice(start, end).arrayBuffer())
}

export function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/**
 * 先頭から順にしか進めない読み手。tar は素のファイルでも gzip の中でも同じ手順で読みたいので、
 * 読む・読み飛ばすの 2 つだけに絞って両方をこの形にそろえる。
 */
export interface SequentialReader {
  /** これまでに読んだ（読み飛ばした）バイト数 */
  readonly position: number
  /** length バイト読む。終わりに達したときだけ短くなる */
  read(length: number): Promise<Uint8Array>
  /** length バイトを細切れのまま渡す。大きなファイルを 1 つの配列にまとめずに済む */
  readChunks(length: number, onChunk: (chunk: Uint8Array) => void): Promise<number>
  skip(length: number): Promise<number>
  /** 途中でやめるときに元のストリームを閉じる */
  close(): void
}

/** 素の Blob の読み手。読み飛ばしは位置を進めるだけなので、中身を読まずにヘッダーだけ拾える */
export function blobReader(blob: Blob, signal?: AbortSignal): SequentialReader {
  let position = 0
  const advance = (length: number) => {
    const end = Math.min(blob.size, position + length)
    const start = position
    position = end
    return { start, end }
  }
  return {
    get position() {
      return position
    },
    async read(length) {
      throwIfAborted(signal)
      const { start, end } = advance(length)
      return readBytes(blob, start, end)
    },
    async readChunks(length, onChunk) {
      const { start, end } = advance(length)
      const reader = blob.slice(start, end).stream().getReader()
      for (;;) {
        throwIfAborted(signal)
        const { done, value } = await reader.read()
        if (done) break
        onChunk(value)
      }
      return end - start
    },
    async skip(length) {
      const { start, end } = advance(length)
      return end - start
    },
    close() {},
  }
}

/** 細切れで届くバイト列を、決まった長さずつ取り出せるようにする */
function queueReader(pull: () => Promise<Uint8Array | null>, close: () => void): SequentialReader {
  let current: Uint8Array = new Uint8Array(0)
  let offset = 0
  let position = 0
  let ended = false

  const take = async (max: number): Promise<Uint8Array | null> => {
    while (offset >= current.length) {
      if (ended) return null
      const next = await pull()
      if (next === null) {
        ended = true
        return null
      }
      current = next
      offset = 0
    }
    const length = Math.min(max, current.length - offset)
    const chunk = current.subarray(offset, offset + length)
    offset += length
    position += length
    return chunk
  }

  const readChunks = async (length: number, onChunk: (chunk: Uint8Array) => void) => {
    let left = length
    while (left > 0) {
      const chunk = await take(left)
      if (chunk === null) break
      onChunk(chunk)
      left -= chunk.length
    }
    return length - left
  }

  return {
    get position() {
      return position
    },
    async read(length) {
      const parts: Uint8Array[] = []
      await readChunks(length, (chunk) => parts.push(chunk))
      return parts.length === 1 ? parts[0] : concatBytes(parts)
    },
    readChunks,
    skip: (length) => readChunks(length, () => {}),
    close,
  }
}

/**
 * gzip を展開しながら読む読み手。tar.gz は全体が 1 つの圧縮の流れなので、
 * どこを読むにも先頭から展開していくしかない。
 * onConsumed には読み終えた圧縮側のバイト数を渡す（進み具合の目安）。
 */
export function gunzipReader(
  blob: Blob,
  signal?: AbortSignal,
  onConsumed?: (compressedBytes: number) => void
): SequentialReader {
  const source = blob.stream().getReader()
  const pending: Uint8Array[] = []
  let finished = false
  let consumed = 0
  const gunzip = new Gunzip((chunk) => {
    if (chunk.length > 0) pending.push(chunk)
  })

  const pull = async (): Promise<Uint8Array | null> => {
    while (pending.length === 0) {
      if (finished) return null
      throwIfAborted(signal)
      const { done, value } = await source.read()
      try {
        if (done) {
          finished = true
          gunzip.push(new Uint8Array(0), true)
        } else {
          consumed += value.length
          gunzip.push(value)
          onConsumed?.(consumed)
        }
      } catch (error) {
        throw new ArchiveError('corrupt', `gzip を展開できません: ${(error as Error).message}`)
      }
    }
    return pending.shift() ?? null
  }

  return queueReader(pull, () => void source.cancel().catch(() => {}))
}

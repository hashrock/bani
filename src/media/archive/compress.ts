/**
 * ZIP・tar.gz を作るときの、1 つの中身の圧縮と CRC。画面を止めないように Worker（compressWorker.ts）で行う。
 *
 * 測ると（Chrome、57MB の文章）、メモリに載せて縮める deflateSync・gzipSync は 2 秒あまり、
 * 縮めずに入れるファイル（JPEG など）の CRC も 11MB で 140ms ほど画面のスレッドを止めていた
 * （Blob の読み取りがすぐ返るので、読みながら数えても描画の順番が回ってこない）。
 * そこで「読む・数える・縮める」をまとめて Worker に渡し、進み具合（読んだバイト数）だけを受け取る。
 * 小さなものは Worker とのやりとりのほうが高くつくので、このスレッドで行う。
 * Worker のない node のテストでは、すべてこのスレッドで行う。
 */
import { deflateSync, gzipSync } from 'fflate'
import { throwIfAborted } from '../../utils/abort'
import { createWorkerClient, type WorkerClient } from '../workerClient'
import { createCrc32 } from './crc32'
import type { CompressionLevel } from './recipe'

export interface CompressRequest {
  /**
   * crc は縮めずに CRC だけ数える（ZIP の無圧縮）。deflate は ZIP の中身（生の deflate）、gzip は tar.gz 全体
   */
  mode: 'crc' | 'deflate' | 'gzip'
  blob: Blob
  level: CompressionLevel
  /**
   * これ以下ならメモリに載せて fflate で縮める（レベル指定が効く）。超えるものはメモリに載せきらないよう
   * ブラウザ組み込みの CompressionStream で流しながら縮める（レベルは既定のみ）
   */
  inMemoryLimit: number
}

export interface CompressResult {
  /** 縮めた中身。crc のときは null */
  data: Blob | null
  /** 元の中身の CRC-32（ZIP の目録に書く）。gzip は自分で持つので数えない（0） */
  crc: number
}

/** これより小さいものはこのスレッドで扱う（1MB の deflate で 10〜25ms） */
const WORKER_THRESHOLD = 1024 * 1024

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

/** Worker とこのスレッドで共有する本体。onBytes には読み終えたバイト数を少しずつ渡す */
export async function compressBlob(
  { mode, blob, level, inMemoryLimit }: CompressRequest,
  onBytes: (bytes: number) => void,
  signal?: AbortSignal
): Promise<CompressResult> {
  const crc = createCrc32()
  const countCrc = mode !== 'gzip'

  if (mode === 'crc') {
    const reader = blob.stream().getReader()
    for (;;) {
      throwIfAborted(signal)
      const { done, value } = await reader.read()
      if (done) break
      crc.update(value)
      onBytes(value.length)
    }
    return { data: null, crc: crc.value() }
  }

  if (blob.size <= inMemoryLimit) {
    throwIfAborted(signal)
    const raw = new Uint8Array(await blob.arrayBuffer())
    if (countCrc) crc.update(raw)
    const compressed = mode === 'gzip' ? gzipSync(raw, { level }) : deflateSync(raw, { level })
    onBytes(blob.size)
    return { data: new Blob([compressed as Uint8Array<ArrayBuffer>]), crc: countCrc ? crc.value() : 0 }
  }

  const data = await collect(
    blob
      .stream()
      .pipeThrough(
        meter(signal, (chunk) => {
          if (countCrc) crc.update(chunk)
          onBytes(chunk.length)
        })
      )
      .pipeThrough(new CompressionStream(mode === 'gzip' ? 'gzip' : 'deflate-raw'))
  )
  return { data, crc: countCrc ? crc.value() : 0 }
}

let client: WorkerClient<CompressRequest, CompressResult> | null = null

/**
 * 1 つの中身を縮める（または CRC を数える）。onBytes には読み終えたバイト数を少しずつ渡す。
 * 止めると、Worker で計算中ならその Worker ごと止める
 */
export async function compress(
  request: CompressRequest,
  options: { signal?: AbortSignal; onBytes?: (bytes: number) => void } = {}
): Promise<CompressResult> {
  const { signal, onBytes = () => {} } = options
  throwIfAborted(signal)
  if (typeof Worker === 'undefined' || request.blob.size < WORKER_THRESHOLD) {
    const result = await compressBlob(request, onBytes, signal)
    throwIfAborted(signal)
    return result
  }
  client ??= createWorkerClient({
    create: () => new Worker(new URL('./compressWorker.ts', import.meta.url), { type: 'module' }),
  })
  return client.call(request, { signal, onProgress: onBytes })
}

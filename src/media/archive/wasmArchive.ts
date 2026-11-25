/**
 * 7z・RAR の読み手の窓口。archive.ts から 7z・RAR を開いたときだけ動的 import される。
 * ブラウザでは Worker（libarchiveWorker.ts）に読ませ、中断は Worker を止めて行う。
 * Worker のない node のテストでは、setInProcessLibarchive で渡したモジュールを同じスレッドで使う。
 */
import { createAbortError } from '../../utils/abort'
import { ArchiveError, type ArchiveErrorCode } from './errors'
import { LibarchiveReader, type LibarchiveEntry, type LibarchiveModule } from './libarchive'

export type WorkerRequest =
  | { type: 'open'; file: Blob }
  | { type: 'list' }
  | { type: 'extract'; indices: number[] }

export type WorkerReply =
  | { type: 'opened' }
  | { type: 'list'; entries: LibarchiveEntry[] }
  | { type: 'data'; index: number; data: Uint8Array }
  | { type: 'done' }
  | { type: 'error'; code: ArchiveErrorCode | null; message: string; path?: string }

export interface WasmArchive {
  list(): Promise<LibarchiveEntry[]>
  /** 番号で指定したファイルを並び順に展開し、1 つ読むたびに onData を呼ぶ */
  extract(indices: readonly number[], onData: (index: number, data: Uint8Array) => void): Promise<void>
  close(): void
}

let inProcess: (() => Promise<LibarchiveModule>) | null = null

/** テスト用: Worker を使わず、このスレッドで libarchive を動かす */
export function setInProcessLibarchive(load: () => Promise<LibarchiveModule>): void {
  inProcess = load
}

async function openInProcess(file: Blob, load: () => Promise<LibarchiveModule>): Promise<WasmArchive> {
  const reader = new LibarchiveReader(await load(), new Uint8Array(await file.arrayBuffer()))
  return {
    list: async () => reader.list(),
    extract: async (indices, onData) => reader.extract(new Set(indices), onData),
    close: () => reader.close(),
  }
}

function openInWorker(file: Blob, signal?: AbortSignal): Promise<WasmArchive> {
  const worker = new Worker(new URL('./libarchiveWorker.ts', import.meta.url), { type: 'module' })
  let pending: { onReply: (reply: WorkerReply) => void; reject: (error: unknown) => void } | null = null
  let closed = false

  const close = () => {
    if (closed) return
    closed = true
    worker.terminate()
    signal?.removeEventListener('abort', onAbort)
  }
  const fail = (error: unknown) => {
    const waiting = pending
    pending = null
    close()
    waiting?.reject(error)
  }
  function onAbort() {
    fail(createAbortError())
  }
  signal?.addEventListener('abort', onAbort)

  worker.onmessage = ({ data: reply }: MessageEvent<WorkerReply>) => {
    if (reply.type === 'error') {
      fail(
        reply.code
          ? new ArchiveError(reply.code, reply.message, { path: reply.path })
          : new Error(reply.message)
      )
      return
    }
    pending?.onReply(reply)
  }
  // Worker のスクリプトそのものが取れない（オフラインでまだキャッシュしていない）ときはここに来る
  worker.onerror = (event) => {
    event.preventDefault()
    fail(new ArchiveError('engine-unavailable', `7z・RAR を読む部品を読み込めませんでした: ${event.message ?? ''}`))
  }

  /** 1 つの依頼を送り、終わりの返事（until）が来るまで待つ。途中の返事は onReply に渡す */
  const request = <T extends WorkerReply['type']>(
    message: WorkerRequest,
    until: T,
    onReply?: (reply: WorkerReply) => void
  ) =>
    new Promise<Extract<WorkerReply, { type: T }>>((resolve, reject) => {
      if (closed) {
        reject(signal?.aborted ? createAbortError() : new Error('閉じた圧縮ファイルは読めません'))
        return
      }
      pending = {
        reject,
        onReply: (reply) => {
          if (reply.type !== until) {
            onReply?.(reply)
            return
          }
          pending = null
          resolve(reply as Extract<WorkerReply, { type: T }>)
        },
      }
      worker.postMessage(message)
    })

  if (signal?.aborted) {
    close()
    return Promise.reject(createAbortError())
  }
  return request({ type: 'open', file }, 'opened').then(() => ({
    list: async () => (await request({ type: 'list' }, 'list')).entries,
    extract: async (indices, onData) => {
      await request({ type: 'extract', indices: [...indices] }, 'done', (reply) => {
        if (reply.type === 'data') onData(reply.index, reply.data)
      })
    },
    close,
  }))
}

/** 7z・RAR を開く。使い終わったら close する（Worker と WASM のメモリを返す） */
export function openWasmArchive(file: Blob, signal?: AbortSignal): Promise<WasmArchive> {
  if (inProcess) return openInProcess(file, inProcess)
  if (typeof Worker === 'undefined') {
    return Promise.reject(new ArchiveError('engine-unavailable', 'この環境では 7z・RAR を読めません'))
  }
  return openInWorker(file, signal)
}

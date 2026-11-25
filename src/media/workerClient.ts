/**
 * 重い同期の処理（HEIC のデコード・大きなファイルの圧縮など）を Worker に頼む窓口。
 * 処理中も画面が固まらないように、エンジンの関数はこれを通して Worker で計算し、結果だけを受け取る。
 *
 * 決めごと:
 * - 依頼には Blob を渡す（構造化複製しても中身は写されない）。中断で Worker を作り直したとき、
 *   ほかの依頼を同じ形で送り直せるように、依頼の中身は手放さない（transfer しない）
 * - 返事の大きな ArrayBuffer・ImageBitmap は Worker から transfer して写さずに受け取る
 * - 中断は Worker ごと止めて行う（同期の計算は途中で止められないため）。同じ Worker に
 *   ほかの依頼が残っていれば、新しい Worker に送り直す
 * - しばらく使われなければ Worker を止め、WASM などのメモリを返す
 */
import { createAbortError } from '../utils/abort'

/** Worker の中で起きた例外を、名前と文言だけ持ち帰った形 */
export interface WorkerErrorInfo {
  name: string
  message: string
}

export type WorkerReply<T> =
  | { id: number; ok: true; value: T }
  | { id: number; ok: false; error: WorkerErrorInfo }
  /** 途中経過。中身の意味（割合か、読んだバイト数か）は依頼ごとに決める */
  | { id: number; progress: number }

export type WorkerRequestMessage<Q> = { id: number; request: Q }

interface Pending<Q, R> {
  message: WorkerRequestMessage<Q>
  resolve: (value: R) => void
  reject: (error: unknown) => void
  onProgress?: (progress: number) => void
  cleanup: () => void
}

export interface WorkerClientOptions {
  create: () => Worker
  /** Worker の例外を呼び出し側の例外の型に戻す */
  revive?: (error: WorkerErrorInfo) => Error
  /** Worker のスクリプトそのものを読み込めなかった（オフラインでまだキャッシュしていないなど） */
  loadError?: (event: ErrorEvent) => Error
  /** 最後の返事からこれだけ何も頼まれなければ Worker を止める */
  idleMs?: number
}

export interface CallOptions {
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}

export interface WorkerClient<Q, R> {
  call(request: Q, options?: CallOptions): Promise<R>
}

const reviveDefault = ({ name, message }: WorkerErrorInfo) => Object.assign(new Error(message), { name })

export function createWorkerClient<Q, R>(options: WorkerClientOptions): WorkerClient<Q, R> {
  const { create, revive = reviveDefault, idleMs = 30_000 } = options
  const pending = new Map<number, Pending<Q, R>>()
  let worker: Worker | null = null
  let nextId = 1
  let idleTimer: ReturnType<typeof setTimeout> | null = null

  const stop = () => {
    worker?.terminate()
    worker = null
  }

  const settle = (id: number) => {
    const entry = pending.get(id)
    if (!entry) return null
    pending.delete(id)
    entry.cleanup()
    if (pending.size === 0) {
      idleTimer = setTimeout(stop, idleMs)
    }
    return entry
  }

  const start = () => {
    const next = create()
    next.onmessage = ({ data: reply }: MessageEvent<WorkerReply<R>>) => {
      if ('progress' in reply) {
        pending.get(reply.id)?.onProgress?.(reply.progress)
        return
      }
      const entry = settle(reply.id)
      if (!entry) return
      if (reply.ok) entry.resolve(reply.value)
      else entry.reject(revive(reply.error))
    }
    next.onerror = (event) => {
      event.preventDefault()
      // 読み込みに失敗した Worker は使い回せない。待っている依頼はすべて失敗にする
      const error = options.loadError?.(event) ?? new Error(event.message || 'Worker を起動できませんでした')
      stop()
      for (const id of [...pending.keys()]) settle(id)?.reject(error)
    }
    worker = next
    return next
  }

  const post = (message: WorkerRequestMessage<Q>) => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer)
      idleTimer = null
    }
    ;(worker ?? start()).postMessage(message)
  }

  return {
    call(request, { signal, onProgress } = {}) {
      if (signal?.aborted) return Promise.reject(createAbortError())
      return new Promise<R>((resolve, reject) => {
        const message = { id: nextId++, request }
        const onAbort = () => {
          if (!settle(message.id)) return
          reject(createAbortError())
          // 計算中の Worker は止めるしかない。残りの依頼は作り直した Worker で続ける
          stop()
          for (const entry of pending.values()) post(entry.message)
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        pending.set(message.id, {
          message,
          resolve,
          reject,
          onProgress,
          cleanup: () => signal?.removeEventListener('abort', onAbort),
        })
        post(message)
      })
    },
  }
}

/** Worker の中で依頼を受け付ける側。handler の返す transfer は写さずに返す。report で途中経過を送れる */
export function serveWorkerRequests<Q, R>(
  handler: (request: Q, report: (progress: number) => void) => Promise<{ value: R; transfer?: Transferable[] }>
): void {
  const scope = self as unknown as {
    onmessage: ((event: MessageEvent<WorkerRequestMessage<Q>>) => void) | null
    postMessage(message: WorkerReply<R>, transfer?: Transferable[]): void
  }
  scope.onmessage = async ({ data: { id, request } }) => {
    try {
      const { value, transfer = [] } = await handler(request, (progress) => scope.postMessage({ id, progress }))
      scope.postMessage({ id, ok: true, value }, transfer)
    } catch (error) {
      const info =
        error instanceof Error ? { name: error.name, message: error.message } : { name: 'Error', message: String(error) }
      scope.postMessage({ id, ok: false, error: info })
    }
  }
}

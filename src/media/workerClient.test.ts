/**
 * Worker の窓口の決めごと（返事の対応づけ・途中経過・中断での作り直し・例外の戻し方）を、
 * node にない Worker の代わりに同じスレッドで返事をする偽物で確かめる。
 */
import { describe, expect, test } from 'vitest'
import { isAbortError } from '../utils/abort'
import { createWorkerClient, type WorkerReply, type WorkerRequestMessage } from './workerClient'

type Request = { n: number; fail?: boolean; hang?: boolean }

/** 依頼を受けると次の周回で n * 2 を返す偽の Worker。hang の依頼には答えない */
class FakeWorker {
  static created: FakeWorker[] = []
  onmessage: ((event: MessageEvent<WorkerReply<number>>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  terminated = false
  received: number[] = []

  constructor() {
    FakeWorker.created.push(this)
  }

  postMessage({ id, request }: WorkerRequestMessage<Request>) {
    this.received.push(request.n)
    if (request.hang) return
    setTimeout(() => {
      if (this.terminated) return
      const reply = (data: WorkerReply<number>) => this.onmessage?.({ data } as MessageEvent<WorkerReply<number>>)
      reply({ id, progress: 0.5 })
      reply(
        request.fail
          ? { id, ok: false, error: { name: 'HeifDecodeError', message: 'broken' } }
          : { id, ok: true, value: request.n * 2 }
      )
    })
  }

  terminate() {
    this.terminated = true
  }
}

const client = () => {
  FakeWorker.created = []
  return createWorkerClient<Request, number>({
    create: () => new FakeWorker() as unknown as Worker,
    revive: ({ name, message }) => Object.assign(new Error(`revived: ${message}`), { name }),
  })
}

describe('createWorkerClient', () => {
  test('同時に頼んでも、それぞれの依頼に返事を対応づけ、途中経過も渡す', async () => {
    const c = client()
    const progress: number[] = []
    const results = await Promise.all([c.call({ n: 1 }, { onProgress: (p) => progress.push(p) }), c.call({ n: 2 })])
    expect(results).toEqual([2, 4])
    expect(progress).toEqual([0.5])
    expect(FakeWorker.created).toHaveLength(1)
  })

  test('Worker の例外は revive で呼び出し側の型に戻す', async () => {
    const c = client()
    await expect(c.call({ n: 1, fail: true })).rejects.toMatchObject({ name: 'HeifDecodeError', message: 'revived: broken' })
  })

  test('中断すると Worker を止め、ほかの依頼は新しい Worker に送り直して続ける', async () => {
    const c = client()
    const controller = new AbortController()
    const aborted = c.call({ n: 1, hang: true }, { signal: controller.signal })
    const other = c.call({ n: 3 })
    controller.abort()
    const error = await aborted.catch((e: unknown) => e)
    expect(isAbortError(error)).toBe(true)
    expect(await other).toBe(6)
    expect(FakeWorker.created).toHaveLength(2)
    expect(FakeWorker.created[0].terminated).toBe(true)
    expect(FakeWorker.created[1].received).toEqual([3])
  })

  test('始める前に止められていれば、Worker を作らずに AbortError', async () => {
    const c = client()
    const error = await c.call({ n: 1 }, { signal: AbortSignal.abort() }).catch((e: unknown) => e)
    expect(isAbortError(error)).toBe(true)
    expect(FakeWorker.created).toHaveLength(0)
  })

  test('Worker を読み込めなければ、待っている依頼をすべて失敗にし、次の依頼では作り直す', async () => {
    const c = client()
    const pending = [c.call({ n: 1, hang: true }), c.call({ n: 2, hang: true })]
    FakeWorker.created[0].onerror?.({ message: 'offline', preventDefault() {} } as ErrorEvent)
    for (const promise of pending) await expect(promise).rejects.toThrow('offline')
    expect(await c.call({ n: 5 })).toBe(10)
    expect(FakeWorker.created).toHaveLength(2)
  })
})

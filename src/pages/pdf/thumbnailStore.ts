import { openPdfThumbnailer, type PdfThumbnailer } from '../../media/pdf'

export type ThumbnailState =
  | { status: 'idle' }
  | { status: 'ready'; url: string }
  | { status: 'error' }

const IDLE: ThumbnailState = { status: 'idle' }
// pdf.js はワーカー 1 つで描くので、同時に投げても速くならない。2 つにして待ち時間だけ重ねる
const CONCURRENCY = 2

interface Job {
  key: string
  source: number
  page: number
}

/**
 * ページのサムネイルを描いて覚えておく。React の外に置き、各ページは自分の鍵だけを購読する
 * （1 枚描けるたびに一覧全体を描き直さないため）。
 *
 * 鍵は「入力:ページ」で、レシピでの位置や回転には依存しない。回転は表示側で CSS で当てるので、
 * 並べ替え・回転・取り消しのどれでも描き直さずに済む。
 * 使う間は activate し、終わったら dispose する。
 * 見えている間だけ request し、見えなくなったら cancel する。描き始める前なら待ち行列から外れる。
 */
export class ThumbnailStore {
  private readonly states = new Map<string, ThumbnailState>()
  private readonly listeners = new Map<string, Set<() => void>>()
  private readonly thumbnailers = new Map<number, Promise<PdfThumbnailer>>()
  private readonly files: Blob[] = []
  private queue: Job[] = []
  private readonly pending = new Set<string>()
  private running = 0
  private disposed = false
  private readonly maxSize: number

  constructor(maxSize: number) {
    this.maxSize = maxSize
  }

  /**
   * 使い始める。dispose のあとでも呼べる（StrictMode が effect を 2 回走らせても壊れないように）。
   * 入力のファイルは覚えたままなので、描き手は次に描くときに開き直す
   */
  activate() {
    this.disposed = false
  }

  /** 入力の配列と同じ位置に入れる。入力は増えるだけで、位置は変わらない */
  setSource(source: number, file: Blob) {
    this.files[source] = file
  }

  get = (key: string): ThumbnailState => this.states.get(key) ?? IDLE

  subscribe = (key: string, listener: () => void) => {
    let set = this.listeners.get(key)
    if (!set) this.listeners.set(key, (set = new Set()))
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  request(source: number, page: number) {
    const key = thumbnailKey(source, page)
    if (this.disposed || this.states.has(key) || this.pending.has(key)) return
    this.pending.add(key)
    this.queue.push({ key, source, page })
    this.pump()
  }

  cancel(source: number, page: number) {
    const key = thumbnailKey(source, page)
    const index = this.queue.findIndex((job) => job.key === key)
    if (index < 0) return
    this.queue.splice(index, 1)
    this.pending.delete(key)
  }

  dispose() {
    this.disposed = true
    this.queue = []
    for (const state of this.states.values()) {
      if (state.status === 'ready') URL.revokeObjectURL(state.url)
    }
    this.states.clear()
    for (const thumbnailer of this.thumbnailers.values()) {
      void thumbnailer.then((opened) => opened.destroy()).catch(() => {})
    }
    this.thumbnailers.clear()
    this.pending.clear()
    // 描いた絵の URL は無効になったので、購読しているページに描き直しを促す
    for (const set of this.listeners.values()) for (const listener of set) listener()
  }

  private thumbnailer(source: number) {
    let opened = this.thumbnailers.get(source)
    if (!opened) {
      opened = openPdfThumbnailer(this.files[source])
      this.thumbnailers.set(source, opened)
    }
    return opened
  }

  private pump() {
    while (this.running < CONCURRENCY && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.running++
      void this.run(job).finally(() => {
        this.running--
        this.pending.delete(job.key)
        if (!this.disposed) this.pump()
      })
    }
  }

  private async run({ key, source, page }: Job) {
    let state: ThumbnailState
    try {
      const thumbnailer = await this.thumbnailer(source)
      const blob = await thumbnailer.render(page, this.maxSize)
      state = { status: 'ready', url: URL.createObjectURL(blob) }
    } catch (error) {
      console.warn(`Thumbnail ${key} failed:`, error)
      state = { status: 'error' }
    }
    if (this.disposed) {
      if (state.status === 'ready') URL.revokeObjectURL(state.url)
      return
    }
    this.states.set(key, state)
    for (const listener of this.listeners.get(key) ?? []) listener()
  }
}

export const thumbnailKey = (source: number, page: number) => `${source}:${page}`

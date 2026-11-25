import type { ConvertKind } from '../pages/convert/kinds'

interface BatchEntryBase {
  file: File
  /** どの出力設定で書き出すか。取り込んだときに決め、あとから変えない */
  kind: ConvertKind
  /** 変換の進み具合（0〜100） */
  progress: number
}

/**
 * 一括変換 1 件の状態。取りうる形をユニオンで閉じているので
 * 「失敗したのに結果がある」といった組み合わせは表現できない。
 * 出力そのものは書き出し先（フォルダか ZIP）へ渡したので、ここには表示に使う名前と大きさだけを残す。
 */
export type BatchEntry =
  | (BatchEntryBase & { status: 'pending' })
  | (BatchEntryBase & { status: 'converting' })
  | (BatchEntryBase & { status: 'completed'; convertedSize: number; outputName: string })
  | (BatchEntryBase & { status: 'error'; error: string })

export type BatchStatusName = BatchEntry['status']

export type BatchState = BatchEntry[]

/** 取り込むファイル。種類はページ側で判定して渡す */
export interface BatchInput {
  file: File
  kind: ConvertKind
}

export type BatchAction =
  | { type: 'init'; files: BatchInput[] }
  /** 末尾に足す。すでにある（同じとみなせる）ファイルは足さない */
  | { type: 'append'; files: BatchInput[] }
  | { type: 'remove'; index: number }
  | { type: 'clear' }
  /**
   * 待機中に戻す。index を省くと全件（ランの始まりに、前のランの結果を消す）。
   * index を指すのは中止したときで、途中だった件を「変換中」のまま残さない
   */
  | { type: 'requeue'; index?: number }
  | { type: 'start'; index: number }
  | { type: 'progress'; index: number; value: number }
  | { type: 'complete'; index: number; convertedSize: number; outputName: string }
  | { type: 'fail'; index: number; message: string }

export const initialBatchState: BatchState = []

/**
 * 同じファイルかどうかの目安。ドロップし直すと別の File オブジェクトになるので、
 * 名前・大きさ・更新時刻の組で見分ける（中身までは読まない）
 */
export function fileKey(file: File): string {
  return `${file.name}\u0000${file.size}\u0000${file.lastModified}`
}

const pending = ({ file, kind }: BatchInput): BatchEntry => ({
  file,
  kind,
  status: 'pending',
  progress: 0,
})

/** 入力の中の重複も、すでにある件との重複も落とす。残す順番は入力のまま */
function dedupe(existing: readonly BatchEntry[], files: readonly BatchInput[]): BatchInput[] {
  const seen = new Set(existing.map((entry) => fileKey(entry.file)))
  const added: BatchInput[] = []
  for (const input of files) {
    const key = fileKey(input.file)
    if (seen.has(key)) continue
    seen.add(key)
    added.push(input)
  }
  return added
}

/**
 * 一括変換の一覧。1 件ずつ差し替えるので、
 * 前のランの結果やエラーが次の状態に紛れ込むことはない。
 */
export function batchReducer(state: BatchState, action: BatchAction): BatchState {
  switch (action.type) {
    case 'init':
      return dedupe([], action.files).map(pending)
    case 'append': {
      const added = dedupe(state, action.files)
      // 何も増えないときは描き直さない
      return added.length === 0 ? state : [...state, ...added.map(pending)]
    }
    case 'remove':
      if (!state[action.index]) return state
      return state.filter((_, i) => i !== action.index)
    case 'clear':
      return initialBatchState
    case 'requeue':
      if (action.index !== undefined) return replaceAt(state, action.index, pending)
      // すでに全件が待機中なら描き直さない
      return state.every((entry) => entry.status === 'pending') ? state : state.map(pending)
    case 'start':
      return replaceAt(state, action.index, ({ file, kind }) => ({
        file,
        kind,
        status: 'converting',
        progress: 0,
      }))
    case 'progress': {
      const item = state[action.index]
      // 決着したあとに遅れて届いた進捗と、同じ値の繰り返しでは作り直さない
      if (item?.status !== 'converting' || item.progress === action.value) return state
      return replaceAt(state, action.index, () => ({ ...item, progress: action.value }))
    }
    case 'complete':
      return replaceAt(state, action.index, ({ file, kind }) => ({
        file,
        kind,
        status: 'completed',
        progress: 100,
        convertedSize: action.convertedSize,
        outputName: action.outputName,
      }))
    case 'fail':
      return replaceAt(state, action.index, ({ file, kind, progress }) => ({
        file,
        kind,
        progress,
        status: 'error',
        error: action.message,
      }))
  }
}

function replaceAt(
  state: BatchState,
  index: number,
  replace: (item: BatchEntry) => BatchEntry
): BatchState {
  const item = state[index]
  if (!item) return state
  return state.map((current, i) => (i === index ? replace(item) : current))
}

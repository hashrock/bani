import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { batchReducer, fileKey, initialBatchState } from './batchConversion'
import type { BatchAction, BatchInput, BatchState } from './batchConversion'
import { CONVERT_KINDS } from '../pages/convert/kinds'
import { progressValue, videoFile } from '../test/arbitraries'

/** 取り込みでは同じファイルを落とすので、件数を保つ性質を見る一覧は重複なしで作る */
const uniqueFiles = (minLength: number) =>
  fc.uniqueArray(videoFile, { minLength, maxLength: 5, selector: fileKey })

const fileList = uniqueFiles(1)

const asInputs = (files: File[], kinds: readonly BatchInput['kind'][] = ['video']): BatchInput[] =>
  files.map((file, i) => ({ file, kind: kinds[i % kinds.length] }))

/** 特定の 1 件に向けた操作。ファイル一覧そのものは動かさない */
type IndexedAction = Extract<BatchAction, { index: number }>

const actionAt = (index: number): fc.Arbitrary<IndexedAction> =>
  fc.oneof(
    fc.constant({ type: 'start', index } as const),
    progressValue.map((value) => ({ type: 'progress', index, value }) as const),
    fc
      .tuple(fc.nat(), fc.string())
      .map(([convertedSize, outputName]) => ({ type: 'complete', index, convertedSize, outputName }) as const),
    fc.string().map((message) => ({ type: 'fail', index, message }) as const)
  )

/**
 * 一覧の長さ（最大 5 件）の外側も混ぜる。変換中にファイルを選び直すと起こりうる。
 * 添字の幅を件数に近づけて、同じ件に何度も操作が当たる列が出るようにする。
 */
const itemIndex = fc.integer({ min: -1, max: 5 })

const indexedAction = itemIndex.chain(actionAt)

// 短い列に偏らせると、同じ件で決着が二度起きるような並びを踏めない
const indexedSequence = fc.array(indexedAction, { minLength: 8, maxLength: 24 })

/**
 * 一覧の操作も混ぜた列。選び直しと取り消しを等確率で混ぜると状態が育つ前に流れてしまうので、
 * 1 件ずつの操作が積み上がるように重みを付ける。
 */
const anyAction: fc.Arbitrary<BatchAction> = fc.oneof(
  { arbitrary: indexedAction, weight: 8 },
  { arbitrary: fileList.map((files) => ({ type: 'init', files: asInputs(files) }) as const), weight: 1 },
  { arbitrary: fc.constant({ type: 'clear' } as const), weight: 1 }
)

const anyActionSequence = fc.array(anyAction, { minLength: 8, maxLength: 30 })

const reachable = (state: BatchState, actions: BatchAction[]): BatchState =>
  actions.reduce(batchReducer, state)

const initial = (files: File[]) =>
  batchReducer(initialBatchState, { type: 'init', files: asInputs(files) })

describe('batchReducer', () => {
  test('選び直し以外の操作では件数が変わらない', () => {
    fc.assert(
      fc.property(fileList, indexedSequence, (files, actions) => {
        expect(reachable(initial(files), actions)).toHaveLength(files.length)
      })
    )
  })

  test('1 件に向けた操作は他の件に触れない（局所性）', () => {
    fc.assert(
      fc.property(fileList, indexedSequence, indexedAction, (files, actions, action) => {
        const before = reachable(initial(files), actions)
        const after = batchReducer(before, action)
        before.forEach((item, i) => {
          if (i !== action.index) expect(after[i]).toBe(item)
        })
      })
    )
  })

  test('範囲外の添字を指した操作は状態をそのまま返す', () => {
    fc.assert(
      fc.property(
        fileList.chain((files) =>
          fc.tuple(
            fc.constant(files),
            fc
              .oneof(
                fc.integer({ min: -5, max: -1 }),
                fc.integer({ min: files.length, max: files.length + 5 })
              )
              .chain(actionAt)
          )
        ),
        indexedSequence,
        ([files, action], actions) => {
          const before = reachable(initial(files), actions)
          expect(batchReducer(before, action)).toBe(before)
        }
      )
    )
  })

  test('別々の件に向けた操作は順番を入れ替えても同じ結果になる（順序非依存性）', () => {
    fc.assert(
      fc.property(
        uniqueFiles(2).chain((files) =>
          fc.tuple(
            fc.constant(files),
            fc
              .uniqueArray(fc.integer({ min: 0, max: files.length - 1 }), {
                minLength: 2,
                maxLength: 2,
              })
              .chain(([i, j]) => fc.tuple(actionAt(i), actionAt(j)))
          )
        ),
        indexedSequence,
        ([files, [a, b]], actions) => {
          const before = reachable(initial(files), actions)
          expect(reachable(before, [a, b])).toEqual(reachable(before, [b, a]))
        }
      )
    )
  })

  test('選び直し以外の操作でファイルそのものは差し替わらない', () => {
    fc.assert(
      fc.property(fileList, indexedSequence, (files, actions) => {
        reachable(initial(files), actions).forEach((item, i) => {
          expect(item.file).toBe(files[i])
        })
      })
    )
  })

  // status に対応するデータしか持てないことは BatchEntry のユニオンが保証するので、
  // ここでは型に書けない進捗の値だけを確かめる
  test('どの操作列をたどっても、進捗は status と食い違わない', () => {
    fc.assert(
      fc.property(fileList, anyActionSequence, (files, actions) => {
        for (const item of reachable(initial(files), actions)) {
          expect(item.progress).toBeGreaterThanOrEqual(0)
          expect(item.progress).toBeLessThanOrEqual(100)
          if (item.status === 'pending') expect(item.progress).toBe(0)
          if (item.status === 'completed') expect(item.progress).toBe(100)
        }
      })
    )
  })

  test('進捗で状態が作り直されるのは、変換中に値が動いたときだけ', () => {
    fc.assert(
      fc.property(
        fileList,
        indexedSequence,
        itemIndex,
        progressValue,
        (files, actions, index, value) => {
          const before = reachable(initial(files), actions)
          const item = before[index]
          const moves = item?.status === 'converting' && item.progress !== value
          const after = batchReducer(before, { type: 'progress', index, value })
          // 決着後に遅れて届いた進捗も、同じ値の繰り返しも、描き直しを起こさない
          expect(after === before).toBe(!moves)
        }
      )
    )
  })

  test('同じ進捗を続けて受けても、2 回目は状態を作り直さない', () => {
    fc.assert(
      fc.property(fileList, itemIndex, progressValue, (files, index, value) => {
        const converting = batchReducer(initial(files), { type: 'start', index })
        const once = batchReducer(converting, { type: 'progress', index, value })
        expect(batchReducer(once, { type: 'progress', index, value })).toBe(once)
      })
    )
  })

  test('取り消しはどの状態からでも空にし、選び直しは履歴を残さない', () => {
    fc.assert(
      fc.property(
        fileList,
        anyActionSequence,
        fileList,
        (files, actions, next) => {
          const before = reachable(initial(files), actions)
          expect(batchReducer(before, { type: 'clear' })).toEqual(initialBatchState)
          expect(batchReducer(before, { type: 'init', files: asInputs(next) })).toEqual(initial(next))
        }
      )
    )
  })
})

/**
 * useBatchConversion が実際に流す順序（1 件ずつ start → progress* → 決着）を組み立てる。
 * 変換は何度でも走らせ直せるので、同じ添字を跨ぐ複数回のランも作る。
 */
type FilePlan = {
  progresses: number[]
  outcome: 'complete' | 'fail' | 'cancel' | 'skip'
}

const planWith = (...outcomes: FilePlan['outcome'][]): fc.Arbitrary<FilePlan> =>
  fc.record({
    progresses: fc.array(progressValue, { maxLength: 4 }),
    outcome: fc.constantFrom(...outcomes),
  })

const runPlans = fc.array(fc.array(planWith('complete', 'fail', 'cancel', 'skip'), { maxLength: 5 }), {
  minLength: 1,
  maxLength: 6,
})

const CONVERTED_SIZE = 1024

function runActions(plans: FilePlan[]): BatchAction[] {
  const actions: BatchAction[] = []
  for (const [index, plan] of plans.entries()) {
    // 中断したらそこで打ち切り、以降の件には手をつけない
    if (plan.outcome === 'skip') break
    actions.push({ type: 'start', index })
    for (const value of plan.progresses) actions.push({ type: 'progress', index, value })
    if (plan.outcome === 'complete')
      actions.push({ type: 'complete', index, convertedSize: CONVERTED_SIZE, outputName: 'out' })
    else if (plan.outcome === 'fail') actions.push({ type: 'fail', index, message: 'boom' })
    else break
  }
  return actions
}

describe('batchReducer（変換ランが流す順序）', () => {
  test('最後まで走り切ったランでは、全件が完了か失敗のどちらかになる', () => {
    fc.assert(
      fc.property(
        fileList,
        fc.array(planWith('complete', 'fail'), { minLength: 5, maxLength: 5 }),
        (files, plans) => {
          for (const item of reachable(initial(files), runActions(plans))) {
            expect(['completed', 'error']).toContain(item.status)
            if (item.status === 'completed') expect(item.convertedSize).toBe(CONVERTED_SIZE)
            else if (item.status === 'error') expect(item.error).toBe('boom')
          }
        }
      )
    )
  })

  test('走らせ直すと、前回のランの決着は残らない', () => {
    fc.assert(
      fc.property(fileList, runPlans, (files, runs) => {
        const after = runs.reduce(
          (current, plans) => reachable(current, runActions(plans)),
          initial(files)
        )
        // 直前に決着していても、やり直しの start で必ず素の状態へ戻る
        expect(batchReducer(after, { type: 'start', index: 0 })[0]).toEqual({
          file: files[0],
          kind: 'video',
          status: 'converting',
          progress: 0,
        })
      })
    )
  })
})

/** 種類も混ぜた取り込み。同じファイルを何度も含みうる（ドロップし直しや重複した選択） */
const kind = fc.constantFrom(...CONVERT_KINDS)
const inputPool = uniqueFiles(1).chain((files) =>
  fc.tuple(fc.constant(files), fc.array(kind, { minLength: files.length, maxLength: files.length }))
)
const inputsFrom = ([files, kinds]: [File[], BatchInput['kind'][]]): fc.Arbitrary<BatchInput[]> =>
  fc.array(
    fc.tuple(fc.integer({ min: 0, max: files.length - 1 }), fc.boolean()).map(([i, copy]) => ({
      // 同じ File オブジェクトだけでなく、作り直された同じファイル（ドロップし直し）も混ぜる
      file: copy ? new File([files[i]], files[i].name, { lastModified: files[i].lastModified }) : files[i],
      kind: kinds[i],
    })),
    { maxLength: 8 }
  )

const twoBatches = inputPool.chain((pool) => fc.tuple(inputsFrom(pool), inputsFrom(pool)))

describe('batchReducer（追加と取り除き）', () => {
  test('追加しても同じファイルは 1 件にまとまり、すでにある件はそのまま残る', () => {
    fc.assert(
      fc.property(twoBatches, ([first, second]) => {
        const before = batchReducer(initialBatchState, { type: 'init', files: first })
        const after = batchReducer(before, { type: 'append', files: second })
        const keys = after.map((entry) => fileKey(entry.file))
        expect(new Set(keys).size).toBe(keys.length)
        // 前からある件は同じオブジェクトのまま先頭に並ぶ
        before.forEach((entry, i) => expect(after[i]).toBe(entry))
        // どちらかの取り込みにあったファイルはすべて載る
        const wanted = new Set([...first, ...second].map(({ file }) => fileKey(file)))
        expect(new Set(keys)).toEqual(wanted)
        for (const entry of after.slice(before.length)) expect(entry.status).toBe('pending')
      })
    )
  })

  test('何も増えない追加は状態を作り直さない', () => {
    fc.assert(
      fc.property(twoBatches, ([first]) => {
        const before = batchReducer(initialBatchState, { type: 'init', files: first })
        expect(batchReducer(before, { type: 'append', files: first })).toBe(before)
        expect(batchReducer(before, { type: 'append', files: [] })).toBe(before)
      })
    )
  })

  test('取り込んだときの種類は、どの操作をたどっても変わらない', () => {
    fc.assert(
      fc.property(inputPool, indexedSequence, ([files, kinds], actions) => {
        const inputs = files.map((file, i) => ({ file, kind: kinds[i] }))
        const state = reachable(batchReducer(initialBatchState, { type: 'init', files: inputs }), actions)
        state.forEach((entry, i) => expect(entry.kind).toBe(kinds[i]))
      })
    )
  })

  test('取り除くとその 1 件だけが消え、範囲外なら何もしない', () => {
    fc.assert(
      fc.property(fileList, indexedSequence, itemIndex, (files, actions, index) => {
        const before = reachable(initial(files), actions)
        const after = batchReducer(before, { type: 'remove', index })
        if (index < 0 || index >= before.length) {
          expect(after).toBe(before)
          return
        }
        expect(after).toEqual([...before.slice(0, index), ...before.slice(index + 1)])
      })
    )
  })

  test('全件を待機に戻すと、ファイルと種類を保ったまま前のランの結果が消える', () => {
    fc.assert(
      fc.property(fileList, indexedSequence, (files, actions) => {
        const before = reachable(initial(files), actions)
        const after = batchReducer(before, { type: 'requeue' })
        expect(after).toEqual(initial(files))
        // もう一度戻しても描き直さない
        expect(batchReducer(after, { type: 'requeue' })).toBe(after)
      })
    )
  })

  test('1 件だけ待機に戻すと、ほかの件には触れない', () => {
    fc.assert(
      fc.property(fileList, indexedSequence, itemIndex, (files, actions, index) => {
        const before = reachable(initial(files), actions)
        const after = batchReducer(before, { type: 'requeue', index })
        before.forEach((entry, i) => {
          if (i === index) expect(after[i]).toEqual(initial(files)[i])
          else expect(after[i]).toBe(entry)
        })
      })
    )
  })
})

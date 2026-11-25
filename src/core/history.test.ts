import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  HISTORY_LIMIT,
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from './history'
import type { History } from './history'

type Step = { type: 'push'; value: number } | { type: 'undo' } | { type: 'redo' }

const step: fc.Arbitrary<Step> = fc.oneof(
  fc.integer({ min: 0, max: 5 }).map((value) => ({ type: 'push', value }) as const),
  fc.constant({ type: 'undo' } as const),
  fc.constant({ type: 'redo' } as const)
)

function run(history: History<number>, steps: Step[]): History<number> {
  return steps.reduce((current, s) => {
    switch (s.type) {
      case 'push':
        return pushHistory(current, s.value)
      case 'undo':
        return undoHistory(current)
      case 'redo':
        return redoHistory(current)
    }
  }, history)
}

const reachable = fc
  .tuple(fc.integer({ min: 0, max: 5 }), fc.array(step, { maxLength: 30 }))
  .map(([initial, steps]) => run(createHistory(initial), steps))

describe('history', () => {
  it('取り消してからやり直すと元に戻る', () => {
    fc.assert(
      fc.property(reachable, (history) => {
        if (!canUndo(history)) return
        expect(redoHistory(undoHistory(history))).toEqual(history)
      })
    )
  })

  it('やり直してから取り消すと元に戻る', () => {
    fc.assert(
      fc.property(reachable, (history) => {
        if (!canRedo(history)) return
        expect(undoHistory(redoHistory(history))).toEqual(history)
      })
    )
  })

  it('取り消し・やり直しでは、たどれる状態の並びが変わらない', () => {
    const timeline = (h: History<number>) => [...h.past, h.present, ...h.future]
    fc.assert(
      fc.property(reachable, fc.constantFrom('undo', 'redo'), (history, kind) => {
        const next = kind === 'undo' ? undoHistory(history) : redoHistory(history)
        expect(timeline(next)).toEqual(timeline(history))
      })
    )
  })

  it('積むとやり直しの列は空になり、すぐ取り消すと積む前の状態に戻る', () => {
    fc.assert(
      fc.property(reachable, fc.integer({ min: 0, max: 5 }), (history, value) => {
        const next = pushHistory(history, value)
        if (value === history.present) {
          expect(next).toBe(history)
          return
        }
        expect(next.future).toEqual([])
        expect(undoHistory(next).present).toBe(history.present)
      })
    )
  })

  it('取り消せる段数は上限を超えない', () => {
    let history = createHistory(0)
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) history = pushHistory(history, i)
    expect(history.past).toHaveLength(HISTORY_LIMIT)
    expect(history.past[0]).toBe(10)
  })
})

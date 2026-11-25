import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createHashGuard } from './hashGuard'
import type { HashGuard } from './hashGuard'

/**
 * ブラウザの履歴の偽物。履歴の移動は非同期に popstate を出し、hash が変わったときだけ続けて
 * hashchange を出す（本物と同じく、同じ hash の項目へ動いたときは hashchange が来ない）。flush で届いた順に処理する。
 */
class FakeBrowser {
  entries: { hash: string; state: unknown }[]
  pos = 0
  queue: (() => void)[] = []
  guard!: HashGuard
  events = 0

  constructor(initial: string) {
    this.entries = [{ hash: initial, state: null }]
  }

  get hash() {
    return this.entries[this.pos].hash
  }

  readonly history = {
    get state() {
      return browser().entries[browser().pos].state
    },
    replaceState: (data: unknown) => {
      this.entries[this.pos].state = data
    },
    go: (delta: number) => this.traverse(delta),
  }

  private traverse(delta: number) {
    const next = Math.min(Math.max(this.pos + delta, 0), this.entries.length - 1)
    if (next === this.pos) return
    const before = this.hash
    this.queue.push(() => {
      this.pos = next
      this.guard.handlePopState()
      if (this.hash !== before) this.fire()
    })
  }

  private fire() {
    this.events++
    this.guard.handleHashChange()
  }

  /** リンクや location.hash の代入。新しい項目を積む */
  push(hash: string) {
    if (hash === this.hash) return
    this.entries = this.entries.slice(0, this.pos + 1)
    this.entries.push({ hash, state: null })
    this.pos++
    this.guard.handlePopState()
    this.fire()
  }

  back() {
    this.traverse(-1)
  }

  forward() {
    this.traverse(1)
  }

  flush() {
    let guard = 0
    while (this.queue.length > 0) {
      if (++guard > 10) throw new Error('hashchange が止まらない')
      this.queue.shift()!()
    }
  }
}

let current: FakeBrowser
const browser = () => current

function setup(initial = '#/') {
  const b = new FakeBrowser(initial)
  current = b
  const state = { dirty: false, answer: true, asked: 0, commits: [] as string[] }
  b.guard = createHashGuard({
    history: b.history,
    getHash: () => b.hash,
    needsConfirm: (from, to) => state.dirty && from !== to,
    confirm: () => {
      state.asked++
      if (state.answer) state.dirty = false
      return state.answer
    },
    onCommit: (hash) => state.commits.push(hash),
  })
  return { b, state }
}

describe('createHashGuard', () => {
  it('変更がなければ戻る・進むをそのまま通す', () => {
    const { b, state } = setup()
    b.push('#/edit/video')
    b.back()
    b.flush()
    expect(b.guard.committed()).toBe('#/')
    b.forward()
    b.flush()
    expect(b.guard.committed()).toBe('#/edit/video')
    expect(state.asked).toBe(0)
    expect(state.commits).toEqual(['#/edit/video', '#/', '#/edit/video'])
  })

  it('断られたら元の項目へ戻し、確定した画面は変えない', () => {
    const { b, state } = setup()
    b.push('#/edit/video')
    state.dirty = true
    state.answer = false
    b.back()
    b.flush()
    expect(state.asked).toBe(1)
    expect(b.hash).toBe('#/edit/video')
    expect(b.pos).toBe(1)
    expect(b.guard.committed()).toBe('#/edit/video')
    // 戻した後も履歴はそのまま。もう一度戻れば、もう一度確かめる
    expect(b.entries.map((entry) => entry.hash)).toEqual(['#/', '#/edit/video'])
    state.answer = true
    b.back()
    b.flush()
    expect(state.asked).toBe(2)
    expect(b.guard.committed()).toBe('#/')
  })

  it('何歩も跳んだときも同じ歩数だけ戻す', () => {
    const { b, state } = setup()
    b.push('#/edit/video')
    b.push('#/edit/audio')
    b.push('#/edit/image')
    state.dirty = true
    state.answer = false
    b.history.go(-3)
    b.flush()
    expect(b.pos).toBe(3)
    expect(b.guard.committed()).toBe('#/edit/image')
  })

  it('新しく積まれた項目を断ったら 1 つ戻す', () => {
    const { b, state } = setup()
    b.push('#/edit/video')
    state.dirty = true
    state.answer = false
    b.push('#/convert')
    b.flush()
    expect(b.hash).toBe('#/edit/video')
    expect(b.guard.committed()).toBe('#/edit/video')
  })

  it('同じ hash の項目へ跳んだ後も歩数を数え違えない', () => {
    const { b, state } = setup()
    b.push('#/edit/video')
    b.push('#/')
    b.history.go(-2)
    b.flush()
    b.push('#/edit/audio')
    state.dirty = true
    state.answer = false
    b.back()
    b.flush()
    expect(b.pos).toBe(1)
    expect(b.guard.committed()).toBe('#/edit/audio')
  })

  it('どんな操作の並びでも、落ち着いたら URL と確定した画面が一致し、確認は 1 操作に 1 回まで', () => {
    const hashes = ['#/', '#/edit/video', '#/edit/audio', '#/convert']
    const action = fc.oneof(
      fc.record({ type: fc.constant('push' as const), hash: fc.constantFrom(...hashes) }),
      fc.record({ type: fc.constant('go' as const), delta: fc.integer({ min: -3, max: 3 }) }),
      fc.record({ type: fc.constant('dirty' as const), value: fc.boolean() }),
      fc.record({ type: fc.constant('answer' as const), value: fc.boolean() })
    )
    fc.assert(
      fc.property(fc.array(action, { maxLength: 40 }), (actions) => {
        const { b, state } = setup()
        for (const a of actions) {
          const asked = state.asked
          const before = { pos: b.pos, committed: b.guard.committed(), length: b.entries.length }
          const events = b.events
          if (a.type === 'push') b.push(a.hash)
          else if (a.type === 'go') b.history.go(a.delta)
          else if (a.type === 'dirty') state.dirty = a.value
          else state.answer = a.value
          b.flush()

          expect(b.guard.committed()).toBe(b.hash)
          expect(state.asked - asked).toBeLessThanOrEqual(1)
          // 移動 1 回と、断ったときに戻す 1 回まで
          expect(b.events - events).toBeLessThanOrEqual(2)
          if (a.type === 'go') expect(b.entries.length).toBe(before.length)
          const declined = state.asked > asked && !state.answer
          if (declined && a.type === 'go') {
            expect(b.pos).toBe(before.pos)
            expect(b.guard.committed()).toBe(before.committed)
          }
          // 番号は履歴の位置と一致し続ける
          expect(b.entries[b.pos].state).toMatchObject({ baniIndex: b.pos })
        }
      }),
      { numRuns: 500 }
    )
  })
})

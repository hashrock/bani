import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
  MAX_DURATION,
  MAX_PLAYS,
  MIN_DURATION,
  applyGifEdit,
  clampDuration,
  createGifRecipe,
  frameAtTime,
  frameStartTime,
  totalDuration,
  type GifEdit,
  type GifRecipe,
} from './recipe'

const index = fc.integer({ min: -2, max: 30 })
const indices = fc.array(index, { maxLength: 8 })
const anyNumber = fc.oneof(fc.double({ noNaN: false }), fc.integer({ min: -100, max: 1_000_000 }))

const edit: fc.Arbitrary<GifEdit> = fc.oneof(
  fc
    .array(fc.record({ source: fc.integer({ min: -1, max: 4 }), frame: fc.integer({ min: -1, max: 9 }), duration: anyNumber }), {
      maxLength: 6,
    })
    .map((frames) => ({ type: 'append' as const, frames, size: { width: 40, height: 30 } })),
  indices.map((i) => ({ type: 'remove' as const, indices: i })),
  fc.record({ indices, to: fc.oneof(index, fc.double()) }).map((e) => ({ type: 'move' as const, ...e })),
  indices.map((i) => ({ type: 'duplicate' as const, indices: i })),
  indices.map((i) => ({ type: 'reverse' as const, indices: i })),
  fc.record({ indices, duration: anyNumber }).map((e) => ({ type: 'duration' as const, ...e })),
  anyNumber.map((duration) => ({ type: 'durationAll' as const, duration })),
  anyNumber.map((plays) => ({ type: 'plays' as const, plays })),
  fc.constantFrom<GifEdit>(
    { type: 'image', edit: { type: 'rotate', turns: 1 } },
    { type: 'image', edit: { type: 'crop', rect: { x: 5, y: 5, width: 10, height: 10 } } },
    { type: 'image', edit: { type: 'resize', resize: { width: 20, height: null, keepAspect: true, allowUpscale: true } } }
  )
)

const start = createGifRecipe({ width: 40, height: 30 }, [
  { source: 0, frame: 0, duration: 100 },
  { source: 0, frame: 1, duration: 50 },
  { source: 0, frame: 2, duration: 70 },
  { source: 1, frame: 0, duration: 1000 },
])

const reachable = fc.array(edit, { maxLength: 25 }).map((edits) => edits.reduce(applyGifEdit, start))

function invariants(recipe: GifRecipe) {
  const ids = recipe.frames.map((frame) => frame.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const frame of recipe.frames) {
    expect(frame.id).toBeLessThan(recipe.nextId)
    expect(frame.duration).toBeGreaterThanOrEqual(MIN_DURATION)
    expect(frame.duration).toBeLessThanOrEqual(MAX_DURATION)
    expect(frame.duration % 10).toBe(0)
    expect(Number.isInteger(frame.source) && frame.source >= 0).toBe(true)
    expect(Number.isInteger(frame.frame) && frame.frame >= 0).toBe(true)
  }
  expect(Number.isInteger(recipe.plays)).toBe(true)
  expect(recipe.plays).toBeGreaterThanOrEqual(0)
  expect(recipe.plays).toBeLessThanOrEqual(MAX_PLAYS)
}

const multiset = (recipe: GifRecipe) => recipe.frames.map((frame) => frame.id).sort((a, b) => a - b)

describe('applyGifEdit', () => {
  it('keeps ids unique, durations clamped to 10ms steps and plays in range', () => {
    fc.assert(fc.property(reachable, invariants), { numRuns: 500 })
  })

  it('moves are permutations that place the moved frames together at the target', () => {
    fc.assert(
      fc.property(reachable, indices, fc.integer({ min: -3, max: 40 }), (recipe, picked, to) => {
        const next = applyGifEdit(recipe, { type: 'move', indices: picked, to })
        expect(multiset(next)).toEqual(multiset(recipe))
        const valid = [...new Set(picked)].filter((i) => i >= 0 && i < recipe.frames.length).sort((a, b) => a - b)
        if (valid.length === 0) {
          expect(next).toBe(recipe)
          return
        }
        const movedIds = valid.map((i) => recipe.frames[i].id)
        const at = Math.max(0, Math.min(recipe.frames.length - valid.length, to))
        expect(next.frames.slice(at, at + valid.length).map((f) => f.id)).toEqual(movedIds)
        // 動かさなかったフレームの順番は変わらない
        const rest = (r: GifRecipe) => r.frames.map((f) => f.id).filter((id) => !movedIds.includes(id))
        expect(rest(next)).toEqual(rest(recipe))
      }),
      { numRuns: 300 }
    )
  })

  it('reverse is a permutation and undoes itself', () => {
    fc.assert(
      fc.property(reachable, indices, (recipe, picked) => {
        const once = applyGifEdit(recipe, { type: 'reverse', indices: picked })
        expect(multiset(once)).toEqual(multiset(recipe))
        const twice = applyGifEdit(once, { type: 'reverse', indices: picked })
        expect(twice.frames.map((f) => f.id)).toEqual(recipe.frames.map((f) => f.id))
      })
    )
  })

  it('remove drops exactly the chosen frames; duplicate adds one copy per chosen frame', () => {
    fc.assert(
      fc.property(reachable, indices, (recipe, picked) => {
        const valid = new Set(picked.filter((i) => i >= 0 && i < recipe.frames.length))
        const removed = applyGifEdit(recipe, { type: 'remove', indices: picked })
        expect(removed.frames).toEqual(recipe.frames.filter((_, i) => !valid.has(i)))
        const duplicated = applyGifEdit(recipe, { type: 'duplicate', indices: picked })
        expect(duplicated.frames.length).toBe(recipe.frames.length + valid.size)
        // 写しは元と同じ絵と表示時間を指す
        const key = (f: { source: number; frame: number; duration: number }) => `${f.source}:${f.frame}:${f.duration}`
        const added = duplicated.frames.filter((f) => f.id >= recipe.nextId).map(key).sort()
        expect(added).toEqual([...valid].map((i) => key(recipe.frames[i])).sort())
      })
    )
  })

  it('durationAll sets every frame and the total follows', () => {
    fc.assert(
      fc.property(reachable, fc.integer({ min: -50, max: 900_000 }), (recipe, duration) => {
        const next = applyGifEdit(recipe, { type: 'durationAll', duration })
        const clamped = clampDuration(duration)!
        expect(next.frames.every((frame) => frame.duration === clamped)).toBe(true)
        expect(totalDuration(next)).toBe(clamped * next.frames.length)
      })
    )
  })

  it('returns the same recipe when nothing changes', () => {
    expect(applyGifEdit(start, { type: 'move', indices: [0], to: 0 })).toBe(start)
    expect(applyGifEdit(start, { type: 'remove', indices: [99] })).toBe(start)
    expect(applyGifEdit(start, { type: 'plays', plays: 0 })).toBe(start)
    expect(applyGifEdit(start, { type: 'duration', indices: [0], duration: 100 })).toBe(start)
    expect(applyGifEdit(start, { type: 'durationAll', duration: Number.NaN })).toBe(start)
  })

  it('sets the canvas size from the first append of a new animation only', () => {
    const empty = createGifRecipe()
    const first = applyGifEdit(empty, { type: 'append', frames: [{ source: 0, frame: 0, duration: 100 }], size: { width: 8, height: 6 } })
    expect([first.width, first.height]).toEqual([8, 6])
    const second = applyGifEdit(first, { type: 'append', frames: [{ source: 1, frame: 0, duration: 100 }], size: { width: 99, height: 99 } })
    expect([second.width, second.height]).toEqual([8, 6])
    // キャンバスがないうちは全体の編集を受け付けない
    expect(applyGifEdit(empty, { type: 'image', edit: { type: 'rotate', turns: 1 } })).toBe(empty)
  })
})

describe('timing', () => {
  it('frameAtTime and frameStartTime agree', () => {
    fc.assert(
      fc.property(reachable, fc.nat(), (recipe, k) => {
        if (recipe.frames.length === 0) {
          expect(frameAtTime(recipe.frames, 0)).toBe(-1)
          return
        }
        const i = k % recipe.frames.length
        const startTime = frameStartTime(recipe.frames, i)
        expect(frameAtTime(recipe.frames, startTime)).toBe(i)
        expect(frameAtTime(recipe.frames, startTime + recipe.frames[i].duration - 1)).toBe(i)
        expect(frameAtTime(recipe.frames, totalDuration(recipe) + 5)).toBe(recipe.frames.length - 1)
      })
    )
  })
})

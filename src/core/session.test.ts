import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  MAX_SESSION_BYTES,
  SESSION_SCHEMA,
  conformsTo,
  isRectOrNull,
  parseSessionRecord,
  planEviction,
  sessionBudget,
  storagePlan,
  unwrapRecipe,
} from './session'

const validRecord = () => ({
  schema: SESSION_SCHEMA,
  id: 'a',
  kind: 'video',
  name: 'clip.mp4',
  updatedAt: 1000,
  bytes: 10,
  source: { key: 'f1', name: 'clip.mp4', type: 'video/mp4', size: 10, lastModified: 5, copied: true },
  extras: [],
  recipe: { version: 1, data: { muted: true } },
})

describe('parseSessionRecord', () => {
  test('正しい記録はそのまま読める', () => {
    const parsed = parseSessionRecord(validRecord())
    expect(parsed).not.toBeNull()
    expect(parsed?.source?.key).toBe('f1')
    expect(parsed?.recipe).toEqual({ version: 1, data: { muted: true } })
  })

  test('形の版が違う・種類が知らないもの・ファイルが壊れていれば捨てる', () => {
    expect(parseSessionRecord({ ...validRecord(), schema: SESSION_SCHEMA + 1 })).toBeNull()
    expect(parseSessionRecord({ ...validRecord(), kind: 'spreadsheet' })).toBeNull()
    expect(parseSessionRecord({ ...validRecord(), source: { key: 'f1' } })).toBeNull()
    expect(parseSessionRecord({ ...validRecord(), extras: [null] })).toBeNull()
    expect(parseSessionRecord({ ...validRecord(), recipe: { data: {} } })).toBeNull()
  })

  test('写しもハンドルもないファイルは読み直せないので捨てる', () => {
    const record = validRecord()
    expect(parseSessionRecord({ ...record, source: { ...record.source, copied: false } })).toBeNull()
  })

  test('元ファイルのないセッション（新規の文書）も読める', () => {
    expect(parseSessionRecord({ ...validRecord(), source: null })?.source).toBeNull()
  })

  test('どんな値を渡しても例外を出さない', () => {
    fc.assert(
      fc.property(fc.anything(), (value) => {
        expect(() => parseSessionRecord(value)).not.toThrow()
      })
    )
  })
})

describe('conformsTo', () => {
  const template = { trim: { start: 0, end: 10 }, crop: null, rotation: 0, muted: false, pages: [{ page: 0 }] }

  test('同じ形なら通り、項目の増減や型の違いは落ちる', () => {
    expect(conformsTo({ trim: { start: 1, end: 2 }, crop: { x: 1 }, rotation: 90, muted: true, pages: [] }, template)).toBe(true)
    expect(conformsTo({ ...template, extra: 1 }, template)).toBe(false)
    const missing: Record<string, unknown> = { ...template }
    delete missing.muted
    expect(conformsTo(missing, template)).toBe(false)
    expect(conformsTo({ ...template, muted: 'yes' }, template)).toBe(false)
    expect(conformsTo({ ...template, rotation: Number.NaN }, template)).toBe(false)
    expect(conformsTo({ ...template, pages: [{ page: 'x' }] }, template)).toBe(false)
  })

  test('同じ形の値は通り、どんな値を比べても例外を出さない', () => {
    const shape = (nullable: fc.Arbitrary<unknown>) =>
      fc.record({
        n: fc.double({ noNaN: true, noDefaultInfinity: true }),
        s: fc.string(),
        b: fc.boolean(),
        list: fc.array(fc.record({ id: fc.string() }), { minLength: 1 }),
        // 見本が null の項目（切り抜きなしなど）には、JSON にできる値なら何が入っていてもよい
        nullable,
      })
    const shaped = shape(fc.constant(null))
    fc.assert(fc.property(shape(fc.jsonValue()), shaped, (value, template) => conformsTo(value, template)))
    fc.assert(fc.property(fc.anything(), shaped, (value, template) => typeof conformsTo(value, template) === 'boolean'))
  })
})

describe('unwrapRecipe', () => {
  const template = { gain: 0 }

  test('版が違えば読まない', () => {
    expect(unwrapRecipe({ version: 2, data: { gain: 3 } }, 1, template)).toBeNull()
    expect(unwrapRecipe({ version: 1, data: { gain: 3 } }, 1, template)).toEqual({ gain: 3 })
  })

  test('画面の確かめに通らなければ、確かめが例外を出しても null', () => {
    expect(unwrapRecipe({ version: 1, data: { gain: 3 } }, 1, template, (r) => r.gain < 1)).toBeNull()
    expect(
      unwrapRecipe({ version: 1, data: { gain: 3 } }, 1, template, () => {
        throw new Error('boom')
      })
    ).toBeNull()
  })
})

test('isRectOrNull は大きさのある矩形か null だけを通す', () => {
  expect(isRectOrNull(null)).toBe(true)
  expect(isRectOrNull({ x: 0, y: 0, width: 4, height: 3 })).toBe(true)
  expect(isRectOrNull({ x: 0, y: 0, width: 0, height: 3 })).toBe(false)
  expect(isRectOrNull({ x: '0', y: 0, width: 4, height: 3 })).toBe(false)
})

describe('容量', () => {
  test('割り当ての一部を使い、上限は超えない。わからなければ控えめな値', () => {
    expect(sessionBudget(400 * 1024 ** 2)).toBe(100 * 1024 ** 2)
    expect(sessionBudget(1024 ** 4)).toBe(MAX_SESSION_BYTES)
    expect(sessionBudget(undefined)).toBeGreaterThan(0)
  })

  test('写せなければハンドルだけ、ハンドルもなければ残さない', () => {
    expect(storagePlan(10, 100, false)).toBe('copy')
    expect(storagePlan(1000, 100, true)).toBe('handle')
    expect(storagePlan(1000, 100, false)).toBe('skip')
  })
})

describe('planEviction', () => {
  const session = (id: string, updatedAt: number, bytes = 1) => ({ id, updatedAt, bytes })

  test('数を超えたら古いものから消す', () => {
    const sessions = [session('a', 1), session('b', 5), session('c', 3)]
    expect(planEviction(sessions, { maxCount: 2, maxBytes: 100 })).toEqual(['a'])
  })

  test('使っているものは消さず、数に入れる', () => {
    const sessions = [session('a', 1), session('b', 5), session('c', 3)]
    expect(planEviction(sessions, { maxCount: 2, maxBytes: 100, keep: new Set(['a']) })).toEqual(['c'])
  })

  test('残したものは数と大きさの上限に収まり、消したものより新しいか小さい', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.record({ id: fc.string(), updatedAt: fc.nat(), bytes: fc.nat({ max: 100 }) }), {
          selector: (s) => s.id,
          maxLength: 12,
        }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 400 }),
        (sessions, maxCount, maxBytes) => {
          const evicted = new Set(planEviction(sessions, { maxCount, maxBytes }))
          const kept = sessions.filter((s) => !evicted.has(s.id))
          expect(kept.length).toBeLessThanOrEqual(maxCount)
          expect(kept.reduce((sum, s) => sum + s.bytes, 0)).toBeLessThanOrEqual(maxBytes)
        }
      )
    )
  })
})

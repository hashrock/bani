import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { MEDIA_KINDS, formatRoute, parseHash } from './routes'
import type { Route } from './routes'

const knownRoute: fc.Arbitrary<Route> = fc.oneof(
  fc.constant({ name: 'hub' } as const),
  fc.constant({ name: 'convert' } as const),
  fc.constantFrom(...MEDIA_KINDS).map((kind) => ({ name: 'edit', kind }) as const)
)

/** 実際の hash に近い形（`/` 区切りの短い語）と、まったく任意の文字列を混ぜる */
const hash = fc.oneof(
  fc
    .array(fc.constantFrom('', 'edit', 'convert', 'video', 'pdf', 'x', 'Edit'), { maxLength: 4 })
    .map((segments) => `#/${segments.join('/')}`),
  fc.string()
)

describe('routes', () => {
  it('画面 → hash → 画面 で元に戻る', () => {
    fc.assert(
      fc.property(knownRoute, (route) => {
        expect(parseHash(formatRoute(route))).toEqual(route)
      })
    )
  })

  it('どんな hash も、読み直すと同じ画面に落ち着く', () => {
    fc.assert(
      fc.property(hash, (value) => {
        const route = parseHash(value)
        expect(parseHash(formatRoute(route))).toEqual(route)
      })
    )
  })

  it('空の hash は入口の画面', () => {
    for (const value of ['', '#', '#/', '#//']) {
      expect(parseHash(value)).toEqual({ name: 'hub' })
    }
  })

  it('知らない種類の編集画面は見つからない扱い', () => {
    expect(parseHash('#/edit/zip')).toEqual({ name: 'notFound', path: '/edit/zip' })
    expect(parseHash('#/edit/video/extra')).toEqual({
      name: 'notFound',
      path: '/edit/video/extra',
    })
  })
})

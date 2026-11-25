import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { detectKind, planIntake, refineKind, stillKind } from './intake'
import type { Capabilities } from './intake'
import { MEDIA_KINDS } from './routes'
import type { MediaKind } from './routes'

const kindOrNull = fc.option(fc.constantFrom(...MEDIA_KINDS), { nil: null })
const kindList = fc.subarray([...MEDIA_KINDS])
const capabilities: fc.Arbitrary<Capabilities> = fc.record({ edit: kindList, convert: kindList })

describe('detectKind', () => {
  it('MIME を拡張子より優先する', () => {
    expect(detectKind({ name: 'clip.pdf', type: 'video/mp4' })).toBe('video')
  })

  it('MIME が空なら拡張子で判定する（大文字も可）', () => {
    expect(detectKind({ name: 'Song.MP3', type: '' })).toBe('audio')
    expect(detectKind({ name: 'scan.pdf', type: '' })).toBe('pdf')
    expect(detectKind({ name: 'subs.srt', type: '' })).toBe('text')
  })

  it('コードはテキスト、圧縮ファイルは archive', () => {
    expect(detectKind({ name: 'data.json', type: 'application/json' })).toBe('text')
    expect(detectKind({ name: 'index.html', type: '' })).toBe('text')
    expect(detectKind({ name: 'logo.svg', type: 'image/svg+xml' })).toBe('text')
    expect(detectKind({ name: 'archive.zip', type: 'application/zip' })).toBe('archive')
    expect(detectKind({ name: 'backup.tar.gz', type: '' })).toBe('archive')
  })

  it('判定できなければ null', () => {
    expect(detectKind({ name: 'disk.iso', type: 'application/x-iso9660-image' })).toBeNull()
    expect(detectKind({ name: 'README', type: '' })).toBeNull()
  })
})

describe('planIntake', () => {
  it('すべてのファイルが受け付けか却下のどちらか一方に入る', () => {
    fc.assert(
      fc.property(fc.array(kindOrNull, { maxLength: 8 }), capabilities, (kinds, caps) => {
        const plan = planIntake(kinds, caps)
        if (!plan) return
        const all = [...plan.accepted, ...plan.rejected].sort((a, b) => a - b)
        expect(all).toEqual(kinds.map((_, index) => index))
      })
    )
  })

  it('受け付けたファイルは、移動先の画面が扱える種類だけ', () => {
    fc.assert(
      fc.property(fc.array(kindOrNull, { maxLength: 8 }), capabilities, (kinds, caps) => {
        const plan = planIntake(kinds, caps)
        if (!plan) return
        const allowed: readonly MediaKind[] =
          plan.route.name === 'edit' ? caps.edit : caps.convert
        for (const index of plan.accepted) {
          // アニメーションは、その画面がなければ画像として受け付ける
          const kind = kinds[index]!
          expect(allowed.includes(kind) || allowed.includes(stillKind(kind))).toBe(true)
        }
      })
    )
  })

  it('扱えるファイルが 1 つでもあれば、どこかの画面に渡る', () => {
    fc.assert(
      fc.property(fc.array(kindOrNull, { maxLength: 8 }), capabilities, (kinds, caps) => {
        const usable = kinds.some(
          (kind) =>
            kind !== null &&
            [kind, stillKind(kind)].some(
              (k) => caps.convert.includes(k) || (kinds.length === 1 && caps.edit.includes(k))
            )
        )
        expect(planIntake(kinds, caps) !== null).toBe(usable)
      })
    )
  })

  it('1 ファイルで編集できるなら単体編集、複数なら一括変換', () => {
    const caps: Capabilities = { edit: ['video'], convert: ['video'] }
    expect(planIntake(['video'], caps)?.route).toEqual({ name: 'edit', kind: 'video' })
    expect(planIntake(['video', 'video'], caps)?.route).toEqual({ name: 'convert' })
    expect(planIntake(['video', 'pdf'], caps)).toEqual({
      route: { name: 'convert' },
      accepted: [0],
      rejected: [1],
    })
  })
})

describe('アニメーション（gif）', () => {
  it('GIF の画面があればそこへ、なければ画像の画面へ。一括変換では画像として受け付ける', () => {
    const caps: Capabilities = { edit: ['image', 'gif'], convert: ['image'] }
    expect(planIntake(['gif'], caps)?.route).toEqual({ name: 'edit', kind: 'gif' })
    expect(planIntake(['gif'], { edit: ['image'], convert: [] })?.route).toEqual({ name: 'edit', kind: 'image' })
    expect(planIntake(['gif', 'image'], caps)).toEqual({ route: { name: 'convert' }, accepted: [0, 1], rejected: [] })
  })
})

describe('refineKind', () => {
  it('.ts は先頭が 0x47 なら動画、それ以外はコード', () => {
    expect(refineKind('video', 'clip.ts', new Uint8Array([0x47, 0x40]))).toBe('video')
    expect(refineKind('video', 'main.ts', new TextEncoder().encode('import'))).toBe('text')
    expect(refineKind(null, 'empty.mts', new Uint8Array())).toBe('text')
  })

  it('.ts 以外は変えない', () => {
    expect(refineKind('image', 'a.png', new Uint8Array([0x47]))).toBe('image')
  })
})

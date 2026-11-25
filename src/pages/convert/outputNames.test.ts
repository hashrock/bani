import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { resolveOutputNames, splitExtension } from './outputNames'

/**
 * 衝突を起こしやすいよう、名前を小さな部品から組み立てる。
 * 付け替え後の名前（`a (2).mp4`）や大文字違いが最初から入力に混ざる場合も作る
 */
const outputName = fc
  .tuple(
    fc.constantFrom('a', 'A', 'a (2)', 'a (3)', 'b', '.hidden', 'x.y'),
    fc.constantFrom('.mp4', '.MP4', '.txt', '')
  )
  .map(([base, extension]) => base + extension)

const names = fc.array(fc.oneof({ arbitrary: outputName, weight: 4 }, { arbitrary: fc.string(), weight: 1 }), {
  maxLength: 20,
})

const fold = (name: string) => name.toLowerCase()

describe('resolveOutputNames', () => {
  test('件数は変わらず、大文字・小文字を区別しなくても重複しない', () => {
    fc.assert(
      fc.property(names, (input) => {
        const output = resolveOutputNames(input)
        expect(output).toHaveLength(input.length)
        expect(new Set(output.map(fold)).size).toBe(output.length)
      })
    )
  })

  test('同じ名前の最初の 1 件だけが元の名前を保ち、ほかは付け替わる', () => {
    fc.assert(
      fc.property(names, (input) => {
        const output = resolveOutputNames(input)
        input.forEach((name, i) => {
          const first = input.findIndex((other) => fold(other) === fold(name)) === i
          expect(output[i] === name).toBe(first)
        })
      })
    )
  })

  test('付け替えた名前は元の名前に番号を足したもので、拡張子は変わらない', () => {
    fc.assert(
      fc.property(names, (input) => {
        const output = resolveOutputNames(input)
        input.forEach((name, i) => {
          if (output[i] === name) return
          const { base, extension } = splitExtension(name)
          expect(output[i].startsWith(`${base} (`)).toBe(true)
          expect(output[i].endsWith(`)${extension}`)).toBe(true)
        })
      })
    )
  })

  test('入力の中に元からある名前を、付け替えで奪わない', () => {
    fc.assert(
      fc.property(names, (input) => {
        const output = resolveOutputNames(input)
        const original = new Set(input.map(fold))
        output.forEach((name, i) => {
          if (name !== input[i]) expect(original.has(fold(name))).toBe(false)
        })
      })
    )
  })

  test('同じ入力からは同じ結果になり、元の名前を保った件は末尾に足しても変わらない', () => {
    fc.assert(
      fc.property(names, names, (input, more) => {
        expect(resolveOutputNames(input)).toEqual(resolveOutputNames([...input]))
        // 足した件が前の件の付け替えに使う番号を押さえることはあるので、元の名前を保つ件だけを比べる
        const before = resolveOutputNames(input)
        const after = resolveOutputNames([...input, ...more])
        before.forEach((name, i) => {
          if (name === input[i]) expect(after[i]).toBe(name)
        })
      })
    )
  })

  test('例: 番号は空いているもののうち最小を使う', () => {
    expect(resolveOutputNames(['a.mp4', 'A.mp4', 'a (2).mp4', 'a.mp4'])).toEqual([
      'a.mp4',
      'A (3).mp4',
      'a (2).mp4',
      'a (4).mp4',
    ])
  })
})

describe('splitExtension', () => {
  test('つなげ直すと元に戻り、拡張子は空か . で始まる', () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const { base, extension } = splitExtension(name)
        expect(base + extension).toBe(name)
        if (extension !== '') expect(extension.startsWith('.')).toBe(true)
      })
    )
  })

  test('先頭の . だけの名前（隠しファイル）は拡張子を持たない', () => {
    expect(splitExtension('.hidden')).toEqual({ base: '.hidden', extension: '' })
  })
})

import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { formatJson, minifyJson, offsetToLineColumn, validateJson } from './json'

describe('formatJson', () => {
  test('字下げして並べ直す。空の {} と [] は 1 行のまま', () => {
    const result = formatJson('{"a":1,"b":[true,null,{}],"c":[]}')
    expect(result).toEqual({
      ok: true,
      text: '{\n  "a": 1,\n  "b": [\n    true,\n    null,\n    {}\n  ],\n  "c": []\n}',
    })
  })

  test('字下げにタブも使える', () => {
    expect(formatJson('[1]', '\t')).toEqual({ ok: true, text: '[\n\t1\n]' })
  })

  test('数値・文字列の字句はそのまま残す（桁落ちやエスケープの展開をしない）', () => {
    const text = '{"big":12345678901234567890,"f":1.0,"e":1E+2,"s":"\\u00e9\\n","dup":1,"dup":2}'
    const formatted = formatJson(text)
    expect(formatted.ok).toBe(true)
    if (formatted.ok) expect(minifyJson(formatted.text)).toEqual({ ok: true, text })
  })

  test('JSON.parse が受け付けるものは受け付け、意味も変えない', () => {
    fc.assert(
      fc.property(fc.json(), (text) => {
        const formatted = formatJson(text)
        expect(formatted.ok).toBe(true)
        if (!formatted.ok) return
        expect(JSON.parse(formatted.text)).toEqual(JSON.parse(text))
        const minified = minifyJson(formatted.text)
        expect(minified.ok && JSON.parse(minified.text)).toEqual(JSON.parse(text))
      })
    )
  })

  test('JSON.parse が断るものは断る', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), (text) => {
        let parses = true
        try {
          JSON.parse(text)
        } catch {
          parses = false
        }
        expect(validateJson(text) === null).toBe(parses)
      }),
      { numRuns: 2000 }
    )
  })
})

describe('エラーの位置', () => {
  test('閉じ忘れは末尾で「途中で終わっています」', () => {
    expect(validateJson('{\n  "a": 1\n')).toMatchObject({ reason: 'unexpected-end', offset: 11, line: 3, column: 1 })
  })

  test('末尾のカンマは閉じ括弧の位置', () => {
    expect(validateJson('[1,\n2,\n]')).toMatchObject({ reason: 'unexpected-character', line: 3, column: 1 })
  })

  test('キーの引用符忘れ', () => {
    expect(validateJson('{a: 1}')).toMatchObject({ reason: 'unexpected-character', offset: 1, line: 1, column: 2 })
  })

  test('値のあとの余分なもの', () => {
    expect(validateJson('{} x')).toMatchObject({ reason: 'trailing-content', offset: 3 })
  })

  test('不正な数値と文字列', () => {
    expect(validateJson('[01]')).toMatchObject({ reason: 'unexpected-character', offset: 2 })
    expect(validateJson('[1.]')).toMatchObject({ reason: 'invalid-number', offset: 3 })
    expect(validateJson('["a\\x"]')).toMatchObject({ reason: 'invalid-string', offset: 4 })
    expect(validateJson('["a\nb"]')).toMatchObject({ reason: 'invalid-string', offset: 3 })
  })

  test('深すぎる入れ子はスタックを使い切る前に断る', () => {
    expect(validateJson('['.repeat(100_000))).toMatchObject({ reason: 'too-deep' })
  })
})

describe('offsetToLineColumn', () => {
  test('CRLF と CR も 1 つの改行と数え、サロゲートペアは 1 列', () => {
    expect(offsetToLineColumn('a\r\nb\rc', 5)).toEqual({ line: 3, column: 1 })
    expect(offsetToLineColumn('😀x', 3)).toEqual({ line: 1, column: 3 })
  })
})

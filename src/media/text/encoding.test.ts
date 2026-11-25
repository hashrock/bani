import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  TEXT_ENCODINGS,
  decodeBytes,
  detectEncoding,
  encodeText,
  findUnrepresentable,
  looksBinary,
  supportsBom,
} from './encoding'

const hex = (s: string) => new Uint8Array(s.trim().split(/\s+/).map((h) => parseInt(h, 16)))

/** 「こんにちは、世界。\r\nカタカナと漢字のテスト。\r\n」を各コードで書いたもの（別の実装で作った固定値） */
const GREETING = 'こんにちは、世界。\r\nカタカナと漢字のテスト。\r\n'
const FIXTURES = {
  shift_jis: hex(
    '82 b1 82 f1 82 c9 82 bf 82 cd 81 41 90 a2 8a 45 81 42 0d 0a 83 4a 83 5e 83 4a 83 69 82 c6 8a bf 8e 9a 82 cc 83 65 83 58 83 67 81 42 0d 0a'
  ),
  'euc-jp': hex(
    'a4 b3 a4 f3 a4 cb a4 c1 a4 cf a1 a2 c0 a4 b3 a6 a1 a3 0d 0a a5 ab a5 bf a5 ab a5 ca a4 c8 b4 c1 bb fa a4 ce a5 c6 a5 b9 a5 c8 a1 a3 0d 0a'
  ),
  'iso-2022-jp': hex(
    '1b 24 42 24 33 24 73 24 4b 24 41 24 4f 21 22 40 24 33 26 21 23 1b 28 42 0d 0a 1b 24 42 25 2b 25 3f 25 2b 25 4a 24 48 34 41 3b 7a 24 4e 25 46 25 39 25 48 21 23 1b 28 42 0d 0a'
  ),
} as const

const utf16 = (text: string, littleEndian: boolean, bom: boolean) => {
  const body = [...(bom ? [0xfeff] : []), ...Array.from(text, (c) => c.charCodeAt(0))]
  const bytes = new Uint8Array(body.length * 2)
  const view = new DataView(bytes.buffer)
  body.forEach((u, i) => view.setUint16(i * 2, u, littleEndian))
  return bytes
}

describe('detectEncoding', () => {
  test.each(Object.entries(FIXTURES))('%s のフィクスチャを見分けて読める', (encoding, bytes) => {
    expect(detectEncoding(bytes)).toEqual({ encoding, bom: false })
    expect(decodeBytes(bytes, encoding as keyof typeof FIXTURES)).toEqual({ text: GREETING, hasDecodeErrors: false })
  })

  test('機種依存文字や半角カナだけの Shift_JIS / EUC-JP も見分ける', () => {
    // 髙橋さんの①番
    expect(detectEncoding(hex('ee e0 8b b4 82 b3 82 f1 82 cc 87 40 94 d4')).encoding).toBe('shift_jis')
    expect(detectEncoding(hex('fc e2 b6 b6 a4 b5 a4 f3 a4 ce ad a1 c8 d6')).encoding).toBe('euc-jp')
    // ｱｲｳｴｵ
    expect(detectEncoding(hex('b1 b2 b3 b4 b5')).encoding).toBe('shift_jis')
    // 半角カナだけの EUC-JP（8E xx の並び）は Shift_JIS の漢字としても自然に読めてしまい、見分けられない。
    // 実際のファイルではひらがなが混ざるので、混ざれば EUC-JP に倒れることを確かめておく
    expect(detectEncoding(hex('8e b1 8e b2 a4 a2 a4 a4 a4 a6')).encoding).toBe('euc-jp')
    // どちらとしても読める短い「あい」（EUC-JP）は、日本語らしさで EUC-JP に倒す
    expect(detectEncoding(hex('a4 a2 a4 a4')).encoding).toBe('euc-jp')
  })

  test('BOM 付きの UTF-8 / UTF-16 を見分ける', () => {
    expect(detectEncoding(hex('ef bb bf 41'))).toEqual({ encoding: 'utf-8', bom: true })
    expect(detectEncoding(utf16('Aあ', true, true))).toEqual({ encoding: 'utf-16le', bom: true })
    expect(detectEncoding(utf16('Aあ', false, true))).toEqual({ encoding: 'utf-16be', bom: true })
  })

  test('BOM のない UTF-16 も ASCII 部分の偏りで見分ける', () => {
    expect(detectEncoding(utf16('Hello, 世界\n', true, false))).toEqual({ encoding: 'utf-16le', bom: false })
    expect(detectEncoding(utf16('Hello, 世界\n', false, false))).toEqual({ encoding: 'utf-16be', bom: false })
  })

  test('空と ASCII だけのものは UTF-8 とみなす', () => {
    expect(detectEncoding(new Uint8Array())).toEqual({ encoding: 'utf-8', bom: false })
    expect(detectEncoding(new TextEncoder().encode('plain ascii\n'))).toEqual({ encoding: 'utf-8', bom: false })
  })

  test('UTF-8 で書いた任意の文字列は UTF-8 と判定され、そのまま読み戻せる', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme', maxLength: 200 }), (text) => {
        // 先頭が U+FEFF だと BOM と区別できないので外す
        fc.pre(!text.startsWith('\ufeff'))
        const bytes = new TextEncoder().encode(text)
        const detected = detectEncoding(bytes)
        // ASCII の制御文字だけなどは UTF-16 の偏りと区別できないので、UTF-8 を名乗るものだけ読み戻す
        fc.pre(detected.encoding === 'utf-8')
        expect(decodeBytes(bytes, 'utf-8').text).toBe(text)
      })
    )
  })

  test('UTF-8 として壊れたバイト列でも例外にせず、置換文字で読んだことを知らせる', () => {
    expect(decodeBytes(hex('41 ff 42'), 'utf-8')).toEqual({ text: 'A\ufffdB', hasDecodeErrors: true })
  })
})

describe('encodeText', () => {
  test.each(Object.entries(FIXTURES))('%s へ書くとフィクスチャと同じバイト列になる', (encoding, bytes) => {
    const result = encodeText(GREETING, encoding as keyof typeof FIXTURES, false)
    expect(result.unrepresentable).toEqual([])
    expect(Array.from(result.bytes)).toEqual(Array.from(bytes))
  })

  test('BOM は Unicode 系にだけ付く', () => {
    expect(Array.from(encodeText('A', 'utf-8', true).bytes)).toEqual([0xef, 0xbb, 0xbf, 0x41])
    expect(Array.from(encodeText('A', 'utf-16le', true).bytes)).toEqual([0xff, 0xfe, 0x41, 0x00])
    expect(Array.from(encodeText('A', 'utf-16be', true).bytes)).toEqual([0xfe, 0xff, 0x00, 0x41])
    expect(Array.from(encodeText('A', 'shift_jis', true).bytes)).toEqual([0x41])
    expect(TEXT_ENCODINGS.filter(supportsBom)).toEqual(['utf-8', 'utf-16le', 'utf-16be'])
  })

  test('Shift_JIS で表せない絵文字は ? にして、文字・回数・最初の位置を知らせる', () => {
    const result = encodeText('あ😀\r\nい😀é', 'shift_jis', false)
    expect(new TextDecoder('shift_jis').decode(result.bytes)).toBe('あ?\r\nい??')
    expect(result.unrepresentable).toEqual([
      { char: '😀', codePoint: 0x1f600, count: 2, line: 1, column: 2 },
      { char: 'é', codePoint: 0xe9, count: 1, line: 2, column: 3 },
    ])
  })

  test('EUC-JP は補助漢字（JIS X 0212）の é を書けるが、ISO-2022-JP では書けない扱いにする', () => {
    expect(findUnrepresentable('é', 'euc-jp')).toEqual([])
    expect(findUnrepresentable('é', 'iso-2022-jp').map((c) => c.char)).toEqual(['é'])
  })

  test('Unicode 系では壊れたサロゲートだけを報告する', () => {
    expect(findUnrepresentable('😀é', 'utf-8')).toEqual([])
    expect(findUnrepresentable('a\ud800b', 'utf-16le')).toEqual([
      { char: '\ud800', codePoint: 0xd800, count: 1, line: 1, column: 2 },
    ])
  })

  test('CR だけ・LF だけ・CRLF のどれでも行番号を正しく数える', () => {
    const at = (text: string) => findUnrepresentable(text, 'shift_jis').map(({ line, column }) => [line, column])
    expect(at('a\rb\nc\r\n😀')).toEqual([[4, 1]])
    expect(at('\n\n😀')).toEqual([[3, 1]])
  })

  test('どの文字コードでも、表せない文字がなければ書いて読むと元に戻る', () => {
    // ひらがな・カタカナ・ASCII（JIS 系でも往復が保証される範囲）
    const char = fc.oneof(
      fc.integer({ min: 0x20, max: 0x7e }),
      fc.integer({ min: 0x3041, max: 0x3093 }),
      fc.integer({ min: 0x30a1, max: 0x30f6 }),
      fc.constantFrom(0x0a, 0x0d, 0x4e00, 0x6f22, 0x5b57)
    )
    const text = fc.array(char, { maxLength: 100 }).map((cs) => String.fromCodePoint(...cs))
    fc.assert(
      fc.property(text, fc.constantFrom(...TEXT_ENCODINGS), fc.boolean(), (text, encoding, bom) => {
        const { bytes, unrepresentable } = encodeText(text, encoding, bom)
        expect(unrepresentable).toEqual([])
        expect(decodeBytes(bytes, encoding).text).toBe(text)
      })
    )
  })

  test('Unicode 系では任意の（正しい）文字列が往復し、判定も BOM 付きで当たる', () => {
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme', maxLength: 100 }),
        fc.constantFrom('utf-8', 'utf-16le', 'utf-16be') as fc.Arbitrary<'utf-8' | 'utf-16le' | 'utf-16be'>,
        (text, encoding) => {
          const { bytes } = encodeText(text, encoding, true)
          expect(detectEncoding(bytes)).toEqual({ encoding, bom: true })
          expect(decodeBytes(bytes, encoding).text).toBe(text)
        }
      )
    )
  })
})

describe('looksBinary', () => {
  test('NUL を含むものや制御文字の多いものはバイナリとみなす', () => {
    expect(looksBinary('abc\0def')).toBe(true)
    expect(looksBinary('\x01\x02\x03abc')).toBe(true)
    expect(looksBinary('普通の文章\tタブ\r\n改行\f')).toBe(false)
    expect(looksBinary('')).toBe(false)
  })
})

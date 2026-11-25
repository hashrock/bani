import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { decodeBytes } from './encoding'
import { countLines, countNewlines, newlineStyle, probeText, probeTextBytes } from './probe'
import { DEFAULT_TEXT_RECIPE } from './recipe'
import { UnrepresentableCharactersError, renderText } from './render'

const bytes = (hex: string) => new Uint8Array(hex.split(' ').map((h) => parseInt(h, 16)))
/** 「あ\r\nい\r\n」の Shift_JIS */
const SJIS_LINES = bytes('82 a0 0d 0a 82 a2 0d 0a')

const fileOf = (content: Uint8Array | string, name = 'memo.txt', type = 'text/plain') =>
  new File([content as BlobPart], name, { type })

const bytesOf = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

describe('probeText', () => {
  test('文字コード・改行・行数・BOM をまとめて読む', async () => {
    expect(await probeText(fileOf(SJIS_LINES))).toEqual({
      encoding: 'shift_jis',
      bom: false,
      newline: 'crlf',
      newlineCounts: { lf: 0, crlf: 2, cr: 0 },
      text: 'あ\r\nい\r\n',
      lineCount: 2,
      hasDecodeErrors: false,
      likelyBinary: false,
    })
  })

  test('BOM は本文から取り除き、有無だけを残す', () => {
    const info = probeTextBytes(bytes('ef bb bf 61 0a 62'))
    expect(info).toMatchObject({ encoding: 'utf-8', bom: true, text: 'a\nb', newline: 'lf', lineCount: 2 })
  })

  test('改行の種類が混ざったものは mixed、改行のないものは none', () => {
    expect(newlineStyle(countNewlines('a\r\nb\nc'))).toBe('mixed')
    expect(newlineStyle(countNewlines('a\rb\rc'))).toBe('cr')
    expect(newlineStyle(countNewlines('abc'))).toBe('none')
  })

  test('行数は末尾の改行の後ろを数えない', () => {
    expect(countLines('')).toBe(0)
    expect(countLines('a')).toBe(1)
    expect(countLines('a\n')).toBe(1)
    expect(countLines('a\n\n')).toBe(2)
    expect(countLines('\r\n')).toBe(1)
  })

  test('改行の数え方は CRLF を 1 つと数え、split の結果と一致する', () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom('a', '\r', '\n', '\r\n')).map((p) => p.join('')), (text) => {
        const { lf, crlf, cr } = countNewlines(text)
        expect(lf + crlf + cr).toBe(text.split(/\r\n|\r|\n/).length - 1)
      })
    )
  })

  test('バイナリらしいものは likelyBinary を立てる', () => {
    expect(probeTextBytes(bytes('89 50 4e 47 0d 0a 1a 0a 00 00 00 0d 49 48 44 52')).likelyBinary).toBe(true)
  })
})

describe('renderText', () => {
  test('既定のレシピでは元のバイト列のまま書き出す', async () => {
    const out = await renderText(fileOf(SJIS_LINES), DEFAULT_TEXT_RECIPE)
    expect(Array.from(await bytesOf(out.blob))).toEqual(Array.from(SJIS_LINES))
    expect(out.filename).toBe('memo.txt')
    expect(out.blob.type).toBe('text/plain;charset=shift_jis')
  })

  test('Shift_JIS を BOM 付き UTF-8 / LF に変える', async () => {
    const recipe = { ...DEFAULT_TEXT_RECIPE, encoding: 'utf-8', bom: 'add', newline: 'lf' } as const
    const out = await renderText(fileOf(SJIS_LINES), recipe)
    const written = await bytesOf(out.blob)
    expect(Array.from(written.subarray(0, 3))).toEqual([0xef, 0xbb, 0xbf])
    expect(decodeBytes(written, 'utf-8').text).toBe('あ\nい\n')
    expect(out.unrepresentable).toEqual([])
  })

  test('元の種類（text/csv）は保って charset だけ付け直す', async () => {
    const out = await renderText(fileOf('a,b\n', 'list.csv', 'text/csv'), { ...DEFAULT_TEXT_RECIPE, encoding: 'euc-jp' })
    expect(out.blob.type).toBe('text/csv;charset=euc-jp')
  })

  test('表せない文字があれば既定では書き出さずに一覧つきで止める', async () => {
    const recipe = { ...DEFAULT_TEXT_RECIPE, encoding: 'shift_jis' as const }
    const error = await renderText(fileOf('ok 😀\n'), recipe).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(UnrepresentableCharactersError)
    expect((error as UnrepresentableCharactersError).characters).toEqual([
      { char: '😀', codePoint: 0x1f600, count: 1, line: 1, column: 4 },
    ])
  })

  test('replace を選べば ? に置き換えて書き出し、一覧も返す', async () => {
    const recipe = { ...DEFAULT_TEXT_RECIPE, encoding: 'shift_jis' as const }
    const out = await renderText(fileOf('ok 😀\n'), recipe, { unrepresentable: 'replace' })
    expect(new TextDecoder('shift_jis').decode(await bytesOf(out.blob))).toBe('ok ?\n')
    expect(out.unrepresentable.map((c) => c.char)).toEqual(['😀'])
  })

  test('不正な正規表現は書き出しを止めず、結果で知らせる', async () => {
    const recipe = {
      ...DEFAULT_TEXT_RECIPE,
      replacements: [{ id: 'x', find: '[', replace: '', regex: true, caseSensitive: true }],
    }
    const out = await renderText(fileOf('abc'), recipe)
    expect(await out.blob.text()).toBe('abc')
    expect(out.replacements[0]).toMatchObject({ id: 'x', ok: false })
  })

  test('中断されたら AbortError で止まり、進み具合は 0 から 1 へ増える', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(renderText(fileOf('a'), DEFAULT_TEXT_RECIPE, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    const progress: number[] = []
    await renderText(fileOf('a'), DEFAULT_TEXT_RECIPE, { onProgress: (p) => progress.push(p) })
    expect(progress[0]).toBe(0)
    expect(progress.at(-1)).toBe(1)
    expect([...progress].sort((a, b) => a - b)).toEqual(progress)
  })

  test('UTF-8 の任意の本文を BOM 付き UTF-16 に変えて読み直すと元に戻る', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ unit: 'grapheme', maxLength: 50 }).filter((s) => !s.startsWith('\ufeff')),
        fc.constantFrom('utf-16le', 'utf-16be') as fc.Arbitrary<'utf-16le' | 'utf-16be'>,
        async (text, encoding) => {
          const out = await renderText(fileOf(text), { ...DEFAULT_TEXT_RECIPE, encoding, bom: 'add' })
          const info = probeTextBytes(await bytesOf(out.blob))
          expect(info.encoding).toBe(encoding)
          expect(info.text).toBe(text)
        }
      ),
      { numRuns: 50 }
    )
  })
})

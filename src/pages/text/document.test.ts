import { Text } from '@codemirror/state'
import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { DEFAULT_TEXT_RECIPE, UnrepresentableCharactersError, applyTextEdit, decodeBytes, probeTextBytes } from '../../media/text'
import type { TextBase } from './document'
import {
  applyContentTools,
  baseAfterSave,
  dominantNewline,
  encodePrepared,
  isDocModified,
  isFormatChanged,
  minimalChange,
  prepareText,
} from './document'

const base: TextBase = {
  name: 'a.txt',
  type: 'text/plain',
  encoding: 'utf-8',
  bom: false,
  newline: 'lf',
  newlineDetected: 'lf',
  subtitle: null,
}

/** エディタと同じく、改行を \n にそろえた本文として持つ */
const docOf = (text: string) => Text.of(text.split(/\r\n|\r|\n/))

describe('isDocModified', () => {
  test('同じ中身なら別のオブジェクトでも変更なし、1 文字でも違えば変更あり', () => {
    const saved = docOf('abc\ndef')
    expect(isDocModified(saved, saved)).toBe(false)
    expect(isDocModified(docOf('abc\ndef'), saved)).toBe(false)
    expect(isDocModified(docOf('abc\ndeg'), saved)).toBe(true)
    expect(isDocModified(docOf('abc\nde'), saved)).toBe(true)
  })

  test('打って消せば（中身が戻れば）変更なしに戻る', () => {
    fc.assert(
      fc.property(fc.string(), fc.nat(), fc.string({ minLength: 1 }), (text, at, insert) => {
        const saved = docOf(text)
        const pos = at % (saved.length + 1)
        const typed = saved.replace(pos, pos, docOf(insert))
        expect(isDocModified(typed, saved)).toBe(true)
        const undone = typed.replace(pos, pos + docOf(insert).length, Text.empty)
        expect(isDocModified(undone, saved)).toBe(false)
      })
    )
  })
})

describe('isFormatChanged', () => {
  test('レシピが基準と同じ書き方を指すなら変更なし', () => {
    expect(isFormatChanged(base, DEFAULT_TEXT_RECIPE, null)).toBe(false)
    // 明示的に同じものを選んでも、書き出す中身は変わらない
    expect(isFormatChanged(base, applyTextEdit(DEFAULT_TEXT_RECIPE, { type: 'setNewline', newline: 'lf' }), null)).toBe(false)
    expect(isFormatChanged(base, applyTextEdit(DEFAULT_TEXT_RECIPE, { type: 'setEncoding', encoding: 'utf-8' }), null)).toBe(false)
  })

  test('文字コード・BOM・改行・字幕の形式のどれかが変われば変更あり', () => {
    const edit = (e: Parameters<typeof applyTextEdit>[1]) => applyTextEdit(DEFAULT_TEXT_RECIPE, e)
    expect(isFormatChanged(base, edit({ type: 'setEncoding', encoding: 'shift_jis' }), null)).toBe(true)
    expect(isFormatChanged(base, edit({ type: 'setBom', bom: 'add' }), null)).toBe(true)
    expect(isFormatChanged(base, edit({ type: 'setNewline', newline: 'crlf' }), null)).toBe(true)
    expect(isFormatChanged({ ...base, subtitle: 'srt' }, DEFAULT_TEXT_RECIPE, 'vtt')).toBe(true)
  })

  test('BOM を持てない文字コードでは BOM の指定は効かない', () => {
    const sjis = { ...base, encoding: 'shift_jis' as const }
    expect(isFormatChanged(sjis, applyTextEdit(DEFAULT_TEXT_RECIPE, { type: 'setBom', bom: 'add' }), null)).toBe(false)
  })
})

describe('dominantNewline', () => {
  test('いちばん多いもの。なければ LF', () => {
    expect(dominantNewline({ lf: 1, crlf: 5, cr: 0 })).toBe('crlf')
    expect(dominantNewline({ lf: 0, crlf: 0, cr: 0 })).toBe('lf')
    expect(dominantNewline({ lf: 2, crlf: 2, cr: 2 })).toBe('lf')
  })
})

describe('minimalChange', () => {
  test('差し替えれば b になり、範囲は変わったところだけ', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (a, b) => {
        const change = minimalChange(a, b)
        if (a === b) {
          expect(change).toBeNull()
          return
        }
        expect(change).not.toBeNull()
        const { from, to, insert } = change!
        expect(a.slice(0, from) + insert + a.slice(to)).toBe(b)
      })
    )
    expect(minimalChange('hello world', 'hello there world')).toEqual({ from: 6, to: 6, insert: 'there ' })
  })
})

describe('保存の流れ（エディタの本文 → バイト列 → 読み直し）', () => {
  test('元の改行と文字コードのまま書き戻す（そのままのレシピなら元と同じバイト列）', () => {
    const original = new Uint8Array([0x82, 0xa0, 0x0d, 0x0a, 0x41, 0x0d, 0x0a]) // 「あ」CRLF「A」CRLF（Shift_JIS）
    const info = probeTextBytes(original)
    expect(info.encoding).toBe('shift_jis')
    const fileBase: TextBase = {
      ...base,
      encoding: info.encoding,
      bom: info.bom,
      newline: dominantNewline(info.newlineCounts),
      newlineDetected: info.newline,
    }
    const editorText = docOf(info.text).toString()
    const prepared = prepareText(editorText, fileBase, DEFAULT_TEXT_RECIPE, null)
    const { blob } = encodePrepared(prepared, { replaceUnrepresentable: false })
    return blob.arrayBuffer().then((buffer) => expect(new Uint8Array(buffer)).toEqual(original))
  })

  test('表せない文字があれば止め、許せば ? にする', async () => {
    const recipe = applyTextEdit(DEFAULT_TEXT_RECIPE, { type: 'setEncoding', encoding: 'shift_jis' })
    const prepared = prepareText('a😀b', base, recipe, null)
    expect(() => encodePrepared(prepared, { replaceUnrepresentable: false })).toThrow(UnrepresentableCharactersError)
    const { blob, unrepresentable } = encodePrepared(prepared, { replaceUnrepresentable: true })
    expect(unrepresentable).toHaveLength(1)
    expect(decodeBytes(new Uint8Array(await blob.arrayBuffer()), 'shift_jis').text).toBe('a?b')
    expect(blob.type).toBe('text/plain;charset=shift_jis')
  })

  test('字幕の形式を変えると名前と MIME も変わり、エディタ用の本文は \\n のまま', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:02,000\r\nHello\r\n'
    const srtBase: TextBase = { ...base, name: 'movie.srt', type: '', newline: 'crlf', subtitle: 'srt' }
    const prepared = prepareText(docOf(srt).toString(), srtBase, DEFAULT_TEXT_RECIPE, 'vtt')
    expect(prepared.filename).toBe('movie.vtt')
    expect(prepared.type).toBe('text/vtt')
    expect(prepared.editorText.startsWith('WEBVTT\n')).toBe(true)
    expect(prepared.editorText).not.toContain('\r')
    expect(prepared.text).toContain('00:00:01.000 --> 00:00:02.000\r\n')
    const next = baseAfterSave(srtBase, prepared)
    expect(next).toMatchObject({ name: 'movie.vtt', subtitle: 'vtt', newline: 'crlf' })
    // 保存した中身が次の基準になるので、同じ設定のままなら「変更なし」
    expect(isFormatChanged(next, DEFAULT_TEXT_RECIPE, 'vtt')).toBe(false)
  })

  test('保存したあとは、保存した書き方が基準になる', () => {
    const recipe = applyTextEdit(
      applyTextEdit(DEFAULT_TEXT_RECIPE, { type: 'setEncoding', encoding: 'utf-16le' }),
      { type: 'setBom', bom: 'add' }
    )
    const prepared = prepareText('x', base, recipe, null)
    const next = baseAfterSave(base, prepared, 'renamed.txt')
    expect(next).toMatchObject({ name: 'renamed.txt', encoding: 'utf-16le', bom: true })
    expect(isFormatChanged(next, DEFAULT_TEXT_RECIPE, null)).toBe(false)
  })
})

describe('applyContentTools', () => {
  test('行末の空白・全角英数字・半角カナを、指定したものだけ直す', () => {
    expect(applyContentTools('a  \nｂ　\n', { trimTrailingWhitespace: true })).toBe('a\nｂ\n')
    expect(applyContentTools('ＡＢＣ１', { halfwidthAscii: true })).toBe('ABC1')
    expect(applyContentTools('ｶﾞｷﾞ', { fullwidthKana: true })).toBe('ガギ')
    expect(applyContentTools('ＡＢ  ', {})).toBe('ＡＢ  ')
  })
})

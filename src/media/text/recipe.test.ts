import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { createHistory, pushHistory, undoHistory } from '../../core/history'
import { TEXT_ENCODINGS, supportsBom } from './encoding'
import { countLines, countNewlines, newlineStyle } from './probe'
import type { TextEdit, TextRecipe, TextReplacement } from './recipe'
import {
  DEFAULT_TEXT_RECIPE,
  applyTextEdit,
  compileReplacement,
  convertNewlines,
  invalidReplacements,
  isDefaultTextRecipe,
  resolveTextOutput,
  transformText,
} from './recipe'

/** 改行の種類が混ざりやすいよう、改行と空白を多めに含む文字列 */
const textWithNewlines = fc
  .array(fc.oneof(fc.constantFrom('\n', '\r', '\r\n', ' ', '\t', '\u3000'), fc.string({ maxLength: 5 })), {
    maxLength: 30,
  })
  .map((parts) => parts.join(''))

const newlineTarget = fc.constantFrom('lf', 'crlf', 'cr') as fc.Arbitrary<'lf' | 'crlf' | 'cr'>

const replacement = (overrides: Partial<TextReplacement> = {}): TextReplacement => ({
  id: 'r1',
  find: '',
  replace: '',
  regex: false,
  caseSensitive: true,
  ...overrides,
})

const withReplacements = (...replacements: TextReplacement[]): TextRecipe => ({
  ...DEFAULT_TEXT_RECIPE,
  replacements,
})

describe('convertNewlines', () => {
  test('同じ改行コードへの変換は何度かけても同じ（冪等）', () => {
    fc.assert(
      fc.property(textWithNewlines, newlineTarget, (text, target) => {
        const once = convertNewlines(text, target)
        expect(convertNewlines(once, target)).toBe(once)
      })
    )
  })

  test('途中でどの改行コードを経由しても、最後の変換の結果は変わらない（往復できる）', () => {
    fc.assert(
      fc.property(textWithNewlines, newlineTarget, newlineTarget, (text, via, target) => {
        expect(convertNewlines(convertNewlines(text, via), target)).toBe(convertNewlines(text, target))
      })
    )
  })

  test('行数を変えず、変換後は 1 種類の改行だけになる', () => {
    fc.assert(
      fc.property(textWithNewlines, newlineTarget, (text, target) => {
        const converted = convertNewlines(text, target)
        expect(countLines(converted)).toBe(countLines(text))
        expect(['none', target]).toContain(newlineStyle(countNewlines(converted)))
      })
    )
  })

  test('keep は何もしない', () => {
    fc.assert(
      fc.property(textWithNewlines, (text) => {
        expect(convertNewlines(text, 'keep')).toBe(text)
      })
    )
  })
})

describe('transformText', () => {
  test('既定のレシピでは本文がそのまま残る', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (text) => {
        expect(transformText(text, DEFAULT_TEXT_RECIPE)).toEqual({ text, replacements: [] })
      })
    )
  })

  test('一致しない置換は本文を変えず、件数 0 を返す', () => {
    // 本文に出てこない文字を検索語に含める
    const text = fc.string().map((s) => s.replaceAll('#', ''))
    fc.assert(
      fc.property(text, fc.string(), fc.string(), fc.boolean(), fc.boolean(), (text, find, replace, regex, caseSensitive) => {
        const r = replacement({ find: regex ? `#${escape(find)}` : `#${find}`, replace, regex, caseSensitive })
        expect(transformText(text, withReplacements(r))).toEqual({ text, replacements: [{ id: 'r1', ok: true, count: 0 }] })
      })
    )
  })

  test('文字どおりの置換は検索語の出現をすべて置き換え、$ も記号もそのまま入れる', () => {
    fc.assert(
      fc.property(fc.array(fc.string().map((s) => s.replaceAll('#', ''))), fc.string(), (pieces, replace) => {
        const text = pieces.join('#.*$1')
        const result = transformText(text, withReplacements(replacement({ find: '#.*$1', replace })))
        expect(result.text).toBe(pieces.join(replace))
        expect(result.replacements).toEqual([{ id: 'r1', ok: true, count: Math.max(0, pieces.length - 1) }])
      })
    )
  })

  test('大文字小文字を区別しない置換', () => {
    const r = replacement({ find: 'abc', replace: 'x', caseSensitive: false })
    expect(transformText('ABC abc AbC', withReplacements(r)).text).toBe('x x x')
    expect(transformText('ABC abc', withReplacements({ ...r, caseSensitive: true })).text).toBe('ABC x')
  })

  test('正規表現の置換は $1 を展開し、^ $ は行ごとに効く', () => {
    const r = replacement({ find: '^(\\w+) (\\w+)$', replace: '$2 $1', regex: true })
    expect(transformText('hello world\nfoo bar', withReplacements(r))).toEqual({
      text: 'world hello\nbar foo',
      replacements: [{ id: 'r1', ok: true, count: 2 }],
    })
  })

  test('不正な正規表現は例外にせず、その置換だけ飛ばして理由を返す', () => {
    const bad = replacement({ id: 'bad', find: '(', regex: true })
    const good = replacement({ id: 'good', find: 'a', replace: 'b' })
    const recipe = withReplacements(bad, good)
    const result = transformText('aaa', recipe)
    expect(result.text).toBe('bbb')
    expect(result.replacements[0]).toMatchObject({ id: 'bad', ok: false })
    expect(result.replacements[1]).toEqual({ id: 'good', ok: true, count: 3 })
    expect(invalidReplacements(recipe).map((r) => r.id)).toEqual(['bad'])
  })

  test('どんな正規表現を与えても例外を投げない', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), fc.string(), fc.boolean(), (text, find, replace, caseSensitive) => {
        const r = replacement({ find, replace, regex: true, caseSensitive })
        expect(() => transformText(text, withReplacements(r))).not.toThrow()
        expect(compileReplacement(r).ok).toBe(invalidReplacements(withReplacements(r)).length === 0)
      })
    )
  })

  test('空の検索語（文字どおり）は何もしない', () => {
    expect(transformText('abc', withReplacements(replacement({ find: '', replace: 'x' }))).text).toBe('abc')
  })

  test('置換は上から順に適用される', () => {
    const recipe = withReplacements(
      replacement({ id: '1', find: 'a', replace: 'b' }),
      replacement({ id: '2', find: 'b', replace: 'c' })
    )
    expect(transformText('ab', recipe).text).toBe('cc')
    expect(transformText('ab', { ...recipe, replacements: [...recipe.replacements].reverse() }).text).toBe('bc')
  })

  test('行末の空白を落とすと、どの行も空白で終わらず、もう一度かけても変わらない', () => {
    const recipe = { ...DEFAULT_TEXT_RECIPE, trimTrailingWhitespace: true }
    fc.assert(
      fc.property(textWithNewlines, (text) => {
        const once = transformText(text, recipe).text
        expect(transformText(once, recipe).text).toBe(once)
        // CR と LF に挟まれた空白だけの行は、改行の構造を守るためにあえて残す
        const lines = once.replace(/\r[^\S\r\n]+(?=\n)/g, '\r').split(/\r\n|\r|\n/)
        for (const line of lines) expect(line).toBe(line.replace(/\s+$/, ''))
        // 空白だけの 1 行は空になって行数 0 になりうるので、改行の数で比べる
        expect(countNewlines(once)).toEqual(countNewlines(text))
      })
    )
    expect(transformText('a \t\u3000\r\nb  \nc ', recipe).text).toBe('a\r\nb\nc')
    expect(transformText('a\r  \nb', recipe).text).toBe('a\r  \nb')
  })

  test('全角英数字を半角に、半角カナを全角にする（全角空白は残す）', () => {
    const recipe = { ...DEFAULT_TEXT_RECIPE, halfwidthAscii: true, fullwidthKana: true }
    expect(transformText('ＡＢＣ１２３！～\u3000ｶﾞｷﾞｸﾞﾊﾟ｡', recipe).text).toBe('ABC123!~\u3000ガギグパ。')
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), (text) => {
        const once = transformText(text, recipe).text
        expect(transformText(once, recipe).text).toBe(once)
      })
    )
  })

  test('改行コードの指定があれば、置換や空白整理のあとでも 1 種類にそろう', () => {
    fc.assert(
      fc.property(textWithNewlines, newlineTarget, fc.boolean(), (text, newline, trim) => {
        const recipe = withReplacements(replacement({ find: ' ', replace: '\r' }))
        const result = transformText(text, { ...recipe, newline, trimTrailingWhitespace: trim })
        expect(['none', newline]).toContain(newlineStyle(countNewlines(result.text)))
      })
    )
  })
})

/** 正規表現の特殊文字を逃がす（u フラグで有効な範囲だけ） */
function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

const ids = ['a', 'b', 'c', 'd']
const editArb: fc.Arbitrary<TextEdit> = fc.oneof(
  fc.constantFrom('keep' as const, ...TEXT_ENCODINGS).map((encoding) => ({ type: 'setEncoding', encoding }) as const),
  fc.constantFrom('keep', 'add', 'remove').map((bom) => ({ type: 'setBom', bom }) as TextEdit),
  fc.constantFrom('keep', 'lf', 'crlf', 'cr').map((newline) => ({ type: 'setNewline', newline }) as TextEdit),
  fc.boolean().map((value) => ({ type: 'setTrimTrailingWhitespace', value }) as const),
  fc.boolean().map((value) => ({ type: 'setHalfwidthAscii', value }) as const),
  fc.boolean().map((value) => ({ type: 'setFullwidthKana', value }) as const),
  fc
    .record({ id: fc.constantFrom(...ids), find: fc.string(), index: fc.option(fc.integer({ min: -2, max: 6 }), { nil: undefined }) })
    .map(({ id, find, index }) => ({ type: 'addReplacement', replacement: replacement({ id, find }), index }) as const),
  fc
    .record({ id: fc.constantFrom(...ids), find: fc.option(fc.string(), { nil: undefined }), regex: fc.option(fc.boolean(), { nil: undefined }) })
    .map(({ id, find, regex }) => ({
      type: 'updateReplacement',
      id,
      patch: { ...(find === undefined ? {} : { find }), ...(regex === undefined ? {} : { regex }) },
    }) as const),
  fc.constantFrom(...ids).map((id) => ({ type: 'removeReplacement', id }) as const),
  fc.record({ id: fc.constantFrom(...ids), to: fc.integer({ min: -2, max: 6 }) }).map((e) => ({ type: 'moveReplacement', ...e }) as const),
  fc.constant({ type: 'reset' } as const)
)

describe('applyTextEdit', () => {
  const reach = (edits: TextEdit[]) => edits.reduce(applyTextEdit, DEFAULT_TEXT_RECIPE)

  test('どんな編集列をたどっても置換の id は重複しない', () => {
    fc.assert(
      fc.property(fc.array(editArb, { maxLength: 30 }), (edits) => {
        const list = reach(edits).replacements.map((r) => r.id)
        expect(new Set(list).size).toBe(list.length)
      })
    )
  })

  test('同じ編集を 2 回続けても 1 回と同じで、2 回目は同じオブジェクトを返す（履歴が積まれない）', () => {
    fc.assert(
      fc.property(fc.array(editArb, { maxLength: 20 }), editArb, (edits, edit) => {
        fc.pre(edit.type !== 'moveReplacement')
        const once = applyTextEdit(reach(edits), edit)
        expect(applyTextEdit(once, edit)).toBe(once)
      })
    )
  })

  test('元のレシピを書き換えない', () => {
    fc.assert(
      fc.property(fc.array(editArb, { maxLength: 20 }), editArb, (edits, edit) => {
        const before = reach(edits)
        const snapshot = structuredClone(before)
        applyTextEdit(before, edit)
        expect(before).toEqual(snapshot)
      })
    )
  })

  test('並べ替えは要素を失わず、指定の位置へ移す', () => {
    const recipe = ['a', 'b', 'c'].reduce(
      (r, id) => applyTextEdit(r, { type: 'addReplacement', replacement: replacement({ id }) }),
      DEFAULT_TEXT_RECIPE
    )
    const order = (r: TextRecipe) => r.replacements.map((x) => x.id).join('')
    expect(order(applyTextEdit(recipe, { type: 'moveReplacement', id: 'a', to: 2 }))).toBe('bca')
    expect(order(applyTextEdit(recipe, { type: 'moveReplacement', id: 'c', to: -5 }))).toBe('cab')
    expect(applyTextEdit(recipe, { type: 'moveReplacement', id: 'b', to: 1 })).toBe(recipe)
    expect(order(applyTextEdit(recipe, { type: 'addReplacement', replacement: replacement({ id: 'z' }), index: 1 }))).toBe('azbc')
  })

  test('reset で既定に戻り、履歴で取り消せる', () => {
    let history = createHistory(DEFAULT_TEXT_RECIPE)
    history = pushHistory(history, applyTextEdit(history.present, { type: 'setNewline', newline: 'crlf' }))
    history = pushHistory(history, applyTextEdit(history.present, { type: 'reset' }))
    expect(isDefaultTextRecipe(history.present)).toBe(true)
    expect(undoHistory(history).present.newline).toBe('crlf')
    // 既定のまま reset しても段は増えない
    expect(pushHistory(createHistory(DEFAULT_TEXT_RECIPE), applyTextEdit(DEFAULT_TEXT_RECIPE, { type: 'reset' })).past).toHaveLength(0)
  })
})

describe('resolveTextOutput', () => {
  test('BOM を持てない文字コードには、どの指定でも BOM を付けない', () => {
    fc.assert(
      fc.property(fc.array(editArb, { maxLength: 20 }), fc.constantFrom(...TEXT_ENCODINGS), fc.boolean(), (edits, encoding, bom) => {
        const recipe = edits.reduce(applyTextEdit, DEFAULT_TEXT_RECIPE)
        const out = resolveTextOutput(recipe, { encoding, bom })
        if (out.bom) expect(supportsBom(out.encoding)).toBe(true)
      })
    )
  })

  test('keep は元の文字コードと BOM を引き継ぐ', () => {
    expect(resolveTextOutput(DEFAULT_TEXT_RECIPE, { encoding: 'utf-8', bom: true })).toEqual({ encoding: 'utf-8', bom: true })
    expect(resolveTextOutput({ ...DEFAULT_TEXT_RECIPE, encoding: 'utf-16le' }, { encoding: 'utf-8', bom: true })).toEqual({
      encoding: 'utf-16le',
      bom: true,
    })
    expect(resolveTextOutput({ ...DEFAULT_TEXT_RECIPE, encoding: 'shift_jis' }, { encoding: 'utf-8', bom: true })).toEqual({
      encoding: 'shift_jis',
      bom: false,
    })
    expect(resolveTextOutput({ ...DEFAULT_TEXT_RECIPE, bom: 'add' }, { encoding: 'utf-8', bom: false }).bom).toBe(true)
    expect(resolveTextOutput({ ...DEFAULT_TEXT_RECIPE, bom: 'remove' }, { encoding: 'utf-8', bom: true }).bom).toBe(false)
  })
})

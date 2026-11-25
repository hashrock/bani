import fc from 'fast-check'
import { describe, expect, test } from 'vitest'
import { parseInline, parseMarkdown, safeHref } from './markdown'

describe('parseMarkdown', () => {
  test('見出し・段落・区切り線', () => {
    expect(parseMarkdown('# Title\n\nHello\nworld\n\n---\nSub\n===')).toEqual([
      { type: 'heading', level: 1, children: [{ type: 'text', text: 'Title' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'Hello world' }] },
      { type: 'hr' },
      { type: 'heading', level: 1, children: [{ type: 'text', text: 'Sub' }] },
    ])
  })

  test('囲みのコードは中身を解釈しない', () => {
    expect(parseMarkdown('```js\n# not heading\n**x**\n```')).toEqual([
      { type: 'code', lang: 'js', text: '# not heading\n**x**' },
    ])
  })

  test('リストの入れ子とタスク', () => {
    const [list] = parseMarkdown('- [x] done\n- todo\n  - child\n')
    expect(list).toMatchObject({
      type: 'list',
      ordered: false,
      items: [
        { checked: true, children: [{ type: 'paragraph' }] },
        { checked: null, children: [{ type: 'paragraph' }, { type: 'list', items: [{ checked: null }] }] },
      ],
    })
  })

  test('番号付きリストは開始番号を持つ', () => {
    expect(parseMarkdown('3. a\n4. b')[0]).toMatchObject({ type: 'list', ordered: true, start: 3 })
  })

  test('引用と表', () => {
    expect(parseMarkdown('> quote\n> more')[0]).toMatchObject({ type: 'quote', children: [{ type: 'paragraph' }] })
    expect(parseMarkdown('| a | b |\n|:-|-:|\n| 1 | 2 |')[0]).toMatchObject({
      type: 'table',
      align: ['left', 'right'],
      rows: [[[{ type: 'text', text: '1' }], [{ type: 'text', text: '2' }]]],
    })
  })

  test('先頭の前付けは見せない', () => {
    expect(parseMarkdown('---\ntitle: x\n---\n# H')).toEqual([
      { type: 'heading', level: 1, children: [{ type: 'text', text: 'H' }] },
    ])
  })

  test('どんな入力でも止まらずに終わる', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.constantFrom('#', '-', '*', '_', '`', '>', '|', '[', ']', '(', ')', '\n', ' ', '1.', '~'), fc.string({ maxLength: 3 }))).map((parts) => parts.join('')),
        (text) => {
          expect(() => parseMarkdown(text)).not.toThrow()
        }
      )
    )
  })
})

describe('parseInline', () => {
  test('強調・コード・リンク', () => {
    expect(parseInline('a **b** *c* `d` [e](https://x.test)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' ' },
      { type: 'link', href: 'https://x.test', children: [{ type: 'text', text: 'e' }] },
    ])
  })

  test('単語の途中の _ は強調にしない', () => {
    expect(parseInline('snake_case_name')).toEqual([{ type: 'text', text: 'snake_case_name' }])
  })

  test('HTML は文字として残る', () => {
    expect(parseInline('<script>alert(1)</script>')).toEqual([{ type: 'text', text: '<script>alert(1)</script>' }])
  })
})

describe('safeHref', () => {
  test('javascript: などは通さない', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref(' JavaScript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,x')).toBeNull()
    expect(safeHref('https://example.com')).toBe('https://example.com')
    expect(safeHref('mailto:a@example.com')).toBe('mailto:a@example.com')
    expect(safeHref('docs/a.md')).toBe('docs/a.md')
    expect(safeHref('#section')).toBe('#section')
  })
})

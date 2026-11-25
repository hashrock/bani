import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { breakLines, breakUnits, joinCues, layoutSubtitle, plainCueText, subtitleStyle } from './subtitleLayout'

/** 等幅として測る（全角は 2、半角は 1） */
const measure = (text: string) => [...text].reduce((sum, c) => sum + (c.charCodeAt(0) > 0xff ? 2 : 1), 0)

describe('breakLines', () => {
  test('和文は 1 文字ずつ折り返し、句読点・閉じ括弧を行頭に出さない', () => {
    const lines = breakLines('今日はいい天気ですね。散歩に行きましょう。', 22, measure)
    expect(lines).toEqual(['今日はいい天気ですね。', '散歩に行きましょう。'])
    expect(breakLines('あいうえおかきくけ、こ', 18, measure)).toEqual(['あいうえおかきく', 'け、こ'])
  })

  test('開き括弧を行末に残さない', () => {
    expect(breakLines('あいうえおかき「くけこ」', 16, measure)).toEqual(['あいうえおかき', '「くけこ」'])
  })

  test('欧文は語の切れ目で折り返し、行末の空白は残さない', () => {
    expect(breakLines('the quick brown fox jumps', 10, measure)).toEqual(['the quick', 'brown fox', 'jumps'])
  })

  test('幅を超える長い語は文字で割る', () => {
    expect(breakLines('abcdefghijkl', 5, measure)).toEqual(['abcde', 'fghij', 'kl'])
  })

  test('本文の改行は残す', () => {
    expect(breakLines('一行目\n二行目', 100, measure)).toEqual(['一行目', '二行目'])
  })

  test('どんな本文でも、行は空でなく、幅を超えるのは 1 文字だけの行に限り、文字（空白を除く）は落とさない', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('あ', 'い', '漢', '。', '、', '「', '」', 'a', 'b', 'word', ' ', '!', 'ー', '\n'), {
          maxLength: 60,
        }),
        fc.integer({ min: 2, max: 40 }),
        (parts, width) => {
          const text = parts.join('')
          const lines = breakLines(text, width, measure)
          for (const line of lines) {
            expect(line).not.toBe('')
            if (measure(line) > width) {
              // 禁則でくっつけた分（句読点を前に寄せた）だけははみ出しうる
              expect([...line].length).toBeLessThanOrEqual(width)
            }
          }
          expect(lines.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''))
        }
      )
    )
  })
})

describe('breakUnits', () => {
  test('禁則の文字を隣にくっつける', () => {
    expect(breakUnits('「あ」い。')).toEqual(['「あ」', 'い。'])
    expect(breakUnits('Hello world')).toEqual(['Hello ', 'world'])
  })
})

describe('本文と見た目', () => {
  test('タグと文字参照を落とし、空行を詰める', () => {
    expect(plainCueText('<i>斜体</i> &amp; <c.yellow>色</c>\n\n<v 話者>声')).toBe('斜体 & 色\n声')
    expect(joinCues([{ start: 0, end: 1, text: 'a' }, { start: 0, end: 1, text: '<b></b>' }, { start: 0, end: 1, text: 'b' }])).toBe(
      'a\nb'
    )
  })

  test('文字の大きさは高さに比例し、縦長では幅でも抑える', () => {
    expect(subtitleStyle(1920, 1080).fontSize).toBe(59)
    expect(subtitleStyle(1080, 1920).fontSize).toBeLessThanOrEqual(Math.round(1080 * 0.07))
    expect(subtitleStyle(10, 10).fontSize).toBe(12)
  })

  test('最後の行が下の余白の位置に来るよう、下から積む', () => {
    const { style, lines } = layoutSubtitle('一\n二', 1280, 720, measure)
    expect(lines.map((l) => l.text)).toEqual(['一', '二'])
    expect(lines[1].y).toBe(style.baseline)
    expect(lines[0].y).toBe(style.baseline - style.lineHeight)
    expect(lines[0].x).toBe(640)
  })
})

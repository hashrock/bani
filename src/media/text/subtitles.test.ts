import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import type { SubtitleCue } from './subtitles'
import {
  detectSubtitleFormat,
  formatTimestamp,
  framerateFactor,
  parseSrt,
  parseSubtitles,
  parseTimestamp,
  parseVtt,
  scaleSubtitles,
  serializeSrt,
  serializeSubtitles,
  serializeVtt,
  shiftSubtitles,
  srtCueTextToVtt,
  srtToVtt,
  vttCueTextToSrt,
  vttToSrt,
} from './subtitles'

/** 100 時間まで。SRT の時は 2 桁を超えてもよい */
const time = fc.integer({ min: 0, max: 100 * 3600 * 1000 })

/** 空行にならず、時刻の行とも紛れない 1 行 */
const textLine = fc
  .string({ unit: 'grapheme', minLength: 1, maxLength: 20 })
  .map((s) => s.replace(/[\r\n]/g, ' ').replaceAll('-->', '->'))
  .filter((s) => s.trim() !== '')

const cueArb = (withVttFields: boolean): fc.Arbitrary<SubtitleCue> =>
  fc
    .record({
      start: time,
      length: fc.integer({ min: 0, max: 10_000 }),
      lines: fc.array(textLine, { maxLength: 3 }),
      id: withVttFields ? fc.option(textLine.map((s) => s.trim()), { nil: undefined }) : fc.constant(undefined),
      settings: withVttFields
        ? fc.option(fc.constantFrom('align:start', 'line:0 position:10%', 'size:50%'), { nil: undefined })
        : fc.constant(undefined),
    })
    .map(({ start, length, lines, id, settings }) => ({
      start,
      end: start + length,
      text: lines.join('\n'),
      ...(id === undefined ? {} : { id }),
      ...(settings === undefined ? {} : { settings }),
    }))

const sortedCues = (withVttFields: boolean) =>
  fc.array(cueArb(withVttFields), { maxLength: 15 }).map((cues) => [...cues].sort((a, b) => a.start - b.start))

const SRT = `1
00:00:01,000 --> 00:00:02,500
こんにちは
<i>二行目</i>

2
00:00:03,000 --> 00:00:04,000
Hello & <font color="red">world</font>
`

const VTT = `WEBVTT - 見出し
Kind: captions

NOTE これは注釈

STYLE
::cue { color: yellow }

intro
00:01.000 --> 00:02.500 align:start line:0
<v 話者>こんにちは</v> &amp; 1 &lt; 2

00:00:03.000 --> 00:00:04.000
Hello
`

describe('時刻', () => {
  test('書いて読むと元に戻る', () => {
    fc.assert(
      fc.property(time, fc.constantFrom(',', '.') as fc.Arbitrary<',' | '.'>, (ms, sep) => {
        expect(parseTimestamp(formatTimestamp(ms, sep))).toBe(ms)
      })
    )
  })

  test('時の省略・区切りの違い・短い小数部を受け付け、壊れたものは null', () => {
    expect(parseTimestamp('01:02.5')).toBe(62_500)
    expect(parseTimestamp('1:02:03.004')).toBe(3_723_004)
    expect(parseTimestamp('123:00:00,000')).toBe(123 * 3_600_000)
    expect(parseTimestamp('00:60:00,000')).toBeNull()
    expect(parseTimestamp('abc')).toBeNull()
    expect(formatTimestamp(3_723_004, ',')).toBe('01:02:03,004')
  })
})

describe('SRT', () => {
  test('番号・時刻・複数行の本文を読む', () => {
    expect(parseSrt(SRT)).toEqual({
      cues: [
        { start: 1000, end: 2500, text: 'こんにちは\n<i>二行目</i>' },
        { start: 3000, end: 4000, text: 'Hello & <font color="red">world</font>' },
      ],
      errors: [],
    })
  })

  test('CRLF・BOM・番号の抜け・空白だけの区切り行に耐え、壊れたブロックは行番号つきで飛ばす', () => {
    const messy = '\ufeff1\r\n00:00:01,000 --> 00:00:02,000\r\nA\r\n   \r\n00:00:03,000 --> 00:00:04,000\r\nB\r\n\r\n3\r\nxx --> yy\r\nC\r\n\r\nただの行\r\n'
    expect(parseSrt(messy)).toEqual({
      cues: [
        { start: 1000, end: 2000, text: 'A' },
        { start: 3000, end: 4000, text: 'B' },
      ],
      errors: [
        { line: 9, reason: 'invalid-timing' },
        { line: 12, reason: 'unknown-block' },
      ],
    })
  })

  test('書いて読むと元に戻り、並び順も保たれる', () => {
    fc.assert(
      fc.property(sortedCues(false), (cues) => {
        expect(parseSrt(serializeSrt(cues))).toEqual({ cues, errors: [] })
      })
    )
  })

  test('本文の空行は区切りと紛れるので書くときに落とす', () => {
    const text = serializeSrt([{ start: 0, end: 1000, text: 'a\n\nb' }])
    expect(parseSrt(text).cues).toEqual([{ start: 0, end: 1000, text: 'a\nb' }])
  })
})

describe('VTT', () => {
  test('見出し・注釈・スタイルを飛ばし、識別子と配置指定を読む', () => {
    expect(parseVtt(VTT)).toEqual({
      cues: [
        {
          start: 1000,
          end: 2500,
          text: '<v 話者>こんにちは</v> &amp; 1 &lt; 2',
          id: 'intro',
          settings: 'align:start line:0',
        },
        { start: 3000, end: 4000, text: 'Hello' },
      ],
      errors: [],
    })
  })

  test('WEBVTT の見出しがなければ知らせつつ読み進める', () => {
    expect(parseVtt('00:01.000 --> 00:02.000\nA\n')).toEqual({
      cues: [{ start: 1000, end: 2000, text: 'A' }],
      errors: [{ line: 1, reason: 'missing-header' }],
    })
  })

  test('見出しの直後に空行なしで字幕が続く崩れたファイルも読む', () => {
    expect(parseVtt('WEBVTT\n00:01.000 --> 00:02.000\nA\n').cues).toEqual([{ start: 1000, end: 2000, text: 'A' }])
  })

  test('書いて読むと識別子・配置指定ごと元に戻る', () => {
    fc.assert(
      fc.property(sortedCues(true), (cues) => {
        expect(parseVtt(serializeVtt(cues))).toEqual({ cues, errors: [] })
      })
    )
  })

  test('形式の判定', () => {
    expect(detectSubtitleFormat(VTT)).toBe('vtt')
    expect(detectSubtitleFormat('\ufeffWEBVTT\n')).toBe('vtt')
    expect(detectSubtitleFormat('WEBVTTX\n')).toBe('srt')
    expect(detectSubtitleFormat(SRT)).toBe('srt')
    expect(parseSubtitles(VTT).cues).toHaveLength(2)
    expect(serializeSubtitles([], 'vtt')).toBe('WEBVTT\n')
    expect(serializeSubtitles([], 'srt')).toBe('')
  })
})

describe('SRT と VTT の相互変換', () => {
  test('SRT → VTT: font タグと ASS の指定を落とし、& と < を逃がす', () => {
    expect(srtCueTextToVtt('{\\an8}<font color="red">a</font> & <B>b</B> < c &amp;')).toBe(
      'a &amp; <b>b</b> &lt; c &amp;'
    )
    const { text, errors } = srtToVtt(SRT)
    expect(errors).toEqual([])
    expect(parseVtt(text).cues.map((c) => c.text)).toEqual(['こんにちは\n<i>二行目</i>', 'Hello &amp; world'])
  })

  test('VTT → SRT: 話者などのタグを落とし、文字参照を戻し、配置指定と識別子は捨てる', () => {
    expect(vttCueTextToSrt('<v 話者>a</v> <c.red>b</c> <00:00:01.000>c <i>d</i> &amp;&lt;&gt;')).toBe('a b c <i>d</i> &<>')
    const { text } = vttToSrt(VTT)
    expect(parseSrt(text).cues).toEqual([
      { start: 1000, end: 2500, text: 'こんにちは & 1 < 2' },
      { start: 3000, end: 4000, text: 'Hello' },
    ])
  })

  test('記号を含まない本文なら SRT → VTT → SRT で時刻も本文も変わらない', () => {
    const plain = fc.array(
      fc.record({ start: time, length: fc.integer({ min: 0, max: 5000 }), text: textLine.filter((s) => !/[<>&{]/.test(s)) }),
      { maxLength: 10 }
    )
    fc.assert(
      fc.property(plain, (raw) => {
        const cues = raw.map(({ start, length, text }) => ({ start, end: start + length, text }))
        expect(parseSrt(vttToSrt(srtToVtt(serializeSrt(cues)).text).text).cues).toEqual(cues)
      })
    )
  })
})

describe('タイミング', () => {
  test('a ずらしてから −a ずらすと、0 で詰まらない限り元に戻る', () => {
    fc.assert(
      fc.property(sortedCues(true), fc.integer({ min: -100_000, max: 100_000 }), (cues, a) => {
        // 先に早める側で詰まる（0 未満になる）ものは除く
        fc.pre(cues.every((c) => c.start + Math.min(a, 0) >= 0))
        expect(shiftSubtitles(shiftSubtitles(cues, a), -a)).toEqual(cues)
      })
    )
  })

  test('ずらしても 0 より前には出ず、並び順と字幕の長さの順序は保たれる', () => {
    fc.assert(
      fc.property(sortedCues(false), fc.integer({ min: -200_000, max: 200_000 }), (cues, a) => {
        const shifted = shiftSubtitles(cues, a)
        for (const cue of shifted) {
          expect(cue.start).toBeGreaterThanOrEqual(0)
          expect(cue.end).toBeGreaterThanOrEqual(cue.start)
        }
        for (let i = 1; i < shifted.length; i++) expect(shifted[i].start).toBeGreaterThanOrEqual(shifted[i - 1].start)
        // 捨てるのは終わりまで 0 以前に押し出されたものだけ
        expect(shifted).toHaveLength(cues.filter((c) => !(a < 0 && c.end + a <= 0)).length)
      })
    )
  })

  test('早めて開始が 0 を割る字幕は 0 に詰め、終わりまで割るものは捨てる', () => {
    const cues = [
      { start: 500, end: 1500, text: 'a' },
      { start: 2000, end: 3000, text: 'b' },
    ]
    expect(shiftSubtitles(cues, -1000)).toEqual([
      { start: 0, end: 500, text: 'a' },
      { start: 1000, end: 2000, text: 'b' },
    ])
    expect(shiftSubtitles(cues, -1500)).toEqual([{ start: 500, end: 1500, text: 'b' }])
  })

  test('倍率をかけても並び順は崩れず、1 倍は何もしない', () => {
    fc.assert(
      fc.property(sortedCues(false), fc.double({ min: 0.5, max: 2, noNaN: true }), (cues, factor) => {
        const scaled = scaleSubtitles(cues, factor)
        for (let i = 1; i < scaled.length; i++) expect(scaled[i].start).toBeGreaterThanOrEqual(scaled[i - 1].start)
        for (const cue of scaled) expect(cue.end).toBeGreaterThanOrEqual(cue.start)
        expect(scaleSubtitles(cues, 1)).toEqual(cues)
      })
    )
  })

  test('フレームレートの補正倍率（23.976fps 用を 25fps に合わせる）', () => {
    const factor = framerateFactor(24000 / 1001, 25)
    expect(scaleSubtitles([{ start: 1_000_000, end: 1_001_000, text: '' }], factor)[0].start).toBe(959_041)
    expect(() => scaleSubtitles([], 0)).toThrow(RangeError)
  })
})

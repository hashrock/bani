import { describe, expect, test } from 'vitest'
import { parseSubtitles } from '../../media/text'
import { shiftTimingLines } from './subtitle'

describe('shiftTimingLines', () => {
  test('時刻の行だけを書き換え、区切りと配置指定・注釈は残す', () => {
    const vtt = 'WEBVTT\n\nNOTE keep me\n\nintro\n00:01.000 --> 00:02.500 align:start\nHello --> world\n'
    const result = shiftTimingLines(vtt, 1500)
    expect(result.text).toBe(
      'WEBVTT\n\nNOTE keep me\n\nintro\n00:00:02.500 --> 00:00:04.000 align:start\nHello --> world\n'
    )
    expect(result).toMatchObject({ shifted: 1, clamped: 0 })
  })

  test('SRT は , のまま。0 より前は 0 に詰めて数える', () => {
    const srt = '1\r\n00:00:01,000 --> 00:00:02,000\r\nA\r\n\r\n2\r\n00:00:05,000 --> 00:00:06,000\r\nB\r\n'
    const result = shiftTimingLines(srt, -3000)
    expect(result.text).toContain('00:00:00,000 --> 00:00:00,000\r\n')
    expect(result.text).toContain('00:00:02,000 --> 00:00:03,000\r\n')
    expect(result).toMatchObject({ shifted: 2, clamped: 1 })
  })

  test('ずらした結果も字幕として読め、時刻が差の分だけ動く', () => {
    const srt = '1\n00:00:01,000 --> 00:00:02,000\nA\n\n2\n00:10:00,250 --> 00:10:01,000\nB\n'
    const before = parseSubtitles(srt, 'srt').cues
    const after = parseSubtitles(shiftTimingLines(srt, 250).text, 'srt').cues
    expect(after.map((c) => [c.start, c.end, c.text])).toEqual(before.map((c) => [c.start + 250, c.end + 250, c.text]))
  })

  test('0 ならそのまま', () => {
    expect(shiftTimingLines('x', 0)).toEqual({ text: 'x', shifted: 0, clamped: 0 })
  })
})

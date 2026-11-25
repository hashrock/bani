import { formatTimestamp, parseTimestamp } from '../../media/text'

export interface ShiftResult {
  text: string
  /** 書き換えた時刻の行の数 */
  shifted: number
  /** 0 より前に押し出され、0 に詰めた字幕の数（表示されなくなる） */
  clamped: number
}

const TIMING_LINE = /^(\s*)(\S+)(\s*-->\s*)(\S+)(.*)$/

/**
 * 時刻の行（`00:00:01,000 --> 00:00:02,000`）だけを書き換えてずらす。
 * 読み直して書き出す（shiftSubtitles + serializeSubtitles）と、VTT の NOTE・STYLE や
 * 番号の振り方、字幕本文の空白まで作り直されてしまうので、エディタの中では行単位で差し替える。
 * 区切り（, か .）と配置指定は元の行のまま残す
 */
export function shiftTimingLines(text: string, ms: number): ShiftResult {
  const delta = Math.round(ms)
  let shifted = 0
  let clamped = 0
  if (delta === 0) return { text, shifted, clamped }
  const out = text.replace(/[^\r\n]+/g, (line) => {
    if (!line.includes('-->')) return line
    const m = TIMING_LINE.exec(line)
    if (!m) return line
    const [, lead, startText, arrow, endText, rest] = m
    const start = parseTimestamp(startText)
    const end = parseTimestamp(endText)
    if (start === null || end === null) return line
    shifted++
    if (end + delta <= 0) clamped++
    const separator = /,\d+$/.test(startText) ? ',' : '.'
    return `${lead}${formatTimestamp(start + delta, separator)}${arrow}${formatTimestamp(end + delta, separator)}${rest}`
  })
  return { text: out, shifted, clamped }
}

/**
 * 字幕（SRT / WebVTT）の読み書きとタイミング調整。時刻はミリ秒の整数で持つ。
 * 実際のファイルは仕様から外れたものが多いので、読みは寛容にして、読めなかったブロックは
 * 止まらずに飛ばし、行番号つきで知らせる。
 */

export interface SubtitleCue {
  /** 表示開始（ミリ秒） */
  readonly start: number
  /** 表示終了（ミリ秒） */
  readonly end: number
  /** 改行は \n。空行は含まない（空行は字幕の区切りになるため） */
  readonly text: string
  /** VTT の識別子。SRT の番号は並び順そのものなので持たない */
  readonly id?: string
  /** VTT の配置指定（`align:start line:0` など） */
  readonly settings?: string
}

export type SubtitleFormat = 'srt' | 'vtt'

export interface SubtitleParseError {
  /** 1 始まりの行番号 */
  line: number
  reason: 'missing-header' | 'invalid-timing' | 'unknown-block'
}

export interface ParsedSubtitles {
  cues: SubtitleCue[]
  errors: SubtitleParseError[]
}

interface Block {
  /** 先頭行の行番号（1 始まり） */
  line: number
  lines: string[]
}

/** 空白だけの行も区切りとみなす。手で編集された SRT にはよくある */
function splitBlocks(text: string): Block[] {
  const lines = text.replace(/^\ufeff/, '').split(/\r\n|\r|\n/)
  const blocks: Block[] = []
  let current: Block | null = null
  lines.forEach((line, i) => {
    if (line.trim() === '') {
      current = null
      return
    }
    if (!current) blocks.push((current = { line: i + 1, lines: [] }))
    current.lines.push(line)
  })
  return blocks
}

/** `01:02:03,456` / `1:02:03.4` / `02:03.456`（時なし）を受け付ける */
const TIMESTAMP = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})$/

export function parseTimestamp(value: string): number | null {
  const m = TIMESTAMP.exec(value.trim())
  if (!m) return null
  const [hours, minutes, seconds] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])]
  if (minutes >= 60 || seconds >= 60) return null
  // 小数部の桁が足りないものは右を 0 で埋める（.5 は 500 ミリ秒）
  const millis = Number(m[4].padEnd(3, '0'))
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis
}

export function formatTimestamp(ms: number, separator: ',' | '.'): string {
  const total = Math.max(0, Math.round(ms))
  const millis = total % 1000
  const seconds = Math.floor(total / 1000) % 60
  const minutes = Math.floor(total / 60000) % 60
  const hours = Math.floor(total / 3600000)
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(millis, 3)}`
}

interface Timing {
  start: number
  end: number
  settings: string
}

function parseTiming(line: string): Timing | null {
  const arrow = line.indexOf('-->')
  if (arrow < 0) return null
  const start = parseTimestamp(line.slice(0, arrow))
  const rest = line.slice(arrow + 3).trim()
  const space = rest.search(/\s/)
  const end = parseTimestamp(space < 0 ? rest : rest.slice(0, space))
  if (start === null || end === null) return null
  return { start, end, settings: space < 0 ? '' : rest.slice(space).trim() }
}

/** ブロックの中で時刻の行を探す。番号・識別子の行は 1 行までしか許さない */
function timingIndex(block: Block): number {
  if (block.lines[0].includes('-->')) return 0
  if (block.lines.length > 1 && block.lines[1].includes('-->')) return 1
  return -1
}

export function parseSrt(text: string): ParsedSubtitles {
  const cues: SubtitleCue[] = []
  const errors: SubtitleParseError[] = []
  for (const block of splitBlocks(text)) {
    const at = timingIndex(block)
    const timing = at < 0 ? null : parseTiming(block.lines[at])
    if (!timing) {
      errors.push({ line: block.line + Math.max(at, 0), reason: at < 0 ? 'unknown-block' : 'invalid-timing' })
      continue
    }
    cues.push({ start: timing.start, end: timing.end, text: block.lines.slice(at + 1).join('\n') })
  }
  return { cues, errors }
}

export function parseVtt(text: string): ParsedSubtitles {
  const cues: SubtitleCue[] = []
  const errors: SubtitleParseError[] = []
  const blocks = splitBlocks(text)
  const first = blocks[0]
  if (first && /^WEBVTT(?:[ \t].*)?$/.test(first.lines[0])) {
    // 見出しのブロックは読み飛ばす。ただし空行を挟まずに最初の字幕が続く崩れたファイルもあるので、
    // 時刻の行があればそこから先を字幕として読み直す
    const at = first.lines.findIndex((l) => l.includes('-->'))
    blocks.shift()
    if (at > 0) {
      const from = Math.max(1, at - 1)
      blocks.unshift({ line: first.line + from, lines: first.lines.slice(from) })
    }
  } else {
    errors.push({ line: 1, reason: 'missing-header' })
  }

  for (const block of blocks) {
    const at = timingIndex(block)
    if (at < 0) {
      // 注釈・スタイル・領域の定義は字幕ではないので黙って飛ばす
      if (!/^(NOTE|STYLE|REGION)(?:[ \t]|$)/.test(block.lines[0])) {
        errors.push({ line: block.line, reason: 'unknown-block' })
      }
      continue
    }
    const timing = parseTiming(block.lines[at])
    if (!timing) {
      errors.push({ line: block.line + at, reason: 'invalid-timing' })
      continue
    }
    cues.push({
      start: timing.start,
      end: timing.end,
      text: block.lines.slice(at + 1).join('\n'),
      ...(at === 1 ? { id: block.lines[0] } : {}),
      ...(timing.settings ? { settings: timing.settings } : {}),
    })
  }
  return { cues, errors }
}

/** 空行は字幕の区切りになってしまうので、書き出す前に落とす */
const cueLines = (text: string) => text.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '')

export function serializeSrt(cues: readonly SubtitleCue[]): string {
  return cues
    .map((cue, i) =>
      [String(i + 1), `${formatTimestamp(cue.start, ',')} --> ${formatTimestamp(cue.end, ',')}`, ...cueLines(cue.text)].join(
        '\n'
      )
    )
    .map((block) => `${block}\n`)
    .join('\n')
}

/** 識別子は 1 行で、`-->` を含めない（含むと時刻の行と区別できない） */
const usableId = (id: string | undefined): string | null => {
  if (id === undefined) return null
  const oneLine = id.replace(/[\r\n]+/g, ' ').trim()
  return oneLine === '' || oneLine.includes('-->') ? null : oneLine
}

export function serializeVtt(cues: readonly SubtitleCue[]): string {
  const blocks = cues.map((cue) => {
    const id = usableId(cue.id)
    const settings = cue.settings?.replace(/[\r\n]+/g, ' ').trim()
    const timing = `${formatTimestamp(cue.start, '.')} --> ${formatTimestamp(cue.end, '.')}${settings ? ` ${settings}` : ''}`
    return [...(id ? [id] : []), timing, ...cueLines(cue.text)].join('\n')
  })
  return ['WEBVTT', ...blocks].map((block) => `${block}\n`).join('\n')
}

/** 先頭が WEBVTT なら VTT、それ以外は SRT とみなす */
export function detectSubtitleFormat(text: string): SubtitleFormat {
  return /^\ufeff?WEBVTT(?:[ \t\r\n]|$)/.test(text) ? 'vtt' : 'srt'
}

export function parseSubtitles(text: string, format = detectSubtitleFormat(text)): ParsedSubtitles {
  return format === 'vtt' ? parseVtt(text) : parseSrt(text)
}

export function serializeSubtitles(cues: readonly SubtitleCue[], format: SubtitleFormat): string {
  return format === 'vtt' ? serializeVtt(cues) : serializeSrt(cues)
}

/** VTT の本文で意味を持つタグ。これ以外の `<` は文字として逃がす */
const VTT_SAFE_TAG = /^<\/?(?:b|i|u)>/i

/**
 * SRT の本文を VTT の本文にする。SRT で使われがちな <font> と ASS の {\an8} は VTT にないので落とし、
 * VTT では特別な意味を持つ & と < を文字参照にする
 */
export function srtCueTextToVtt(text: string): string {
  const stripped = text.replace(/<\/?font\b[^>]*>/gi, '').replace(/\{\\[^}]*\}/g, '')
  let out = ''
  for (let i = 0; i < stripped.length; i++) {
    const c = stripped[i]
    if (c === '&') out += /^&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i.test(stripped.slice(i)) ? c : '&amp;'
    else if (c === '<') {
      const tag = VTT_SAFE_TAG.exec(stripped.slice(i))
      if (tag) {
        out += tag[0].toLowerCase()
        i += tag[0].length - 1
      } else out += '&lt;'
    } else out += c
  }
  return out
}

const VTT_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', nbsp: '\u00a0', lrm: '\u200e', rlm: '\u200f' }

/** VTT の本文を SRT の本文にする。b・i・u 以外のタグ（話者 <v>、クラス <c>、時刻 <00:01.000> など）は落とす */
export function vttCueTextToSrt(text: string): string {
  return text
    .replace(/<[^>]*>/g, (tag) => (VTT_SAFE_TAG.test(tag) ? tag : ''))
    .replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (_, name: string) => VTT_ENTITIES[name])
}

export interface ConvertedSubtitles {
  text: string
  /** 元の字幕で読めずに飛ばしたブロック */
  errors: SubtitleParseError[]
}

export function srtToVtt(srt: string): ConvertedSubtitles {
  const { cues, errors } = parseSrt(srt)
  return { text: serializeVtt(cues.map((cue) => ({ ...cue, text: srtCueTextToVtt(cue.text) }))), errors }
}

/** SRT には配置指定も識別子もないので落とす */
export function vttToSrt(vtt: string): ConvertedSubtitles {
  const { cues, errors } = parseVtt(vtt)
  return {
    text: serializeSrt(cues.map((cue) => ({ start: cue.start, end: cue.end, text: vttCueTextToSrt(cue.text) }))),
    errors,
  }
}

/**
 * すべての字幕を ms だけずらす（負なら早める）。0 より前には出さず 0 に詰める。
 * 終了まで 0 以前に押し出された字幕は表示されようがないので捨てる
 */
export function shiftSubtitles(cues: readonly SubtitleCue[], ms: number): SubtitleCue[] {
  const delta = Math.round(ms)
  if (delta === 0) return [...cues]
  return cues.flatMap((cue) => {
    if (delta < 0 && cue.end + delta <= 0) return []
    return [{ ...cue, start: Math.max(0, cue.start + delta), end: Math.max(0, cue.end + delta) }]
  })
}

/**
 * 時刻を factor 倍する。フレームレート違いの補正に使う（framerateFactor を参照）。
 * 単調な変換なので並び順は崩れない
 */
export function scaleSubtitles(cues: readonly SubtitleCue[], factor: number): SubtitleCue[] {
  if (!Number.isFinite(factor) || factor <= 0) throw new RangeError(`invalid scale factor: ${factor}`)
  return cues.map((cue) => ({ ...cue, start: Math.round(cue.start * factor), end: Math.round(cue.end * factor) }))
}

/**
 * 字幕を作ったときのフレームレート（from）から、合わせたい動画のフレームレート（to）への倍率。
 * 同じフレーム番号の時刻は frame / fps なので、時刻は from / to 倍になる
 * （23.976fps 用の字幕を 25fps の PAL 版に合わせるなら約 0.959 倍）
 */
export function framerateFactor(from: number, to: number): number {
  return from / to
}

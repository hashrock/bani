import { decodeBytes, detectEncoding } from '../text/encoding'
import { detectSubtitleFormat, parseSubtitles, srtCueTextToVtt } from '../text/subtitles'
import type { SubtitleCue, SubtitleParseError } from '../text/subtitles'

/**
 * 動画に添える字幕ファイル（.srt / .vtt）の読み込み。日本の SRT は Shift_JIS のものが多いので文字コードを推定して読む。
 * レシピの中の本文は WebVTT の書き方にそろえる（同梱は WebVTT で書き、焼き込みは VTT のタグを落として描く）。
 */

const SUBTITLE_EXTENSION = /\.(srt|vtt)$/i
const SUBTITLE_MIME_TYPES = new Set(['text/vtt', 'application/x-subrip', 'text/srt', 'application/srt'])

/** 字幕として足せるファイルか（名前と種類で見る） */
export function isSubtitleFile(file: { name: string; type: string }): boolean {
  return SUBTITLE_EXTENSION.test(file.name) || SUBTITLE_MIME_TYPES.has(file.type.toLowerCase())
}

/**
 * ドラッグ中（名前がまだ読めない）に、字幕かもしれないか。.srt は種類が空で届くことが多いので空も通し、
 * 落とされてから名前で選り分ける（字幕でなければ開き直しに回す）
 */
export function mayBeSubtitle(item: { type: string }): boolean {
  return item.type === '' || SUBTITLE_MIME_TYPES.has(item.type.toLowerCase()) || item.type === 'text/plain'
}

export interface LoadedSubtitles {
  name: string
  cues: SubtitleCue[]
  errors: SubtitleParseError[]
}

/** 字幕の本文を読む。SRT の本文は VTT の書き方に直す */
export function parseSubtitleText(text: string, name: string): LoadedSubtitles {
  const format = /\.vtt$/i.test(name) ? 'vtt' : /\.srt$/i.test(name) ? 'srt' : detectSubtitleFormat(text)
  const { cues, errors } = parseSubtitles(text, format)
  return {
    name,
    cues: format === 'srt' ? cues.map((cue) => ({ ...cue, text: srtCueTextToVtt(cue.text) })) : cues,
    errors,
  }
}

export async function loadSubtitleFile(file: File): Promise<LoadedSubtitles> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const { text } = decodeBytes(bytes, detectEncoding(bytes).encoding)
  return parseSubtitleText(text, file.name)
}

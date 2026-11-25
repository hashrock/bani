import { trimDuration } from '../../state/trim'
import type { SubtitleCue } from '../text/subtitles'
import type { Trim } from '../../types'
import type { VideoFormat, VideoRecipe, VideoSubtitleMode, VideoSubtitles } from './types'

/**
 * 時間軸の計算（純粋）。元ファイルの時間軸（秒）と、書き出した動画の時間軸（区間の先頭を 0 とし、speed で縮めたもの）を
 * 行き来する。字幕の時刻は SubtitleCue と同じミリ秒の整数。
 *
 * 元の時刻 t は書き出しで (t - trim.start) / speed になる。映像のタイムスタンプも、音声の長さも、字幕もこの 1 本の式に従うので、
 * どれかを別の式で計算するとずれる。
 */

export const MIN_VIDEO_SPEED = 0.25
export const MAX_VIDEO_SPEED = 4
/** 画面で選べる速さ */
export const VIDEO_SPEED_PRESETS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const

/** 速さを範囲に収め、0.05 刻みに丸める（JSON で比べる鍵が浮動小数のごみで揺れないように）。読めない値は 1 */
export function clampSpeed(speed: number): number {
  if (!Number.isFinite(speed) || speed <= 0) return 1
  const clamped = Math.min(MAX_VIDEO_SPEED, Math.max(MIN_VIDEO_SPEED, speed))
  return Math.round(clamped * 20) / 20
}

/** 書き出した動画の長さ（秒） */
export function outputDuration(recipe: Pick<VideoRecipe, 'trim' | 'speed'>): number {
  return trimDuration(recipe.trim) / recipe.speed
}

/** 元の時刻（秒）→ 書き出しの時刻（秒） */
export function sourceToOutputTime(time: number, trim: Pick<Trim, 'start'>, speed: number): number {
  return (time - trim.start) / speed
}

/** 書き出しの時刻（秒）→ 元の時刻（秒） */
export function outputToSourceTime(time: number, trim: Pick<Trim, 'start'>, speed: number): number {
  return trim.start + time * speed
}

/** 字幕の時刻に offset を足した、元の時間軸での表示区間（ミリ秒） */
export function cueSourceSpan(cue: SubtitleCue, offset: number): { start: number; end: number } {
  return { start: cue.start + offset, end: cue.end + offset }
}

/**
 * 書き出す動画の時間軸に直した字幕（ミリ秒）。ずらし（offset）を足し、区間の外を切り落とし、speed で縮める。
 * 区間にかからない字幕と、丸めて長さ 0 になった字幕は捨てる。並び順は保つ
 */
export function cuesForOutput(
  subtitles: Pick<VideoSubtitles, 'cues' | 'offset'>,
  trim: Trim,
  speed: number
): SubtitleCue[] {
  const from = trim.start * 1000
  const to = trim.end * 1000
  const toOutput = (ms: number) => Math.round((ms - from) / speed)
  return subtitles.cues.flatMap((cue) => {
    const span = cueSourceSpan(cue, subtitles.offset)
    const start = Math.max(span.start, from)
    const end = Math.min(span.end, to)
    if (!(end > start)) return []
    const mapped = { start: toOutput(start), end: toOutput(end) }
    return mapped.end > mapped.start ? [{ ...cue, ...mapped }] : []
  })
}

/** time（ミリ秒）に表示中の字幕。重なっていれば並び順にすべて。終わりの瞬間は含まない */
export function activeCues(cues: readonly SubtitleCue[], time: number, offset = 0): SubtitleCue[] {
  return cues.filter((cue) => cue.start + offset <= time && time < cue.end + offset)
}

/** 実際に使う字幕の入れ方。GIF には字幕トラックがないので焼き込む */
export function effectiveSubtitleMode(mode: VideoSubtitleMode, format: VideoFormat): VideoSubtitleMode {
  return format === 'gif' ? 'burn' : mode
}

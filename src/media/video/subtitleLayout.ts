import { vttCueTextToSrt } from '../text/subtitles'
import type { SubtitleCue } from '../text/subtitles'

/**
 * 字幕を絵に焼き込むときの見た目と改行（純粋。文字幅は measure で受け取る）。
 * プレビューの重ね表示も同じ割合（subtitleStyle）を使い、書き出しと見た目をそろえる。
 */

/** 出力の高さに対する文字の大きさ。1080p で 59px、360p で 20px ほど（テレビ字幕より少し大きめ） */
export const SUBTITLE_FONT_RATIO = 0.055
/** 下端からの余白（高さに対する割合） */
export const SUBTITLE_BOTTOM_RATIO = 0.06
/** 1 行の幅の上限（幅に対する割合） */
export const SUBTITLE_WIDTH_RATIO = 0.9
/** 縁取りの太さ（文字の大きさに対する割合）。どんな背景でも読めるよう黒で縁取る */
export const SUBTITLE_STROKE_RATIO = 0.16
export const SUBTITLE_LINE_HEIGHT = 1.25
/** 端末に入っている日本語のゴシック体を優先する（ネットワークのフォントは使わない） */
export const SUBTITLE_FONT_FAMILY =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans CJK JP", "Noto Sans JP", "Yu Gothic UI", "Yu Gothic", Meiryo, system-ui, sans-serif'

export interface SubtitleStyle {
  fontSize: number
  lineHeight: number
  strokeWidth: number
  /** 最後の行のベースラインの y */
  baseline: number
  maxWidth: number
  font: string
}

export function subtitleStyle(width: number, height: number): SubtitleStyle {
  // 縦長の動画では高さ基準だと横にはみ出すので、短い辺も見る
  const fontSize = Math.max(12, Math.round(Math.min(height * SUBTITLE_FONT_RATIO, width * 0.07)))
  return {
    fontSize,
    lineHeight: Math.round(fontSize * SUBTITLE_LINE_HEIGHT),
    strokeWidth: Math.max(2, Math.round(fontSize * SUBTITLE_STROKE_RATIO)),
    baseline: Math.round(height - height * SUBTITLE_BOTTOM_RATIO),
    maxWidth: width * SUBTITLE_WIDTH_RATIO,
    font: `600 ${fontSize}px ${SUBTITLE_FONT_FAMILY}`,
  }
}

/** 本文から書式のタグ（<i>・<font>・{\an8} など）と文字参照を落とし、描く文字だけにする */
export function plainCueText(text: string): string {
  return vttCueTextToSrt(text)
    .replace(/<[^>]*>/g, '')
    .replace(/\{\\[^}]*\}/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n')
}

/** 同時に出ている字幕を 1 つの本文にまとめる（上から並び順） */
export function joinCues(cues: readonly SubtitleCue[]): string {
  return cues
    .map((cue) => plainCueText(cue.text))
    .filter((text) => text !== '')
    .join('\n')
}

/** 行の頭に来てはいけない文字（句読点・閉じ括弧・小書きの仮名・長音） */
const NO_LINE_START = new Set(
  '、。，．,.!?！？)）]］}｝」』】〕〉》〟’”ー…‥ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ・：；:;%％'
)
/** 行の終わりに来てはいけない文字（開き括弧） */
const NO_LINE_END = new Set('(（[［{｛「『【〔〈《〝‘“')
/** 1 文字ずつ折り返してよい文字（漢字・仮名・全角の記号） */
const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f\u3040-\u30ff\u31f0-\u31ff]/

/**
 * 折り返しの単位に分ける。和文は 1 文字ずつ、欧文は語（後ろの空白込み）ごと。
 * 行頭禁則の文字は前の単位に、行末禁則の文字は次の単位にくっつけて、その位置で折り返さないようにする
 */
export function breakUnits(text: string): string[] {
  const raw: string[] = []
  let word = ''
  for (const char of text) {
    if (CJK.test(char)) {
      if (word) raw.push(word)
      word = ''
      raw.push(char)
    } else if (char === ' ' || char === '\t') {
      word += ' '
      raw.push(word)
      word = ''
    } else {
      // 欧文の語が空白で終わったあとに続く文字は新しい語
      word += char
    }
  }
  if (word) raw.push(word)

  const units: string[] = []
  for (const unit of raw) {
    const previous = units[units.length - 1]
    const first = [...unit][0]
    if (previous !== undefined && (NO_LINE_START.has(first) || NO_LINE_END.has([...previous].pop() ?? '') || unit.trim() === '')) {
      units[units.length - 1] = previous + unit
    } else {
      units.push(unit)
    }
  }
  return units
}

/**
 * 1 行が maxWidth に収まるよう折り返す（貪欲法）。本文の改行はそのまま行の区切りにする。
 * 1 単位だけで幅を超える長い語は、1 文字ずつに割って詰める
 */
export function breakLines(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    let line = ''
    const pushLine = () => {
      const trimmed = line.trimEnd()
      if (trimmed !== '') lines.push(trimmed)
      line = ''
    }
    for (const unit of breakUnits(paragraph)) {
      if (measure((line + unit).trimEnd()) <= maxWidth) {
        line += unit
        continue
      }
      if (line !== '') pushLine()
      const piece = unit.trimStart()
      if (measure(piece.trimEnd()) <= maxWidth) {
        line = piece
        continue
      }
      for (const char of piece) {
        if (line !== '' && measure((line + char).trimEnd()) > maxWidth) pushLine()
        line += char
      }
    }
    pushLine()
  }
  return lines
}

/** 描く行と、それぞれのベースラインの y（下から積む） */
export function layoutSubtitle(
  text: string,
  width: number,
  height: number,
  measure: (text: string) => number
): { style: SubtitleStyle; lines: { text: string; x: number; y: number }[] } {
  const style = subtitleStyle(width, height)
  const lines = breakLines(text, style.maxWidth, measure)
  return {
    style,
    lines: lines.map((line, i) => ({
      text: line,
      x: width / 2,
      y: style.baseline - (lines.length - 1 - i) * style.lineHeight,
    })),
  }
}

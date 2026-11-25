import type { SubtitleCue } from '../text/subtitles'
import { joinCues, layoutSubtitle, subtitleStyle } from './subtitleLayout'
import { activeCues } from './timing'

type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * いま（書き出しの時間軸のミリ秒）出ている字幕を、width × height の絵の下寄せに描く。
 * 白い文字を黒で縁取る。縁取りを先に描いてから塗るので、太い縁でも文字がやせない
 */
export function drawSubtitlesAt(
  context: Context2D,
  cues: readonly SubtitleCue[],
  timeMs: number,
  width: number,
  height: number
): void {
  const text = joinCues(activeCues(cues, timeMs))
  if (text === '') return
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  // 折り返しの幅は描くのと同じ書体で測る
  context.font = subtitleStyle(width, height).font
  const { style, lines } = layoutSubtitle(text, width, height, (line) => context.measureText(line).width)
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  context.lineJoin = 'round'
  context.miterLimit = 2
  context.lineWidth = style.strokeWidth
  context.strokeStyle = 'rgba(0, 0, 0, 0.9)'
  context.fillStyle = '#fff'
  for (const line of lines) context.strokeText(line.text, line.x, line.y)
  for (const line of lines) context.fillText(line.text, line.x, line.y)
  context.restore()
}

import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { activeCues, joinCues, sourceRect, subtitleStyle } from '../../media/video'
import type { VideoRecipe, VideoSize } from '../../media/video'

/** 再生位置（秒）を追う。再生中は毎フレーム、止まっているときはシークのたびに読む */
function useCurrentTime(videoRef: RefObject<HTMLVideoElement | null>): number {
  const [time, setTime] = useState(0)
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    let frame = 0
    const read = () => setTime(video.currentTime)
    const loop = () => {
      read()
      frame = requestAnimationFrame(loop)
    }
    const play = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(loop)
    }
    const stop = () => {
      cancelAnimationFrame(frame)
      read()
    }
    const events = ['seeked', 'timeupdate', 'loadedmetadata'] as const
    events.forEach((name) => video.addEventListener(name, read))
    video.addEventListener('play', play)
    video.addEventListener('pause', stop)
    video.addEventListener('ended', stop)
    if (!video.paused) play()
    return () => {
      cancelAnimationFrame(frame)
      events.forEach((name) => video.removeEventListener(name, read))
      video.removeEventListener('play', play)
      video.removeEventListener('pause', stop)
      video.removeEventListener('ended', stop)
    }
  }, [videoRef])
  return time
}

/**
 * プレビューに重ねる字幕。プレビューは元の映像を CSS で回転・反転して見せているので、その中に置いたうえで
 * 逆向きに回し、文字は正立させる。置き場所は切り抜きの範囲で、大きさは焼き込みと同じ割合（subtitleStyle）にする。
 * 再生しているのは元の映像なので、再生位置は元の時間軸のまま、ずらし（offset）だけを足して比べる。
 */
export function SubtitleOverlay({
  recipe,
  size,
  scale,
  videoRef,
}: {
  recipe: VideoRecipe
  size: VideoSize
  /** 元の 1 画素が画面の何 CSS ピクセルに当たるか */
  scale: number
  videoRef: RefObject<HTMLVideoElement | null>
}) {
  const time = useCurrentTime(videoRef)
  const subtitles = recipe.subtitles
  if (!subtitles) return null
  const text = joinCues(activeCues(subtitles.cues, time * 1000, subtitles.offset))
  if (text === '') return null

  const rect = sourceRect(recipe, size)
  const quarter = recipe.rotation % 180 !== 0
  // 画面に見えている（回したあとの）切り抜き範囲の大きさ
  const visible = {
    width: (quarter ? rect.height : rect.width) * scale,
    height: (quarter ? rect.width : rect.height) * scale,
  }
  const style = subtitleStyle(visible.width, visible.height)
  const percent = (value: number, total: number) => `${(value / total) * 100}%`

  return (
    <div
      className="pointer-events-none absolute"
      style={{
        left: percent(rect.x, size.width),
        top: percent(rect.y, size.height),
        width: percent(rect.width, size.width),
        height: percent(rect.height, size.height),
      }}
    >
      <div
        className="absolute top-1/2 left-1/2"
        style={{
          width: visible.width,
          height: visible.height,
          // 親の scale(反転) rotate(回転) を打ち消す（逆行列は rotate(-回転) scale(反転)）
          transform: `translate(-50%, -50%) rotate(${-recipe.rotation}deg) scale(${recipe.flipH ? -1 : 1}, ${recipe.flipV ? -1 : 1})`,
        }}
      >
        <div
          className="absolute inset-x-0 text-center whitespace-pre-line text-white"
          style={{
            bottom: visible.height - style.baseline - style.fontSize * 0.25,
            paddingInline: (visible.width - style.maxWidth) / 2,
            font: style.font,
            lineHeight: `${style.lineHeight}px`,
            // 和文の禁則（句読点を行頭に出さない）はブラウザの strict に任せる
            lineBreak: 'strict',
            overflowWrap: 'anywhere',
            WebkitTextStroke: `${style.strokeWidth}px rgba(0, 0, 0, 0.9)`,
            paintOrder: 'stroke fill',
          }}
        >
          {text}
        </div>
      </div>
    </div>
  )
}

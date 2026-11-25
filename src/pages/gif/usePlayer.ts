import { useCallback, useEffect, useRef, useState } from 'react'
import { frameAtTime, frameStartTime } from '../../media/gif'
import type { GifFrameRef } from '../../media/gif'

/**
 * プレビューの再生。各フレームの表示時間どおりに進め、終わりまで来たら頭に戻す
 * （プレビューは回数によらず繰り返す。回数は書き出したファイルで効く）。
 * 時刻は requestAnimationFrame で測り、フレームの表示時間ぶん経ったら次へ進める。
 */
export function usePlayer(frames: readonly GifFrameRef[]) {
  const [playing, setPlaying] = useState(false)
  const [index, setIndex] = useState(0)
  const count = frames.length
  // 並べ替え・削除で数が減っても並びの中に収める
  const current = count === 0 ? -1 : Math.min(index, count - 1)

  const latest = useRef({ frames, current })
  useEffect(() => {
    latest.current = { frames, current }
  })

  useEffect(() => {
    if (!playing || count === 0) return
    let raf = 0
    // 今のフレームの頭から測る
    let shownAt = performance.now()
    // 進めた位置はここで持つ（描き直しを待たずに次の tick で使うため）
    let position = Math.max(0, latest.current.current)
    const tick = (now: number) => {
      const list = latest.current.frames
      if (list.length === 0) return
      position = Math.min(position, list.length - 1)
      const at = position
      let elapsed = now - shownAt
      // 遅れたら（タブを裏に回したなど）、経った時間ぶんだけまとめて進める
      while (elapsed >= list[position].duration) {
        elapsed -= list[position].duration
        shownAt += list[position].duration
        position = (position + 1) % list.length
      }
      if (position !== at) setIndex(position)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, count])

  const toggle = useCallback(() => setPlaying((value) => !value), [])
  /** そのフレームを出して止める（一覧で選んだとき） */
  const show = useCallback((next: number) => {
    setPlaying(false)
    setIndex(next)
  }, [])
  /** 再生位置（ミリ秒）から出すフレームを決める（つまみを動かしたとき） */
  const seek = useCallback((time: number) => {
    setPlaying(false)
    setIndex(Math.max(0, frameAtTime(latest.current.frames, time)))
  }, [])

  return {
    playing: playing && count > 0,
    current,
    time: current < 0 ? 0 : frameStartTime(frames, current),
    toggle,
    show,
    seek,
    stop: useCallback(() => setPlaying(false), []),
  }
}

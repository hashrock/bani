import { useEffect, useState } from 'react'
import { probeVideo } from '../media/video'
import type { VideoInfo } from '../media/video'

/**
 * ファイルのメディア情報を読む。読み終えたら onLoaded にも渡す。
 * 画面はファイルごとに作り直す前提なので、ファイルが変わったときの片付けは持たない。
 * onLoaded は参照が安定したもの（useCallback など）を渡すこと。
 */
export function useMediaInfo(file: File | null, onLoaded?: (info: VideoInfo) => void) {
  const [media, setMedia] = useState<VideoInfo | null>(null)

  useEffect(() => {
    if (!file) return
    let cancelled = false
    probeVideo(file)
      .then((info) => {
        if (cancelled) return
        setMedia(info)
        onLoaded?.(info)
      })
      .catch((err) => console.error('Failed to get media information:', err))
    return () => {
      cancelled = true
    }
  }, [file, onLoaded])

  return media
}

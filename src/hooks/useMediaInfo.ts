import { useEffect, useState } from 'react'
import { probeMedia } from '../converters'
import type { MediaInfo } from '../types'

/**
 * ファイルのメディア情報を読む。読み終えたら onLoaded にも渡す。
 * 画面はファイルごとに作り直す前提なので、ファイルが変わったときの片付けは持たない。
 * onLoaded は参照が安定したもの（useCallback など）を渡すこと。
 */
export function useMediaInfo(file: File | null, onLoaded?: (info: MediaInfo) => void) {
  const [media, setMedia] = useState<MediaInfo | null>(null)

  useEffect(() => {
    if (!file) return
    let cancelled = false
    probeMedia(file)
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

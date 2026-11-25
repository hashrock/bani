import { useEffect, useState } from 'react'
import { decodeImage, probeImage } from '../../media/image'
import type { ImageInfo } from '../../media/image'

export interface ImageSource {
  file: File
  info: ImageInfo
  /** プレビューに描くためのデコード結果。EXIF の向きは反映済み */
  bitmap: ImageBitmap
}

type State =
  | { file: File; status: 'ready'; source: ImageSource }
  | { file: File; status: 'error'; error: unknown }

/**
 * 開いた画像の情報とデコード結果。プレビューは編集のたびに描き直すので、
 * デコードは開いたときの 1 回だけにして使い回す。
 */
export function useImageSource(file: File | null) {
  const [state, setState] = useState<State | null>(null)

  useEffect(() => {
    if (!file) return
    let cancelled = false
    let bitmap: ImageBitmap | null = null
    ;(async () => {
      try {
        const info = await probeImage(file)
        const decoded = await decodeImage(file)
        // 待っているあいだに閉じられたら、片付けはもう済んでいるのでここで捨てる
        if (cancelled) {
          decoded.close()
          return
        }
        bitmap = decoded
        setState({ file, status: 'ready', source: { file, info, bitmap: decoded } })
      } catch (error) {
        if (cancelled) return
        console.error('Failed to load image:', error)
        setState({ file, status: 'error', error })
      }
    })()
    return () => {
      cancelled = true
      bitmap?.close()
    }
  }, [file])

  // 前のファイルの結果は見せない（読み込み中として扱う）
  const current = state && state.file === file ? state : null
  return {
    source: current?.status === 'ready' ? current.source : null,
    error: current?.status === 'error' ? current.error : null,
    loading: !!file && current === null,
  }
}

import { useEffect, useState } from 'react'
import { estimateRasterOutput, type PdfImageSettings, type PdfPageRef, type PdfRasterizer } from '../../media/pdf'
import { isAbortError } from '../../utils/abort'

export interface RasterEstimate {
  bytes: number
  first: { width: number; height: number } | null
}

// スライダーを動かしているあいだに何度も描かないよう、止まってから描く
const DEBOUNCE_MS = 400

/**
 * 画像・圧縮の書き出しの大きさを、何ページかだけ描いて見込む。設定が変われば描き直す。
 * 前の結果は描き直しているあいだも残す（数字が「計算中」と行き来してちらつかないように）
 */
export function useRasterEstimate(
  rasterizer: PdfRasterizer,
  pages: readonly PdfPageRef[],
  settings: PdfImageSettings,
  asPdf: boolean,
  enabled: boolean
): { estimate: RasterEstimate | null; estimating: boolean } {
  const [estimate, setEstimate] = useState<RasterEstimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  // 配列・オブジェクトは描画のたびに作り直されるので、中身で比べる
  const key = enabled ? JSON.stringify([pages, settings, asPdf]) : null

  useEffect(() => {
    if (key === null) return
    const [currentPages, currentSettings, currentAsPdf] = JSON.parse(key) as [PdfPageRef[], PdfImageSettings, boolean]
    if (currentPages.length === 0) return
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setEstimating(true)
      estimateRasterOutput(rasterizer, currentPages, currentSettings, currentAsPdf, controller.signal).then(
        (result) => {
          if (controller.signal.aborted) return
          setEstimate(result)
          setEstimating(false)
        },
        (error: unknown) => {
          if (controller.signal.aborted || isAbortError(error)) return
          console.error('PDF raster estimate failed:', error)
          setEstimate(null)
          setEstimating(false)
        }
      )
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [rasterizer, key])

  return { estimate: key === null ? null : estimate, estimating: key !== null && estimating }
}

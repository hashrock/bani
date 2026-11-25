import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useI18n } from '../i18n/context'
import { previewScale, previewTransform } from '../media/video'
import type { VideoRecipe, VideoSize } from '../media/video'
import type { ConversionResult } from '../types'

interface VideoPreviewProps {
  file: File
  videoRef: RefObject<HTMLVideoElement | null>
  /** 変換前の映像に映すレシピ。回転・反転は CSS で、音声の除去は muted で見せる */
  recipe: VideoRecipe
  /** 元の映像の寸法（見た目どおりの向き）。わかるまではレシピを映さず、枠いっぱいに出す */
  dimensions: VideoSize | null
  /**
   * 変換前の映像に重ねるもの（切り抜きの枠など）。元の向きの座標で置けば映像と一緒に回る。
   * scale は元の 1 画素が画面の何 CSS ピクセルに当たるか
   */
  renderOverlay?: (scale: number) => ReactNode
  result: ConversionResult | null
  converting: boolean
  progress: number
  showAfter: boolean
  error: string
  isDragging: boolean
}

/** 要素の内寸を追う。プレビューの拡大率を枠に合わせて決めるのに使う */
function useElementSize(ref: RefObject<HTMLElement | null>): VideoSize {
  const [size, setSize] = useState<VideoSize>({ width: 0, height: 0 })
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** 変換前後の映像だけを映す領域。操作系はサイドバーと下バーに集約している */
export function VideoPreview({
  file,
  videoRef,
  recipe,
  dimensions,
  renderOverlay,
  result,
  converting,
  progress,
  showAfter,
  error,
  isDragging,
}: VideoPreviewProps) {
  const { t } = useI18n()
  const areaRef = useRef<HTMLElement>(null)
  const area = useElementSize(areaRef)
  const originalUrl = useMemo(() => URL.createObjectURL(file), [file])
  const previewUrl = useMemo(() => (result ? URL.createObjectURL(result.blob) : ''), [result])

  // 音声の除去は書き出す前から聞こえ方で確かめられるようにする
  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = recipe.muted
  }, [videoRef, recipe.muted])

  // GIF は video 要素で再生できないため、結果の種類によって表示要素を変える
  const isGifResult = result?.blob.type === 'image/gif'
  const sourceVisible = !result || !showAfter
  const scale = dimensions ? previewScale(area, dimensions, recipe) : 0
  const placed = dimensions !== null && scale > 0

  return (
    <main ref={areaRef} className={cn('preview-area', isDragging && 'drop-target-active')}>
      {/*
        元の向きの大きさで置いてから回す。中に重ねた切り抜きの枠も一緒に回る。
        寸法がわかる前も同じ要素を使う（video 要素を作り直すと再生位置の購読が外れる）
      */}
      <div
        className="absolute overflow-hidden transition-opacity duration-300"
        style={{
          ...(placed
            ? {
                top: '50%',
                left: '50%',
                width: dimensions.width * scale,
                height: dimensions.height * scale,
                transform: `translate(-50%, -50%) ${previewTransform(recipe)}`,
              }
            : { inset: 0 }),
          opacity: sourceVisible ? 1 : 0,
          pointerEvents: sourceVisible ? 'auto' : 'none',
        }}
      >
        <video
          ref={videoRef}
          src={originalUrl}
          className={cn('absolute inset-0 size-full bg-black', placed ? 'object-fill' : 'object-contain')}
        />
        {placed && renderOverlay?.(scale)}
      </div>
      {result &&
        (isGifResult ? (
          <img
            src={previewUrl}
            alt={t.convertedGifAlt}
            className="preview-video"
            style={{
              opacity: showAfter ? 1 : 0,
              pointerEvents: showAfter ? 'auto' : 'none',
            }}
          />
        ) : (
          <video
            src={previewUrl}
            controls
            className="preview-video"
            style={{
              opacity: showAfter ? 1 : 0,
              pointerEvents: showAfter ? 'auto' : 'none',
            }}
          />
        ))}

      {converting && (
        // 映像の上に重ねるので、地の色に関係なく読めるよう黒い板に白で描く
        <div className="absolute top-1/2 left-1/2 z-10 min-w-[200px] -translate-1/2 rounded-xl bg-black/80 px-10 py-6 text-white">
          <Progress
            value={progress}
            className="mb-3 bg-white/20 **:data-[slot=progress-indicator]:bg-white"
          />
          <div className="text-center text-lg font-semibold tabular-nums">{progress}%</div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="absolute top-5 left-1/2 z-20 -translate-x-1/2 rounded-md border border-destructive bg-background px-5 py-3 text-[13px] text-destructive shadow-md"
        >
          {error}
        </div>
      )}
    </main>
  )
}

import { useMemo } from 'react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { useI18n } from '../i18n/context'
import type { RefObject } from 'react'
import type { ConversionResult } from '../types'

interface VideoPreviewProps {
  file: File
  videoRef: RefObject<HTMLVideoElement | null>
  result: ConversionResult | null
  converting: boolean
  progress: number
  showAfter: boolean
  error: string
  isDragging: boolean
}

const MIME_TYPES: Record<string, string> = {
  gif: 'image/gif',
  webm: 'video/webm',
  mp4: 'video/mp4',
}

function mimeTypeOf(filename: string): string {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  return MIME_TYPES[extension] ?? 'application/octet-stream'
}

/** 変換前後の映像だけを映す領域。操作系はサイドバーと下バーに集約している */
export function VideoPreview({
  file,
  videoRef,
  result,
  converting,
  progress,
  showAfter,
  error,
  isDragging,
}: VideoPreviewProps) {
  const { t } = useI18n()
  const originalUrl = useMemo(() => URL.createObjectURL(file), [file])
  const previewUrl = useMemo(
    () =>
      result
        ? URL.createObjectURL(new Blob([result.buffer], { type: mimeTypeOf(result.filename) }))
        : '',
    [result]
  )

  // GIF は video 要素で再生できないため、結果の種類によって表示要素を変える
  const isGifResult = result?.filename.endsWith('.gif') ?? false

  return (
    <main className={cn('preview-area', isDragging && 'drop-target-active')}>
      <video
        ref={videoRef}
        src={originalUrl}
        className="preview-video"
        style={{
          opacity: !result || !showAfter ? 1 : 0,
          pointerEvents: !result || !showAfter ? 'auto' : 'none',
        }}
      />
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

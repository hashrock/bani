import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react'
import { cn } from '@/lib/utils'
import { computeDrawPlan, fitRecipeToImage } from '../../media/image'
import type { ImageDrawPlan, ImageRecipe, ImageSize } from '../../media/image'
import { CORNER_HANDLES, EDGE_HANDLES, moveRect, resizeRect, spanRect } from './crop'
import type { CropHandle, Point, Rect } from './crop'

/** 画面の端からプレビューまでの余白（CSS px） */
const GUTTER = 24
/** プレビューの Canvas の 1 辺の上限（実画素）。巨大な写真でも描き直しを軽く保つ */
const MAX_PREVIEW_PIXELS = 4096

/** 透過部分を見分けるための市松模様（色は配色に合わせて index.css の変数から） */
const CHECKER: CSSProperties = {
  backgroundColor: 'var(--checker-light)',
  backgroundImage:
    'linear-gradient(45deg, var(--checker-dark) 25%, transparent 25%, transparent 75%, var(--checker-dark) 75%), linear-gradient(45deg, var(--checker-dark) 25%, transparent 25%, transparent 75%, var(--checker-dark) 75%)',
  backgroundSize: '16px 16px',
  backgroundPosition: '0 0, 8px 8px',
}

export interface CropOverlayProps {
  /** 見た目の座標での切り抜き範囲 */
  rect: Rect
  /** 縦横比の固定（幅 / 高さ）。null は自由 */
  aspect: number | null
  onCommit: (rect: Rect) => void
  label: string
}

interface ImagePreviewProps {
  bitmap: ImageBitmap
  /** レシピの座標の基準になる寸法（probeImage の width/height） */
  info: ImageSize
  /** 描くレシピ。書き出しと同じ computeDrawPlan で描くので、見た目は書き出しと一致する */
  recipe: ImageRecipe
  /** 書き出す形式が透過を残せるか。残せなければ書き出しと同じく白を敷く */
  keepsAlpha: boolean
  /** 切り抜きの枠を重ねるとき。recipe は切り抜き前のものを渡す */
  crop?: CropOverlayProps | null
  className?: string
}

/** 中央のプレビュー。Canvas にレシピどおりに描き、切り抜き中は枠を重ねる */
export function ImagePreview({ bitmap, info, recipe, keepsAlpha, crop, className }: ImagePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const available = useElementSize(containerRef)

  const plan = useMemo(() => computeDrawPlan(info, fitRecipeToImage(recipe, info)), [info, recipe])
  // 原寸より大きくは見せない（小さな画像がぼやけて見えないように）
  const scale = available
    ? Math.min(
        1,
        Math.max(available.width - GUTTER * 2, 1) / plan.canvasWidth,
        Math.max(available.height - GUTTER * 2, 1) / plan.canvasHeight
      )
    : 0
  const cssWidth = plan.canvasWidth * scale
  const cssHeight = plan.canvasHeight * scale

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || scale <= 0) return
    const dpr = window.devicePixelRatio || 1
    const pixelScale = Math.min(
      scale * dpr,
      1,
      MAX_PREVIEW_PIXELS / Math.max(plan.canvasWidth, plan.canvasHeight)
    )
    drawPreview(canvas, bitmap, info, plan, recipe.background, keepsAlpha, pixelScale)
  }, [bitmap, info, plan, recipe.background, keepsAlpha, scale])

  return (
    <div ref={containerRef} className={cn('preview-area', className)}>
      {scale > 0 && (
        <div className="relative shadow-sm" style={{ width: cssWidth, height: cssHeight }}>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 size-full"
            style={keepsAlpha ? CHECKER : undefined}
          />
          {crop && (
            <CropOverlay
              {...crop}
              bounds={{ width: plan.canvasWidth, height: plan.canvasHeight }}
              scale={scale}
            />
          )}
        </div>
      )}
    </div>
  )
}

/**
 * renderImage の drawToCanvas と同じ手順で描く。違うのは縮小表示のための pixelScale だけ。
 * 計算は computeDrawPlan に任せるので、ここを書き出しとずらさないこと
 */
function drawPreview(
  canvas: HTMLCanvasElement,
  bitmap: ImageBitmap,
  info: ImageSize,
  plan: ImageDrawPlan,
  background: string | null,
  keepsAlpha: boolean,
  pixelScale: number
) {
  canvas.width = Math.max(1, Math.round(plan.canvasWidth * pixelScale))
  canvas.height = Math.max(1, Math.round(plan.canvasHeight * pixelScale))
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(canvas.width / plan.canvasWidth, 0, 0, canvas.height / plan.canvasHeight, 0, 0)
  ctx.clearRect(0, 0, plan.canvasWidth, plan.canvasHeight)
  if (!keepsAlpha) {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, plan.canvasWidth, plan.canvasHeight)
  }
  if (background !== null) {
    ctx.fillStyle = background
    ctx.fillRect(0, 0, plan.canvasWidth, plan.canvasHeight)
  }
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(plan.centerX, plan.centerY)
  ctx.scale(plan.scaleX, plan.scaleY)
  ctx.rotate((plan.rotation * Math.PI) / 180)
  // レシピは probe の寸法で持つが、デコード結果の寸法がまれに違うので、元画像の座標を合わせる
  const sx = bitmap.width / info.width
  const sy = bitmap.height / info.height
  const { source } = plan
  ctx.drawImage(
    bitmap,
    source.x * sx,
    source.y * sy,
    source.width * sx,
    source.height * sy,
    -plan.drawWidth / 2,
    -plan.drawHeight / 2,
    plan.drawWidth,
    plan.drawHeight
  )
}

type Drag =
  | { kind: 'move'; origin: Point; start: Rect }
  | { kind: 'resize'; origin: Point; start: Rect; handle: CropHandle }
  | { kind: 'draw'; origin: Point }

const HANDLE_POSITION: Record<CropHandle, string> = {
  nw: 'left-0 top-0 cursor-nwse-resize',
  ne: 'left-full top-0 cursor-nesw-resize',
  se: 'left-full top-full cursor-nwse-resize',
  sw: 'left-0 top-full cursor-nesw-resize',
  n: 'left-1/2 top-0 cursor-ns-resize',
  s: 'left-1/2 top-full cursor-ns-resize',
  e: 'left-full top-1/2 cursor-ew-resize',
  w: 'left-0 top-1/2 cursor-ew-resize',
}

/**
 * 切り抜きの枠。枠の中をドラッグで移動、つまみで大きさを変え、枠の外をドラッグで描き直す。
 * ドラッグ中は手元の状態だけを動かし、離したときに 1 回だけ確定する（履歴に 1 手として積むため）。
 */
function CropOverlay({
  rect,
  aspect,
  onCommit,
  label,
  bounds,
  scale,
}: CropOverlayProps & { bounds: ImageSize; scale: number }) {
  const layerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [draft, setDraft] = useState<Rect | null>(null)
  const shown = draft ?? rect
  // 画面上で 8px 未満の枠は掴めないので、それより小さくはしない
  const minSize = Math.min(8 / scale, bounds.width, bounds.height)

  const toView = (event: ReactPointerEvent): Point => {
    const box = layerRef.current!.getBoundingClientRect()
    return { x: (event.clientX - box.left) / scale, y: (event.clientY - box.top) / scale }
  }

  const next = (drag: Drag, point: Point): Rect => {
    const dx = point.x - drag.origin.x
    const dy = point.y - drag.origin.y
    switch (drag.kind) {
      case 'move':
        return moveRect(drag.start, dx, dy, bounds)
      case 'resize':
        return resizeRect(drag.start, drag.handle, dx, dy, bounds, aspect, minSize)
      case 'draw':
        return spanRect(drag.origin, point, bounds, aspect, minSize)
    }
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const origin = toView(event)
    const target = event.target as HTMLElement
    const handle = target.dataset.handle as CropHandle | undefined
    dragRef.current = handle
      ? { kind: 'resize', origin, start: rect, handle }
      : target.dataset.crop
        ? { kind: 'move', origin, start: rect }
        : { kind: 'draw', origin }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    setDraft(next(drag, toView(event)))
  }

  const finish = (event: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setDraft(null)
    // 描き直しでクリックしただけ（ほとんど動いていない）なら何もしない
    const result = next(drag, toView(event))
    const moved = Math.hypot(result.x - rect.x, result.y - rect.y, result.width - rect.width, result.height - rect.height)
    if (commit && (drag.kind !== 'draw' || (result.width >= minSize && result.height >= minSize)) && moved > 0.5) {
      onCommit(result)
    }
  }

  const handles = aspect === null ? [...CORNER_HANDLES, ...EDGE_HANDLES] : CORNER_HANDLES

  return (
    <div
      ref={layerRef}
      className="absolute inset-0 cursor-crosshair touch-none overflow-hidden select-none"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(event) => finish(event, true)}
      onPointerCancel={(event) => finish(event, false)}
      aria-label={label}
    >
      <div
        data-crop="1"
        className="absolute cursor-move border border-white outline outline-1 outline-black/60"
        style={{
          left: shown.x * scale,
          top: shown.y * scale,
          width: shown.width * scale,
          height: shown.height * scale,
          // 枠の外を暗くして、残る範囲を浮かせる
          boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.45)',
        }}
      >
        {/* 三分割の目安線 */}
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="border-[0.5px] border-white/30" />
          ))}
        </div>
        {handles.map((handle) => (
          <div
            key={handle}
            data-handle={handle}
            className={cn(
              'absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-[2px] border border-black/60 bg-white',
              HANDLE_POSITION[handle]
            )}
          />
        ))}
      </div>
    </div>
  )
}

/** 要素の大きさを追う。プレビューを作業領域に合わせて縮めるため */
function useElementSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize((prev) => (prev && prev.width === width && prev.height === height ? prev : { width, height }))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref])
  return size
}

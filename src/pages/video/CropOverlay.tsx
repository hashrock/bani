import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { cn } from '@/lib/utils'
import { screenDeltaToSource } from '../../media/video'
import type { VideoCropRect, VideoRecipe, VideoSize } from '../../media/video'

/** 掴んだ場所。辺・角は動かす辺の組、move は枠ごと動かす */
type Grip = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const HANDLES: Exclude<Grip, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

interface CropOverlayProps {
  recipe: VideoRecipe
  size: VideoSize
  /** 元の 1 画素が画面の何 CSS ピクセルに当たるか */
  scale: number
  /** 枠を動かせるか。動かせないときは外側を暗くして、書き出しの見た目に近づけるだけ */
  editing: boolean
  /** ドラッグ中。範囲の丸めはレシピ側（applyVideoEdit）が行う */
  onChange: (rect: VideoCropRect) => void
  /** ドラッグを離したとき */
  onCommit: () => void
  label: string
}

const percent = (value: number, total: number) => `${(value / total) * 100}%`

/**
 * 切り抜きの枠。プレビューの映像と同じ要素の中に元の向きの座標で置くので、
 * 映像と一緒に回転・反転して見える。ドラッグの移動量は画面の向きなので、元の向きへ戻して足す。
 */
export function CropOverlay({ recipe, size, scale, editing, onChange, onCommit, label }: CropOverlayProps) {
  const dragRef = useRef<{ grip: Grip; x: number; y: number; rect: VideoCropRect } | null>(null)
  const rect = recipe.crop ?? { x: 0, y: 0, width: size.width, height: size.height }
  if (!editing && !recipe.crop) return null

  // 掴んだ場所は data-grip で受け取る（描画中に場所ごとの関数を作ると ref の扱いが lint に咎められる）
  const begin = (event: ReactPointerEvent<HTMLElement>) => {
    const grip = event.currentTarget.dataset.grip as Grip | undefined
    if (!editing || event.button !== 0 || !grip) return
    event.preventDefault()
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { grip, x: event.clientX, y: event.clientY, rect }
  }

  const move = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const delta = screenDeltaToSource(event.clientX - drag.x, event.clientY - drag.y, recipe, scale)
    onChange(resize(drag.rect, drag.grip, delta.dx, delta.dy, size))
  }

  const end = (event: ReactPointerEvent<HTMLElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    onCommit()
  }

  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end }

  return (
    <div className="pointer-events-none absolute inset-0" aria-label={label}>
      <div
        className={cn(
          'absolute',
          editing ? 'pointer-events-auto cursor-move outline outline-1 outline-white' : ''
        )}
        style={{
          left: percent(rect.x, size.width),
          top: percent(rect.y, size.height),
          width: percent(rect.width, size.width),
          height: percent(rect.height, size.height),
          // 外側を暗くする。親が overflow: hidden なので映像の外にははみ出さない
          boxShadow: `0 0 0 9999px rgba(0, 0, 0, ${editing ? 0.55 : 0.85})`,
        }}
        data-grip="move"
        onPointerDown={begin}
        {...handlers}
      >
        {editing && (
          <>
            {/* 三分割の目安線 */}
            <div className="pointer-events-none absolute inset-x-0 top-1/3 h-px bg-white/40" />
            <div className="pointer-events-none absolute inset-x-0 top-2/3 h-px bg-white/40" />
            <div className="pointer-events-none absolute inset-y-0 left-1/3 w-px bg-white/40" />
            <div className="pointer-events-none absolute inset-y-0 left-2/3 w-px bg-white/40" />
            {HANDLES.map((grip) => (
              <div
                key={grip}
                data-grip={grip}
                className="absolute size-3 -translate-1/2 rounded-[2px] border border-black/40 bg-white"
                style={{ ...handlePosition(grip), cursor: cursorFor(grip, recipe) }}
                onPointerDown={begin}
                {...handlers}
              />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function handlePosition(grip: Exclude<Grip, 'move'>) {
  const left = grip.includes('w') ? '0%' : grip.includes('e') ? '100%' : '50%'
  const top = grip.includes('n') ? '0%' : grip.includes('s') ? '100%' : '50%'
  return { left, top }
}

/** 画面での見た目の向きに合わせたカーソル。90° 回すと縦横が、片方だけ反転すると斜めの向きが入れ替わる */
function cursorFor(grip: Exclude<Grip, 'move'>, recipe: VideoRecipe): string {
  const quarter = recipe.rotation % 180 !== 0
  if (grip.length === 1) {
    const vertical = grip === 'n' || grip === 's'
    return vertical !== quarter ? 'ns-resize' : 'ew-resize'
  }
  const mainDiagonal = grip === 'nw' || grip === 'se'
  const swapped = quarter !== (recipe.flipH !== recipe.flipV)
  return mainDiagonal !== swapped ? 'nwse-resize' : 'nesw-resize'
}

/** 掴んだ場所に応じて枠を動かす。移動は枠の大きさを保ったまま映像の内側で止める */
function resize(
  rect: VideoCropRect,
  grip: Grip,
  dx: number,
  dy: number,
  size: VideoSize
): VideoCropRect {
  if (grip === 'move') {
    return {
      ...rect,
      x: Math.min(Math.max(0, rect.x + dx), size.width - rect.width),
      y: Math.min(Math.max(0, rect.y + dy), size.height - rect.height),
    }
  }
  let left = rect.x
  let top = rect.y
  let right = rect.x + rect.width
  let bottom = rect.y + rect.height
  if (grip.includes('w')) left = Math.min(Math.max(0, left + dx), right - 1)
  if (grip.includes('e')) right = Math.max(Math.min(size.width, right + dx), left + 1)
  if (grip.includes('n')) top = Math.min(Math.max(0, top + dy), bottom - 1)
  if (grip.includes('s')) bottom = Math.max(Math.min(size.height, bottom + dy), top + 1)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

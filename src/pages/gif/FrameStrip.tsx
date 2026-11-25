import { memo, useEffect, useRef, useState } from 'react'
import type { CSSProperties, DragEvent, KeyboardEvent, MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import { isMac } from '../../core/useHotkey'
import { useLocalMessages } from '../../i18n/local'
import type { GifFrameRef } from '../../media/gif'
import { slotFromPointer, type ClickModifiers, type Selection } from '../pdf/pageModel'
import { messages } from './messages'

/** 並べ替えのドラッグだけを見分ける種類。ファイルのドロップ（Files）とは混ざらない */
const DRAG_TYPE = 'application/x-bani-gif-frames'
/** サムネイルの 1 辺（CSS px）。高精細な画面ではその倍まで描く */
const THUMB = 72
/** 透過を見分ける市松模様（色は index.css の変数から。画像の画面のプレビューと同じ） */
const CHECKER: CSSProperties = {
  backgroundColor: 'var(--checker-light)',
  backgroundImage:
    'linear-gradient(45deg, var(--checker-dark) 25%, transparent 25%, transparent 75%, var(--checker-dark) 75%), linear-gradient(45deg, var(--checker-dark) 25%, transparent 25%, transparent 75%, var(--checker-dark) 75%)',
  backgroundSize: '12px 12px',
  backgroundPosition: '0 0, 6px 6px',
}

export interface FrameStripProps {
  frames: readonly GifFrameRef[]
  keys: readonly string[]
  selection: Selection
  /** いまプレビューに出しているフレーム */
  current: number
  bitmapOf: (source: number, frame: number) => ImageBitmap | null
  onSelect: (index: number, modifiers: ClickModifiers) => void
  onSelectAll: () => void
  onClearSelection: () => void
  onDragStartFrame: (index: number) => number[]
  onDropAt: (slot: number, indices: readonly number[]) => void
  onRemove: () => void
  onStep: (delta: -1 | 1) => void
  onTogglePlay: () => void
}

/**
 * フレームの一覧（画面の下）。横に並べ、ドラッグか ⌥ + 矢印で並べ替える。
 * キーは一覧が自分で処理する（矢印・Home/End・Delete・⌘A・Esc・Space は再生）。
 * 選択の約束は PDF のページ一覧と同じ（src/pages/pdf/pageModel.ts）。
 */
export function FrameStrip(props: FrameStripProps) {
  const { frames, keys, selection, current, bitmapOf } = props
  const m = useLocalMessages(messages)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState(0)
  const [drag, setDrag] = useState<{ indices: number[]; slot: number | null } | null>(null)

  // 各フレームへ渡す関数は作り直さない（memo したフレームが描き直されないように）。最新の props は ref から読む
  const latest = useRef(props)
  useEffect(() => {
    latest.current = props
  })
  const [handlers] = useState(() => ({
    click(index: number, event: MouseEvent) {
      setFocus(index)
      latest.current.onSelect(index, { shift: event.shiftKey, toggle: isMac() ? event.metaKey : event.ctrlKey })
    },
    dragStart(index: number, event: DragEvent) {
      const indices = latest.current.onDragStartFrame(index)
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData(DRAG_TYPE, String(indices.length))
      setDrag({ indices, slot: null })
    },
    dragOver(index: number, event: DragEvent<HTMLElement>) {
      if (!event.dataTransfer.types.includes(DRAG_TYPE)) return
      event.preventDefault()
      event.stopPropagation()
      event.dataTransfer.dropEffect = 'move'
      const rect = event.currentTarget.getBoundingClientRect()
      const slot = slotFromPointer(index, event.clientX - rect.left, rect.width)
      setDrag((d) => (d && d.slot !== slot ? { ...d, slot } : d))
    },
  }))

  const focused = Math.min(focus, Math.max(0, frames.length - 1))
  // 再生中のフレームが見えるように、一覧を横にずらす
  useEffect(() => {
    scrollRef.current?.querySelector<HTMLElement>(`[data-index="${current}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  const focusCell = (index: number) => {
    setFocus(index)
    scrollRef.current?.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const mod = isMac() ? event.metaKey : event.ctrlKey
    const last = frames.length - 1
    if (last < 0) return
    const go = (index: number) => {
      const next = Math.max(0, Math.min(last, index))
      focusCell(next)
      props.onSelect(next, { shift: event.shiftKey })
    }
    switch (event.key) {
      case 'ArrowLeft':
      case 'ArrowRight': {
        const delta = event.key === 'ArrowLeft' ? -1 : 1
        event.preventDefault()
        if (event.altKey) {
          props.onStep(delta)
          focusCell(Math.max(0, Math.min(last, focused + delta)))
        } else {
          go(focused + delta)
        }
        return
      }
      case 'Home':
        event.preventDefault()
        go(0)
        return
      case 'End':
        event.preventDefault()
        go(last)
        return
      case ' ':
        // 一覧の上でも Space は再生・一時停止（選択の足し引きは ⌘ / Ctrl + クリック）
        event.preventDefault()
        props.onTogglePlay()
        return
      case 'Delete':
      case 'Backspace':
        event.preventDefault()
        props.onRemove()
        return
      case 'Escape':
        props.onClearSelection()
        return
      case 'a':
        if (mod) {
          event.preventDefault()
          props.onSelectAll()
        }
        return
    }
  }

  const finishDrag = () => setDrag(null)
  const moving = new Set(drag?.indices ?? [])

  return (
    <div
      ref={scrollRef}
      className="overflow-x-auto overflow-y-hidden"
      onClick={(event) => {
        if (event.target === event.currentTarget) props.onClearSelection()
      }}
      onDragOver={(event) => {
        if (!drag || !event.dataTransfer.types.includes(DRAG_TYPE)) return
        event.preventDefault()
        if (event.target === event.currentTarget) {
          setDrag((d) => (d && d.slot !== frames.length ? { ...d, slot: frames.length } : d))
        }
      }}
      onDrop={(event) => {
        if (!drag || !event.dataTransfer.types.includes(DRAG_TYPE)) return
        event.preventDefault()
        if (drag.slot !== null) props.onDropAt(drag.slot, drag.indices)
        finishDrag()
      }}
    >
      <div
        role="listbox"
        aria-label={m.framesLabel}
        aria-multiselectable
        aria-orientation="horizontal"
        className="flex w-max gap-2 px-1 py-1"
        onKeyDown={onKeyDown}
      >
        {frames.map((ref, index) => (
          <FrameCell
            key={keys[index]}
            index={index}
            bitmap={bitmapOf(ref.source, ref.frame)}
            duration={ref.duration}
            selected={selection.keys.has(keys[index])}
            current={index === current}
            focused={index === focused}
            moving={moving.has(index)}
            dropBefore={drag?.slot === index}
            dropAfter={drag?.slot === frames.length && index === frames.length - 1}
            handlers={handlers}
            onDragEnd={finishDrag}
          />
        ))}
      </div>
    </div>
  )
}

interface FrameCellProps {
  index: number
  bitmap: ImageBitmap | null
  duration: number
  selected: boolean
  current: boolean
  focused: boolean
  moving: boolean
  dropBefore: boolean
  dropAfter: boolean
  handlers: {
    click: (index: number, event: MouseEvent) => void
    dragStart: (index: number, event: DragEvent) => void
    dragOver: (index: number, event: DragEvent<HTMLElement>) => void
  }
  onDragEnd: () => void
}

const FrameCell = memo(function FrameCell({
  index,
  bitmap,
  duration,
  selected,
  current,
  focused,
  moving,
  dropBefore,
  dropAfter,
  handlers,
  onDragEnd,
}: FrameCellProps) {
  const m = useLocalMessages(messages)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // サムネイルは絵が変わったときだけ描く（ImageBitmap は入力を読んだときにできていて、描くのは縮めるだけ）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !bitmap) return
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1))
    const scale = Math.min((THUMB * dpr) / bitmap.width, (THUMB * dpr) / bitmap.height)
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  }, [bitmap])

  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={`${m.frameLabel(index + 1)} ${duration}ms`}
      aria-current={current || undefined}
      data-index={index}
      tabIndex={focused ? 0 : -1}
      draggable
      onClick={(event) => handlers.click(index, event)}
      onDragStart={(event) => handlers.dragStart(index, event)}
      onDragOver={(event) => handlers.dragOver(index, event)}
      onDragEnd={onDragEnd}
      className={cn(
        'relative flex w-[88px] shrink-0 cursor-default flex-col items-center gap-1 rounded-md p-1.5 outline-none select-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
        selected ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-muted',
        moving && 'opacity-40'
      )}
    >
      {dropBefore && <DropMarker side="left" />}
      {dropAfter && <DropMarker side="right" />}
      <div
        className={cn(
          'flex size-[72px] items-center justify-center overflow-hidden rounded-sm ring-1 ring-black/10',
          current && 'ring-2 ring-foreground/70'
        )}
        style={CHECKER}
      >
        <canvas ref={canvasRef} className="max-h-full max-w-full" />
      </div>
      <div className="flex w-full justify-between gap-1 text-[10px] text-muted-foreground tabular-nums">
        <span className={cn(selected && 'font-semibold text-foreground')}>{index + 1}</span>
        <span>{duration}ms</span>
      </div>
    </div>
  )
})

function DropMarker({ side }: { side: 'left' | 'right' }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute top-1 bottom-1 w-0.5 rounded bg-primary',
        side === 'left' ? '-left-1' : '-right-1'
      )}
    />
  )
}

import { memo, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { DragEvent, KeyboardEvent, MouseEvent } from 'react'
import { cn } from '@/lib/utils'
import { displayedPageSize, type PdfPageInfo, type PdfPageRef } from '../../media/pdf'
import { useLocalMessages } from '../../i18n/local'
import { messages } from './messages'
import { slotFromPointer, type ClickModifiers, type Selection } from './pageModel'
import { thumbnailKey, type ThumbnailStore } from './thumbnailStore'

/** 並べ替えのドラッグだけを見分ける種類。ファイルのドロップ（Files）とは混ざらない */
const DRAG_TYPE = 'application/x-bani-pdf-pages'
const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export interface PageGridProps {
  pages: readonly PdfPageRef[]
  keys: readonly string[]
  selection: Selection
  store: ThumbnailStore
  /** 入力ごとのページの大きさ。描けるまでの枠の形に使う */
  pageInfo: (source: number, page: number) => PdfPageInfo | undefined
  /** 複数の入力を結合しているときだけ、どの入力のページかを示す */
  sourceLabel: ((source: number) => string) | null
  onSelect: (index: number, modifiers: ClickModifiers) => void
  onSelectAll: () => void
  onClearSelection: () => void
  /** ドラッグを始めたページが選択に入っていなければ、そのページだけを選び直す */
  onDragStartPage: (index: number) => number[]
  /** すき間（0〜pages.length）に選んだページを落とした */
  onDropAt: (slot: number, indices: readonly number[]) => void
  onRemove: () => void
  onRotate: (by: 90 | -90) => void
  onStep: (delta: -1 | 1) => void
}

/**
 * ページのサムネイルの格子。見えているページだけを描き（IntersectionObserver）、
 * 描いた絵は ThumbnailStore が覚えているので、スクロールで戻っても描き直さない。
 * 回転は絵を描き直さず CSS で当てる。
 */
export function PageGrid(props: PageGridProps) {
  const { pages, keys, selection, store, pageInfo, sourceLabel } = props
  const m = useLocalMessages(messages)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const [focus, setFocus] = useState(0)
  const [drag, setDrag] = useState<{ indices: number[]; slot: number | null } | null>(null)

  // 各ページへ渡す関数は毎回作り直さない（memo したページが描き直されないように）。
  // 最新の props は ref から読む
  const latest = useRef({ props, drag })
  useEffect(() => {
    latest.current = { props, drag }
  })
  const [handlers] = useState(() => ({
    click(index: number, event: MouseEvent) {
      setFocus(index)
      latest.current.props.onSelect(index, {
        shift: event.shiftKey,
        toggle: isMac() ? event.metaKey : event.ctrlKey,
      })
    },
    dragStart(index: number, event: DragEvent) {
      const indices = latest.current.props.onDragStartPage(index)
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
      setDrag((current) => (current && current.slot !== slot ? { ...current, slot } : current))
    },
  }))

  // 選択や削除でページの数が変わっても、フォーカスは並びの中に収める
  const focused = Math.min(focus, Math.max(0, pages.length - 1))

  const focusCell = (index: number) => {
    setFocus(index)
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-index="${index}"]`)
      ?.focus({ preventScroll: false })
  }

  const finishDrag = () => setDrag(null)

  const onDrop = (event: DragEvent) => {
    if (!drag || !event.dataTransfer.types.includes(DRAG_TYPE)) return
    event.preventDefault()
    if (drag.slot !== null) props.onDropAt(drag.slot, drag.indices)
    finishDrag()
  }

  const onKeyDown = (event: KeyboardEvent) => {
    const mod = isMac() ? event.metaKey : event.ctrlKey
    const last = pages.length - 1
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
        // ⌥ + 矢印はページそのものを動かす（ドラッグの代わり）
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
        event.preventDefault()
        props.onSelect(focused, { toggle: true })
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
      case 'r':
      case 'R':
        if (!mod) {
          event.preventDefault()
          props.onRotate(event.shiftKey ? -90 : 90)
        }
        return
    }
  }

  const moving = new Set(drag?.indices ?? [])

  return (
    <div
      ref={(element) => {
        scrollRef.current = element
        setRoot(element)
      }}
      className="flex-1 overflow-y-auto p-4"
      onClick={(event) => {
        // ページの外（すき間）を押したら選択を外す
        if (event.target === event.currentTarget) props.onClearSelection()
      }}
      onDragOver={(event) => {
        // 最後のページより後ろの空いたところは「末尾へ」
        if (!drag || !event.dataTransfer.types.includes(DRAG_TYPE)) return
        event.preventDefault()
        // ページ同士のすき間では、直前に指していた位置のままにする（行き来でちらつかないように）
        if (event.target === event.currentTarget) {
          setDrag((current) =>
            current && current.slot !== pages.length ? { ...current, slot: pages.length } : current
          )
        }
      }}
      onDrop={onDrop}
    >
      <div
        role="listbox"
        aria-label={m.pagesLabel}
        aria-multiselectable
        aria-orientation="horizontal"
        className="grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-3"
        onKeyDown={onKeyDown}
      >
        {pages.map((ref, index) => (
          <PageCell
            key={keys[index]}
            index={index}
            source={ref.source}
            page={ref.page}
            rotate={ref.rotate}
            info={pageInfo(ref.source, ref.page)}
            sourceLabel={sourceLabel?.(ref.source) ?? null}
            selected={selection.keys.has(keys[index])}
            focused={index === focused}
            moving={moving.has(index)}
            dropBefore={drag?.slot === index}
            dropAfter={drag?.slot === pages.length && index === pages.length - 1}
            store={store}
            root={root}
            handlers={handlers}
            onDragEnd={finishDrag}
          />
        ))}
      </div>
    </div>
  )
}

interface PageCellProps {
  index: number
  source: number
  page: number
  rotate: number
  info: PdfPageInfo | undefined
  sourceLabel: string | null
  selected: boolean
  focused: boolean
  moving: boolean
  dropBefore: boolean
  dropAfter: boolean
  store: ThumbnailStore
  root: HTMLElement | null
  handlers: {
    click: (index: number, event: MouseEvent) => void
    dragStart: (index: number, event: DragEvent) => void
    dragOver: (index: number, event: DragEvent<HTMLElement>) => void
  }
  onDragEnd: () => void
}

const PageCell = memo(function PageCell({
  index,
  source,
  page,
  rotate,
  info,
  sourceLabel,
  selected,
  focused,
  moving,
  dropBefore,
  dropAfter,
  store,
  root,
  handlers,
  onDragEnd,
}: PageCellProps) {
  const m = useLocalMessages(messages)
  const cellRef = useRef<HTMLDivElement>(null)
  const key = thumbnailKey(source, page)
  const state = useSyncExternalStore(
    (listener) => store.subscribe(key, listener),
    () => store.get(key)
  )

  // 見えている（少し手前も含む）間だけ描いてもらう。描き始める前に外れたら取り下げる
  useEffect(() => {
    const element = cellRef.current
    if (!element || !root || state.status !== 'idle') return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) store.request(source, page)
        else store.cancel(source, page)
      },
      { root, rootMargin: '300px 0px' }
    )
    observer.observe(element)
    return () => {
      observer.disconnect()
      store.cancel(source, page)
    }
  }, [root, store, source, page, state.status])

  const size = info ? displayedPageSize(info) : { width: 1, height: 1.414 }
  const transform = rotate ? { transform: `rotate(${rotate}deg)` } : undefined
  const fit = size.width >= size.height ? { width: '100%' } : { height: '100%' }

  return (
    <div
      ref={cellRef}
      role="option"
      aria-selected={selected}
      aria-label={m.pageLabel(index + 1)}
      data-index={index}
      tabIndex={focused ? 0 : -1}
      draggable
      onClick={(event) => handlers.click(index, event)}
      onDragStart={(event) => handlers.dragStart(index, event)}
      onDragOver={(event) => handlers.dragOver(index, event)}
      onDragEnd={onDragEnd}
      className={cn(
        'relative flex cursor-default flex-col items-center gap-1.5 rounded-md p-2 outline-none select-none',
        'focus-visible:ring-3 focus-visible:ring-ring/50',
        selected ? 'bg-primary/10 ring-2 ring-primary' : 'hover:bg-background/60',
        moving && 'opacity-40'
      )}
    >
      {dropBefore && <DropMarker side="left" />}
      {dropAfter && <DropMarker side="right" />}
      {/* 枠は正方形に固定する。縦長・横長のページを回しても枠からはみ出さず、並びもそろう */}
      <div className="relative aspect-square w-full">
        <div className="absolute inset-1 flex items-center justify-center">
          {state.status === 'ready' ? (
            <img
              src={state.url}
              alt=""
              draggable={false}
              className="max-h-full max-w-full bg-white shadow-sm ring-1 ring-black/10 transition-transform duration-150"
              style={transform}
            />
          ) : (
            <div
              className={cn(
                'flex items-center justify-center bg-white shadow-sm ring-1 ring-black/10 transition-transform duration-150',
                state.status === 'error' && 'text-[10px] text-muted-foreground'
              )}
              style={{ aspectRatio: `${size.width} / ${size.height}`, ...fit, ...transform }}
            >
              {state.status === 'error' && m.thumbnailFailed}
            </div>
          )}
        </div>
      </div>
      <div className="flex max-w-full items-center gap-1 text-[11px] text-muted-foreground">
        <span className={cn('tabular-nums', selected && 'font-semibold text-foreground')}>
          {index + 1}
        </span>
        {sourceLabel && (
          <span className="truncate rounded bg-background px-1 text-[10px]" title={sourceLabel}>
            {sourceLabel}
          </span>
        )}
      </div>
    </div>
  )
})

/** ドロップしたときに差し込まれる位置。格子のすき間に縦線を引く */
function DropMarker({ side }: { side: 'left' | 'right' }) {
  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute top-1 bottom-1 w-0.5 rounded bg-primary',
        side === 'left' ? '-left-2' : '-right-2'
      )}
    />
  )
}

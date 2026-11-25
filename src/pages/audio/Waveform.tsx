import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { useTheme } from '../../app/theme'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import { applyTrim } from '../../state/trim'
import type { AudioTrim, TimeRange } from '../../media/audio/types'
import { columnPeaks } from './logic'
import { audioMessages } from './messages'

interface WaveformProps {
  duration: number
  /** ファイル全体のピーク列（0〜1）。読み込み中は null */
  peaks: Float32Array | null
  trim: AudioTrim
  /** 無音カットで削る範囲（元ファイルの秒）。区間の外と同じく暗くし、斜線で区別する */
  removed: readonly TimeRange[]
  currentTime: number
  /** 元ファイルの時刻での編集後の倍率。区間の中の波形をこの倍率で描き、編集の効き方を見せる */
  gainAt: (time: number) => number
  loading: boolean
  error: boolean
  /** ドラッグを終えたときに 1 度だけ呼ぶ（履歴に 1 段だけ積むため） */
  onTrimCommit: (trim: AudioTrim) => void
  onSeek: (time: number) => void
}

type DragTarget = 'start' | 'end' | 'playhead'

const percent = (value: number, duration: number) =>
  duration > 0 ? `${(Math.min(Math.max(value / duration, 0), 1)) * 100}%` : '0%'

/**
 * 画面中央の波形。元の波形を薄く、区間の中は編集（フェード・音量）を掛けた波形を濃く重ねる。
 * 無音カットで削る範囲は gainAt が 0 になるので濃い波形が消え、さらに斜線を重ねて示す。
 * 区間をドラッグしているあいだは、削る範囲を確定した区間のまま出す（ドラッグ中に検出し直さない）。
 * 両端のつまみで切り出し区間、それ以外の場所のドラッグで再生位置を動かす。
 */
export function Waveform({
  duration,
  peaks,
  trim,
  removed,
  currentTime,
  gainAt,
  loading,
  error,
  onTrimCommit,
  onSeek,
}: WaveformProps) {
  const { t } = useI18n()
  const m = useLocalMessages(audioMessages)
  // 色は CSS 変数から読むので、配色が変わったら描き直す
  const { theme } = useTheme()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [dragging, setDragging] = useState<DragTarget | null>(null)
  // ドラッグ中の区間。離すまでレシピ（履歴）には入れない
  const [draft, setDraft] = useState<AudioTrim | null>(null)
  const shown = draft ?? trim

  useLayoutEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ width: Math.floor(width), height: Math.floor(height) })
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

  // 描画は区間と倍率が変わるたびにやり直す（数千本の線なので 1 フレームに収まる）
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.width === 0 || size.height === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.width * dpr
    canvas.height = size.height * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)

    const style = getComputedStyle(canvas)
    const strong = style.getPropertyValue('--foreground').trim() || '#111'
    const faint = style.getPropertyValue('--border').trim() || '#ddd'
    const mid = size.height / 2

    // 無音の基準線
    ctx.fillStyle = faint
    ctx.fillRect(0, mid - 0.5, size.width, 1)
    if (!peaks || duration <= 0) return

    const columns = columnPeaks(peaks, size.width)
    const half = mid - 4
    for (let x = 0; x < columns.length; x++) {
      const time = ((x + 0.5) / columns.length) * duration
      const original = columns[x]
      ctx.fillStyle = faint
      const h = Math.max(1, original * half)
      ctx.fillRect(x, mid - h, 1, h * 2)
      if (time < shown.start || time > shown.end) continue
      // 書き出しでは 1 を超えた分は割れるので、表示も 1 で頭打ちにする
      const edited = Math.min(1, original * gainAt(time))
      const e = Math.max(edited > 0 ? 1 : 0, edited * half)
      ctx.fillStyle = strong
      ctx.fillRect(x, mid - e, 1, e * 2)
    }
  }, [peaks, duration, size, shown.start, shown.end, gainAt, theme])

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect || rect.width === 0) return 0
      return Math.min(duration, Math.max(0, ((clientX - rect.left) / rect.width) * duration))
    },
    [duration]
  )

  const draftRef = useRef<AudioTrim | null>(null)
  useEffect(() => {
    draftRef.current = draft
  })

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => {
      const time = timeAt(e.clientX)
      if (dragging === 'playhead') {
        onSeek(time)
        return
      }
      const base = draftRef.current ?? trim
      const next = applyTrim(base, duration, dragging === 'start' ? { type: 'setStart', time } : { type: 'setEnd', time })
      setDraft(next)
      // 動かした側の端へ再生位置を合わせ、切り出し位置をその場で確かめられるようにする
      onSeek(dragging === 'start' ? next.start : next.end)
    }
    const onUp = () => {
      const finished = draftRef.current
      setDragging(null)
      setDraft(null)
      if (finished) onTrimCommit(finished)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [dragging, timeAt, trim, duration, onSeek, onTrimCommit])

  const beginDrag = (target: DragTarget) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragging(target)
  }

  // つまみはキーボードでも動かせるようにする（矢印で 0.1 秒、Shift で 1 秒）
  const nudge = (target: 'start' | 'end') => (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 1 : 0.1
    const delta = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
    if (delta === 0) return
    e.preventDefault()
    const time = (target === 'start' ? trim.start : trim.end) + delta
    onTrimCommit(applyTrim(trim, duration, target === 'start' ? { type: 'setStart', time } : { type: 'setEnd', time }))
  }

  return (
    <div className="flex flex-1 flex-col justify-center px-6 py-8">
      <div
        ref={wrapRef}
        className={cn(
          'relative h-[min(320px,60%)] min-h-[120px] w-full cursor-pointer touch-none rounded-md border bg-background select-none',
          dragging && 'cursor-ew-resize'
        )}
        aria-label={m.waveformLabel}
        onPointerDown={(e) => {
          setDragging('playhead')
          onSeek(timeAt(e.clientX))
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 size-full" />

        {/* 区間の外を暗くして、書き出されない部分だとわかるようにする */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 bg-muted/70"
          style={{ width: percent(shown.start, duration) }}
        />
        <div
          className="pointer-events-none absolute inset-y-0 right-0 bg-muted/70"
          style={{ left: percent(shown.end, duration) }}
        />

        {removed.map((range) => (
          <div
            key={`${range.start}-${range.end}`}
            data-silence-removed=""
            className="pointer-events-none absolute inset-y-0 bg-muted/60"
            style={{
              left: percent(range.start, duration),
              width: percent(range.end - range.start, duration),
              backgroundImage:
                'repeating-linear-gradient(135deg, transparent 0 6px, color-mix(in oklab, var(--foreground) 14%, transparent) 6px 7px)',
            }}
            aria-hidden
          />
        ))}

        <TrimHandle
          left={percent(shown.start, duration)}
          label={t.trimStartHandle}
          value={shown.start}
          max={duration}
          onPointerDown={beginDrag('start')}
          onKeyDown={nudge('start')}
        />
        <TrimHandle
          left={percent(shown.end, duration)}
          label={t.trimEndHandle}
          value={shown.end}
          max={duration}
          onPointerDown={beginDrag('end')}
          onKeyDown={nudge('end')}
        />

        <div
          className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-timeline-strong"
          style={{ left: percent(currentTime, duration) }}
        />

        {(loading || error) && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-muted-foreground">
            {error ? m.errorWaveform : m.loadingWaveform}
          </div>
        )}
      </div>
    </div>
  )
}

function TrimHandle({
  left,
  label,
  value,
  max,
  onPointerDown,
  onKeyDown,
}: {
  left: string
  label: string
  value: number
  max: number
  onPointerDown: (e: React.PointerEvent) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="absolute inset-y-0 z-10 flex w-3 -translate-x-1/2 cursor-ew-resize items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      style={{ left }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    >
      <div className="h-full w-0.5 bg-foreground" />
      <div className="absolute h-8 w-2.5 rounded-sm border border-foreground bg-background shadow-xs" />
    </div>
  )
}

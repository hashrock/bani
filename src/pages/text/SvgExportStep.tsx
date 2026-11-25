import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ClipboardCopyIcon, ImageDownIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { copyToClipboard, saveFileAs } from '../../core/save'
import { usePersistentState } from '../../core/usePersistentState'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
// テキストの画面と一緒に読み込まれるので、画像エンジンの窓口（index）ではなく要る部分だけを読む
import { IMAGE_FORMATS } from '../../media/image/output'
import { MAX_DIMENSION, createImageRecipe } from '../../media/image/recipe'
import { renderImage } from '../../media/image/render'
import { SvgParseError, countRemovals, sanitizeSvg, svgRasterSize } from '../../media/image/svg'
import { SvgTooLargeError, rasterizeSvg } from '../../media/image/svgRaster'
import { isAbortError } from '../../utils/abort'
import { textMessages } from './messages'
import { Field, Segmented } from './parts'
import type { SvgExportSettings } from './svgExport'
import {
  DEFAULT_SVG_EXPORT,
  SVG_EXPORT_FORMATS,
  SVG_EXPORT_QUALITY,
  SVG_EXPORT_SCALES,
  previewScale,
  rasterOptionsOf,
} from './svgExport'

/** 下見の枠（CSS px）。サイドバーの幅に収める */
const PREVIEW_BOX = 160

/** 透過部分を見分けるための市松模様（画像の画面と同じ色） */
const CHECKER: CSSProperties = {
  backgroundColor: 'var(--checker-light)',
  backgroundImage:
    'linear-gradient(45deg, var(--checker-dark) 25%, transparent 25%, transparent 75%, var(--checker-dark) 75%), linear-gradient(45deg, var(--checker-dark) 25%, transparent 25%, transparent 75%, var(--checker-dark) 75%)',
  backgroundSize: '12px 12px',
  backgroundPosition: '0 0, 6px 6px',
}

const FORMAT_LABELS: Record<SvgExportSettings['format'], string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP' }

const BACKGROUNDS = { none: null, white: '#ffffff', black: '#000000' } as const
type BackgroundChoice = keyof typeof BACKGROUNDS | 'custom'

interface SvgExportStepProps {
  index: number
  /** 下見に使う本文（打つ手が止まってからの最新） */
  source: string
  /** 書き出すときの本文。エディタのいまの中身を読む */
  getText: () => string
  /** 書き出しの名前の元（拡張子は形式に合わせて付け替える） */
  name: string
}

/**
 * SVG の文書を PNG / JPEG / WebP として書き出す、テキストの画面の別の書き出し。
 * 描く前に外部への参照とスクリプトを取り除く（src/media/image/svg.ts）。保存は共通の保存（src/core/save.ts）を使う。
 */
export function SvgExportStep({ index, source, getText, name }: SvgExportStepProps) {
  const { t } = useI18n()
  const m = useLocalMessages(textMessages)
  const [settings, setSettings] = usePersistentState<SvgExportSettings>('text.svgExport', DEFAULT_SVG_EXPORT)
  const [busy, setBusy] = useState(false)
  const [failedPreview, setFailedPreview] = useState<string | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const update = (patch: Partial<SvgExportSettings>) => setSettings((prev) => ({ ...prev, ...patch }))

  // 寸法と取り除くものは字句解析だけでわかるので、描く前に出す
  const parsed = useMemo(() => {
    try {
      return { ok: true as const, ...sanitizeSvg(source) }
    } catch (error) {
      return { ok: false as const, error }
    }
  }, [source])
  const options = rasterOptionsOf(settings)
  const outputSize = parsed.ok ? svgRasterSize(parsed.intrinsic, options) : null
  const tooLarge = !!outputSize && (outputSize.width > MAX_DIMENSION || outputSize.height > MAX_DIMENSION)
  const removedCount = parsed.ok ? countRemovals(parsed.removed) : 0
  const keepsAlpha = IMAGE_FORMATS[settings.format].alpha
  const previewFailed = failedPreview === source

  // 下見は書き出しと同じ消毒・描き方で、枠に収まる大きさに描く
  useEffect(() => {
    if (!parsed.ok) return
    let cancelled = false
    const ratio = window.devicePixelRatio || 1
    rasterizeSvg(source, { scale: previewScale(parsed.intrinsic, PREVIEW_BOX, ratio) })
      .then(({ bitmap }) => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext('2d')
        if (cancelled || !canvas || !ctx) {
          bitmap.close()
          return
        }
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        canvas.style.width = `${bitmap.width / Math.max(1, ratio)}px`
        canvas.style.height = `${bitmap.height / Math.max(1, ratio)}px`
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(bitmap, 0, 0)
        bitmap.close()
        setFailedPreview(null)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        console.warn('SVG preview failed:', error)
        setFailedPreview(source)
      })
    return () => {
      cancelled = true
    }
  }, [parsed, source])

  const background = settings.background
  const backgroundChoice: BackgroundChoice =
    (Object.keys(BACKGROUNDS) as (keyof typeof BACKGROUNDS)[]).find((key) => BACKGROUNDS[key] === background) ?? 'custom'
  const previewBackground: CSSProperties =
    background !== null ? { backgroundColor: background } : keepsAlpha ? CHECKER : { backgroundColor: '#ffffff' }

  const describe = (error: unknown) => {
    if (error instanceof SvgParseError) return m.svgInvalid
    if (error instanceof SvgTooLargeError) return m.svgTooLarge(MAX_DIMENSION)
    return error instanceof Error ? error.message : String(error)
  }

  const run = async (method: 'saveAs' | 'copy') => {
    if (busy) return
    setBusy(true)
    try {
      // クリップボードに入れられる画像は PNG だけ
      const format = method === 'copy' ? 'png' : settings.format
      const file = new File([getText()], name, { type: 'image/svg+xml' })
      const recipe = { ...createImageRecipe(), background }
      const rendered = await renderImage(
        file,
        recipe,
        { format, quality: SVG_EXPORT_QUALITY, targetBytes: null },
        { svg: options }
      )
      if (method === 'copy') {
        await copyToClipboard({ blob: rendered.blob })
        toast(t.copiedToClipboard)
      } else {
        const handle = await saveFileAs(rendered.blob, rendered.filename)
        toast(handle ? t.savedTo(handle.name) : t.downloaded(rendered.filename))
      }
    } catch (error) {
      if (isAbortError(error)) return
      console.error('SVG export failed:', error)
      toast.error(m.svgFailed(describe(error)))
    } finally {
      setBusy(false)
    }
  }

  const disabled = busy || !parsed.ok || tooLarge

  return (
    <Step index={index} title={m.svgExport}>
      <div className="flex min-h-24 items-center justify-center rounded-md bg-muted p-2">
        {parsed.ok && !previewFailed ? (
          <canvas ref={canvasRef} aria-label={m.svgPreview} style={previewBackground} className="max-w-full" />
        ) : (
          <span className="text-[11px] text-muted-foreground">{m.svgNoPreview}</span>
        )}
      </div>
      {outputSize && (
        <div className="text-center text-[11px] text-muted-foreground tabular-nums">
          {m.svgOutputSize(outputSize.width, outputSize.height)}
        </div>
      )}

      <Field label={m.svgSize}>
        <Segmented
          className="w-40"
          value={settings.sizeMode}
          options={[
            { value: 'scale', label: m.svgSizeScale },
            { value: 'width', label: m.svgSizeWidth },
            { value: 'dpi', label: 'DPI' },
          ]}
          onChange={(sizeMode) => update({ sizeMode })}
        />
      </Field>
      {settings.sizeMode === 'scale' && (
        <Field label={m.svgSizeScale}>
          <Segmented
            className="w-40"
            value={String(settings.scale)}
            options={SVG_EXPORT_SCALES.map((scale) => ({ value: String(scale), label: `${scale}×` }))}
            onChange={(scale) => update({ scale: Number(scale) })}
          />
        </Field>
      )}
      {settings.sizeMode === 'width' && (
        <Field label={m.svgWidthPx}>
          <Input
            type="number"
            min={1}
            max={MAX_DIMENSION}
            value={settings.width ?? ''}
            placeholder={parsed.ok ? String(Math.round(parsed.intrinsic.width)) : ''}
            onChange={(event) => {
              const value = Number(event.target.value)
              update({ width: event.target.value === '' || !(value > 0) ? null : value })
            }}
            aria-label={m.svgWidthPx}
            className="h-7 w-40 bg-background text-xs"
          />
        </Field>
      )}
      {settings.sizeMode === 'dpi' && (
        <Field label={m.svgDpi}>
          <Input
            type="number"
            min={1}
            value={settings.dpi}
            onChange={(event) => {
              const value = Number(event.target.value)
              if (value > 0) update({ dpi: value })
            }}
            aria-label={m.svgDpi}
            className="h-7 w-40 bg-background text-xs"
          />
        </Field>
      )}

      <Field label={m.svgBackground}>
        <div className="flex items-center gap-1.5">
          <Segmented<BackgroundChoice>
            className="w-32"
            value={backgroundChoice}
            options={[
              { value: 'none', label: m.svgBackgroundNone },
              { value: 'white', label: m.svgBackgroundWhite },
              { value: 'black', label: m.svgBackgroundBlack },
            ]}
            onChange={(choice) => {
              if (choice !== 'custom') update({ background: BACKGROUNDS[choice] })
            }}
          />
          <input
            type="color"
            aria-label={m.svgBackgroundCustom}
            title={m.svgBackgroundCustom}
            className="h-6 w-7 cursor-pointer rounded border border-input bg-transparent p-0.5"
            value={(background ?? '#ffffff').slice(0, 7)}
            onChange={(event) => update({ background: event.currentTarget.value })}
          />
        </div>
      </Field>
      {!keepsAlpha && background === null && <StepHint>{m.svgFlattened}</StepHint>}

      <Field label={t.stepFormat}>
        <Segmented
          className="w-40"
          value={settings.format}
          options={SVG_EXPORT_FORMATS.map((format) => ({ value: format, label: FORMAT_LABELS[format] }))}
          onChange={(format) => update({ format })}
        />
      </Field>

      {!parsed.ok && <Notice tone="warn">{m.svgInvalid}</Notice>}
      {parsed.ok && previewFailed && <Notice tone="warn">{m.svgRenderFailed}</Notice>}
      {tooLarge && <Notice tone="warn">{m.svgTooLarge(MAX_DIMENSION)}</Notice>}
      {parsed.ok && removedCount > 0 && <Notice>{m.svgRemoved(parsed.removed)}</Notice>}

      <div className="flex gap-1.5">
        <Button variant="outline" size="xs" className="h-7 px-2.5" disabled={disabled} onClick={() => void run('saveAs')}>
          <ImageDownIcon />
          {t.saveAs}
        </Button>
        <Button variant="outline" size="xs" className="h-7 px-2.5" disabled={disabled} onClick={() => void run('copy')}>
          <ClipboardCopyIcon />
          {m.svgCopy}
        </Button>
      </div>
      <StepHint>{m.svgHint}</StepHint>
    </Step>
  )
}

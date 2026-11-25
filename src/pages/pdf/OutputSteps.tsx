import { useState } from 'react'
import type { ReactNode } from 'react'
import { ImageIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { solidOnClass } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { Chip, EstimateBox, EstimateRow, Notice, SmallButton } from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import {
  MAX_DPI,
  MIN_DPI,
  MIN_LONG_EDGE,
  MAX_CANVAS_SIDE,
  type PdfImageFormat,
  type PdfRasterResolution,
} from '../../media/pdf'
import { formatBytes } from '../../utils/format'
import { messages } from './messages'
import {
  COMPRESS_DPI_PRESETS,
  DPI_PRESETS,
  LONG_EDGE_PRESETS,
  type PdfOutputKind,
  type PdfOutputSettings,
} from './output'
import type { RasterEstimate } from './useRasterEstimate'

const toggleItemClass = cn('h-7 flex-1 px-2.5 text-xs', solidOnClass)

/** 押し直しで選択が外れないよう、空の値は無視する ToggleGroup */
function Choice<T extends string>({
  value,
  options,
  label,
  onChange,
}: {
  value: T
  options: { value: T; label: string }[]
  label: string
  onChange: (value: T) => void
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      size="sm"
      className="w-full"
      value={value}
      aria-label={label}
      onValueChange={(next) => {
        const found = options.find((option) => option.value === next)
        if (found) onChange(found.value)
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value} className={toggleItemClass}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function FieldLabel({ children, value }: { children: ReactNode; value?: ReactNode }) {
  return (
    <div className="flex justify-between text-[11px] text-muted-foreground">
      <span>{children}</span>
      {value !== undefined && <span className="font-semibold text-foreground tabular-nums">{value}</span>}
    </div>
  )
}

/** プリセットに無い値を打つ欄。確定（Enter・フォーカスを外す）したときだけ反映する */
function CustomNumber({
  id,
  value,
  min,
  max,
  suffix,
  onCommit,
}: {
  id: string
  value: number
  min: number
  max: number
  suffix: string
  onCommit: (value: number) => void
}) {
  const commit = (text: string) => {
    const parsed = Math.round(Number(text))
    if (Number.isFinite(parsed) && text.trim() !== '') onCommit(Math.min(max, Math.max(min, parsed)))
  }
  return (
    <div className="flex items-center gap-1.5">
      <Input
        key={value}
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        defaultValue={value}
        aria-label={suffix}
        className="h-7 w-20 px-2 text-xs md:text-xs"
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
      <span className="text-[11px] text-muted-foreground">{suffix}</span>
    </div>
  )
}

function QualitySlider({ value, label, onChange }: { value: number; label: string; onChange: (value: number) => void }) {
  // 動かしているあいだは数字だけを変え、離したときに設定へ入れる（見込みを何度も描き直さない）
  const [draft, setDraft] = useState<number | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel value={draft ?? value}>{label}</FieldLabel>
      <Slider
        min={1}
        max={100}
        value={[draft ?? value]}
        aria-label={label}
        onValueChange={([next]) => setDraft(next)}
        onValueCommit={([next]) => {
          setDraft(null)
          onChange(next)
        }}
      />
    </div>
  )
}

export interface OutputStepsProps {
  settings: PdfOutputSettings
  onChange: (settings: PdfOutputSettings) => void
  /** いまの並びのページ数と、選んでいるページ数 */
  pageCount: number
  selectedCount: number
  /** 画像・圧縮で書き出すページ数 */
  targetCount: number
  /** 結合する PDF の数（PDF の見込みに出す） */
  mergedCount: number
  /** 使っている入力の大きさの合計（圧縮の比べる元） */
  originalBytes: number
  estimate: RasterEstimate | null
  estimating: boolean
  /** いまの設定で最後に保存した圧縮 PDF の大きさ */
  actualBytes: number | null
  locked: boolean
  opening: boolean
  onOpenInImage: () => void
}

/** 「出力」と「出力の見込み」の手順。PDF・画像・圧縮のどれを書き出すかと、その設定 */
export function OutputSteps({
  settings,
  onChange,
  pageCount,
  selectedCount,
  targetCount,
  mergedCount,
  originalBytes,
  estimate,
  estimating,
  actualBytes,
  locked,
  opening,
  onOpenInImage,
}: OutputStepsProps) {
  const { t } = useI18n()
  const m = useLocalMessages(messages)
  const { kind, images, compress } = settings
  const set = (patch: Partial<PdfOutputSettings>) => onChange({ ...settings, ...patch })
  const setImages = (patch: Partial<PdfOutputSettings['images']>) => set({ images: { ...images, ...patch } })
  const setResolution = (resolution: PdfRasterResolution) => setImages({ resolution })
  const resolution = images.resolution

  const sizeText = (bytes: number | null | undefined) =>
    bytes == null ? (estimating ? t.estimating : '—') : formatBytes(bytes)
  const ratio = estimate && originalBytes > 0 ? estimate.bytes / originalBytes : null

  return (
    <>
      <Step index={3} title={t.stepOutput}>
        <Choice<PdfOutputKind>
          value={kind}
          label={m.outputKind}
          options={[
            { value: 'pdf', label: m.kindPdf },
            { value: 'images', label: m.kindImages },
            { value: 'compress', label: m.kindCompress },
          ]}
          onChange={(next) => set({ kind: next })}
        />
        <StepHint>{m.kindHint[kind]}</StepHint>

        {kind === 'images' && (
          <>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{m.scopeLabel}</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                <Chip active={settings.scope === 'all' || selectedCount === 0} onClick={() => set({ scope: 'all' })}>
                  {m.scopeAll(pageCount)}
                </Chip>
                <Chip
                  active={settings.scope === 'selected' && selectedCount > 0}
                  disabled={selectedCount === 0}
                  onClick={() => set({ scope: 'selected' })}
                >
                  {m.scopeSelected(selectedCount)}
                </Chip>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <FieldLabel>{m.imageFormat}</FieldLabel>
              <Choice<PdfImageFormat>
                value={images.format}
                label={m.imageFormat}
                options={[
                  { value: 'png', label: 'PNG' },
                  { value: 'jpeg', label: 'JPEG' },
                ]}
                onChange={(format) => setImages({ format })}
              />
              <StepHint>{m.formatHint[images.format]}</StepHint>
            </div>
            {images.format === 'jpeg' && (
              <QualitySlider value={images.quality} label={m.qualityLabel} onChange={(quality) => setImages({ quality })} />
            )}

            <div className="flex flex-col gap-1.5">
              <FieldLabel>{m.resolutionLabel}</FieldLabel>
              <Choice<PdfRasterResolution['kind']>
                value={resolution.kind}
                label={m.resolutionLabel}
                options={[
                  { value: 'dpi', label: m.resolutionDpi },
                  { value: 'longEdge', label: m.resolutionLongEdge },
                ]}
                onChange={(next) =>
                  setResolution(next === 'dpi' ? { kind: 'dpi', dpi: 150 } : { kind: 'longEdge', pixels: 2048 })
                }
              />
              {resolution.kind === 'dpi' ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {DPI_PRESETS.map((dpi) => (
                    <Chip key={dpi} active={resolution.dpi === dpi} onClick={() => setResolution({ kind: 'dpi', dpi })}>
                      {dpi}
                    </Chip>
                  ))}
                  <CustomNumber
                    id="pdf-image-dpi"
                    value={resolution.dpi}
                    min={MIN_DPI}
                    max={MAX_DPI}
                    suffix="DPI"
                    onCommit={(dpi) => setResolution({ kind: 'dpi', dpi })}
                  />
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  {LONG_EDGE_PRESETS.map((pixels) => (
                    <Chip
                      key={pixels}
                      active={resolution.pixels === pixels}
                      onClick={() => setResolution({ kind: 'longEdge', pixels })}
                    >
                      {pixels}
                    </Chip>
                  ))}
                  <CustomNumber
                    id="pdf-image-long-edge"
                    value={resolution.pixels}
                    min={MIN_LONG_EDGE}
                    max={MAX_CANVAS_SIDE}
                    suffix="px"
                    onCommit={(pixels) => setResolution({ kind: 'longEdge', pixels })}
                  />
                </div>
              )}
              <StepHint>{resolution.kind === 'dpi' ? m.dpiHint : m.longEdgeHint}</StepHint>
            </div>

            <div className="flex flex-col gap-1">
              <SmallButton
                className="self-start"
                onClick={onOpenInImage}
                disabled={locked || selectedCount !== 1}
              >
                <ImageIcon />
                {opening ? m.openingInImage : m.openInImage}
              </SmallButton>
              <StepHint>{m.openInImageHint}</StepHint>
            </div>
          </>
        )}

        {kind === 'compress' && (
          <>
            <Notice tone="warn">{m.compressWarning}</Notice>
            <div className="flex flex-col gap-1.5">
              <FieldLabel>{m.resolutionLabel}</FieldLabel>
              <div className="flex flex-wrap items-center gap-1.5">
                {COMPRESS_DPI_PRESETS.map((dpi) => (
                  <Chip key={dpi} active={compress.dpi === dpi} onClick={() => set({ compress: { ...compress, dpi } })}>
                    {dpi}
                  </Chip>
                ))}
                <CustomNumber
                  id="pdf-compress-dpi"
                  value={compress.dpi}
                  min={MIN_DPI}
                  max={MAX_DPI}
                  suffix="DPI"
                  onCommit={(dpi) => set({ compress: { ...compress, dpi } })}
                />
              </div>
              <StepHint>{m.compressDpiHint}</StepHint>
            </div>
            <QualitySlider
              value={compress.quality}
              label={m.qualityLabel}
              onChange={(quality) => set({ compress: { ...compress, quality } })}
            />
          </>
        )}
      </Step>

      <Step index={4} title={t.stepEstimate}>
        {pageCount === 0 ? (
          <p className="text-[11px] leading-normal text-destructive">{m.outputEmpty}</p>
        ) : kind === 'pdf' ? (
          <StepHint>
            {m.outputPages(pageCount)}
            {mergedCount > 1 && <br />}
            {mergedCount > 1 && m.outputMerged(mergedCount)}
          </StepHint>
        ) : kind === 'images' ? (
          <EstimateBox>
            <EstimateRow label={m.estimateFiles}>{m.imageCount(targetCount)}</EstimateRow>
            <EstimateRow label={m.estimateImageSize}>
              {estimate?.first ? `${estimate.first.width}×${estimate.first.height}` : sizeText(null)}
            </EstimateRow>
            <EstimateRow label={t.estimatedSize}>{sizeText(estimate?.bytes)}</EstimateRow>
          </EstimateBox>
        ) : (
          <>
            <EstimateBox>
              <EstimateRow label={m.estimateOriginal}>{formatBytes(originalBytes)}</EstimateRow>
              <EstimateRow label={m.estimateCompressed}>
                {sizeText(estimate?.bytes)}
                {ratio !== null && ` (${Math.round(ratio * 100)}%)`}
              </EstimateRow>
              {actualBytes !== null && (
                <EstimateRow label={m.estimateActual}>
                  {formatBytes(actualBytes)}
                  {originalBytes > 0 && ` (${Math.round((actualBytes / originalBytes) * 100)}%)`}
                </EstimateRow>
              )}
            </EstimateBox>
            {ratio !== null && ratio >= 1 && <Notice tone="warn">{m.compressLarger}</Notice>}
            <StepHint>{m.compressEstimateHint}</StepHint>
          </>
        )}
      </Step>
    </>
  )
}

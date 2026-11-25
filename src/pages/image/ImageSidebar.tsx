import { FlipHorizontal2, FlipVertical2, MapPin, RotateCcw, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { solidOnClass } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { SidebarHead } from '../../components/BrandMark'
import { CompatibilityList } from '../../components/CompatibilityList'
import { PresetPicker } from '../../components/PresetPicker'
import { SaveButton } from '../../components/SaveButton'
import {
  Chip,
  EstimateBox,
  EstimateRow,
  Fact,
  Facts,
  HistoryButtons,
  IconButton,
  IconToggle,
  LinkButton,
  Notice,
  SidebarFooter,
  SmallButton,
  SourceName,
  ToolbarDivider,
} from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { pickFiles } from '../../core/opened'
import type { OpenedFile } from '../../core/opened'
import type { SaveState } from '../../core/useSave'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import {
  IMAGE_FORMATS,
  MAX_DIMENSION,
  MAX_PADDING,
  NO_PADDING,
  computeOutputSize,
} from '../../media/image'
import type { ImageEdit, ImageFormat, ImageInfo, ImageOutput, ImageRecipe, RenderedImage } from '../../media/image'
import { formatBytes } from '../../utils/format'
import { ColorField, FieldLabel, NumberField } from './fields'
import { imageMessages } from './messages'

/** 縦横比のプリセット（幅 / 高さ）。null は自由 */
const ASPECT_PRESETS: { label: string | null; value: number | null }[] = [
  { label: null, value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
]

const SCALE_PRESETS = [0.75, 0.5, 0.25]

const KB = 1024
const MB = 1024 * 1024
/** 目標サイズのプリセット。投稿先の上限（serviceLimits.json）は画像には大きすぎるので、よく使う値を並べる */
const TARGET_PRESETS = [500 * KB, 1 * MB, 2 * MB, 5 * MB, 10 * MB]

const FORMAT_LABEL: Record<ImageFormat, string> = { png: 'PNG', jpeg: 'JPEG', webp: 'WebP', avif: 'AVIF' }

const BACKGROUNDS: { color: string | null; key: 'backgroundNone' | 'backgroundWhite' | 'backgroundBlack' }[] = [
  { color: null, key: 'backgroundNone' },
  { color: '#ffffff', key: 'backgroundWhite' },
  { color: '#000000', key: 'backgroundBlack' },
]

/** MIME から形式の短い名前を出す（image/jpeg → JPEG） */
function mimeLabel(mime: string): string {
  const format = (Object.keys(IMAGE_FORMATS) as ImageFormat[]).find((f) => IMAGE_FORMATS[f].mime === mime)
  if (format) return FORMAT_LABEL[format]
  return mime.replace(/^image\//, '').toUpperCase()
}

interface ImageSidebarProps {
  file: File | null
  info: ImageInfo | null
  recipe: ImageRecipe
  onEdit: (edit: ImageEdit) => void
  /** 背景色を選んでいる最中の色（プレビューにだけ効かせる）。undefined は選んでいない */
  backgroundDraft: string | null | undefined
  onBackgroundDraft: (color: string | undefined) => void
  cropping: boolean
  onCroppingChange: (cropping: boolean) => void
  aspect: number | null
  onAspectChange: (aspect: number | null) => void
  output: ImageOutput
  onOutputChange: (output: ImageOutput) => void
  formats: ImageFormat[]
  estimate: { rendered: RenderedImage | null; last: RenderedImage | null; estimating: boolean; error: unknown }
  onFileSelect: (file: OpenedFile) => void
  save: SaveState
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}

/** 画像の手順（入力 → 編集 → 出力 → 見込み）を上から並べたパネル。保存は下端に固定する */
export function ImageSidebar({
  file,
  info,
  recipe,
  onEdit,
  backgroundDraft,
  onBackgroundDraft,
  cropping,
  onCroppingChange,
  aspect,
  onAspectChange,
  output,
  onOutputChange,
  formats,
  estimate,
  onFileSelect,
  save,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: ImageSidebarProps) {
  const { t } = useI18n()
  const m = useLocalMessages(imageMessages)
  const ready = !!info
  const format = IMAGE_FORMATS[output.format]

  const size = info ? computeOutputSize(info, recipe) : null
  // 「元のサイズ」と割合のプリセットの基準。切り抜き・回転のあとでリサイズ前の寸法
  const base = info ? computeOutputSize(info, { ...recipe, resize: null, padding: NO_PADDING }) : null

  const resizeTo = (width: number | null, height: number | null) => {
    if (width === null && height === null) return onEdit({ type: 'resize', resize: null })
    onEdit({ type: 'resize', resize: { width, height, keepAspect: true, allowUpscale: true } })
  }

  const shownSize = estimate.rendered?.blob.size ?? estimate.last?.blob.size ?? null
  const background = backgroundDraft !== undefined ? backgroundDraft : recipe.background

  return (
    <aside className="sidebar">
      <SidebarHead />

      <div className="sidebar-scroll">
        <Step index={1} title={t.stepInput}>
          {file ? (
            <div className="flex flex-col gap-2">
              <SourceName title={file.name}>{file.name}</SourceName>
              <Facts>
                <Fact label={t.factSize}>{formatBytes(file.size)}</Fact>
                {info && (
                  <>
                    <Fact label={t.factResolution}>
                      {info.width}×{info.height}
                    </Fact>
                    <Fact label={m.factFormat}>{mimeLabel(info.mime)}</Fact>
                  </>
                )}
              </Facts>
              {info?.metadata.gps ? (
                <Notice icon={<MapPin className="size-3.5" />} tone="warn">
                  {m.gpsNotice}
                </Notice>
              ) : (
                info &&
                (info.metadata.exif || info.metadata.xmp || info.metadata.other) && (
                  <Notice>{m.metadataNotice}</Notice>
                )
              )}
              {info?.mime === 'image/gif' && <Notice>{m.gifNotice}</Notice>}
            </div>
          ) : (
            <StepHint>{t.inputEmpty}</StepHint>
          )}
          <div className="flex gap-1.5">
            <SmallButton
              onClick={async () => {
                const [picked] = await pickFiles({ accept: 'image/*' })
                if (picked) onFileSelect(picked)
              }}
            >
              {t.selectFile}
            </SmallButton>
          </div>
        </Step>

        <Step index={2} title={t.stepEdit}>
          <div className="flex flex-wrap gap-1">
            <HistoryButtons canUndo={canUndo} canRedo={canRedo} onUndo={onUndo} onRedo={onRedo} />
            <ToolbarDivider />
            <IconButton label={m.rotateLeft} disabled={!ready} onClick={() => onEdit({ type: 'rotate', turns: -1 })}>
              <RotateCcw />
            </IconButton>
            <IconButton label={m.rotateRight} disabled={!ready} onClick={() => onEdit({ type: 'rotate', turns: 1 })}>
              <RotateCw />
            </IconButton>
            {/* lucide の名前は「反転の軸」の向きなので、左右反転には縦軸の FlipVertical2 を使う */}
            <IconToggle label={m.flipH} disabled={!ready} pressed={recipe.flipH} onPressedChange={() => onEdit({ type: 'flipH' })}>
              <FlipVertical2 />
            </IconToggle>
            <IconToggle label={m.flipV} disabled={!ready} pressed={recipe.flipV} onPressedChange={() => onEdit({ type: 'flipV' })}>
              <FlipHorizontal2 />
            </IconToggle>
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <FieldLabel>{m.cropLabel}</FieldLabel>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {recipe.crop ? `${recipe.crop.width}×${recipe.crop.height}` : m.cropNone}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ASPECT_PRESETS.map((preset) => (
                <Chip
                  key={preset.label ?? 'free'}
                  active={cropping && aspect === preset.value}
                  disabled={!ready}
                  onClick={() => onAspectChange(preset.value)}
                >
                  {preset.label ?? m.cropFree}
                </Chip>
              ))}
            </div>
            <div className="flex gap-1.5">
              <Button
                variant={cropping ? 'default' : 'outline'}
                size="xs"
                className="h-7 px-2.5"
                disabled={!ready}
                onClick={() => onCroppingChange(!cropping)}
              >
                {cropping ? m.cropDone : m.cropStart}
              </Button>
              <Button
                variant="outline"
                size="xs"
                className="h-7 px-2.5"
                disabled={!ready || recipe.crop === null}
                onClick={() => onEdit({ type: 'crop', rect: null })}
              >
                {m.cropClear}
              </Button>
            </div>
            {cropping && <StepHint>{m.cropHint}</StepHint>}
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>{m.resizeLabel}</FieldLabel>
            <div className="flex flex-wrap gap-1.5">
              <Chip active={recipe.resize === null} disabled={!ready} onClick={() => resizeTo(null, null)}>
                {m.resizeOriginal}
              </Chip>
              {base &&
                SCALE_PRESETS.map((scale) => {
                  const width = Math.max(1, Math.round(base.contentWidth * scale))
                  return (
                    <Chip
                      key={scale}
                      active={recipe.resize !== null && size?.contentWidth === width}
                      onClick={() => resizeTo(width, null)}
                    >
                      {Math.round(scale * 100)}%
                    </Chip>
                  )
                })}
            </div>
            <div className="flex items-end gap-1.5">
              <NumberField
                id="image-width"
                label={t.width}
                value={size?.contentWidth ?? null}
                min={1}
                max={MAX_DIMENSION}
                disabled={!ready}
                onCommit={(width) => {
                  if (width !== size?.contentWidth) resizeTo(width, null)
                }}
              />
              <span className="pb-2 text-input">×</span>
              <NumberField
                id="image-height"
                label={t.height}
                value={size?.contentHeight ?? null}
                min={1}
                max={MAX_DIMENSION}
                disabled={!ready}
                onCommit={(height) => {
                  if (height !== size?.contentHeight) resizeTo(null, height)
                }}
              />
            </div>
            <StepHint>{m.resizeHint}</StepHint>
          </div>

          <div className="flex flex-col gap-1.5">
            <FieldLabel>{m.paddingLabel}</FieldLabel>
            <div className="flex items-end gap-1.5">
              <NumberField
                id="image-padding"
                label={m.paddingPx}
                value={recipe.padding.top}
                min={0}
                max={MAX_PADDING}
                disabled={!ready}
                onCommit={(value) => {
                  const v = value ?? 0
                  onEdit({ type: 'padding', padding: { top: v, right: v, bottom: v, left: v } })
                }}
              />
            </div>
            <FieldLabel>{m.backgroundLabel}</FieldLabel>
            <div className="flex flex-wrap items-center gap-1.5">
              {BACKGROUNDS.map(({ color, key }) => (
                <Chip
                  key={key}
                  active={background === color}
                  disabled={!ready}
                  onClick={() => onEdit({ type: 'background', color })}
                >
                  {m[key]}
                </Chip>
              ))}
              <ColorField
                label={m.backgroundCustom}
                value={(background ?? '#ffffff').slice(0, 7)}
                onPreview={(color) => onBackgroundDraft(color)}
                onCommit={(color) => {
                  onBackgroundDraft(undefined)
                  onEdit({ type: 'background', color })
                }}
              />
            </div>
            {!format.alpha && background === null && <StepHint>{m.backgroundFlattened}</StepHint>}
          </div>
        </Step>

        <Step index={3} title={t.stepOutput}>
          <PresetPicker kind="image" scope="image" value={output} onChange={onOutputChange} />
          <ToggleGroup
            type="single"
            variant="outline"
            spacing={0}
            className="w-full"
            value={output.format}
            onValueChange={(value) => {
              // 押し直しで選択が外れないよう、空の値は無視する
              if (value) onOutputChange({ ...output, format: value as ImageFormat })
            }}
          >
            {formats.map((f) => (
              <ToggleGroupItem key={f} value={f} size="sm" className={cn('flex-1 text-xs', solidOnClass)}>
                {FORMAT_LABEL[f]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <StepHint>{m.formatHint[output.format]}</StepHint>

          {format.lossy ? (
            <>
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{m.qualityLabel}</span>
                  <span className="font-semibold text-foreground">{output.quality}</span>
                </div>
                <Slider
                  min={1}
                  max={100}
                  value={[output.quality]}
                  onValueChange={([quality]) => onOutputChange({ ...output, quality })}
                  aria-label={m.qualityLabel}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <FieldLabel>{m.targetLabel}</FieldLabel>
                <div className="flex flex-wrap gap-1.5">
                  <Chip active={output.targetBytes === null} onClick={() => onOutputChange({ ...output, targetBytes: null })}>
                    {m.targetNone}
                  </Chip>
                  {TARGET_PRESETS.map((bytes) => (
                    <Chip
                      key={bytes}
                      active={output.targetBytes === bytes}
                      onClick={() => onOutputChange({ ...output, targetBytes: bytes })}
                    >
                      {formatBytes(bytes)}
                    </Chip>
                  ))}
                </div>
                <div className="flex items-end">
                  <NumberField
                    id="image-target"
                    label={m.targetCustom}
                    value={output.targetBytes === null ? null : Math.round(output.targetBytes / KB)}
                    min={1}
                    onCommit={(kb) =>
                      onOutputChange({ ...output, targetBytes: kb === null || kb <= 0 ? null : Math.round(kb * KB) })
                    }
                  />
                </div>
                <StepHint>{m.targetHint}</StepHint>
              </div>
            </>
          ) : (
            <StepHint>{m.qualityLossless}</StepHint>
          )}
        </Step>

        <Step index={4} title={t.stepEstimate}>
          <EstimateBox>
            <EstimateRow label={m.outputResolution}>{size ? `${size.width}×${size.height}` : '—'}</EstimateRow>
            <EstimateRow label={t.estimatedSize}>
              {estimate.estimating && shownSize === null
                ? t.estimating
                : shownSize !== null
                  ? formatBytes(shownSize)
                  : '—'}
            </EstimateRow>
            {format.lossy && estimate.rendered?.quality != null && output.targetBytes !== null && (
              <EstimateRow label={m.outputQuality}>{estimate.rendered.quality}</EstimateRow>
            )}
          </EstimateBox>
          {estimate.error != null && (
            <Notice tone="warn">
              {m.estimateError}: {estimate.error instanceof Error ? estimate.error.message : String(estimate.error)}
            </Notice>
          )}
          {format.lossy && output.targetBytes !== null && estimate.rendered?.fitsTarget != null && (
            estimate.rendered.fitsTarget ? (
              <StepHint>{m.targetFits}</StepHint>
            ) : (
              <Notice tone="warn">{m.targetTooBig(formatBytes(output.targetBytes))}</Notice>
            )
          )}
          {shownSize !== null ? (
            <CompatibilityList estimatedSize={shownSize} duration={0} />
          ) : (
            <StepHint>{t.estimateEmpty}</StepHint>
          )}
        </Step>

        <LinkButton
          className="mx-4 mt-3.5"
          disabled={!ready}
          onClick={() => {
            onCroppingChange(false)
            onEdit({ type: 'reset' })
          }}
        >
          {t.resetEdits}
        </LinkButton>
      </div>

      <SidebarFooter progress={null}>
        <SaveButton save={save} disabled={!ready} />
      </SidebarFooter>
    </aside>
  )
}

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { solidOnClass } from '@/lib/styles'
import { cn } from '@/lib/utils'
import type { Messages } from '../i18n/messages'
import { useI18n } from '../i18n/context'
import type { ConversionSettings, OutputFormat } from '../types'
import { Step, StepHint } from './Step'

/** 文言のうち、そのまま表示できる（引数を取らない）ものの名前 */
type TextKey = {
  [K in keyof Messages]: Messages[K] extends string ? K : never
}[keyof Messages]

const FORMATS: { value: OutputFormat; label: string; hint: TextKey }[] = [
  { value: 'mp4', label: 'MP4', hint: 'formatHintMp4' },
  { value: 'webm', label: 'WebM', hint: 'formatHintWebm' },
  { value: 'gif', label: 'GIF', hint: 'formatHintGif' },
]

/** 縦に並べる解像度プリセット（高さ基準） */
const HEIGHT_PRESETS = [1080, 720, 480, 360]

const evenNumber = (value: number) => Math.max(2, Math.round(value / 2) * 2)

/** スライダーの見出し行（名前と現在値） */
function FieldHead({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  )
}

interface OutputStepsProps {
  /** 最初の手順に振る番号 */
  startIndex: number
  settings: ConversionSettings
  onSettingsChange: (settings: ConversionSettings) => void
  /** 元の解像度。わかるときだけ解像度のプリセットを出す */
  dimensions: { width: number; height: number } | null
}

/** 出力形式 → 画質（GIF ならフレームレート） → 解像度 の手順。単体編集と一括変換で共有する */
export function OutputSteps({
  startIndex,
  settings,
  onSettingsChange,
  dimensions,
}: OutputStepsProps) {
  const { t } = useI18n()
  const currentFormat = FORMATS.find((format) => format.value === settings.format)

  const applyHeightPreset = (height: number) => {
    if (!dimensions) return
    const scaled = evenNumber((dimensions.width * height) / dimensions.height)
    onSettingsChange({ ...settings, width: scaled, height: evenNumber(height) })
  }

  const isPresetActive = (height: number) =>
    !!dimensions &&
    settings.height === evenNumber(height) &&
    settings.width === evenNumber((dimensions.width * height) / dimensions.height)

  return (
    <>
      <Step index={startIndex} title={t.stepFormat}>
        <ToggleGroup
          type="single"
          variant="outline"
          spacing={0}
          className="w-full"
          value={settings.format}
          onValueChange={(value) => {
            // 押し直しで選択が外れないよう、空の値は無視する
            const format = FORMATS.find((item) => item.value === value)
            if (!format) return
            onSettingsChange({
              ...settings,
              format: format.value,
              fps: format.value === 'gif' ? (settings.fps ?? 10) : settings.fps,
            })
          }}
        >
          {FORMATS.map((format) => (
            <ToggleGroupItem
              key={format.value}
              value={format.value}
              size="sm"
              className={cn('flex-1 text-xs', solidOnClass)}
            >
              {format.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {currentFormat && <StepHint>{t[currentFormat.hint]}</StepHint>}
      </Step>

      <Step index={startIndex + 1} title={settings.format === 'gif' ? t.stepFps : t.stepQuality}>
        {settings.format === 'gif' ? (
          <div className="flex flex-col gap-2">
            <FieldHead label={t.fpsLabel} value={settings.fps ?? 10} />
            <Slider
              min={1}
              max={30}
              value={[settings.fps ?? 10]}
              onValueChange={([fps]) => onSettingsChange({ ...settings, fps })}
              aria-label={t.fpsLabel}
            />
            <StepHint>{t.fpsHint}</StepHint>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <FieldHead label={t.qualityLabel} value={`${settings.quality}%`} />
            <Slider
              min={1}
              max={100}
              value={[settings.quality]}
              onValueChange={([quality]) => onSettingsChange({ ...settings, quality })}
              aria-label={t.qualityLabel}
            />
            <StepHint>{t.qualityHint}</StepHint>
          </div>
        )}
      </Step>

      <Step index={startIndex + 2} title={t.stepResolution}>
        {dimensions && (
          <div className="flex flex-wrap gap-1.5">
            <PresetChip
              active={!settings.width && !settings.height}
              onClick={() => onSettingsChange({ ...settings, width: undefined, height: undefined })}
            >
              {t.originalSize}
            </PresetChip>
            {HEIGHT_PRESETS.filter((height) => height < dimensions.height).map((height) => (
              <PresetChip
                key={height}
                active={isPresetActive(height)}
                onClick={() => applyHeightPreset(height)}
              >
                {height}p
              </PresetChip>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <DimensionField
            id="output-width"
            label={t.width}
            placeholder={t.auto}
            value={settings.width}
            onChange={(width) => onSettingsChange({ ...settings, width })}
          />
          <span className="pb-2 text-input">×</span>
          <DimensionField
            id="output-height"
            label={t.height}
            placeholder={t.auto}
            value={settings.height}
            onChange={(height) => onSettingsChange({ ...settings, height })}
          />
        </div>
      </Step>
    </>
  )
}

/** 解像度のプリセット。プリセットは同時に 1 つしか当たらないが、手入力で外れることもあるので押しボタンにしている */
function PresetChip({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant={active ? 'default' : 'outline'}
      size="xs"
      className="rounded-full px-2.5 text-[11px]"
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** 幅・高さの入力。空欄は「元に合わせて自動」を表す */
function DimensionField({
  id,
  label,
  placeholder,
  value,
  onChange,
}: {
  id: string
  label: string
  placeholder: string
  value: number | undefined
  onChange: (value: number | undefined) => void
}) {
  return (
    <div className="flex flex-1 flex-col gap-1">
      <Label htmlFor={id} className="text-[11px] font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        className="h-8 px-2 text-[13px] md:text-[13px]"
        placeholder={placeholder}
        value={value || ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
      />
    </div>
  )
}

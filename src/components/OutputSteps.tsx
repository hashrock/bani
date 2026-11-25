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
import { defineMessages, useLocalMessages } from '../i18n/local'
import {
  DEFAULT_GIF_FPS,
  applyResolutionPreset,
  isResolutionPresetActive,
  resolutionPresetsFor,
  usesTargetSize,
  videoBitrate,
} from '../media/video'
import type { VideoFormat, VideoOutput } from '../media/video'
import { formatBytes } from '../utils/format'
import { PresetPicker } from './PresetPicker'
import { LinkButton } from './SidebarParts'
import { Step, StepHint } from './Step'

const messages = defineMessages({
  ja: {
    targetSize: (size: string) => `目標サイズ: ${size} 以下`,
    targetBitrate: (kbps: number) => `長さから映像を約 ${kbps.toLocaleString()} kbps にします（音声は 128 kbps）。`,
    targetBitrateLater: '書き出すときに、ファイルごとの長さからビットレートを決めます。',
    targetGif: 'GIF では目標サイズは使いません。',
    clearTarget: '目標サイズを外す',
    maxShortSide: (px: number) => `短い辺を ${px}px 以下にします（小さい動画は引き伸ばしません）。`,
  },
  en: {
    targetSize: (size: string) => `Target size: ≤ ${size}`,
    targetBitrate: (kbps: number) =>
      `Video is encoded at about ${kbps.toLocaleString()} kbps for this length (audio 128 kbps).`,
    targetBitrateLater: 'The bitrate is chosen from each file’s length when exporting.',
    targetGif: 'GIF does not use the target size.',
    clearTarget: 'Remove target size',
    maxShortSide: (px: number) => `Shortens the short side to ${px}px or less (smaller videos are not upscaled).`,
  },
})

/** 文言のうち、そのまま表示できる（引数を取らない）ものの名前 */
type TextKey = {
  [K in keyof Messages]: Messages[K] extends string ? K : never
}[keyof Messages]

const FORMATS: { value: VideoFormat; label: string; hint: TextKey }[] = [
  { value: 'mp4', label: 'MP4', hint: 'formatHintMp4' },
  { value: 'webm', label: 'WebM', hint: 'formatHintWebm' },
  { value: 'gif', label: 'GIF', hint: 'formatHintGif' },
]

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
  settings: VideoOutput
  onSettingsChange: (settings: VideoOutput) => void
  /**
   * 拡大縮小の前の解像度（単体編集なら切り抜き・回転のあと）。わかるときだけ解像度のプリセットを出す
   */
  dimensions: { width: number; height: number } | null
  /** 書き出す長さ（秒）。目標サイズからビットレートを見せるのに使う。わからなければ null */
  duration?: number | null
  /** プリセットの選択を覚える場所（PresetPicker の scope） */
  presetScope: string
}

/** 出力形式 → 画質（GIF ならフレームレート） → 解像度 の手順。単体編集と一括変換で共有する */
export function OutputSteps({
  startIndex,
  settings,
  onSettingsChange,
  dimensions,
  duration = null,
  presetScope,
}: OutputStepsProps) {
  const { t } = useI18n()
  const m = useLocalMessages(messages)
  const currentFormat = FORMATS.find((format) => format.value === settings.format)
  // 解像度を手で決めたら、プリセットの「短い辺の上限」は効かなくなるので外す
  const setSize = (next: Pick<VideoOutput, 'width' | 'height'>) =>
    onSettingsChange({ ...settings, ...next, maxShortSide: undefined })

  return (
    <>
      <Step index={startIndex} title={t.stepFormat}>
        <PresetPicker
          kind="video"
          scope={presetScope}
          value={settings}
          onChange={onSettingsChange}
          dimensions={dimensions}
        />
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
              fps: format.value === 'gif' ? (settings.fps ?? DEFAULT_GIF_FPS) : settings.fps,
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
            <FieldHead label={t.fpsLabel} value={settings.fps ?? DEFAULT_GIF_FPS} />
            <Slider
              min={1}
              max={30}
              value={[settings.fps ?? DEFAULT_GIF_FPS]}
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
        {settings.targetSize && (
          <div className="flex flex-col gap-1">
            <div className="text-xs font-medium">{m.targetSize(formatBytes(settings.targetSize))}</div>
            <StepHint>
              {!usesTargetSize(settings)
                ? m.targetGif
                : duration && duration > 0
                  ? m.targetBitrate(Math.round(videoBitrate(settings, duration) / 1000))
                  : m.targetBitrateLater}
            </StepHint>
            <LinkButton onClick={() => onSettingsChange({ ...settings, targetSize: undefined })}>
              {m.clearTarget}
            </LinkButton>
          </div>
        )}
      </Step>

      <Step index={startIndex + 2} title={t.stepResolution}>
        {dimensions && (
          <div className="flex flex-wrap gap-1.5">
            <PresetChip
              active={!settings.width && !settings.height && !settings.maxShortSide}
              onClick={() => setSize({ width: undefined, height: undefined })}
            >
              {t.originalSize}
            </PresetChip>
            {/* 短い辺を合わせる。長い辺は縦横比から決まるので、切り抜きや回転を変えても崩れない */}
            {resolutionPresetsFor(dimensions).map((preset) => (
              <PresetChip
                key={preset}
                active={isResolutionPresetActive(settings, dimensions, preset)}
                onClick={() => setSize(applyResolutionPreset(settings, dimensions, preset))}
              >
                {preset}p
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
            onChange={(width) => setSize({ width, height: settings.height })}
          />
          <span className="pb-2 text-input">×</span>
          <DimensionField
            id="output-height"
            label={t.height}
            placeholder={t.auto}
            value={settings.height}
            onChange={(height) => setSize({ width: settings.width, height })}
          />
        </div>
        {settings.maxShortSide && !settings.width && !settings.height && (
          <StepHint>{m.maxShortSide(settings.maxShortSide)}</StepHint>
        )}
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

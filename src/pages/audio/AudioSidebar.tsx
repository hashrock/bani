import { useState } from 'react'
import type { ReactNode } from 'react'
import { Redo2Icon, Undo2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Slider } from '@/components/ui/slider'
import { Toggle } from '@/components/ui/toggle'
import { solidOnClass } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { SidebarHead } from '../../components/BrandMark'
import { SaveButton } from '../../components/SaveButton'
import { SourceName } from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { pickFiles } from '../../core/opened'
import type { OpenedFile } from '../../core/opened'
import type { SaveState } from '../../core/useSave'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import {
  AUDIO_FORMATS,
  AUDIO_FORMAT_LIST,
  MAX_GAIN_DB,
  MIN_GAIN_DB,
  changeAudioFormat,
  estimateRenderSize,
  resolveSampleRate,
  trimmedLength,
} from '../../media/audio'
import type { AudioEdit, AudioFormat, AudioInfo, AudioOutput, AudioRecipe } from '../../media/audio'
import { formatBytes, formatTimecode } from '../../utils/format'
import { bitrateChoices, effectiveRecipe } from './logic'
import { audioMessages, formatBitrate, formatSampleRate } from './messages'

const FORMAT_LABEL: Record<AudioFormat, string> = {
  mp3: 'MP3',
  m4a: 'AAC (M4A)',
  opus: 'Opus',
  wav: 'WAV',
  flac: 'FLAC',
}

/** 画面で選べるフェードの上限（秒）。区間より長くはレシピ側が詰める */
const MAX_FADE = 10

interface AudioSidebarProps {
  file: File | null
  info: AudioInfo | null
  recipe: AudioRecipe | null
  onEdit: (edit: AudioEdit) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  output: AudioOutput
  onOutputChange: (output: AudioOutput) => void
  /** 形式ごとの書き出し可否。確認中は null */
  supported: Readonly<Record<AudioFormat, boolean>> | null
  onFileSelect: (file: OpenedFile) => void
  save: SaveState
  /** 書き出し中の進み具合（0〜1）。書き出していなければ null */
  renderProgress: number | null
  onCancelRender: () => void
}

/** 入力 → 編集 → 出力 → 保存 を上から並べたパネル */
export function AudioSidebar({
  file,
  info,
  recipe,
  onEdit,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  output,
  onOutputChange,
  supported,
  onFileSelect,
  save,
  renderProgress,
  onCancelRender,
}: AudioSidebarProps) {
  const { t } = useI18n()
  const m = useLocalMessages(audioMessages)
  const ready = !!info && !!recipe

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
                {info && <Fact label={t.factDuration}>{formatTimecode(info.duration)}</Fact>}
                {info && <Fact label={m.factChannels}>{m.channelsLabel(info.channels)}</Fact>}
                {info && <Fact label={m.factSampleRate}>{formatSampleRate(info.sampleRate)}</Fact>}
                {info?.codec && <Fact label={m.factCodec}>{info.codec}</Fact>}
              </Facts>
            </div>
          ) : (
            <StepHint>{t.inputEmpty}</StepHint>
          )}
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="xs"
              className="h-7 px-2.5"
              onClick={async () => {
                const [picked] = await pickFiles({ accept: 'audio/*' })
                if (picked) onFileSelect(picked)
              }}
            >
              {t.selectFile}
            </Button>
          </div>
        </Step>

        {ready && (
          <>
            <Step index={2} title={m.stepEdit}>
              <EditControls info={info} recipe={recipe} onEdit={onEdit} />
              <div className="flex items-center gap-1.5">
                <Button variant="outline" size="xs" onClick={onUndo} disabled={!canUndo} title={`${m.undo} (⌘Z)`}>
                  <Undo2Icon />
                  {m.undo}
                </Button>
                <Button variant="outline" size="xs" onClick={onRedo} disabled={!canRedo} title={`${m.redo} (⇧⌘Z)`}>
                  <Redo2Icon />
                  {m.redo}
                </Button>
                <Button
                  variant="link"
                  size="xs"
                  className="ml-auto h-auto px-0 text-[11px] font-normal text-muted-foreground underline hover:text-foreground"
                  onClick={() => onEdit({ type: 'reset' })}
                >
                  {m.resetEdits}
                </Button>
              </div>
            </Step>

            <Step index={3} title={m.stepOutput}>
              <OutputControls
                info={info}
                recipe={recipe}
                output={output}
                onOutputChange={onOutputChange}
                supported={supported}
              />
            </Step>

            <Step index={4} title={m.stepSave}>
              <div className="flex flex-col gap-1.5 rounded-md bg-muted px-3 py-2.5">
                <SummaryRow label={m.estimatedSize}>
                  {formatBytes(estimateRenderSize(output, effectiveRecipe(recipe), info))}
                </SummaryRow>
                <SummaryRow label={m.outputLength}>{formatTimecode(trimmedLength(recipe))}</SummaryRow>
              </div>
              <StepHint>{m.previewNote}</StepHint>
            </Step>
          </>
        )}
      </div>

      <div className="sidebar-footer">
        {renderProgress !== null ? (
          <>
            <Progress value={renderProgress * 100} className="h-1" />
            <Button variant="destructive" className="w-full" onClick={onCancelRender}>
              {t.cancel} — {m.rendering(Math.round(renderProgress * 100))}
            </Button>
          </>
        ) : (
          file && <SaveButton save={save} disabled={!ready} />
        )}
      </div>
    </aside>
  )
}

function EditControls({
  info,
  recipe,
  onEdit,
}: {
  info: AudioInfo
  recipe: AudioRecipe
  onEdit: (edit: AudioEdit) => void
}) {
  const m = useLocalMessages(audioMessages)
  const length = trimmedLength(recipe)
  const fadeMax = Math.max(0.1, Math.min(MAX_FADE, length))

  return (
    <div className="flex flex-col gap-3">
      <DraftSlider
        label={m.fadeIn}
        value={recipe.fadeIn}
        min={0}
        max={fadeMax}
        step={0.1}
        format={m.seconds}
        onCommit={(seconds) => onEdit({ type: 'setFadeIn', seconds })}
      />
      <DraftSlider
        label={m.fadeOut}
        value={recipe.fadeOut}
        min={0}
        max={fadeMax}
        step={0.1}
        format={m.seconds}
        onCommit={(seconds) => onEdit({ type: 'setFadeOut', seconds })}
      />
      <div className="flex flex-col gap-1.5">
        <DraftSlider
          label={m.gain}
          value={recipe.normalize ? 0 : recipe.gainDb}
          min={MIN_GAIN_DB}
          max={MAX_GAIN_DB}
          step={0.5}
          format={m.decibels}
          disabled={recipe.normalize}
          onCommit={(db) => onEdit({ type: 'setGain', db })}
        />
        {recipe.normalize && <StepHint>{m.gainDisabledHint}</StepHint>}
      </div>
      <SwitchRow
        label={m.normalize}
        hint={m.normalizeHint}
        pressed={recipe.normalize}
        onChange={(enabled) => onEdit({ type: 'setNormalize', enabled })}
      />
      <SwitchRow
        label={m.mono}
        hint={info.channels === 1 ? m.monoAlready : undefined}
        pressed={recipe.mono}
        disabled={info.channels === 1 && !recipe.mono}
        onChange={(enabled) => onEdit({ type: 'setMono', enabled })}
      />
    </div>
  )
}

function OutputControls({
  info,
  recipe,
  output,
  onOutputChange,
  supported,
}: {
  info: AudioInfo
  recipe: AudioRecipe
  output: AudioOutput
  onOutputChange: (output: AudioOutput) => void
  supported: Readonly<Record<AudioFormat, boolean>> | null
}) {
  const m = useLocalMessages(audioMessages)
  const effective = effectiveRecipe(recipe)
  const spec = AUDIO_FORMATS[output.format]
  const size = (next: AudioOutput) => formatBytes(estimateRenderSize(next, effective, info))
  // 元のレートがこの形式で使えなければ、実際に書き出すレート（いちばん近いもの）を見せる
  const originalRate = resolveSampleRate({ ...output, sampleRate: null }, info)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1" role="radiogroup" aria-label={m.format}>
        {AUDIO_FORMAT_LIST.map((format) => {
          const next = changeAudioFormat(output, format)
          const available = supported?.[format] ?? false
          const active = output.format === format
          return (
            <Button
              key={format}
              role="radio"
              aria-checked={active}
              variant={active ? 'default' : 'outline'}
              size="sm"
              disabled={!available}
              className="h-8 justify-between px-2.5 text-xs"
              title={supported === null ? m.formatChecking : available ? undefined : m.formatUnavailable}
              onClick={() => onOutputChange(next)}
            >
              <span className="flex items-center gap-1.5">
                {FORMAT_LABEL[format]}
                {AUDIO_FORMATS[format].lossless && (
                  <span className="text-[10px] opacity-70">{m.lossless}</span>
                )}
              </span>
              <span className="text-[11px] tabular-nums opacity-80">
                {supported === null ? m.formatChecking : available ? size(next) : m.formatUnavailable}
              </span>
            </Button>
          )
        })}
      </div>

      {!spec.lossless && (
        <ChoiceGroup label={m.bitrate}>
          {bitrateChoices(output.format).map((bitrate) => {
            const next = { ...output, bitrate }
            return (
              <Chip
                key={bitrate}
                active={output.bitrate === bitrate}
                onClick={() => onOutputChange(next)}
                title={size(next)}
              >
                {formatBitrate(bitrate)}
                <span className="opacity-70">{size(next)}</span>
              </Chip>
            )
          })}
        </ChoiceGroup>
      )}

      <ChoiceGroup label={m.sampleRate}>
        <Chip active={output.sampleRate === null} onClick={() => onOutputChange({ ...output, sampleRate: null })}>
          {m.sampleRateOriginal(formatSampleRate(originalRate))}
        </Chip>
        {spec.sampleRates.map((rate) => {
          const next = { ...output, sampleRate: rate }
          return (
            <Chip
              key={rate}
              active={output.sampleRate === rate}
              onClick={() => onOutputChange(next)}
              title={spec.lossless ? size(next) : undefined}
            >
              {formatSampleRate(rate)}
            </Chip>
          )
        })}
      </ChoiceGroup>
    </div>
  )
}

/**
 * ドラッグ中は手元だけで値を動かし、離したときに 1 度だけ確定するスライダー。
 * 動かすたびにレシピを積むと、取り消しが 1 目盛りずつになってしまうため。
 */
function DraftSlider({
  label,
  value,
  min,
  max,
  step,
  format,
  disabled = false,
  onCommit,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  format: (value: number) => string
  disabled?: boolean
  onCommit: (value: number) => void
}) {
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? value
  return (
    <div className={cn('flex flex-col gap-2', disabled && 'opacity-60')}>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <span className="font-semibold text-foreground tabular-nums">{format(shown)}</span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[Math.min(max, Math.max(min, shown))]}
        disabled={disabled}
        onValueChange={([next]) => setDraft(next)}
        onValueCommit={([next]) => {
          setDraft(null)
          onCommit(next)
        }}
        aria-label={label}
      />
    </div>
  )
}

function SwitchRow({
  label,
  hint,
  pressed,
  disabled = false,
  onChange,
}: {
  label: string
  hint?: string
  pressed: boolean
  disabled?: boolean
  onChange: (pressed: boolean) => void
}) {
  const m = useLocalMessages(audioMessages)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        <Toggle
          variant="outline"
          size="sm"
          className={cn('h-7 min-w-14 text-xs', solidOnClass)}
          pressed={pressed}
          disabled={disabled}
          onPressedChange={onChange}
          aria-label={label}
        >
          {pressed ? m.on : m.off}
        </Toggle>
      </div>
      {hint && <StepHint>{hint}</StepHint>}
    </div>
  )
}

function ChoiceGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title?: string
  children: ReactNode
}) {
  return (
    <Button
      variant={active ? 'default' : 'outline'}
      size="xs"
      className="gap-1 rounded-full px-2.5 text-[11px]"
      aria-pressed={active}
      title={title}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-1 text-xs">{children}</dl>
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  )
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between text-xs text-muted-foreground">
      <span>{label}</span>
      <strong className="text-[13px] text-foreground">{children}</strong>
    </div>
  )
}

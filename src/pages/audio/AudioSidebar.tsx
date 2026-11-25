import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { SidebarHead } from '../../components/BrandMark'
import { PresetPicker } from '../../components/PresetPicker'
import { SaveButton } from '../../components/SaveButton'
import {
  Chip,
  EstimateBox,
  EstimateRow,
  Fact,
  Facts,
  HistoryButtons,
  LinkButton,
  SidebarFooter,
  SmallButton,
  SourceName,
  SwitchField,
} from '../../components/SidebarParts'
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
  MAX_SILENCE_DURATION,
  MAX_SILENCE_PADDING,
  MAX_SILENCE_THRESHOLD_DB,
  MIN_GAIN_DB,
  MIN_SILENCE_DURATION,
  MIN_SILENCE_THRESHOLD_DB,
  changeAudioFormat,
  estimateRenderSize,
  keptLength,
  removedRanges,
  resolveSampleRate,
} from '../../media/audio'
import type { AudioEdit, AudioFormat, AudioInfo, AudioOutput, AudioRecipe, TimeRange } from '../../media/audio'
import { formatBytes, formatTimecode } from '../../utils/format'
import { bitrateChoices, effectiveRecipe } from './logic'
import { audioMessages, formatBitrate, formatSampleRate } from './messages'

type LevelsState = 'loading' | 'ready' | 'error'

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
  /** 書き出しに残す範囲（無音カットを切っていれば区間全体） */
  kept: readonly TimeRange[]
  /** 無音の検出に使う包絡の読み込み。読めるまで（読めなければ）画面では削る範囲を出せない */
  levels: LevelsState
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

/** 入力 → 編集 → 出力 → 出力の見込み を上から並べたパネル。保存は下端に固定する */
export function AudioSidebar({
  file,
  info,
  recipe,
  kept,
  levels,
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
  const outputLength = keptLength(kept)

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
            <SmallButton
              onClick={async () => {
                const [picked] = await pickFiles({ accept: 'audio/*' })
                if (picked) onFileSelect(picked)
              }}
            >
              {t.selectFile}
            </SmallButton>
          </div>
        </Step>

        {ready && (
          <>
            <Step index={2} title={t.stepEdit}>
              <div className="flex flex-wrap items-center gap-1">
                <HistoryButtons canUndo={canUndo} canRedo={canRedo} onUndo={onUndo} onRedo={onRedo} />
              </div>
              <EditControls info={info} recipe={recipe} kept={kept} levels={levels} onEdit={onEdit} />
              <LinkButton onClick={() => onEdit({ type: 'reset' })}>{t.resetEdits}</LinkButton>
            </Step>

            <Step index={3} title={t.stepOutput}>
              {/* この環境で書き出せない形式のプリセットは、画面側の usableOutput が使える形式へ戻す */}
              <PresetPicker kind="audio" scope="audio" value={output} onChange={onOutputChange} />
              <OutputControls
                info={info}
                recipe={recipe}
                outputLength={outputLength}
                output={output}
                onOutputChange={onOutputChange}
                supported={supported}
              />
            </Step>

            <Step index={4} title={t.stepEstimate}>
              <EstimateBox>
                <EstimateRow label={t.estimatedSize}>
                  {formatBytes(estimateRenderSize(output, effectiveRecipe(recipe), info, outputLength))}
                </EstimateRow>
                <EstimateRow label={t.outputDuration}>{formatTimecode(outputLength)}</EstimateRow>
              </EstimateBox>
              <StepHint>{m.previewNote}</StepHint>
            </Step>
          </>
        )}
      </div>

      <SidebarFooter progress={renderProgress === null ? null : renderProgress * 100} onCancel={onCancelRender}>
        <SaveButton save={save} disabled={!ready} />
      </SidebarFooter>
    </aside>
  )
}

function EditControls({
  info,
  recipe,
  kept,
  levels,
  onEdit,
}: {
  info: AudioInfo
  recipe: AudioRecipe
  kept: readonly TimeRange[]
  levels: LevelsState
  onEdit: (edit: AudioEdit) => void
}) {
  const m = useLocalMessages(audioMessages)
  const length = recipe.trim.end - recipe.trim.start
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
      <SwitchField
        label={m.normalize}
        hint={m.normalizeHint}
        checked={recipe.normalize}
        onChange={(enabled) => onEdit({ type: 'setNormalize', enabled })}
      />
      <SwitchField
        label={m.mono}
        hint={info.channels === 1 ? m.monoAlready : undefined}
        checked={recipe.mono}
        disabled={info.channels === 1 && !recipe.mono}
        onChange={(enabled) => onEdit({ type: 'setMono', enabled })}
      />
      <SilenceControls recipe={recipe} kept={kept} levels={levels} onEdit={onEdit} />
    </div>
  )
}

/** 無音カットのオン・オフと、入れているあいだだけ出す 3 つの値。下に削る量の見込みを出す */
function SilenceControls({
  recipe,
  kept,
  levels,
  onEdit,
}: {
  recipe: AudioRecipe
  kept: readonly TimeRange[]
  levels: LevelsState
  onEdit: (edit: AudioEdit) => void
}) {
  const m = useLocalMessages(audioMessages)
  const { silence } = recipe
  const removed = removedRanges(kept, recipe.trim)
  const removedSeconds = removed.reduce((sum, r) => sum + (r.end - r.start), 0)
  return (
    <div className="flex flex-col gap-3">
      <SwitchField
        label={m.silence}
        hint={silence.enabled ? undefined : m.silenceHint}
        checked={silence.enabled}
        onChange={(enabled) => onEdit({ type: 'setSilence', silence: { enabled } })}
      />
      {silence.enabled && (
        <>
          <DraftSlider
            label={m.silenceThreshold}
            value={silence.thresholdDb}
            min={MIN_SILENCE_THRESHOLD_DB}
            max={MAX_SILENCE_THRESHOLD_DB}
            step={1}
            format={m.dbfs}
            onCommit={(thresholdDb) => onEdit({ type: 'setSilence', silence: { thresholdDb } })}
          />
          <DraftSlider
            label={m.silenceMinDuration}
            value={silence.minDuration}
            min={MIN_SILENCE_DURATION}
            max={MAX_SILENCE_DURATION}
            step={0.1}
            format={m.seconds}
            onCommit={(minDuration) => onEdit({ type: 'setSilence', silence: { minDuration } })}
          />
          <DraftSlider
            label={m.silencePadding}
            value={silence.padding}
            min={0}
            max={MAX_SILENCE_PADDING}
            step={0.05}
            format={m.secondsFine}
            onCommit={(padding) => onEdit({ type: 'setSilence', silence: { padding } })}
          />
          <StepHint>
            {levels === 'ready'
              ? m.silenceSummary(removed.length, m.seconds(removedSeconds))
              : levels === 'error'
                ? m.silenceUnknown
                : m.silenceAnalyzing}
          </StepHint>
        </>
      )}
    </div>
  )
}

function OutputControls({
  info,
  recipe,
  outputLength,
  output,
  onOutputChange,
  supported,
}: {
  info: AudioInfo
  recipe: AudioRecipe
  outputLength: number
  output: AudioOutput
  onOutputChange: (output: AudioOutput) => void
  supported: Readonly<Record<AudioFormat, boolean>> | null
}) {
  const m = useLocalMessages(audioMessages)
  const effective = effectiveRecipe(recipe)
  const spec = AUDIO_FORMATS[output.format]
  const size = (next: AudioOutput) => formatBytes(estimateRenderSize(next, effective, info, outputLength))
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

function ChoiceGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

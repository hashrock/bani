import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { solidOnClass } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { Step, StepHint } from '../../components/Step'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
// 画面と一緒に読み込まれるので、エンコーダ本体を引き込まない部分だけを直接読む
import { canEncodeAudioFormat } from '../../media/audio/encoders'
import { AUDIO_FORMATS, AUDIO_FORMAT_LIST, changeAudioFormat, clampBitrate } from '../../media/audio/output'
import type { AudioFormat, AudioOutput } from '../../media/audio/types'
import { IMAGE_FORMATS, clampQuality } from '../../media/image/output'
import type { ImageFormat } from '../../media/image/output'
import { MAX_DIMENSION } from '../../media/image/recipe'
import { detectEncodableFormats } from '../../media/image/render'
import type { TextEncodingName } from '../../media/text/encoding'
import type { BomSetting, NewlineSetting } from '../../media/text/recipe'
import { convertMessages } from './messages'
import type { ImageBatchOutput, TextBatchOutput } from './outputs'
import { clampMaxSize } from './outputs'

/** 項目が少ない選択肢を横に並べる。押し直しで選択が外れないよう、空の値は無視する */
function Choices<T extends string>({
  label,
  value,
  options,
  disabled = [],
  onChange,
  wrap = false,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  disabled?: readonly T[]
  onChange: (value: T) => void
  /** 項目が多いときは折り返して並べる */
  wrap?: boolean
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={wrap ? 1 : 0}
      className={cn('w-full', wrap && 'flex-wrap')}
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const option = options.find((item) => item.value === next)
        if (option) onChange(option.value)
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          size="sm"
          disabled={disabled.includes(option.value)}
          className={cn(wrap ? 'px-2 text-xs' : 'flex-1 text-xs', solidOnClass)}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function FieldHead({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between text-xs text-muted-foreground">
      <span>{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  )
}

/** WebCodecs 頼みの形式（AAC・Opus）だけ確かめる。MP3・FLAC は同梱のエンコーダ、WAV は mediabunny が書く */
const PLATFORM_AUDIO_FORMATS: readonly AudioFormat[] = ['m4a', 'opus']

function useUnavailableAudioFormats(): AudioFormat[] {
  const [unavailable, setUnavailable] = useState<AudioFormat[]>([])
  useEffect(() => {
    let cancelled = false
    Promise.all(
      PLATFORM_AUDIO_FORMATS.map(async (format) => ((await canEncodeAudioFormat(format)) ? null : format))
    ).then((results) => {
      if (!cancelled) setUnavailable(results.filter((format): format is AudioFormat => format !== null))
    })
    return () => {
      cancelled = true
    }
  }, [])
  return unavailable
}

/** 音声: 形式 → ビットレート（2 手順） */
export function AudioSteps({
  startIndex,
  output,
  onChange,
}: {
  startIndex: number
  output: AudioOutput
  onChange: (output: AudioOutput) => void
}) {
  const { t } = useI18n()
  const m = useLocalMessages(convertMessages)
  const unavailable = useUnavailableAudioFormats()
  const spec = AUDIO_FORMATS[output.format]

  return (
    <>
      <Step index={startIndex} title={t.stepFormat}>
        <Choices
          label={t.stepFormat}
          value={output.format}
          options={AUDIO_FORMAT_LIST.map((format) => ({
            value: format,
            label: AUDIO_FORMATS[format].extension.toUpperCase(),
          }))}
          disabled={unavailable}
          onChange={(format) => onChange(changeAudioFormat(output, format))}
        />
        {unavailable.includes(output.format) && <StepHint>{m.audioUnavailable}</StepHint>}
      </Step>
      <Step index={startIndex + 1} title={m.stepBitrate}>
        {spec.lossless ? (
          <StepHint>{m.losslessHint}</StepHint>
        ) : (
          <div className="flex flex-col gap-2">
            <FieldHead label={m.bitrateLabel} value={Math.round(output.bitrate / 1000)} />
            <Slider
              min={spec.bitrate.min / 1000}
              max={spec.bitrate.max / 1000}
              step={8}
              value={[Math.round(output.bitrate / 1000)]}
              onValueChange={([kbps]) =>
                onChange({ ...output, bitrate: clampBitrate(output.format, kbps * 1000) })
              }
              aria-label={m.stepBitrate}
            />
          </div>
        )}
      </Step>
    </>
  )
}

const IMAGE_FORMAT_LABEL: Record<ImageFormat, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  avif: 'AVIF',
}

function useEncodableImageFormats(): ImageFormat[] | null {
  const [formats, setFormats] = useState<ImageFormat[] | null>(null)
  useEffect(() => {
    let cancelled = false
    detectEncodableFormats().then((found) => {
      if (!cancelled) setFormats(found)
    })
    return () => {
      cancelled = true
    }
  }, [])
  return formats
}

/** 画像: 形式 → 画質 → 大きさ（3 手順） */
export function ImageSteps({
  startIndex,
  value,
  onChange,
}: {
  startIndex: number
  value: ImageBatchOutput
  onChange: (value: ImageBatchOutput) => void
}) {
  const { t } = useI18n()
  const m = useLocalMessages(convertMessages)
  const encodable = useEncodableImageFormats()
  const allFormats = Object.keys(IMAGE_FORMATS) as ImageFormat[]
  // 確かめ終わるまでは全部選べるようにしておき、書き出せないと分かった形式だけを灰色にする。
  // 1 つも書き出せないという結果は確かめ方の失敗とみなし、何も灰色にしない（書き出しの失敗は一覧に出る）
  const disabled =
    encodable && encodable.length > 0
      ? allFormats.filter((format) => !encodable.includes(format))
      : []
  const { output } = value

  return (
    <>
      <Step index={startIndex} title={t.stepFormat}>
        <Choices
          label={t.stepFormat}
          value={output.format}
          options={allFormats.map((format) => ({ value: format, label: IMAGE_FORMAT_LABEL[format] }))}
          disabled={disabled}
          onChange={(format) => onChange({ ...value, output: { ...output, format } })}
        />
      </Step>
      <Step index={startIndex + 1} title={t.stepQuality}>
        {IMAGE_FORMATS[output.format].lossy ? (
          <div className="flex flex-col gap-2">
            <FieldHead label={t.qualityLabel} value={`${output.quality}%`} />
            <Slider
              min={1}
              max={100}
              value={[output.quality]}
              onValueChange={([quality]) =>
                onChange({ ...value, output: { ...output, quality: clampQuality(quality) } })
              }
              aria-label={t.qualityLabel}
            />
          </div>
        ) : (
          <StepHint>{m.imageLosslessHint}</StepHint>
        )}
      </Step>
      <Step index={startIndex + 2} title={m.stepMaxSize}>
        <div className="flex flex-col gap-1">
          <Label htmlFor="convert-image-max-size" className="text-[11px] font-normal text-muted-foreground">
            {m.maxSizeLabel}
          </Label>
          <Input
            id="convert-image-max-size"
            type="number"
            min={1}
            max={MAX_DIMENSION}
            className="h-8 px-2 text-[13px] md:text-[13px]"
            placeholder={t.auto}
            value={value.maxSize ?? ''}
            onChange={(event) =>
              onChange({
                ...value,
                maxSize: event.target.value === '' ? null : clampMaxSize(Number(event.target.value)),
              })
            }
          />
        </div>
        <StepHint>{m.maxSizeHint}</StepHint>
      </Step>
    </>
  )
}

/**
 * 書き出せる文字コードと表示名（画面に出す順）。media/text の TEXT_ENCODINGS は文字コード表
 * （encoding-japanese）ごと読み込むので、画面では名前だけを持つ。Record なので種類の欠けは型で分かる
 */
const ENCODING_LABEL: Record<TextEncodingName, string> = {
  'utf-8': 'UTF-8',
  shift_jis: 'Shift_JIS',
  'euc-jp': 'EUC-JP',
  'iso-2022-jp': 'JIS',
  'utf-16le': 'UTF-16LE',
  'utf-16be': 'UTF-16BE',
}

const ENCODING_OPTIONS = (Object.keys(ENCODING_LABEL) as TextEncodingName[]).map((value) => ({
  value,
  label: ENCODING_LABEL[value],
}))

/** テキスト: 文字コード → 改行 → BOM（3 手順） */
export function TextSteps({
  startIndex,
  value,
  onChange,
}: {
  startIndex: number
  value: TextBatchOutput
  onChange: (value: TextBatchOutput) => void
}) {
  const m = useLocalMessages(convertMessages)
  const newlines: { value: NewlineSetting; label: string }[] = [
    { value: 'keep', label: m.keep },
    { value: 'lf', label: 'LF' },
    { value: 'crlf', label: 'CRLF' },
    { value: 'cr', label: 'CR' },
  ]
  const boms: { value: BomSetting; label: string }[] = [
    { value: 'keep', label: m.keep },
    { value: 'add', label: m.bomAdd },
    { value: 'remove', label: m.bomRemove },
  ]

  return (
    <>
      <Step index={startIndex} title={m.stepEncoding}>
        <Choices
          label={m.stepEncoding}
          value={value.encoding}
          options={[{ value: 'keep', label: m.keep }, ...ENCODING_OPTIONS]}
          onChange={(encoding) => onChange({ ...value, encoding })}
          wrap
        />
      </Step>
      <Step index={startIndex + 1} title={m.stepNewline}>
        <Choices
          label={m.stepNewline}
          value={value.newline}
          options={newlines}
          onChange={(newline) => onChange({ ...value, newline })}
        />
      </Step>
      <Step index={startIndex + 2} title={m.stepBom}>
        <Choices label={m.stepBom} value={value.bom} options={boms} onChange={(bom) => onChange({ ...value, bom })} />
        <StepHint>{m.bomHint}</StepHint>
      </Step>
    </>
  )
}

import type { Messages } from '../i18n/messages'
import { useI18n } from '../i18n/context'
import type { ConversionSettings, OutputFormat } from '../types'
import { Step } from './Step'

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
        <div className="segmented">
          {FORMATS.map((format) => (
            <button
              key={format.value}
              className={`segment ${settings.format === format.value ? 'active' : ''}`}
              onClick={() =>
                onSettingsChange({
                  ...settings,
                  format: format.value,
                  fps: format.value === 'gif' ? (settings.fps ?? 10) : settings.fps,
                })
              }
            >
              {format.label}
            </button>
          ))}
        </div>
        {currentFormat && <p className="step-hint">{t[currentFormat.hint]}</p>}
      </Step>

      <Step index={startIndex + 1} title={settings.format === 'gif' ? t.stepFps : t.stepQuality}>
        {settings.format === 'gif' ? (
          <div className="field">
            <div className="field-head">
              <span>{t.fpsLabel}</span>
              <span className="field-value">{settings.fps ?? 10}</span>
            </div>
            <input
              type="range"
              min="1"
              max="30"
              value={settings.fps ?? 10}
              onChange={(e) => onSettingsChange({ ...settings, fps: Number(e.target.value) })}
            />
            <p className="step-hint">{t.fpsHint}</p>
          </div>
        ) : (
          <div className="field">
            <div className="field-head">
              <span>{t.qualityLabel}</span>
              <span className="field-value">{settings.quality}%</span>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              value={settings.quality}
              onChange={(e) => onSettingsChange({ ...settings, quality: Number(e.target.value) })}
            />
            <p className="step-hint">{t.qualityHint}</p>
          </div>
        )}
      </Step>

      <Step index={startIndex + 2} title={t.stepResolution}>
        {dimensions && (
          <div className="preset-row">
            <button
              className={`chip ${!settings.width && !settings.height ? 'active' : ''}`}
              onClick={() => onSettingsChange({ ...settings, width: undefined, height: undefined })}
            >
              {t.originalSize}
            </button>
            {HEIGHT_PRESETS.filter((height) => height < dimensions.height).map((height) => (
              <button
                key={height}
                className={`chip ${isPresetActive(height) ? 'active' : ''}`}
                onClick={() => applyHeightPreset(height)}
              >
                {height}p
              </button>
            ))}
          </div>
        )}
        <div className="dimension-row">
          <label className="dimension-field">
            <span>{t.width}</span>
            <input
              type="number"
              placeholder={t.auto}
              value={settings.width || ''}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  width: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </label>
          <span className="dimension-times">×</span>
          <label className="dimension-field">
            <span>{t.height}</span>
            <input
              type="number"
              placeholder={t.auto}
              value={settings.height || ''}
              onChange={(e) =>
                onSettingsChange({
                  ...settings,
                  height: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
          </label>
        </div>
      </Step>
    </>
  )
}

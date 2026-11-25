import { useRef, useState } from 'react'
import { useI18n } from '../i18n/context'
import { trimDuration, trimFromSettings } from '../state/trim'
import type { ConversionSettings, MediaInfo, PreviewEstimate } from '../types'
import { formatBytes, formatTimecode } from '../utils/format'
import { SidebarHead } from './BrandMark'
import { CompatibilityList } from './CompatibilityList'
import { OutputSteps } from './OutputSteps'
import { Step } from './Step'

interface SidebarProps {
  file: File | null
  media: MediaInfo | null
  settings: ConversionSettings
  onSettingsChange: (settings: ConversionSettings) => void
  onFileSelect: (file: File) => void
  onResetSettings: () => void
  previewEstimate: PreviewEstimate
  converting: boolean
  progress: number
  hasResult: boolean
  stale: boolean
  onConvert: () => void
  onCancel: () => void
  onDownload: () => void
}

/**
 * 単体編集の手順（入力 → 形式 → 画質 → 解像度 → 見込み → 実行）を上から下に並べたパネル。
 */
export function Sidebar({
  file,
  media,
  settings,
  onSettingsChange,
  onFileSelect,
  onResetSettings,
  previewEstimate,
  converting,
  progress,
  hasResult,
  stale,
  onConvert,
  onCancel,
  onDownload,
}: SidebarProps) {
  const { t, lang } = useI18n()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const dimensions = media?.dimensions ?? null
  const trimmedDuration = trimDuration(trimFromSettings(settings, media?.duration ?? 0))

  return (
    <aside className="sidebar">
      <SidebarHead />

      <div className="sidebar-scroll">
        <Step index={1} title={t.stepInput}>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const selected = e.target.files?.[0]
              if (selected) onFileSelect(selected)
              e.target.value = ''
            }}
          />

          {file ? (
            <div className="source">
              <div className="source-name" title={file.name}>
                {file.name}
              </div>
              <dl className="source-facts">
                <div>
                  <dt>{t.factSize}</dt>
                  <dd>{formatBytes(file.size)}</dd>
                </div>
                {dimensions && (
                  <div>
                    <dt>{t.factResolution}</dt>
                    <dd>
                      {dimensions.width}×{dimensions.height}
                    </dd>
                  </div>
                )}
                {media && (
                  <div>
                    <dt>{t.factDuration}</dt>
                    <dd>{formatTimecode(media.duration)}</dd>
                  </div>
                )}
              </dl>

              <button className="disclosure" onClick={() => setDetailsOpen(!detailsOpen)}>
                {detailsOpen ? '▼' : '▶'} {t.details}
              </button>
              {detailsOpen && (
                <dl className="source-facts source-facts-detail">
                  <div>
                    <dt>{t.factMime}</dt>
                    <dd>{file.type || 'unknown'}</dd>
                  </div>
                  {media?.videoCodec && (
                    <div>
                      <dt>{t.factVideoCodec}</dt>
                      <dd>{media.videoCodec}</dd>
                    </div>
                  )}
                  {media?.audioCodec && (
                    <div>
                      <dt>{t.factAudioCodec}</dt>
                      <dd>{media.audioCodec}</dd>
                    </div>
                  )}
                  {media?.tags?.title && (
                    <div>
                      <dt>{t.factTitle}</dt>
                      <dd>{media.tags.title}</dd>
                    </div>
                  )}
                  {media?.tags?.artist && (
                    <div>
                      <dt>{t.factArtist}</dt>
                      <dd>{media.tags.artist}</dd>
                    </div>
                  )}
                  <div>
                    <dt>{t.factModified}</dt>
                    <dd>{new Date(file.lastModified).toLocaleString(lang)}</dd>
                  </div>
                </dl>
              )}
            </div>
          ) : (
            <p className="step-empty">{t.inputEmpty}</p>
          )}

          <div className="step-actions">
            <button className="ghost-btn" onClick={() => fileInputRef.current?.click()}>
              {t.selectFile}
            </button>
          </div>
        </Step>

        <OutputSteps
          startIndex={2}
          settings={settings}
          onSettingsChange={onSettingsChange}
          dimensions={dimensions}
        />

        <Step index={5} title={t.stepEstimate}>
          <div className="estimate">
            <div className="estimate-row">
              <span>{t.estimatedSize}</span>
              <strong>
                {previewEstimate.isEstimating
                  ? t.estimating
                  : previewEstimate.estimatedSize > 0
                    ? formatBytes(previewEstimate.estimatedSize)
                    : '—'}
              </strong>
            </div>
            <div className="estimate-row">
              <span>{t.outputDuration}</span>
              <strong>{trimmedDuration > 0 ? formatTimecode(trimmedDuration) : '—'}</strong>
            </div>
          </div>

          {previewEstimate.estimatedSize > 0 ? (
            <CompatibilityList
              estimatedSize={previewEstimate.estimatedSize}
              duration={trimmedDuration}
            />
          ) : (
            <p className="step-hint">{t.estimateEmpty}</p>
          )}
        </Step>

        <button className="link-btn" onClick={onResetSettings}>
          {t.resetSettings}
        </button>
      </div>

      <div className="sidebar-footer">
        {converting ? (
          <>
            <div className="footer-progress">
              <div className="footer-progress-bar" style={{ width: `${progress}%` }} />
            </div>
            <button className="cancel-btn block" onClick={onCancel}>
              {t.cancelWithProgress(progress)}
            </button>
          </>
        ) : (
          <>
            <button className="convert-btn block" onClick={onConvert} disabled={!file}>
              {hasResult ? (stale ? t.reconvertLong : t.convertAgain) : t.convert}
            </button>
            {hasResult && (
              <button className="download-btn block" onClick={onDownload}>
                {t.download}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  )
}

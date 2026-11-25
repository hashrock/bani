import { useRef } from 'react'
import { BatchStatus } from '../components/BatchStatus'
import { SidebarHead } from '../components/BrandMark'
import { FileUpload } from '../components/FileUpload'
import { OutputSteps } from '../components/OutputSteps'
import { Step } from '../components/Step'
import { useBatchConversion } from '../hooks/useBatchConversion'
import { useI18n } from '../i18n/context'
import type { ConversionSettings } from '../types'
import { DEFAULT_SETTINGS } from '../types'

interface ConvertPageProps {
  /** 変換するファイル。選び直すと画面ごと作り直す */
  files: File[]
  settings: ConversionSettings
  onSettingsChange: (settings: ConversionSettings) => void
  isDragging: boolean
  onFiles: (files: File[]) => void
}

/** 複数のファイルを同じ設定でまとめて書き出す画面。編集はせず、常に全体を変換する */
export function ConvertPage({
  files,
  settings,
  onSettingsChange,
  isDragging,
  onFiles,
}: ConvertPageProps) {
  const { t } = useI18n()
  const batch = useBatchConversion(settings, files)
  const inputRef = useRef<HTMLInputElement>(null)
  const count = batch.files.length

  return (
    <div className="app">
      <aside className="sidebar">
        <SidebarHead />

        <div className="sidebar-scroll">
          <Step index={1} title={t.stepInput}>
            <input
              ref={inputRef}
              type="file"
              accept="video/*"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const selected = e.target.files
                if (selected && selected.length > 0) onFiles(Array.from(selected))
                e.target.value = ''
              }}
            />
            {count > 0 ? (
              <div className="source">
                <div className="source-name">{t.batchSelected(count)}</div>
              </div>
            ) : (
              <p className="step-empty">{t.batchEmpty}</p>
            )}
            <div className="step-actions">
              <button
                className="ghost-btn"
                onClick={() => inputRef.current?.click()}
                disabled={batch.running}
              >
                {count > 0 ? t.addFiles : t.selectFiles}
              </button>
            </div>
          </Step>

          <OutputSteps
            startIndex={2}
            settings={settings}
            onSettingsChange={onSettingsChange}
            dimensions={null}
          />

          <button className="link-btn" onClick={() => onSettingsChange(DEFAULT_SETTINGS)}>
            {t.resetSettings}
          </button>
        </div>

        <div className="sidebar-footer">
          {batch.running ? (
            <button className="cancel-btn block" onClick={batch.cancel}>
              {t.cancel}
            </button>
          ) : (
            <button className="convert-btn block" onClick={batch.run} disabled={count === 0}>
              {t.convertBatch(count)}
            </button>
          )}
        </div>
      </aside>

      <div className="workspace">
        <div className="stage">
          {count > 0 ? (
            <div className={`batch-area ${isDragging ? 'dragging' : ''}`}>
              {batch.error && <div className="batch-error">{batch.error}</div>}
              <BatchStatus files={batch.files} />
            </div>
          ) : (
            <FileUpload
              isDragging={isDragging}
              message={t.dropHereBatch}
              buttonLabel={t.selectFiles}
              accept="video/*"
              multiple
              onFiles={onFiles}
            />
          )}
        </div>
      </div>
    </div>
  )
}

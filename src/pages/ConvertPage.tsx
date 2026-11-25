import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BatchStatus } from '../components/BatchStatus'
import { SidebarHead } from '../components/BrandMark'
import { FileUpload } from '../components/FileUpload'
import { OutputSteps } from '../components/OutputSteps'
import { ResetSettingsButton, SourceName } from '../components/SidebarParts'
import { Step, StepHint } from '../components/Step'
import { pickFiles } from '../core/opened'
import type { OpenedFile } from '../core/opened'
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
  onFiles: (files: OpenedFile[]) => void
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
  const count = batch.files.length

  return (
    <div className="app">
      <aside className="sidebar">
        <SidebarHead />

        <div className="sidebar-scroll">
          <Step index={1} title={t.stepInput}>
            {count > 0 ? (
              <SourceName>{t.batchSelected(count)}</SourceName>
            ) : (
              <StepHint>{t.batchEmpty}</StepHint>
            )}
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="xs"
                className="h-7 px-2.5"
                onClick={async () => {
                  const picked = await pickFiles({ multiple: true, accept: 'video/*' })
                  if (picked.length > 0) onFiles(picked)
                }}
                disabled={batch.running}
              >
                {count > 0 ? t.addFiles : t.selectFiles}
              </Button>
            </div>
          </Step>

          <OutputSteps
            startIndex={2}
            settings={settings}
            onSettingsChange={onSettingsChange}
            dimensions={null}
          />

          <ResetSettingsButton onClick={() => onSettingsChange(DEFAULT_SETTINGS)} />
        </div>

        <div className="sidebar-footer">
          {batch.running ? (
            <Button variant="destructive" className="w-full" onClick={batch.cancel}>
              {t.cancel}
            </Button>
          ) : (
            <Button className="w-full" onClick={batch.run} disabled={count === 0}>
              {t.convertBatch(count)}
            </Button>
          )}
        </div>
      </aside>

      <div className="workspace">
        <div className="stage">
          {count > 0 ? (
            <div
              className={cn(
                'flex-1 overflow-y-auto bg-background px-5 py-4',
                isDragging && 'drop-target-active'
              )}
            >
              {batch.error && (
                <div className="mb-3 rounded-md border border-destructive px-3 py-2.5 text-[13px] text-destructive">
                  {batch.error}
                </div>
              )}
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

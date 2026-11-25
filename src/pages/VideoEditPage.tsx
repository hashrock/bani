import { useCallback, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { BottomBar } from '../components/BottomBar'
import { FileUpload } from '../components/FileUpload'
import { Sidebar } from '../components/Sidebar'
import { VideoPreview } from '../components/VideoPreview'
import { useConversionJob } from '../hooks/useConversionJob'
import { useMediaInfo } from '../hooks/useMediaInfo'
import { useSizeEstimate } from '../hooks/useSizeEstimate'
import { useI18n } from '../i18n/context'
import type { ConversionSettings, MediaInfo } from '../types'
import { DEFAULT_SETTINGS } from '../types'

/** 変換結果がいまの設定で作られたものかを比べるための鍵 */
function settingsKey(settings: ConversionSettings): string {
  return [
    settings.format,
    settings.quality,
    settings.width ?? '',
    settings.height ?? '',
    settings.fps ?? '',
    settings.startTime ?? '',
    settings.endTime ?? '',
  ].join('|')
}

interface VideoEditPageProps {
  /** 開いているファイル。別のファイルを開くと画面ごと作り直す */
  file: File | null
  settings: ConversionSettings
  setSettings: Dispatch<SetStateAction<ConversionSettings>>
  isDragging: boolean
  onFiles: (files: File[]) => void
}

/** 動画 1 本を開き、切り出しや解像度を決めて書き出す画面 */
export function VideoEditPage({
  file,
  settings,
  setSettings,
  isDragging,
  onFiles,
}: VideoEditPageProps) {
  const { t } = useI18n()
  const [showAfter, setShowAfter] = useState(false)
  const [convertedKey, setConvertedKey] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  // 尺がわかったら、切り出し区間を新しいファイルの全体に合わせる
  const handleMediaLoaded = useCallback(
    (info: MediaInfo) => setSettings((prev) => ({ ...prev, startTime: 0, endTime: info.duration })),
    [setSettings]
  )
  const media = useMediaInfo(file, handleMediaLoaded)

  const job = useConversionJob({ file, settings, media })
  const previewEstimate = useSizeEstimate({ file, settings, media })

  // 変換したあとに設定を触ったか。再変換ボタンで示す
  const stale = !!job.result && convertedKey !== settingsKey(settings)

  const handleConvert = async () => {
    // 変換できたら結果側に切り替える（その後の手動切り替えは妨げない）
    if (await job.convert()) {
      setConvertedKey(settingsKey(settings))
      setShowAfter(true)
    }
  }

  // 尺に依存する切り出し区間は、いま開いているファイルに合わせて残す
  const handleResetSettings = () =>
    setSettings({ ...DEFAULT_SETTINGS, startTime: 0, endTime: media?.duration })

  return (
    <div className="app">
      <Sidebar
        file={file}
        media={media}
        settings={settings}
        onSettingsChange={setSettings}
        onFileSelect={(selected) => onFiles([selected])}
        onResetSettings={handleResetSettings}
        previewEstimate={previewEstimate}
        converting={job.running}
        progress={job.progress}
        hasResult={!!job.result}
        stale={stale}
        onConvert={handleConvert}
        onCancel={job.cancel}
        onDownload={job.download}
      />

      <div className="workspace">
        <div className="stage">
          {file ? (
            <VideoPreview
              file={file}
              videoRef={videoRef}
              result={job.result}
              converting={job.running}
              progress={job.progress}
              showAfter={showAfter}
              error={job.error}
              isDragging={isDragging}
            />
          ) : (
            <FileUpload
              isDragging={isDragging}
              message={t.dropHere}
              buttonLabel={t.selectFile}
              accept="video/*"
              onFiles={onFiles}
            />
          )}
        </div>

        {file && (
          <BottomBar
            file={file}
            videoRef={videoRef}
            duration={media?.duration ?? 0}
            settings={settings}
            onSettingsChange={setSettings}
            result={job.result}
            showAfter={showAfter}
            onToggleView={setShowAfter}
            converting={job.running}
            progress={job.progress}
            stale={stale}
            onConvert={handleConvert}
            onCancel={job.cancel}
            onDownload={job.download}
          />
        )}
      </div>
    </div>
  )
}

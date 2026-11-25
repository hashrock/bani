import { useCallback, useRef, useState } from 'react'
import { BottomBar } from '../../components/BottomBar'
import { FileUpload } from '../../components/FileUpload'
import { Sidebar } from '../../components/Sidebar'
import { VideoPreview } from '../../components/VideoPreview'
import { usePersistentState } from '../../core/usePersistentState'
import { useSave } from '../../core/useSave'
import type { ConversionResult } from '../../types'
import type { EditPageProps } from '../types'
import { useConversionJob } from '../../hooks/useConversionJob'
import { useMediaInfo } from '../../hooks/useMediaInfo'
import { useSizeEstimate } from '../../hooks/useSizeEstimate'
import { useI18n } from '../../i18n/context'
import type { ConversionSettings, MediaInfo } from '../../types'
import { DEFAULT_SETTINGS } from '../../types'

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

const MIME_TYPES: Record<string, string> = {
  gif: 'image/gif',
  webm: 'video/webm',
  mp4: 'video/mp4',
}

const toRendered = (result: ConversionResult) => {
  const extension = result.filename.split('.').pop()?.toLowerCase() ?? ''
  return {
    blob: new Blob([result.buffer], { type: MIME_TYPES[extension] ?? 'application/octet-stream' }),
    filename: result.filename,
  }
}

/** 動画 1 本を開き、切り出しや解像度を決めて書き出す画面 */
export function VideoEditPage({ opened, isDragging, onFiles }: EditPageProps) {
  const { t } = useI18n()
  const file = opened?.file ?? null
  // 出力設定は別のファイルを開いても、画面を行き来しても残す
  const [settings, setSettings] = usePersistentState<ConversionSettings>(
    'video.settings',
    DEFAULT_SETTINGS
  )
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

  // 保存は変換結果を使う。まだ変換していなければ先に変換する。
  // 動画は常に再エンコードするので、別名で保存が主になる（上書きはドロップダウン）
  const save = useSave({
    opened,
    lossless: false,
    sameFormat: false,
    canCopy: false,
    disabled: !file || job.running,
    render: async () => {
      const result = job.result ?? (await handleConvertResult())
      if (!result) throw new DOMException('Conversion did not finish', 'AbortError')
      return toRendered(result)
    },
    onSourceReplaced: (next) => onFiles([next]),
  })

  async function handleConvertResult() {
    const result = await job.convert()
    if (result) {
      setConvertedKey(settingsKey(settings))
      setShowAfter(true)
    }
    return result
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
        save={save}
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
            save={save}
          />
        )}
      </div>
    </div>
  )
}

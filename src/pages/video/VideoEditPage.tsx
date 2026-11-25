import { useRef, useState } from 'react'
import { BottomBar } from '../../components/BottomBar'
import { FileUpload } from '../../components/FileUpload'
import { Sidebar } from '../../components/Sidebar'
import { VideoPreview } from '../../components/VideoPreview'
import { usePersistentState } from '../../core/usePersistentState'
import { useSave } from '../../core/useSave'
import { useConversionJob } from '../../hooks/useConversionJob'
import { useMediaInfo } from '../../hooks/useMediaInfo'
import { useSizeEstimate } from '../../hooks/useSizeEstimate'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import { DEFAULT_VIDEO_OUTPUT, editedSize } from '../../media/video'
import type { VideoOutput, VideoRecipe } from '../../media/video'
import { createAbortError } from '../../utils/abort'
import type { EditPageProps } from '../types'
import { CropOverlay } from './CropOverlay'
import { EditStep } from './EditStep'
import { ExportStep } from './ExportStep'
import { videoMessages } from './messages'
import { useVideoRecipe } from './useVideoRecipe'

/** 変換結果がいまのレシピと出力設定で作られたものかを比べるための鍵 */
const resultKey = (recipe: VideoRecipe, output: VideoOutput) => JSON.stringify([recipe, output])

/**
 * 動画 1 本を開き、編集（レシピ）と出力設定を決めて書き出す画面。
 * レシピは取り消し・やり直しの履歴で持ち、出力設定は別のファイルを開いても残す。
 */
export function VideoEditPage({ opened, isDragging, onFiles }: EditPageProps) {
  const { t } = useI18n()
  const m = useLocalMessages(videoMessages)
  const file = opened?.file ?? null
  const [output, setOutput] = usePersistentState<VideoOutput>('video.output', DEFAULT_VIDEO_OUTPUT)
  const edits = useVideoRecipe()
  // 尺と寸法がわかったら、レシピを新しいファイルの全体に合わせて作り直す
  const media = useMediaInfo(file, edits.resetFor)
  const { recipe, committed } = edits

  const [cropping, setCropping] = useState(false)
  const [showAfter, setShowAfter] = useState(false)
  const [convertedKey, setConvertedKey] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)

  const job = useConversionJob({ file, recipe: committed, output, media })
  const previewEstimate = useSizeEstimate({ file, recipe: committed, output, media })

  // 変換したあとにレシピや設定を触ったか。再変換ボタンで示す
  const stale = !!job.result && convertedKey !== resultKey(committed, output)

  const convert = async () => {
    const key = resultKey(committed, output)
    const result = await job.convert()
    // 変換できたら結果側に切り替える（その後の手動切り替えは妨げない）
    if (result) {
      setConvertedKey(key)
      setShowAfter(true)
      setCropping(false)
    }
    return result
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
      const result = (!stale && job.result) || (await convert())
      if (!result) throw createAbortError('Conversion did not finish')
      return { blob: result.blob, filename: result.filename }
    },
    onSourceReplaced: (next) => onFiles([next]),
  })

  const size = media ? editedSize(media, recipe) : null

  // 編集はいま映している元の映像に対して行うので、結果を見ていたら入力側に戻す
  const showSource = () => {
    if (showAfter) setShowAfter(false)
  }

  return (
    <div className="app">
      <Sidebar
        file={file}
        media={media}
        output={output}
        onOutputChange={setOutput}
        trim={recipe.trim}
        editedSize={size}
        renderEditStep={(index) => (
          <EditStep
            index={index}
            info={media}
            state={edits}
            cropping={cropping}
            onCroppingChange={(next) => {
              showSource()
              setCropping(next)
            }}
          />
        )}
        renderExportStep={(index) =>
          file && (
            <ExportStep index={index} file={file} info={media} recipe={committed} videoRef={videoRef} />
          )
        }
        onFileSelect={(selected) => onFiles([selected])}
        // 出力設定だけを戻す。編集は「編集をすべて取り消す」で戻す（こちらは取り消せる）
        onResetSettings={() => setOutput(DEFAULT_VIDEO_OUTPUT)}
        previewEstimate={previewEstimate}
        converting={job.running}
        progress={job.progress}
        hasResult={!!job.result}
        stale={stale}
        onConvert={() => void convert()}
        onCancel={job.cancel}
        save={save}
      />

      <div className="workspace">
        <div className="stage">
          {file ? (
            <VideoPreview
              file={file}
              videoRef={videoRef}
              recipe={recipe}
              dimensions={media?.dimensions ?? null}
              renderOverlay={(scale) =>
                media?.dimensions && (
                  <CropOverlay
                    recipe={recipe}
                    size={media.dimensions}
                    scale={scale}
                    editing={cropping && !showAfter}
                    onChange={(rect) => edits.preview({ type: 'crop', rect })}
                    onCommit={edits.commit}
                    label={m.cropArea}
                  />
                )
              }
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
            trim={recipe.trim}
            onTrimEdit={(action) => edits.edit({ type: 'trim', action })}
            onTrimPreview={(action) => edits.preview({ type: 'trim', action })}
            onTrimCommit={edits.commit}
            result={job.result}
            showAfter={showAfter}
            onToggleView={setShowAfter}
            converting={job.running}
            progress={job.progress}
            stale={stale}
            onConvert={() => void convert()}
            onCancel={job.cancel}
            save={save}
          />
        )}
      </div>
    </div>
  )
}

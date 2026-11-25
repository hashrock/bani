import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useReportUnsaved } from '../../app/leaveGuard'
import { useLocalDrop } from '../../app/useLocalDrop'
import { BottomBar } from '../../components/BottomBar'
import { FileUpload } from '../../components/FileUpload'
import { Sidebar } from '../../components/Sidebar'
import { VideoPreview } from '../../components/VideoPreview'
import { pickFiles } from '../../core/opened'
import { useRememberedChoice } from '../../core/usePersistentState'
import { isRectOrNull } from '../../core/session'
import { useSessionRecipe } from '../../core/useSessionRecipe'
import { useSave } from '../../core/useSave'
import { useConversionJob } from '../../hooks/useConversionJob'
import { useMediaInfo } from '../../hooks/useMediaInfo'
import { useSizeEstimate } from '../../hooks/useSizeEstimate'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import {
  DEFAULT_VIDEO_OUTPUT,
  defaultVideoOutput,
  editedSize,
  isSubtitleFile,
  loadSubtitleFile,
  mayBeSubtitle,
  outputDuration,
} from '../../media/video'
import type { VideoOutput, VideoRecipe } from '../../media/video'
import { createAbortError } from '../../utils/abort'
import type { EditPageProps } from '../types'
import { CropOverlay } from './CropOverlay'
import { EditStep } from './EditStep'
import { ExportStep } from './ExportStep'
import { videoMessages } from './messages'
import { SubtitleOverlay } from './SubtitleOverlay'
import { useVideoRecipe } from './useVideoRecipe'

/** 変換結果がいまのレシピと出力設定で作られたものかを比べるための鍵 */
const resultKey = (recipe: VideoRecipe, output: VideoOutput) => JSON.stringify([recipe, output])

/**
 * 動画 1 本を開き、編集（レシピ）と出力設定を決めて書き出す画面。
 * レシピは取り消し・やり直しの履歴で持ち、出力設定は別のファイルを開いても残す。
 */
export function VideoEditPage({ opened, isDragging, onFiles, onReopen, onDirtyChange, resumed }: EditPageProps) {
  const { t } = useI18n()
  const m = useLocalMessages(videoMessages)
  const file = opened?.file ?? null
  // 出力形式は、選ぶまでは元と同じ入れ物（MP4 / WebM）。選んだら別のファイルを開いても残す
  const derivedOutput = useMemo(() => (file ? defaultVideoOutput(file) : DEFAULT_VIDEO_OUTPUT), [file])
  const [output, setOutput, resetOutput] = useRememberedChoice<VideoOutput>('video.output', derivedOutput)
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
    onSaved: edits.markSaved,
    onSourceReplaced: onReopen,
  })
  useReportUnsaved(edits.dirty, onDirtyChange)
  // 作業を残し、入口から再開できるようにする（尺がわかってから、トリムが尺の内側なら当てる）
  useSessionRecipe('video', committed, {
    opened,
    resumed,
    enabled: !!file,
    dirty: edits.dirty,
    version: 1,
    ready: !!media,
    check: (saved, fresh) =>
      saved.trim.start >= 0 && saved.trim.end <= fresh.trim.end + 1e-3 && isRectOrNull(saved.crop),
    onResume: edits.restore,
  })

  const size = media ? editedSize(media, recipe) : null

  // 速さはプレビューの再生にも映す（音の高さの扱いも書き出しと同じにする）
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.defaultPlaybackRate = recipe.speed
    video.playbackRate = recipe.speed
    video.preservesPitch = recipe.preservePitch
  }, [recipe.speed, recipe.preservePitch, file])

  /** 字幕ファイルを読んでレシピに入れる（1 つだけ。入れ替えは取り消せる） */
  const addSubtitles = async (subtitleFile: File) => {
    try {
      const loaded = await loadSubtitleFile(subtitleFile)
      if (loaded.cues.length === 0) {
        toast.error(m.subtitlesEmpty(subtitleFile.name))
        return
      }
      edits.edit({ type: 'subtitles', subtitles: { name: loaded.name, cues: loaded.cues } })
      if (loaded.errors.length > 0) toast.warning(m.subtitlesSkipped(loaded.errors.length))
    } catch (error) {
      console.error('Subtitle load failed:', error)
      toast.error(m.subtitlesFailed(error instanceof Error ? error.message : String(error)))
    }
  }

  const pickSubtitles = async () => {
    const [picked] = await pickFiles({ accept: '.srt,.vtt,text/vtt,application/x-subrip' })
    if (picked) await addSubtitles(picked.file)
  }

  // 動画の上に落とした字幕は、開き直さずに足す。.srt は種類が空で届くことが多く、ドラッグ中は名前が読めないので
  // 空の種類も受け取り、落とされてから名前で選り分ける。字幕でないものが混ざっていたら、いつもどおり開き直す
  const subtitleDrop = useLocalDrop({
    enabled: !!file && !!media,
    accepts: (items) => items.length > 0 && items.every(mayBeSubtitle),
    onDrop: (dropped) => {
      if (dropped.every(({ file: item }) => isSubtitleFile(item))) void addSubtitles(dropped[0].file)
      else onFiles(dropped)
    },
  })

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
        // 見込みと目標サイズは書き出す長さで考えるので、速さで縮めた区間を渡す
        trim={{ start: 0, end: outputDuration(recipe) }}
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
            format={output.format}
            onAddSubtitles={() => void pickSubtitles()}
            videoRef={videoRef}
          />
        )}
        renderExportStep={(index) =>
          file && (
            <ExportStep index={index} file={file} info={media} recipe={committed} videoRef={videoRef} />
          )
        }
        onFileSelect={(selected) => onFiles([selected])}
        // 出力設定だけを戻す。編集は「編集をすべて取り消す」で戻す（こちらは取り消せる）
        onResetSettings={resetOutput}
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
        <div className={cn('stage', subtitleDrop.over && 'drop-target-active')} {...subtitleDrop.handlers}>
          {file ? (
            <VideoPreview
              file={file}
              videoRef={videoRef}
              recipe={recipe}
              dimensions={media?.dimensions ?? null}
              renderOverlay={(scale) =>
                media?.dimensions && (
                  <>
                    <CropOverlay
                      recipe={recipe}
                      size={media.dimensions}
                      scale={scale}
                      editing={cropping && !showAfter}
                      onChange={(rect) => edits.preview({ type: 'crop', rect })}
                      onCommit={edits.commit}
                      label={m.cropArea}
                    />
                    <SubtitleOverlay recipe={recipe} size={media.dimensions} scale={scale} videoRef={videoRef} />
                  </>
                )
              }
              result={job.result}
              converting={job.running}
              progress={job.progress}
              showAfter={showAfter}
              error={job.error}
              // 字幕を足せる場所の上では、開き直しの枠ではなく足す枠だけを出す
              isDragging={isDragging && !subtitleDrop.over}
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
          />
        )}
      </div>
    </div>
  )
}

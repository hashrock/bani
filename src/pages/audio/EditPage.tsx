import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { FileUpload } from '../../components/FileUpload'
import { isEditableTarget } from '../../core/useHotkey'
import { usePersistentState } from '../../core/usePersistentState'
import { useRecipeHistory } from '../../core/useRecipeHistory'
import { useSave } from '../../core/useSave'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import {
  AUDIO_FORMATS,
  AUDIO_FORMAT_LIST,
  NoAudioTrackError,
  applyAudioEdit,
  canEncodeAudioFormat,
  createAudioOutput,
  createAudioRecipe,
  loadWaveform,
  probeAudio,
  renderAudio,
} from '../../media/audio'
import type { AudioEdit, AudioFormat, AudioInfo, AudioOutput, AudioRecipe, AudioTrim } from '../../media/audio'
import { isAbortError } from '../../utils/abort'
import type { EditPageProps } from '../types'
import { AudioBottomBar } from './AudioBottomBar'
import { AudioSidebar } from './AudioSidebar'
import { effectiveRecipe, isSameAudioFormat, previewBaseGain, previewGainAt, usableOutput } from './logic'
import { audioMessages } from './messages'
import { useAudioPreview } from './useAudioPreview'
import { Waveform } from './Waveform'

/** 波形のピーク数。広い画面でも 1 列に 1 つ以上行き渡る数にしておく */
const WAVEFORM_BUCKETS = 4000

/** 区間のないレシピの代わり（読み込み前）。試聴のフックに渡すだけで使わない */
const EMPTY_TRIM: AudioTrim = { start: 0, end: 0 }

/** 音声 1 本を開き、切り出し・フェード・音量を決めて書き出す画面 */
export default function EditPage({ opened, isDragging, onFiles }: EditPageProps) {
  const { t } = useI18n()
  const m = useLocalMessages(audioMessages)
  const file = opened?.file ?? null

  const [info, setInfo] = useState<AudioInfo | null>(null)
  const [probeError, setProbeError] = useState<string | null>(null)
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [waveformError, setWaveformError] = useState(false)
  const [supported, setSupported] = useState<Record<AudioFormat, boolean> | null>(null)
  const [renderProgress, setRenderProgress] = useState<number | null>(null)
  const renderAbort = useRef<AbortController | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)

  const history = useRecipeHistory<AudioRecipe | null>(null)
  const { recipe, replace } = history
  // 出力設定は別のファイルを開いても、画面を行き来しても残す
  const [storedOutput, setOutput] = usePersistentState<AudioOutput>('audio.output', () =>
    createAudioOutput('mp3')
  )
  const output = usableOutput(storedOutput, supported, AUDIO_FORMAT_LIST)

  // 画面はファイルごとに作り直されるので、読み込みの片付けは中断だけでよい
  useEffect(() => {
    if (!file) return
    let cancelled = false
    const abort = new AbortController()
    probeAudio(file)
      .then((probed) => {
        if (cancelled) return
        setInfo(probed)
        replace(createAudioRecipe(probed))
        return loadWaveform(file, WAVEFORM_BUCKETS, { signal: abort.signal })
          .then((loaded) => !cancelled && setPeaks(loaded))
          .catch((err) => {
            if (cancelled || isAbortError(err)) return
            console.error('Failed to load waveform:', err)
            setWaveformError(true)
          })
      })
      .catch((err) => {
        if (cancelled) return
        console.error('Failed to read audio:', err)
        setProbeError(
          err instanceof NoAudioTrackError ? m.errorNoAudio : m.errorProbe(err instanceof Error ? err.message : String(err))
        )
      })
    return () => {
      cancelled = true
      abort.abort()
    }
    // 文言の言語が変わっても読み込み直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, replace])

  // 書き出せない形式は選べないようにする（AAC は OS 次第、MP3 / FLAC は同梱の WASM）
  useEffect(() => {
    let cancelled = false
    Promise.all(AUDIO_FORMAT_LIST.map((format) => canEncodeAudioFormat(format))).then((results) => {
      if (cancelled) return
      setSupported(
        Object.fromEntries(AUDIO_FORMAT_LIST.map((format, i) => [format, results[i]])) as Record<AudioFormat, boolean>
      )
    })
    return () => {
      cancelled = true
    }
  }, [])

  // URL の作成と破棄を同じ effect に置く。useMemo で作って effect で破棄すると、
  // StrictMode の付け外しで使用中の URL を捨ててしまう
  useEffect(() => {
    const audio = audioRef.current
    if (!file || !audio) return
    const url = URL.createObjectURL(file)
    audio.src = url
    return () => {
      audio.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [file])

  const onEdit = useCallback(
    (edit: AudioEdit) => {
      if (!info) return
      history.update((current) => (current ? applyAudioEdit(current, edit, info) : current))
    },
    // history.update は安定している
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info, history.update]
  )

  const onTrimCommit = useCallback(
    (trim: AudioTrim) => {
      if (!info) return
      // 区間をまとめて 1 段にする（始点と終点で 2 段に分けない）
      history.update((current) => {
        if (!current) return current
        const withStart = applyAudioEdit(current, { type: 'setTrimStart', time: trim.start }, info)
        return applyAudioEdit(withStart, { type: 'setTrimEnd', time: trim.end }, info)
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [info, history.update]
  )

  const duration = info?.duration ?? 0
  const baseGain = useMemo(
    () => (recipe ? previewBaseGain(recipe, peaks, duration) : 1),
    [recipe, peaks, duration]
  )
  const gainAt = useCallback(
    (time: number) => (recipe ? previewGainAt(recipe, time, baseGain) : 1),
    [recipe, baseGain]
  )

  const trim = recipe?.trim ?? EMPTY_TRIM
  const playback = useAudioPreview({
    audioRef,
    start: trim.start,
    end: trim.end,
    gainAt,
    mono: !!recipe?.mono && (info?.channels ?? 1) > 1,
  })

  // スペースで再生・一時停止。ボタンやつまみの上ではそれ自身の操作に任せる
  const { toggle } = playback
  useEffect(() => {
    if (!recipe) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return
      const target = event.target
      if (isEditableTarget(target)) return
      if (target instanceof HTMLElement && target.closest('button, [role="slider"], [role="radio"]')) return
      event.preventDefault()
      toggle()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [recipe, toggle])

  const save = useSave({
    opened,
    lossless: AUDIO_FORMATS[output.format].lossless,
    sameFormat:
      !!file && !!info && isSameAudioFormat({ name: file.name, type: file.type, codec: info.codec }, output.format),
    canCopy: false,
    disabled: !file || !recipe || supported === null,
    render: async () => {
      if (!file || !recipe) throw new DOMException('Nothing to save', 'AbortError')
      const controller = new AbortController()
      renderAbort.current = controller
      setRenderProgress(0)
      try {
        return await renderAudio(file, effectiveRecipe(recipe), output, {
          signal: controller.signal,
          onProgress: setRenderProgress,
        })
      } finally {
        renderAbort.current = null
        setRenderProgress(null)
      }
    },
    onSourceReplaced: (next) => onFiles([next]),
  })

  return (
    <div className="app">
      <AudioSidebar
        file={file}
        info={info}
        recipe={recipe}
        onEdit={onEdit}
        canUndo={history.canUndo}
        canRedo={history.canRedo}
        onUndo={history.undo}
        onRedo={history.redo}
        output={output}
        onOutputChange={setOutput}
        supported={supported}
        onFileSelect={(selected) => onFiles([selected])}
        save={save}
        renderProgress={renderProgress}
        onCancelRender={() => renderAbort.current?.abort()}
      />

      <div className="workspace">
        <div className="stage">
          {!file ? (
            <FileUpload
              isDragging={isDragging}
              message={m.dropHere}
              buttonLabel={t.selectFile}
              accept="audio/*"
              onFiles={onFiles}
            />
          ) : (
            // .preview-area は中身を中央に縮めて寄せるので、波形を横いっぱいに広げるためにここは自前で組む
            <main className={cn('flex min-h-0 flex-1 flex-col', isDragging && 'drop-target-active')}>
              {/* 試聴は元ファイルをそのまま鳴らし、編集は Web Audio でおおよそ掛ける */}
              <audio ref={audioRef} preload="auto" className="hidden" />
              {probeError ? (
                <p className="m-auto text-sm text-muted-foreground">{probeError}</p>
              ) : info && recipe ? (
                <Waveform
                  duration={duration}
                  peaks={peaks}
                  trim={recipe.trim}
                  currentTime={playback.currentTime}
                  gainAt={gainAt}
                  loading={!peaks && !waveformError}
                  error={waveformError}
                  onTrimCommit={onTrimCommit}
                  onSeek={playback.seek}
                />
              ) : (
                <p className="m-auto text-sm text-muted-foreground">{m.loadingWaveform}</p>
              )}
            </main>
          )}
        </div>

        {info && recipe && (
          <AudioBottomBar duration={duration} recipe={recipe} playback={playback} onEdit={onEdit} />
        )}
      </div>
    </div>
  )
}

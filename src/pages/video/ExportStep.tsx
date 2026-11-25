import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { ChevronDown, ClipboardCopyIcon, ImageDownIcon, MusicIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Step, StepHint } from '../../components/Step'
import { copyBlobToClipboard, saveFileAs } from '../../core/save'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import {
  AUDIO_FORMATS,
  AUDIO_FORMAT_LIST,
  applyAudioEdit,
  createAudioOutput,
  createAudioRecipe,
  probeAudio,
  renderAudio,
} from '../../media/audio'
import type { AudioFormat } from '../../media/audio'
import { captureFrame, frameFilename } from '../../media/video'
import type { VideoInfo, VideoRecipe } from '../../media/video'
import { isAbortError } from '../../utils/abort'
import { videoMessages } from './messages'

const AUDIO_LABELS: Record<AudioFormat, string> = {
  wav: 'WAV',
  mp3: 'MP3',
  m4a: 'M4A (AAC)',
  opus: 'Opus',
  flac: 'FLAC',
}

interface ExportStepProps {
  index: number
  file: File
  info: VideoInfo | null
  /** 書き出しに使うレシピ（履歴に積まれたもの） */
  recipe: VideoRecipe
  videoRef: RefObject<HTMLVideoElement | null>
}

/**
 * 動画からほかの種類を取り出す書き出し。いまのフレームを静止画に、トリムした区間の音声だけを音声ファイルに。
 * どちらもレシピ（切り抜き・回転・トリム）を反映する。保存は共通の保存（src/core/save.ts）を使う。
 */
export function ExportStep({ index, file, info, recipe, videoRef }: ExportStepProps) {
  const { t } = useI18n()
  const m = useLocalMessages(videoMessages)
  const [frameBusy, setFrameBusy] = useState(false)
  const [audioProgress, setAudioProgress] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // 画面を離れたら書き出し中の音声も止める
  useEffect(() => () => abortRef.current?.abort(), [])

  const hasVideo = !!info?.dimensions
  const hasAudio = !!info?.audioCodec

  const handleFrame = async (method: 'saveAs' | 'copy') => {
    const video = videoRef.current
    if (!video || frameBusy) return
    setFrameBusy(true)
    try {
      const blob = await captureFrame(video, recipe)
      if (method === 'copy') {
        await copyBlobToClipboard(blob)
        toast(t.copiedToClipboard)
      } else {
        const handle = await saveFileAs(blob, frameFilename(file.name, video.currentTime))
        if (handle) toast(t.savedTo(handle.name))
      }
    } catch (err) {
      if (isAbortError(err)) return
      console.error('Frame capture failed:', err)
      toast.error(m.frameFailed(err instanceof Error ? err.message : String(err)))
    } finally {
      setFrameBusy(false)
    }
  }

  const handleAudio = async (format: AudioFormat) => {
    if (audioProgress !== null) return
    const controller = new AbortController()
    abortRef.current = controller
    setAudioProgress(0)
    try {
      const audioInfo = await probeAudio(file)
      // 動画のトリムをそのまま音声の区間にする（どちらも元ファイルの時間軸の秒）
      const audioRecipe = [
        { type: 'setTrimEnd', time: recipe.trim.end } as const,
        { type: 'setTrimStart', time: recipe.trim.start } as const,
      ].reduce((current, edit) => applyAudioEdit(current, edit, audioInfo), createAudioRecipe(audioInfo))
      const rendered = await renderAudio(file, audioRecipe, createAudioOutput(format), {
        signal: controller.signal,
        onProgress: (progress) => setAudioProgress(Math.round(progress * 100)),
      })
      const handle = await saveFileAs(rendered.blob, rendered.filename)
      if (handle) toast(t.savedTo(handle.name))
    } catch (err) {
      if (isAbortError(err)) return
      console.error('Audio export failed:', err)
      toast.error(m.audioFailed(err instanceof Error ? err.message : String(err)))
    } finally {
      setAudioProgress(null)
      if (abortRef.current === controller) abortRef.current = null
    }
  }

  return (
    <Step index={index} title={m.stepMoreExports}>
      <div className="flex flex-col gap-1.5">
        <div className="text-xs font-medium">{m.frameTitle}</div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="xs"
            className="h-7 px-2.5"
            disabled={!hasVideo || frameBusy}
            onClick={() => void handleFrame('saveAs')}
          >
            <ImageDownIcon />
            {m.frameSave}
          </Button>
          <Button
            variant="outline"
            size="xs"
            className="h-7 px-2.5"
            disabled={!hasVideo || frameBusy}
            onClick={() => void handleFrame('copy')}
          >
            <ClipboardCopyIcon />
            {m.frameCopy}
          </Button>
        </div>
        <StepHint>{m.frameHint}</StepHint>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-xs font-medium">{m.audioTitle}</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="xs"
              className="h-7 self-start px-2.5"
              disabled={!hasAudio || audioProgress !== null}
              title={hasAudio ? undefined : m.noAudio}
            >
              <MusicIcon />
              {audioProgress !== null ? m.audioExporting(audioProgress) : m.audioExport}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {AUDIO_FORMAT_LIST.map((format) => (
              <DropdownMenuItem key={format} onSelect={() => void handleAudio(format)}>
                {AUDIO_LABELS[format]}
                <span className="ml-auto pl-4 text-[11px] text-muted-foreground">
                  .{AUDIO_FORMATS[format].extension}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <StepHint>{hasAudio ? m.audioHint : m.noAudio}</StepHint>
      </div>
    </Step>
  )
}

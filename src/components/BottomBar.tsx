import type { RefObject } from 'react'
import { PauseIcon, PlayIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import { useVideoPlayback } from '../hooks/useVideoPlayback'
import { useI18n } from '../i18n/context'
import { applyTrim, isWholeClip, trimDuration, trimFromSettings } from '../state/trim'
import type { TrimAction } from '../state/trim'
import type { ConversionResult, ConversionSettings, Trim } from '../types'
import { formatBytes, formatTimecode } from '../utils/format'
import { TimeField } from './TimeField'
import { Timeline } from './Timeline'
import type { SaveState } from '../core/useSave'
import { SaveButton } from './SaveButton'

interface BottomBarProps {
  file: File
  videoRef: RefObject<HTMLVideoElement | null>
  duration: number
  settings: ConversionSettings
  onSettingsChange: (settings: ConversionSettings) => void
  result: ConversionResult | null
  showAfter: boolean
  onToggleView: (showAfter: boolean) => void
  converting: boolean
  progress: number
  /** 変換後に設定を触ったか。再変換を促すために使う */
  stale: boolean
  onConvert: () => void
  onCancel: () => void
  save: SaveState
}

/**
 * 画面下の操作帯。切り出し区間の調整と、変換 → 確認 → 再変換の往復をここで完結させる。
 */
export function BottomBar({
  file,
  videoRef,
  duration,
  settings,
  onSettingsChange,
  result,
  showAfter,
  onToggleView,
  converting,
  progress,
  stale,
  onConvert,
  onCancel,
  save,
}: BottomBarProps) {
  const { t } = useI18n()
  const trim = trimFromSettings(settings, duration)
  const { start, end } = trim
  const hasTimeline = duration > 0

  const playback = useVideoPlayback({ videoRef, file, trim: hasTimeline ? trim : null })

  // 区間や再生位置をいじるのは変換前の映像に対してなので、結果を見ていたら入力側に戻す
  const showSource = () => {
    if (showAfter) onToggleView(false)
  }

  const setTrim = (next: Trim) => {
    showSource()
    onSettingsChange({ ...settings, startTime: next.start, endTime: next.end })
  }

  const dispatchTrim = (action: TrimAction) => setTrim(applyTrim(trim, duration, action))

  const seek = (time: number) => {
    showSource()
    playback.seek(time)
  }

  const togglePlay = () => {
    showSource()
    playback.toggle()
  }

  const compressionRatio = result
    ? (1 - result.convertedSize / result.originalSize) * 100
    : 0
  const compressionDisplay =
    compressionRatio > 0
      ? `-${compressionRatio.toFixed(1)}%`
      : compressionRatio < 0
        ? `+${Math.abs(compressionRatio).toFixed(1)}%`
        : '0%'

  return (
    <div className="bottom-bar">
      {hasTimeline && (
        <div className="trim-row">
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-full border-input hover:border-primary"
            onClick={togglePlay}
            title={playback.playing ? t.pause : t.play}
            aria-label={playback.playing ? t.pause : t.play}
          >
            {playback.playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
          </Button>
          <span className="transport-time">
            {formatTimecode(playback.currentTime)}
            <span className="text-muted-foreground"> / {formatTimecode(duration)}</span>
          </span>

          <Timeline
            duration={duration}
            trim={trim}
            currentTime={playback.currentTime}
            onTrimChange={setTrim}
            onSeek={seek}
          />

          <span className="trim-length" title={t.trimmedLength}>
            {formatTimecode(trimDuration(trim))}
          </span>
        </div>
      )}

      <div className="adjust-row">
        {hasTimeline && (
          <div className="flex flex-wrap items-center gap-1.5">
            <TimeField
              label={t.trimIn}
              value={start}
              onChange={(time) => dispatchTrim({ type: 'setStart', time })}
            />
            <Button
              variant="outline"
              size="xs"
              onClick={() => dispatchTrim({ type: 'setStart', time: playback.currentTime })}
              title={t.setInTitle}
            >
              {t.setInToPlayhead}
            </Button>

            <TimeField
              label={t.trimOut}
              value={end}
              onChange={(time) => dispatchTrim({ type: 'setEnd', time })}
            />
            <Button
              variant="outline"
              size="xs"
              onClick={() => dispatchTrim({ type: 'setEnd', time: playback.currentTime })}
              title={t.setOutTitle}
            >
              {t.setOutToPlayhead}
            </Button>

            <Button
              variant="outline"
              size="xs"
              onClick={() => dispatchTrim({ type: 'wholeClip' })}
              disabled={isWholeClip(trim, duration)}
              title={t.wholeClipTitle}
            >
              {t.wholeClip}
            </Button>
          </div>
        )}

        <div className="result-actions">
          {converting && (
            <>
              <Progress value={progress} className="h-1 w-[120px]" />
              <span className="min-w-9 text-xs text-muted-foreground tabular-nums">{progress}%</span>
              <Button variant="destructive" size="sm" onClick={onCancel}>
                {t.cancel}
              </Button>
            </>
          )}

          {!converting && result && (
            <>
              <ToggleGroup
                type="single"
                spacing={1}
                className="rounded-md bg-secondary p-[3px]"
                value={showAfter ? 'after' : 'before'}
                // 押し直しで両方が外れないよう、空の値は無視する
                onValueChange={(value) => value && onToggleView(value === 'after')}
              >
                <ToggleGroupItem value="before" size="sm" className={compareItemClass}>
                  {t.before}
                  <span className="text-[10px] opacity-70">{formatBytes(result.originalSize)}</span>
                </ToggleGroupItem>
                <ToggleGroupItem value="after" size="sm" className={compareItemClass}>
                  {t.after}
                  <span className="text-[10px] opacity-70">{formatBytes(result.convertedSize)}</span>
                  <span
                    className={cn(
                      'rounded-sm px-1.5 py-0.5 text-[10px]',
                      compressionRatio < 0 ? 'bg-destructive/25' : 'bg-success/25'
                    )}
                  >
                    {compressionDisplay}
                  </span>
                </ToggleGroupItem>
              </ToggleGroup>

              {/* 設定を変えたあとは、結果が古いことを塗りつぶしで示す */}
              <Button
                variant={stale ? 'default' : 'outline'}
                size="sm"
                className="border-primary"
                onClick={onConvert}
                title={stale ? t.reconvertTitleStale : t.reconvertTitle}
              >
                {stale ? `● ${t.reconvert}` : t.reconvert}
              </Button>
              <SaveButton save={save} className="w-auto" />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** 変換前後の切り替え。選ばれている側を白く浮かせる */
const compareItemClass =
  'h-7 gap-1.5 px-2.5 text-xs text-muted-foreground hover:bg-transparent data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs'

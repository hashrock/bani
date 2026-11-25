import { PauseIcon, PlayIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TimeField } from '../../components/TimeField'
import { useI18n } from '../../i18n/context'
import type { AudioEdit, AudioRecipe } from '../../media/audio'
import { trimmedLength } from '../../media/audio'
import { formatTimecode } from '../../utils/format'
import type { AudioPreview } from './useAudioPreview'

interface AudioBottomBarProps {
  duration: number
  recipe: AudioRecipe
  playback: AudioPreview
  onEdit: (edit: AudioEdit) => void
}

/** 画面下の操作帯。再生と、切り出し区間の数値での調整 */
export function AudioBottomBar({ duration, recipe, playback, onEdit }: AudioBottomBarProps) {
  const { t } = useI18n()
  const { start, end } = recipe.trim
  const whole = start === 0 && end >= duration

  return (
    <div className="bottom-bar">
      <div className="adjust-row">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon-sm"
            className="rounded-full border-input hover:border-primary"
            onClick={playback.toggle}
            title={`${playback.playing ? t.pause : t.play} (Space)`}
            aria-label={playback.playing ? t.pause : t.play}
          >
            {playback.playing ? <PauseIcon className="fill-current" /> : <PlayIcon className="fill-current" />}
          </Button>
          <span className="transport-time">
            {formatTimecode(playback.currentTime)}
            <span className="text-muted-foreground"> / {formatTimecode(duration)}</span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <TimeField
            label={t.trimIn}
            value={start}
            onChange={(time) => onEdit({ type: 'setTrimStart', time })}
          />
          <Button
            variant="outline"
            size="xs"
            onClick={() => onEdit({ type: 'setTrimStart', time: playback.currentTime })}
            title={t.setInTitle}
          >
            {t.setInToPlayhead}
          </Button>

          <TimeField
            label={t.trimOut}
            value={end}
            onChange={(time) => onEdit({ type: 'setTrimEnd', time })}
          />
          <Button
            variant="outline"
            size="xs"
            onClick={() => onEdit({ type: 'setTrimEnd', time: playback.currentTime })}
            title={t.setOutTitle}
          >
            {t.setOutToPlayhead}
          </Button>

          <Button
            variant="outline"
            size="xs"
            onClick={() => onEdit({ type: 'resetTrim' })}
            disabled={whole}
            title={t.wholeClipTitle}
          >
            {t.wholeClip}
          </Button>
        </div>

        <span className="trim-length ml-auto" title={t.trimmedLength}>
          {formatTimecode(trimmedLength(recipe))}
        </span>
      </div>
    </div>
  )
}

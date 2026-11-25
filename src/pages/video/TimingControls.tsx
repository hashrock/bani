import { useId, useState } from 'react'
import type { RefObject } from 'react'
import { CaptionsIcon, CrosshairIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Chip, IconButton, SwitchField } from '../../components/SidebarParts'
import { StepHint } from '../../components/Step'
import { useLocalMessages } from '../../i18n/local'
import { VIDEO_SPEED_PRESETS, cuesForOutput, effectiveSubtitleMode } from '../../media/video'
import type { VideoEdit, VideoFormat, VideoInfo, VideoRecipe, VideoSubtitleMode } from '../../media/video'
import { videoMessages } from './messages'

/** 小見出し。編集の手順の中を区切る */
function SubHeading({ children }: { children: string }) {
  return <div className="text-xs font-medium">{children}</div>
}

/** 速さ（再生速度）と、音の高さを保つか */
export function SpeedControl({
  recipe,
  info,
  edit,
}: {
  recipe: VideoRecipe
  info: VideoInfo | null
  edit: (edit: VideoEdit) => void
}) {
  const m = useLocalMessages(videoMessages)
  const hasAudio = !!info?.audioCodec && !recipe.muted
  return (
    <div className="flex flex-col gap-1.5">
      <SubHeading>{m.speed}</SubHeading>
      <div className="flex flex-wrap gap-1">
        {VIDEO_SPEED_PRESETS.map((speed) => (
          <Chip
            key={speed}
            active={recipe.speed === speed}
            disabled={!info}
            onClick={() => edit({ type: 'speed', speed })}
          >
            {m.speedLabel(speed)}
          </Chip>
        ))}
      </div>
      {recipe.speed !== 1 && hasAudio && (
        <SwitchField
          label={m.preservePitch}
          hint={m.preservePitchHint}
          checked={recipe.preservePitch}
          onChange={(preserve) => edit({ type: 'preservePitch', preserve })}
        />
      )}
    </div>
  )
}

/**
 * 秒の入力。打っている途中（「-」「1.」など）は数にせず、確定（離れる・Enter）したら渡す。
 * レシピ側で値が変わったら（取り消し・合わせるボタン）、呼び出し側が key を変えて作り直す
 */
function SecondsInput({ id, ms, onCommit }: { id: string; ms: number; onCommit: (ms: number) => void }) {
  const [text, setText] = useState(() => formatSeconds(ms))
  const commit = () => {
    const value = Number(text)
    if (text.trim() !== '' && Number.isFinite(value)) onCommit(value * 1000)
    else setText(formatSeconds(ms))
  }
  return (
    <Input
      id={id}
      inputMode="decimal"
      className="h-7 w-20 px-2 text-xs tabular-nums md:text-xs"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
      }}
    />
  )
}

const formatSeconds = (ms: number) => String(Math.round(ms) / 1000)

/** 字幕の追加・ずらし・入れ方 */
export function SubtitlesControl({
  recipe,
  info,
  format,
  edit,
  onAdd,
  videoRef,
}: {
  recipe: VideoRecipe
  info: VideoInfo | null
  format: VideoFormat
  edit: (edit: VideoEdit) => void
  onAdd: () => void
  videoRef: RefObject<HTMLVideoElement | null>
}) {
  const m = useLocalMessages(videoMessages)
  const offsetId = useId()
  const subtitles = recipe.subtitles
  const nudges = [-1000, -100, 100, 1000]

  if (!subtitles) {
    return (
      <div className="flex flex-col gap-1.5">
        <SubHeading>{m.subtitles}</SubHeading>
        <Button variant="outline" size="xs" className="h-7 self-start px-2.5" disabled={!info} onClick={onAdd}>
          <CaptionsIcon />
          {m.subtitlesAdd}
        </Button>
        <StepHint>{m.subtitlesHint}</StepHint>
      </div>
    )
  }

  const mode = effectiveSubtitleMode(subtitles.mode, format)
  const inRange = cuesForOutput(subtitles, recipe.trim, recipe.speed).length
  const first = subtitles.cues[0]

  return (
    <div className="flex flex-col gap-1.5">
      <SubHeading>{m.subtitles}</SubHeading>
      <div className="flex items-center gap-1.5 text-xs">
        <CaptionsIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate" title={subtitles.name}>
          {subtitles.name}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">{m.subtitlesCount(subtitles.cues.length)}</span>
        <IconButton label={m.subtitlesRemove} onClick={() => edit({ type: 'subtitles', subtitles: null })}>
          <XIcon />
        </IconButton>
      </div>

      <div className="flex flex-wrap items-center gap-1">
        <label htmlFor={offsetId} className="mr-1 text-[11px] text-muted-foreground">
          {m.subtitlesOffset}
        </label>
        <SecondsInput
          key={subtitles.offset}
          id={offsetId}
          ms={subtitles.offset}
          onCommit={(offset) => edit({ type: 'subtitleOffset', offset })}
        />
        {nudges.map((delta) => (
          <Button
            key={delta}
            variant="ghost"
            size="xs"
            className="h-7 px-1.5 text-[11px] tabular-nums"
            onClick={() => edit({ type: 'subtitleOffset', offset: subtitles.offset + delta })}
          >
            {delta > 0 ? '+' : '−'}
            {Math.abs(delta) / 1000}
          </Button>
        ))}
      </div>
      {first && (
        <Button
          variant="ghost"
          size="xs"
          className="h-7 self-start px-1.5 text-[11px] text-muted-foreground"
          onClick={() => {
            const video = videoRef.current
            if (video) edit({ type: 'subtitleOffset', offset: video.currentTime * 1000 - first.start })
          }}
        >
          <CrosshairIcon />
          {m.subtitlesAlign}
        </Button>
      )}
      <StepHint>{m.subtitlesOffsetHint}</StepHint>

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        className="self-start"
        value={mode}
        // 押し直しで両方が外れないよう、空の値は無視する
        onValueChange={(value) => value && edit({ type: 'subtitleMode', mode: value as VideoSubtitleMode })}
      >
        <ToggleGroupItem value="burn" className="h-7 px-2.5 text-xs">
          {m.subtitlesBurn}
        </ToggleGroupItem>
        <ToggleGroupItem value="embed" className="h-7 px-2.5 text-xs" disabled={format === 'gif'}>
          {m.subtitlesEmbed}
        </ToggleGroupItem>
      </ToggleGroup>
      <StepHint>
        {format === 'gif' ? m.subtitlesGifHint : mode === 'burn' ? m.subtitlesBurnHint : m.subtitlesEmbedHint}
      </StepHint>
      {inRange === 0 && <StepHint>{m.subtitlesOutside}</StepHint>}
    </div>
  )
}

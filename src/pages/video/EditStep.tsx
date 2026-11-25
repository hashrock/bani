import {
  CropIcon,
  FlipHorizontal2Icon,
  FlipVertical2Icon,
  Redo2Icon,
  RotateCcwIcon,
  RotateCwIcon,
  Undo2Icon,
  VolumeXIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { Step, StepHint } from '../../components/Step'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import { editedSize, isIdentityRecipe } from '../../media/video'
import type { VideoInfo } from '../../media/video'
import { videoMessages } from './messages'
import type { VideoRecipeState } from './useVideoRecipe'

const modKey = () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+')

interface EditStepProps {
  index: number
  info: VideoInfo | null
  state: VideoRecipeState
  cropping: boolean
  onCroppingChange: (cropping: boolean) => void
}

/** 編集（取り消し・回転・反転・切り抜き・音声の除去）の手順。トリムは下のタイムラインで行う */
export function EditStep({ index, info, state, cropping, onCroppingChange }: EditStepProps) {
  const { t } = useI18n()
  const m = useLocalMessages(videoMessages)
  const { recipe, edit } = state
  const disabled = !info
  const hasVideo = !!info?.dimensions
  const hasAudio = !!info?.audioCodec
  const size = info ? editedSize(info, recipe) : null

  return (
    <Step index={index} title={m.stepEdit}>
      <div className="flex flex-wrap items-center gap-1">
        <IconButton label={`${t.undo} (${modKey()}Z)`} onClick={state.undo} disabled={!state.canUndo}>
          <Undo2Icon />
        </IconButton>
        <IconButton label={`${t.redo} (${modKey()}⇧Z)`} onClick={state.redo} disabled={!state.canRedo}>
          <Redo2Icon />
        </IconButton>
        <span className="mx-1 h-5 w-px bg-border" />
        <IconButton
          label={m.rotateLeft}
          onClick={() => edit({ type: 'rotate', turns: -1 })}
          disabled={disabled || !hasVideo}
        >
          <RotateCcwIcon />
        </IconButton>
        <IconButton
          label={m.rotateRight}
          onClick={() => edit({ type: 'rotate', turns: 1 })}
          disabled={disabled || !hasVideo}
        >
          <RotateCwIcon />
        </IconButton>
        <IconToggle
          label={m.flipH}
          pressed={recipe.flipH}
          onPressedChange={() => edit({ type: 'flipH' })}
          disabled={disabled || !hasVideo}
        >
          <FlipHorizontal2Icon />
        </IconToggle>
        <IconToggle
          label={m.flipV}
          pressed={recipe.flipV}
          onPressedChange={() => edit({ type: 'flipV' })}
          disabled={disabled || !hasVideo}
        >
          <FlipVertical2Icon />
        </IconToggle>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Toggle
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          pressed={cropping}
          onPressedChange={onCroppingChange}
          disabled={disabled || !hasVideo}
        >
          <CropIcon />
          {cropping ? m.cropDone : m.crop}
        </Toggle>
        {recipe.crop && (
          <Button
            variant="ghost"
            size="xs"
            className="text-muted-foreground"
            onClick={() => edit({ type: 'crop', rect: null })}
          >
            {m.cropClear}
          </Button>
        )}
      </div>
      {cropping && <StepHint>{m.cropHint}</StepHint>}

      <Toggle
        variant="outline"
        size="sm"
        className="h-7 self-start px-2 text-xs"
        pressed={recipe.muted}
        onPressedChange={(muted) => edit({ type: 'mute', muted })}
        disabled={disabled || !hasAudio}
        title={hasAudio ? undefined : m.noAudio}
      >
        <VolumeXIcon />
        {m.mute}
      </Toggle>

      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {m.editedSize}
          {size && (
            <strong className="ml-1.5 text-foreground tabular-nums">
              {size.width}×{size.height}
            </strong>
          )}
        </span>
        {info && !isIdentityRecipe(recipe, info) && (
          <Button
            variant="link"
            size="xs"
            className="h-auto px-0 text-[11px] font-normal text-muted-foreground underline"
            onClick={() => edit({ type: 'reset' })}
          >
            {m.resetEdits}
          </Button>
        )}
      </div>
    </Step>
  )
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Button
      variant="outline"
      size="icon-sm"
      className="size-7"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </Button>
  )
}

function IconToggle({
  label,
  pressed,
  onPressedChange,
  disabled,
  children,
}: {
  label: string
  pressed: boolean
  onPressedChange: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <Toggle
      variant="outline"
      size="sm"
      className="size-7 min-w-7 px-0"
      pressed={pressed}
      onPressedChange={onPressedChange}
      disabled={disabled}
      title={label}
      aria-label={label}
    >
      {children}
    </Toggle>
  )
}

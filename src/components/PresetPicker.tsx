import { useState } from 'react'
import { BookmarkIcon, CheckIcon, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  MAX_PRESET_NAME_LENGTH,
  addPreset,
  applyPresetSettings,
  deletePreset,
  newPresetId,
  presetName,
  presetsFor,
  renamePreset,
  sameSettings,
  settingsForSaving,
} from '../core/presets'
import type { Preset, PresetKind, PresetSettingsMap } from '../core/presets'
import { usePersistentState } from '../core/usePersistentState'
import { usePresets } from '../core/usePresets'
import { useI18n } from '../i18n/context'
import { defineMessages, useLocalMessages } from '../i18n/local'
import { AUDIO_FORMATS } from '../media/audio/output'
import type { AudioOutput } from '../media/audio/types'
import { IMAGE_FORMATS } from '../media/image/output'
import type { ImageOutput } from '../media/image/output'
import type { VideoSize } from '../media/video/recipe'
import type { VideoOutput } from '../media/video/types'
import { formatBytes } from '../utils/format'
import { LinkButton } from './SidebarParts'

const messages = defineMessages({
  ja: {
    label: 'プリセット',
    none: 'プリセットなし',
    modified: '（変更あり）',
    builtIn: '組み込み',
    saved: '保存したもの',
    saveCurrent: 'いまの設定をプリセットに保存…',
    updateCurrent: (name: string) => `「${name}」をいまの設定で上書き`,
    rename: '名前を変更',
    remove: '削除',
    namePlaceholder: 'プリセットの名前',
    save: '保存',
    cancel: 'キャンセル',
    savedToast: (name: string) => `プリセット「${name}」を保存しました`,
    updatedToast: (name: string) => `プリセット「${name}」を上書きしました`,
    removedToast: (name: string) => `プリセット「${name}」を削除しました`,
    undo: '元に戻す',
    upTo: (value: string) => `${value} 以下`,
    shortSide: (px: number) => `${px}p 以下`,
    quality: (value: number) => `画質 ${value}%`,
    fps: (value: number) => `${value} fps`,
    original: '元の解像度',
  },
  en: {
    label: 'Preset',
    none: 'No preset',
    modified: ' (modified)',
    builtIn: 'Built-in',
    saved: 'Saved',
    saveCurrent: 'Save current settings as preset…',
    updateCurrent: (name: string) => `Overwrite “${name}” with current settings`,
    rename: 'Rename',
    remove: 'Delete',
    namePlaceholder: 'Preset name',
    save: 'Save',
    cancel: 'Cancel',
    savedToast: (name: string) => `Saved preset “${name}”`,
    updatedToast: (name: string) => `Updated preset “${name}”`,
    removedToast: (name: string) => `Deleted preset “${name}”`,
    undo: 'Undo',
    upTo: (value: string) => `≤ ${value}`,
    shortSide: (px: number) => `≤ ${px}p`,
    quality: (value: number) => `Quality ${value}%`,
    fps: (value: number) => `${value} fps`,
    original: 'Original resolution',
  },
})

type PickerMessages = (typeof messages)['ja']

/** プリセットの中身を 1 行で（MP4 · 720p 以下 · 20 MB 以下） */
function summarize<K extends PresetKind>(kind: K, settings: PresetSettingsMap[K], m: PickerMessages): string {
  const parts: string[] = []
  if (kind === 'video') {
    const video = settings as VideoOutput
    parts.push(video.format.toUpperCase())
    if (video.format === 'gif') parts.push(m.fps(video.fps ?? 10))
    else parts.push(m.quality(video.quality))
    if (video.width || video.height) parts.push(`${video.width ?? 'auto'}×${video.height ?? 'auto'}`)
    else if (video.maxShortSide) parts.push(m.shortSide(video.maxShortSide))
    else parts.push(m.original)
    if (video.targetSize && video.format !== 'gif') parts.push(m.upTo(formatBytes(video.targetSize)))
  } else if (kind === 'image') {
    const image = settings as ImageOutput
    parts.push(IMAGE_FORMATS[image.format].extension.toUpperCase())
    if (IMAGE_FORMATS[image.format].lossy) {
      parts.push(m.quality(image.quality))
      if (image.targetBytes) parts.push(m.upTo(formatBytes(image.targetBytes)))
    }
  } else {
    const audio = settings as AudioOutput
    parts.push(AUDIO_FORMATS[audio.format].extension.toUpperCase())
    if (!AUDIO_FORMATS[audio.format].lossless) parts.push(`${Math.round(audio.bitrate / 1000)} kbps`)
  }
  return parts.join(' · ')
}

/** 最後に当てたプリセットと、当てた直後の設定。あとで設定を触ったかを比べる */
interface Applied<K extends PresetKind> {
  id: string
  settings: PresetSettingsMap[K]
}

interface PresetPickerProps<K extends PresetKind> {
  kind: K
  /**
   * どのプリセットを当てたかを覚える場所（画面ごとに一意。`video`、`convert.video` など）。
   * 出力設定と同じく、別のファイルを開いても画面を行き来しても残す
   */
  scope: string
  value: PresetSettingsMap[K]
  onChange: (settings: PresetSettingsMap[K]) => void
  /** 動画の解像度の基準（切り抜き・回転のあと）。わかれば短い辺の上限を幅・高さに直して当てる */
  dimensions?: VideoSize | null
}

/**
 * 出力の手順の先頭に置くプリセットの選択。選ぶと出力設定をまとめて置き換える（編集ではないので履歴には積まない）。
 * 当てたあとに設定を触ると「（変更あり）」を添える。保存・名前の変更・削除もここで行う。
 */
export function PresetPicker<K extends PresetKind>({
  kind,
  scope,
  value,
  onChange,
  dimensions = null,
}: PresetPickerProps<K>) {
  const { lang } = useI18n()
  const m = useLocalMessages(messages)
  const [saved, updateSaved] = usePresets()
  const [applied, setApplied] = usePersistentState<Applied<K> | null>(`preset.${scope}`, null)
  // 名前の入力欄。新しく保存するときは id なし、名前を変えるときはその id
  const [editing, setEditing] = useState<{ id: string | null; name: string } | null>(null)

  const presets = presetsFor(kind, saved)
  const selected = applied ? (presets.find((preset) => preset.id === applied.id) ?? null) : null
  const modified = !!selected && !!applied && !sameSettings(kind, value, applied.settings)

  const apply = (preset: Preset<K>) => {
    const next = applyPresetSettings(kind, preset.settings, dimensions)
    setApplied({ id: preset.id, settings: next })
    onChange(next)
  }

  const commitName = () => {
    if (!editing) return
    const name = editing.name
    if (editing.id === null) {
      const settings = settingsForSaving(kind, value, dimensions)
      if (!settings) return
      const id = newPresetId()
      updateSaved((current) => addPreset(current, kind, name, settings, id))
      // 保存した直後は、いまの設定がそのプリセットそのもの
      setApplied({ id, settings: value })
      toast(m.savedToast(name.trim()))
    } else {
      const id = editing.id
      updateSaved((current) => renamePreset(current, id, name))
    }
    setEditing(null)
  }

  const overwrite = (preset: Preset<K>) => {
    const settings = settingsForSaving(kind, value, dimensions)
    if (!settings) return
    updateSaved((current) => current.map((item) => (item.id === preset.id ? { ...item, settings } : item)))
    setApplied({ id: preset.id, settings: value })
    toast(m.updatedToast(presetName(preset, lang)))
  }

  const remove = (preset: Preset<K>) => {
    const before = saved
    updateSaved((current) => deletePreset(current, preset.id))
    setApplied(null)
    // 確かめの画面を挟まず、消したあとで戻せるようにする
    toast(m.removedToast(presetName(preset, lang)), {
      action: { label: m.undo, onClick: () => updateSaved(() => before) },
    })
  }

  const builtIns = presets.filter((preset) => preset.builtIn)
  const userPresets = presets.filter((preset) => !preset.builtIn)

  const item = (preset: Preset<K>) => (
    <DropdownMenuItem key={preset.id} onSelect={() => apply(preset)} className="items-start">
      <CheckIcon className={selected?.id === preset.id ? 'mt-0.5' : 'invisible mt-0.5'} />
      <div className="flex min-w-0 flex-col">
        <span className="truncate">{presetName(preset, lang)}</span>
        <span className="text-[11px] text-muted-foreground">{summarize(kind, preset.settings, m)}</span>
      </div>
    </DropdownMenuItem>
  )

  return (
    <div className="flex flex-col gap-1.5" data-preset-picker={scope}>
      {editing ? (
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            commitName()
          }}
        >
          <Input
            autoFocus
            aria-label={m.namePlaceholder}
            placeholder={m.namePlaceholder}
            maxLength={MAX_PRESET_NAME_LENGTH}
            className="h-7 flex-1 px-2 text-xs md:text-xs"
            value={editing.name}
            onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                // サイドバーの外の Esc（選択を外すなど）まで届かせない
                event.stopPropagation()
                setEditing(null)
              }
            }}
          />
          <Button type="submit" size="xs" className="h-7 px-2.5" disabled={!editing.name.trim()}>
            {m.save}
          </Button>
          <Button type="button" variant="ghost" size="xs" className="h-7 px-2" onClick={() => setEditing(null)}>
            {m.cancel}
          </Button>
        </form>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="xs" className="h-7 w-full justify-start gap-1.5 px-2.5" aria-label={m.label}>
              <BookmarkIcon className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-left">
                {selected ? presetName(selected, lang) : m.none}
                {modified && <span className="text-muted-foreground">{m.modified}</span>}
              </span>
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-(--radix-dropdown-menu-trigger-width) min-w-72">
            {builtIns.length > 0 && (
              <>
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">{m.builtIn}</DropdownMenuLabel>
                {builtIns.map(item)}
              </>
            )}
            {userPresets.length > 0 && (
              <>
                {builtIns.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuLabel className="text-[11px] text-muted-foreground">{m.saved}</DropdownMenuLabel>
                {userPresets.map(item)}
              </>
            )}
            {presets.length > 0 && <DropdownMenuSeparator />}
            {selected && !selected.builtIn && modified && (
              <DropdownMenuItem onSelect={() => overwrite(selected)}>
                {m.updateCurrent(presetName(selected, lang))}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setEditing({ id: null, name: '' })}>{m.saveCurrent}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {selected && !editing && (
        <div className="flex items-center gap-3">
          <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">
            {summarize(kind, selected.settings, m)}
          </span>
          {!selected.builtIn && (
            <>
              <LinkButton
                className="text-[11px]"
                onClick={() => setEditing({ id: selected.id, name: presetName(selected, lang) })}
              >
                {m.rename}
              </LinkButton>
              <LinkButton className="text-[11px]" onClick={() => remove(selected)}>
                {m.remove}
              </LinkButton>
            </>
          )}
        </div>
      )}
    </div>
  )
}

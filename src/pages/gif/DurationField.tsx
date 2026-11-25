import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SmallButton } from '../../components/SidebarParts'
import { useLocalMessages } from '../../i18n/local'
import { messages } from './messages'

/**
 * 表示時間の入力。打っている途中では編集を積まず（取り消しが 1 文字ずつにならないように）、
 * Enter か「選んだフレームに」で選んだフレームへ、「全部に適用」で全フレームへ当てる。
 * value は選んだフレームの表示時間（ばらばらなら null）
 */
export function DurationField({
  value,
  disabled,
  hasSelection,
  onApply,
  onApplyAll,
}: {
  value: number | null
  disabled: boolean
  hasSelection: boolean
  onApply: (duration: number) => void
  onApplyAll: (duration: number) => void
}) {
  const m = useLocalMessages(messages)
  // 外から値が変わったら（別のフレームを選んだ・取り消した）打ちかけの値を捨てる
  const [draft, setDraft] = useState<{ base: number | null; text: string } | null>(null)
  const text = draft && draft.base === value ? draft.text : value === null ? '' : String(value)
  const parsed = Number(text.trim())
  const valid = text.trim() !== '' && Number.isFinite(parsed)

  const apply = (all: boolean) => {
    if (!valid) return
    setDraft(null)
    if (all || !hasSelection) onApplyAll(parsed)
    else onApply(parsed)
  }

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor="gif-duration" className="text-[11px] font-normal text-muted-foreground">
        {m.durationLabel}
      </Label>
      <Input
        id="gif-duration"
        type="number"
        inputMode="numeric"
        min={20}
        step={10}
        disabled={disabled}
        className="h-7 px-2 text-xs md:text-xs"
        placeholder={value === null ? m.durationMixed : undefined}
        value={text}
        onChange={(event) => setDraft({ base: value, text: event.currentTarget.value })}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            apply(false)
          }
        }}
      />
      {/* 入力欄の幅が選択の有無で変わらないよう、ボタンは下の段に置く */}
      <div className="flex flex-wrap gap-1.5">
        {hasSelection && (
          <SmallButton disabled={disabled || !valid} onClick={() => apply(false)}>
            {m.durationApply}
          </SmallButton>
        )}
        <SmallButton disabled={disabled || !valid} onClick={() => apply(true)}>
          {m.durationApplyAll}
        </SmallButton>
      </div>
    </div>
  )
}

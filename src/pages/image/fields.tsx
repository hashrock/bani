import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** 手順の中の小見出し */
export function FieldLabel({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-medium text-muted-foreground">{children}</div>
}

/**
 * 数値の入力。打っている途中の値で編集を積むと、取り消しが 1 文字ずつになってしまうので、
 * 確定（フォーカスを外す・Enter）したときだけ onCommit を呼ぶ。空欄は null。
 */
export function NumberField({
  id,
  label,
  value,
  placeholder,
  min,
  max,
  disabled,
  onCommit,
}: {
  id: string
  label: string
  value: number | null
  placeholder?: string
  min?: number
  max?: number
  disabled?: boolean
  onCommit: (value: number | null) => void
}) {
  const commit = (text: string) => {
    const trimmed = text.trim()
    if (trimmed === '') return onCommit(null)
    const parsed = Number(trimmed)
    if (Number.isFinite(parsed)) onCommit(parsed)
  }
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <Label htmlFor={id} className="text-[11px] font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        // 外から値が変わったら（取り消し・回転など）入力欄を作り直して表示を合わせる
        key={String(value ?? '')}
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        disabled={disabled}
        className="h-8 px-2 text-[13px] md:text-[13px]"
        placeholder={placeholder}
        defaultValue={value ?? ''}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
        }}
      />
    </div>
  )
}

/**
 * 色の選択。選んでいるあいだ（input）はプレビューだけを変え、
 * 選び終えたとき（change）に 1 回だけ確定する。React の onChange は input で発火するので、change は自前で拾う。
 */
export function ColorField({
  value,
  label,
  onPreview,
  onCommit,
}: {
  value: string
  label: string
  onPreview: (color: string) => void
  onCommit: (color: string) => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const commitRef = useRef(onCommit)
  useEffect(() => {
    commitRef.current = onCommit
  })
  useEffect(() => {
    const input = ref.current
    if (!input) return
    const onChange = () => commitRef.current(input.value)
    input.addEventListener('change', onChange)
    return () => input.removeEventListener('change', onChange)
  }, [])
  return (
    <input
      ref={ref}
      type="color"
      aria-label={label}
      title={label}
      className="h-6 w-8 cursor-pointer rounded border border-input bg-transparent p-0.5"
      value={value}
      onChange={(event) => onPreview(event.currentTarget.value)}
    />
  )
}

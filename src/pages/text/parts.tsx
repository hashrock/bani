import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { solidOnClass } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** サイドバーの小さな部品。動画画面の Sidebar.tsx と同じ見た目にそろえる */

/** 名前と値を左右に振り分けた 1 行 */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  )
}

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-1 text-xs">{children}</dl>
}

/** 項目の名前（左）と操作（右）を 1 行に置く */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

/** 選択肢の多いもの（文字コード・言語）は、場所を取らないドロップダウンにする */
export function Choice<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  ariaLabel: string
  className?: string
}) {
  const current = options.find((option) => option.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="xs" className={cn('h-7 justify-between gap-1 px-2.5', className)} aria-label={ariaLabel}>
          <span className="truncate">{current?.label ?? value}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="text-xs">
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** 少ない選択肢の切り替え。押し直しで選択が外れないよう、空の値は無視する */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  className,
}: {
  value: T
  options: readonly { value: T; label: string; title?: string }[]
  onChange: (value: T) => void
  disabled?: boolean
  className?: string
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      spacing={0}
      className={className}
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const found = options.find((option) => option.value === next)
        if (found) onChange(found.value)
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          title={option.title}
          className={cn('h-7 min-w-0 flex-1 px-2 text-[11px]', solidOnClass)}
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

export function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs">
      <input
        type="checkbox"
        className="mt-0.5 size-3.5 shrink-0 accent-black"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  )
}

/** 保存の前に気づいてほしいこと */
export function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-2 text-[11px] leading-normal text-destructive">
      {children}
    </div>
  )
}

/** 道具のボタン。サイドバーの幅に 2 つずつ並べる */
export function ToolButton({
  onClick,
  disabled,
  children,
  title,
}: {
  onClick: () => void
  disabled?: boolean
  children: ReactNode
  title?: string
}) {
  return (
    <Button variant="outline" size="xs" className="h-7 justify-start px-2.5" onClick={onClick} disabled={disabled} title={title}>
      {children}
    </Button>
  )
}

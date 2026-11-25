import { useId } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { Redo2, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Switch } from '@/components/ui/switch'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'
import { modKey } from '../core/useHotkey'
import { useI18n } from '../i18n/context'
import { StepHint } from './Step'

/*
 * サイドバーの小さな部品。どの画面も同じ見た目・同じ並びになるよう、ここから使う。
 */

/** 入力の手順に出すファイル名（または件数）。長い名前は 1 行で切る */
export function SourceName({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="truncate text-[13px] font-semibold" title={title}>
      {children}
    </div>
  )
}

/** 名前と値を左右に振り分けた 1 行 */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="truncate text-right tabular-nums">{children}</dd>
    </div>
  )
}

export function Facts({ className, children }: { className?: string; children: ReactNode }) {
  return <dl className={cn('flex flex-col gap-1 text-xs', className)}>{children}</dl>
}

/** 手順の下に置く、設定を初期値に戻す控えめな操作 */
export function ResetSettingsButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n()
  return (
    <Button
      variant="link"
      size="xs"
      className="mx-4 mt-3.5 h-auto px-0 text-[11px] font-normal text-muted-foreground underline hover:text-foreground"
      onClick={onClick}
    >
      {t.resetSettings}
    </Button>
  )
}

/** 手順の中の控えめな文字だけの操作（「編集をすべて取り消す」など） */
export function LinkButton({ className, ...props }: ComponentProps<typeof Button>) {
  return (
    <Button
      variant="link"
      size="xs"
      className={cn(
        'h-auto self-start px-0 text-[11px] font-normal text-muted-foreground underline hover:text-foreground',
        className
      )}
      {...props}
    />
  )
}

/** 手順の中の小さなボタン（ファイルを選択・追加など） */
export function SmallButton({ variant = 'outline', className, ...props }: ComponentProps<typeof Button>) {
  return <Button variant={variant} size="xs" className={cn('h-7 px-2.5', className)} {...props} />
}

/** 絵だけのボタン。名前は title と読み上げに出す */
export function IconButton({
  label,
  children,
  ...props
}: { label: string } & Omit<ComponentProps<typeof Button>, 'aria-label'>) {
  return (
    <Button variant="outline" size="icon-sm" className="size-7" aria-label={label} title={label} {...props}>
      {children}
    </Button>
  )
}

/** 絵だけの押し切りボタン（左右反転など、レシピの中のオン・オフ） */
export function IconToggle({
  label,
  pressed,
  onPressedChange,
  disabled,
  children,
}: {
  label: string
  pressed: boolean
  onPressedChange: (pressed: boolean) => void
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

/** 区切りの縦線。編集の手順で、取り消し・やり直しとほかの操作を分ける */
export function ToolbarDivider() {
  return <span className="mx-0.5 h-5 w-px self-center bg-border" aria-hidden="true" />
}

/**
 * 取り消し・やり直し。どの画面でも「編集」の手順のいちばん左に置く（⌘Z / ⇧⌘Z と同じ操作）
 */
export function HistoryButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
}) {
  const { t } = useI18n()
  return (
    <>
      <IconButton label={`${t.undo} (${modKey()}Z)`} onClick={onUndo} disabled={!canUndo}>
        <Undo2 />
      </IconButton>
      <IconButton label={`${t.redo} (${modKey()}⇧Z)`} onClick={onRedo} disabled={!canRedo}>
        <Redo2 />
      </IconButton>
    </>
  )
}

/** プリセットの押しボタン。手入力で外れることもあるので ToggleGroup ではなく押しボタンにする */
export function Chip({
  active,
  onClick,
  disabled,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  disabled?: boolean
  title?: string
  children: ReactNode
}) {
  return (
    <Button
      variant={active ? 'default' : 'outline'}
      size="xs"
      className="gap-1 rounded-full px-2.5 text-[11px]"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

/** 手順の中に出す注意書き。読み直した・断った・位置情報があるなど、操作の前に知っておくべきこと */
export function Notice({
  children,
  tone = 'info',
  icon,
}: {
  children: ReactNode
  tone?: 'info' | 'warn'
  icon?: ReactNode
}) {
  return (
    <div
      role="note"
      className={cn(
        'flex items-start gap-1.5 rounded-md px-2.5 py-2 text-[11px] leading-normal',
        tone === 'warn'
          ? 'border border-destructive/30 bg-destructive/5 text-destructive'
          : 'bg-muted text-muted-foreground'
      )}
    >
      {icon && <span className="mt-px shrink-0">{icon}</span>}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

/** 「出力の見込み」の囲み。中に EstimateRow を並べる */
export function EstimateBox({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1.5 rounded-md bg-muted px-3 py-2.5">{children}</div>
}

export function EstimateRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between text-xs text-muted-foreground">
      <span>{label}</span>
      <strong className="text-[13px] text-foreground tabular-nums">{children}</strong>
    </div>
  )
}

/** チェックボックスと名前の 1 行。保存のしかたなど、決めたら置いておく設定に使う */
export function CheckboxField({
  checked,
  onChange,
  disabled,
  children,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  children: ReactNode
}) {
  const id = useId()
  return (
    <div className="flex items-start gap-2 text-xs">
      <Checkbox
        id={id}
        className="mt-px size-3.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <label htmlFor={id} className={cn('cursor-pointer', disabled && 'opacity-50')}>
        {children}
      </label>
    </div>
  )
}

/** 名前とスイッチの 1 行。レシピの中のオン・オフ（ノーマライズ、音声の除去など）に使う */
export function SwitchField({
  label,
  hint,
  checked,
  disabled = false,
  onChange,
  title,
}: {
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
  title?: string
}) {
  const id = useId()
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2 text-xs" title={title}>
        <label htmlFor={id} className={cn('cursor-pointer text-muted-foreground', disabled && 'opacity-50')}>
          {label}
        </label>
        <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      </div>
      {hint && <StepHint>{hint}</StepHint>}
    </div>
  )
}

/**
 * サイドバーの下端。走っている処理があれば進み具合と中止を、なければ保存の操作を出す。
 * どの画面もこの形にそろえ、保存ボタンがスクロールで隠れないようにする。
 */
export function SidebarFooter({
  progress,
  onCancel,
  children,
}: {
  /** 走っている処理の進み具合（0〜100）。何も走っていなければ null */
  progress: number | null
  onCancel?: () => void
  children?: ReactNode
}) {
  const { t } = useI18n()
  return (
    <div className="sidebar-footer">
      {progress !== null ? (
        <>
          <Progress value={progress} className="h-1" />
          <Button variant="destructive" className="w-full" onClick={onCancel} disabled={!onCancel}>
            {t.cancelWithProgress(Math.round(progress))}
          </Button>
        </>
      ) : (
        children
      )}
    </div>
  )
}

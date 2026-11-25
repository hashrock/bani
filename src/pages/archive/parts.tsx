import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

/** 名前と値を左右に振り分けた 1 行（動画のサイドバーと同じ見た目） */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  )
}

export function Facts({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-1 text-xs">{children}</dl>
}

/** 手順の中に出す注意書き。読み直した・断ったなど、操作の前に知っておくべきこと */
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' }) {
  return (
    <p
      className={cn(
        'rounded-md px-2.5 py-2 text-[11px] leading-normal',
        tone === 'warn' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'
      )}
    >
      {children}
    </p>
  )
}

export interface SplitAction {
  key: string
  label: string
  run: () => void
}

/** 主の操作を大きく出し、ほかの方法を右のドロップダウンに置くボタン（保存ボタンと同じ形） */
export function SplitButton({
  primary,
  others,
  disabled,
  moreLabel,
  variant = 'default',
}: {
  primary: SplitAction
  others: SplitAction[]
  disabled?: boolean
  moreLabel: string
  variant?: 'default' | 'outline'
}) {
  return (
    <div className="flex w-full" data-slot="button-group">
      <Button
        variant={variant}
        className={cn('flex-1', others.length > 0 && 'rounded-r-none')}
        disabled={disabled}
        onClick={primary.run}
      >
        {primary.label}
      </Button>
      {others.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={variant}
              className={cn(
                'rounded-l-none px-2',
                variant === 'default' ? 'border-l border-l-primary-foreground/20' : 'border-l-0'
              )}
              disabled={disabled}
              aria-label={moreLabel}
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {others.map((action) => (
              <DropdownMenuItem key={action.key} onSelect={action.run}>
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

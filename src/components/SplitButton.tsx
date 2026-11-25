import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface SplitAction {
  key: string
  label: string
  run: () => void
  /** 押す前に知っておくとよいこと（ショートカットなど） */
  title?: string
}

/**
 * 主の操作を大きく出し、ほかの方法を右のドロップダウンに置くボタン。
 * 保存（SaveButton）・複数ファイルの保存・展開がみなこの形を使う。
 */
export function SplitButton({
  primary,
  others,
  moreLabel,
  disabled = false,
  variant = 'default',
  className,
}: {
  primary: SplitAction
  others: readonly SplitAction[]
  /** ドロップダウンを開くボタンの読み上げ名 */
  moreLabel: string
  disabled?: boolean
  variant?: 'default' | 'outline'
  className?: string
}) {
  return (
    <div className={cn('flex w-full', className)} data-slot="button-group">
      <Button
        variant={variant}
        className={cn('min-w-0 flex-1', others.length > 0 && 'rounded-r-none')}
        disabled={disabled}
        onClick={primary.run}
        title={primary.title}
      >
        <span className="truncate">{primary.label}</span>
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
              title={moreLabel}
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          {/* 開くボタンは細いので、幅は中身に合わせる（「クリップボードにコピー」が折り返さないように） */}
          <DropdownMenuContent align="end" className="w-max min-w-44">
            {others.map((action) => (
              <DropdownMenuItem
                key={action.key}
                className="whitespace-nowrap"
                title={action.title}
                onSelect={action.run}
              >
                {action.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

import { ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { SaveMethod } from '../core/save'
import type { SaveState } from '../core/useSave'
import { useI18n } from '../i18n/context'
import type { Messages } from '../i18n/messages'

const LABEL: Record<SaveMethod, keyof Messages> = {
  overwrite: 'saveOverwrite',
  saveAs: 'saveAs',
  copyToClipboard: 'saveCopyToClipboard',
}

const modKey = () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+')

/**
 * 全画面で共通の保存ボタン。主の方法（⌘S）を大きく出し、ほかの方法は右のドロップダウンに置く。
 * どちらが主になるかは useSave（src/core/save.ts の planSave）が決める。
 */
export function SaveButton({
  save,
  disabled = false,
  className,
}: {
  save: SaveState
  disabled?: boolean
  className?: string
}) {
  const { t } = useI18n()
  const label = (method: SaveMethod) => t[LABEL[method]] as string
  const { plan, busy, run } = save
  const off = disabled || busy

  return (
    <div className={`flex w-full ${className ?? ''}`} data-slot="button-group">
      <Button
        className="flex-1 rounded-r-none"
        onClick={() => void run(plan.primary)}
        disabled={off}
        title={`${label(plan.primary)} (${modKey()}S)`}
      >
        {busy ? t.saving : label(plan.primary)}
      </Button>
      {plan.others.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="rounded-l-none border-l border-l-primary-foreground/20 px-2"
              disabled={off}
              aria-label={t.saveMore}
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {plan.others.map((method) => (
              <DropdownMenuItem key={method} onSelect={() => void run(method)}>
                {label(method)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

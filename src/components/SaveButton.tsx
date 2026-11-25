import { modKey } from '../core/useHotkey'
import type { SaveState } from '../core/useSave'
import { useI18n } from '../i18n/context'
import { SplitButton } from './SplitButton'

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
  const { plan, busy, run, labelOf } = save
  return (
    <SplitButton
      className={className}
      disabled={disabled || busy}
      moreLabel={t.saveMore}
      primary={{
        key: plan.primary,
        label: busy ? t.saving : labelOf(plan.primary),
        title: `${labelOf(plan.primary)} (${modKey()}S)`,
        run: () => void run(plan.primary),
      }}
      others={plan.others.map((method) => ({
        key: method,
        label: labelOf(method),
        run: () => void run(method),
      }))}
    />
  )
}

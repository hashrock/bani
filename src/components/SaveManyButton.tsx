import { canPickFolder, planSaveMany } from '../core/save'
import type { SaveManyMethod } from '../core/save'
import { useI18n } from '../i18n/context'
import { SplitButton } from './SplitButton'

/**
 * 複数のファイルを保存するボタン（一括変換・PDF の分割・展開）。
 * フォルダを選べるならフォルダが主で、ZIP にまとめる・1 つずつダウンロードはドロップダウンに置く。
 * 主の文言は画面が決めてよい（「3 ファイルを変換」「選んだ 5 件を展開」など）。
 */
export function SaveManyButton({
  count,
  onSave,
  primaryLabel,
  disabled = false,
  variant = 'default',
}: {
  count: number
  onSave: (method: SaveManyMethod) => void
  /** 主のボタンの文言。省略すれば方法の名前 */
  primaryLabel?: (method: SaveManyMethod) => string
  disabled?: boolean
  variant?: 'default' | 'outline'
}) {
  const { t } = useI18n()
  const plan = planSaveMany({ canPickFolder: canPickFolder(), count })
  const labelOf = (method: SaveManyMethod) =>
    method === 'folder' ? t.saveManyFolder : method === 'zip' ? t.saveManyZip : t.saveManyEach(count)
  return (
    <SplitButton
      variant={variant}
      disabled={disabled}
      moreLabel={t.saveMore}
      primary={{
        key: plan.primary,
        label: primaryLabel ? primaryLabel(plan.primary) : labelOf(plan.primary),
        title: labelOf(plan.primary),
        run: () => onSave(plan.primary),
      }}
      others={plan.others.map((method) => ({ key: method, label: labelOf(method), run: () => onSave(method) }))}
    />
  )
}

import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { useI18n } from '../i18n/context'

/** 入力の手順に出すファイル名（または件数）。長い名前は 1 行で切る */
export function SourceName({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="truncate text-[13px] font-semibold" title={title}>
      {children}
    </div>
  )
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

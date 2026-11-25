import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { Capabilities } from '../app/intake'
import { MEDIA_KINDS, formatRoute } from '../app/routes'
import { HubLayout } from '../components/HubLayout'
import { ResumeSessions } from '../components/ResumeSessions'
import { pickFiles } from '../core/opened'
import type { OpenedFile } from '../core/opened'
import { useI18n } from '../i18n/context'

interface HubPageProps {
  capabilities: Capabilities
  isDragging: boolean
  onFiles: (files: OpenedFile[]) => void
  /** 「前回の作業を再開」で選んだセッション */
  onResume: (id: string) => void
}

/** 入口。とりあえずファイルを落とせば、種類と数に合った画面へ進む */
export function HubPage({ capabilities, isDragging, onFiles, onResume }: HubPageProps) {
  const { t } = useI18n()

  return (
    <HubLayout>
      <p className="text-xl leading-normal font-semibold">{t.hubTagline}</p>

      {/* 領域全体を押せるようにして、ドロップとクリックのどちらでも入れるようにする */}
      <button
        type="button"
        className={cn(
          'flex flex-col items-center gap-3 rounded-[10px] border-2 border-dashed border-input bg-background px-6 py-14 transition-colors hover:border-primary hover:bg-muted/40 focus-visible:border-primary focus-visible:outline-none',
          isDragging && 'border-primary bg-muted/40'
        )}
        onClick={async () => {
          const picked = await pickFiles({ multiple: true })
          if (picked.length > 0) onFiles(picked)
        }}
      >
        <span className="text-base font-semibold">{t.hubDrop}</span>
        <span className="text-center text-xs leading-relaxed text-muted-foreground">
          {t.hubDropHint}
        </span>
        <span className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'h-7 px-2.5')}>{t.hubPick}</span>
      </button>

      <ResumeSessions onResume={onResume} />

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-2">
        {MEDIA_KINDS.map((kind) => {
          const canEdit = capabilities.edit.includes(kind)
          const canConvert = capabilities.convert.includes(kind)
          const available = canEdit || canConvert
          return (
            <li key={kind}>
              <Card
                size="sm"
                className={cn(
                  'h-full flex-row items-center justify-between gap-2 px-3.5 py-3 text-[13px]',
                  // 未対応の種類は枠だけ残して沈め、対応済みのものと見分けやすくする
                  !available && 'bg-transparent text-muted-foreground shadow-none'
                )}
              >
                <span className="font-semibold">{t.kindLabel[kind]}</span>
                {available ? (
                  <span className="flex shrink-0 gap-2.5 text-xs whitespace-nowrap">
                    {canEdit && (
                      <a className="underline underline-offset-2" href={formatRoute({ name: 'edit', kind })}>
                        {t.hubEdit}
                      </a>
                    )}
                    {canConvert && (
                      <a className="underline underline-offset-2" href={formatRoute({ name: 'convert' })}>
                        {t.hubConvert}
                      </a>
                    )}
                  </span>
                ) : (
                  <span className="text-[11px]">{t.hubComingSoon}</span>
                )}
              </Card>
            </li>
          )
        })}
      </ul>
    </HubLayout>
  )
}

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { useI18n } from '../i18n/context'
import serviceLimits from '../serviceLimits.json'
import { formatBytes } from '../utils/format'
import { Caret } from './Caret'

interface CompatibilityListProps {
  estimatedSize: number
  /** トリム後の長さ（秒） */
  duration: number
}

function checkServices(estimatedSize: number, duration: number) {
  return serviceLimits.services.map((service) => {
    const tierResults = service.limits.map((limit) => {
      const sizeOk = estimatedSize <= limit.maxSize
      const durationOk = !limit.maxDuration || duration <= limit.maxDuration
      return {
        ...limit,
        compatible: sizeOk && durationOk,
        sizeExceeded: !sizeOk,
        durationExceeded: !durationOk,
      }
    })
    return {
      ...service,
      compatible: tierResults.some((tier) => tier.compatible),
      // 通る中でいちばん条件の緩くないプラン＝一覧の先頭にある通過プラン
      passingTier: tierResults.find((tier) => tier.compatible)?.tier ?? null,
      tierResults,
    }
  })
}

function StatusDot({ ok, title }: { ok: boolean; title?: string }) {
  return (
    <span
      className={cn('size-[7px] shrink-0 rounded-full', ok ? 'bg-success' : 'bg-destructive')}
      title={title}
    />
  )
}

/**
 * 推定サイズが各サービスの投稿上限に収まるかの一覧。
 * ふだんは合否の数だけを出し、内訳はサービスごとに開いて確かめる。
 */
export function CompatibilityList({ estimatedSize, duration }: CompatibilityListProps) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  // 内訳は一度に 1 サービスだけ開き、一覧が縦に伸びすぎないようにする
  const [openService, setOpenService] = useState<string | null>(null)

  const services = checkServices(estimatedSize, duration)
  const okCount = services.filter((service) => service.compatible).length

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-md border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 bg-muted/70 px-2.5 py-[7px] text-left text-xs hover:bg-secondary">
        <Caret open={open} />
        <span className="font-semibold">{t.compatTitle}</span>
        <span className="text-muted-foreground tabular-nums">
          {okCount}/{services.length}
        </span>
        <span className="ml-auto flex gap-[3px]">
          {services.map((service) => (
            <StatusDot key={service.name} ok={service.compatible} title={service.name} />
          ))}
        </span>
      </CollapsibleTrigger>

      <CollapsibleContent className="flex flex-col divide-y divide-secondary border-t border-secondary">
        {services.map((service) => {
          const expanded = openService === service.name
          return (
            <Collapsible
              key={service.name}
              open={expanded}
              onOpenChange={(next) => setOpenService(next ? service.name : null)}
            >
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 bg-background px-2.5 py-1.5 text-left text-xs hover:bg-muted/50">
                <StatusDot ok={service.compatible} />
                <span className="font-medium">{service.name}</span>
                <span className="ml-auto text-[11px] text-muted-foreground">
                  {service.passingTier ?? t.compatExceeded}
                </span>
                <Caret open={expanded} />
              </CollapsibleTrigger>

              <CollapsibleContent className="divide-y divide-muted border-t border-secondary">
                {service.tierResults.map((tier, index) => (
                  <div
                    key={index}
                    className={cn(
                      'flex items-center justify-between gap-2 py-[5px] pr-2.5 pl-[22px] text-[11px]',
                      tier.compatible ? 'bg-success/10' : 'bg-destructive/10'
                    )}
                  >
                    <span className="font-medium">
                      {tier.compatible ? '✓' : '✗'} {tier.tier}
                    </span>
                    <span className="flex items-center gap-[5px] whitespace-nowrap text-muted-foreground">
                      <Limit exceeded={tier.sizeExceeded}>{formatBytes(tier.maxSize)}</Limit>
                      {tier.maxDuration && (
                        <>
                          <span className="text-input">•</span>
                          <Limit exceeded={tier.durationExceeded}>
                            {Math.floor(tier.maxDuration / 60)}m
                            {tier.maxDuration % 60 > 0 ? ` ${tier.maxDuration % 60}s` : ''}
                          </Limit>
                        </>
                      )}
                    </span>
                  </div>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )
        })}
      </CollapsibleContent>
    </Collapsible>
  )
}

/** 上限のひとつ。超えた条件は打ち消し線で示す */
function Limit({ exceeded, children }: { exceeded: boolean; children: ReactNode }) {
  return (
    <span className={cn(exceeded && 'font-semibold text-destructive line-through')}>{children}</span>
  )
}

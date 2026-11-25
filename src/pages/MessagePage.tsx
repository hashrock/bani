import { Button } from '@/components/ui/button'
import { formatRoute } from '../app/routes'
import { HubLayout } from '../components/HubLayout'
import { useI18n } from '../i18n/context'

/** 準備中の画面や、見つからない画面に出す案内 */
export function MessagePage({ title, body }: { title: string; body?: string }) {
  const { t } = useI18n()
  return (
    <HubLayout className="items-start justify-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      {body && <p className="text-[13px] leading-relaxed text-muted-foreground">{body}</p>}
      <Button asChild variant="outline" size="xs" className="h-7 px-2.5">
        <a href={formatRoute({ name: 'hub' })}>{t.backToHub}</a>
      </Button>
    </HubLayout>
  )
}

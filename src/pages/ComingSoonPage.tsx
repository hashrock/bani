import type { MediaKind } from '../app/routes'
import { useI18n } from '../i18n/context'
import { MessagePage } from './MessagePage'

export function ComingSoonPage({ kind }: { kind: MediaKind }) {
  const { t } = useI18n()
  return <MessagePage title={t.comingSoonTitle(t.kindLabel[kind])} body={t.comingSoonBody} />
}

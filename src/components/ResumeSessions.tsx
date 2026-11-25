import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { sessionMessages } from '../app/sessionMessages'
import type { SessionSummary } from '../core/session'
import { deleteSession, listSessions, storageEstimate } from '../core/sessionStore'
import { useI18n } from '../i18n/context'
import { useLocalMessages } from '../i18n/local'
import { formatBytes } from '../utils/format'

/** 入口に出す「前回の作業を再開」。残っている作業がなければ何も出さない */
export function ResumeSessions({ onResume }: { onResume: (id: string) => void }) {
  const { t, lang } = useI18n()
  const m = useLocalMessages(sessionMessages)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)

  useEffect(() => {
    let cancelled = false
    void listSessions().then((found) => {
      if (!cancelled) setSessions(found)
    })
    void storageEstimate().then((found) => {
      if (!cancelled) setEstimate(found)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (sessions.length === 0) return null
  const time = new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' })

  const remove = async (id: string) => {
    setSessions((current) => current.filter((session) => session.id !== id))
    await deleteSession(id)
    setEstimate(await storageEstimate())
  }

  return (
    <section className="flex flex-col gap-2" aria-labelledby="resume-sessions-title">
      <h2 id="resume-sessions-title" className="text-sm font-semibold">
        {m.title}
      </h2>
      <ul className="flex flex-col gap-2">
        {sessions.map((session) => (
          <li key={session.id}>
            <Card size="sm" className="flex-row items-center gap-2 px-3.5 py-2.5 text-[13px]">
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-semibold" title={session.name}>
                  {session.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t.kindLabel[session.kind]} · {time.format(session.updatedAt)}
                  {session.bytes > 0 && ` · ${formatBytes(session.bytes)}`}
                </span>
              </div>
              <Button size="sm" aria-label={m.resumeLabel(session.name)} onClick={() => onResume(session.id)}>
                {m.resume}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={m.removeLabel(session.name)}
                onClick={() => void remove(session.id)}
              >
                {m.remove}
              </Button>
            </Card>
          </li>
        ))}
      </ul>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {m.note}
        {estimate && ` ${m.storage(formatBytes(estimate.usage), formatBytes(estimate.quota))}`}
      </p>
    </section>
  )
}

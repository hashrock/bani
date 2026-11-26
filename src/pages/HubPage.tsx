import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { AudioLines, FileArchive, FileCode, FileText, Film, Image, Images, Layers, Pencil, ShieldCheck, Upload } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Capabilities } from '../app/intake'
import { shellMessages } from '../app/messages'
import { MEDIA_KINDS, formatRoute } from '../app/routes'
import type { MediaKind } from '../app/routes'
import { HubLayout } from '../components/HubLayout'
import { ResumeSessions } from '../components/ResumeSessions'
import { pickFiles } from '../core/opened'
import type { OpenedFile } from '../core/opened'
import { useI18n } from '../i18n/context'
import { useLocalMessages } from '../i18n/local'
import { KIND_FORMATS, hubMessages } from './hubMessages'

const KIND_ICONS: Record<MediaKind, LucideIcon> = {
  video: Film,
  audio: AudioLines,
  image: Image,
  gif: Images,
  pdf: FileText,
  text: FileCode,
  archive: FileArchive,
}

function FormatChips({ formats }: { formats: readonly string[] }) {
  return (
    <ul className="flex flex-wrap gap-1">
      {formats.map((format) => (
        <li key={format} className="rounded border bg-muted/60 px-1.5 py-px font-mono text-[10.5px] leading-4">
          {format}
        </li>
      ))}
    </ul>
  )
}

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
  const shell = useLocalMessages(shellMessages)
  const hub = useLocalMessages(hubMessages)

  return (
    <HubLayout className="max-w-[1040px]">
      <div className="flex flex-col gap-1.5">
        <p className="text-2xl leading-normal font-semibold">{t.hubTagline}</p>
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <ShieldCheck className="size-3.5 text-success" aria-hidden />
          {hub.private}
        </p>
      </div>

      {/* 領域全体を押せるようにして、ドロップとクリックのどちらでも入れるようにする */}
      <button
        type="button"
        className={cn(
          'flex flex-col items-center gap-3 rounded-[10px] border-2 border-dashed border-input bg-background px-6 py-10 transition-colors hover:border-primary hover:bg-muted/40 focus-visible:border-primary focus-visible:outline-none',
          isDragging && 'border-primary bg-muted/40'
        )}
        onClick={async () => {
          const picked = await pickFiles({ multiple: true })
          if (picked.length > 0) onFiles(picked)
        }}
      >
        <span className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Upload className="size-5" aria-hidden />
        </span>
        <span className="text-base font-semibold">{t.hubDrop}</span>
        <span className="text-center text-xs leading-relaxed text-muted-foreground">
          {t.hubDropHint}
        </span>
        <span className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'h-7 px-2.5')}>{t.hubPick}</span>
      </button>

      <ResumeSessions onResume={onResume} />

      <section className="flex flex-col gap-3" aria-labelledby="hub-kinds-title">
        <h2 id="hub-kinds-title" className="text-sm font-semibold">
          {hub.kindsTitle}
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-3">
          {MEDIA_KINDS.map((kind) => {
            const canEdit = capabilities.edit.includes(kind)
            const canConvert = capabilities.convert.includes(kind)
            const available = canEdit || canConvert
            const Icon = KIND_ICONS[kind]
            const formats = KIND_FORMATS[kind]
            return (
              <li key={kind}>
                <Card
                  size="sm"
                  className={cn(
                    'h-full gap-3 px-4 py-4 text-[13px]',
                    // 未対応の種類は枠だけ残して沈め、対応済みのものと見分けやすくする
                    !available && 'bg-transparent text-muted-foreground shadow-none'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className={'flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground'}>
                      <Icon className="size-[18px]" aria-hidden />
                    </span>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-sm font-semibold">{t.kindLabel[kind]}</span>
                      <span className="text-xs leading-relaxed text-muted-foreground">
                        {hub.kindDescription[kind]}
                      </span>
                    </div>
                  </div>

                  <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-[11px]">
                    <dt className="text-muted-foreground">{hub.inputs}</dt>
                    <dd>
                      <FormatChips formats={formats.inputs} />
                    </dd>
                    <dt className="text-muted-foreground">{hub.outputs}</dt>
                    <dd>
                      <FormatChips formats={formats.outputs} />
                    </dd>
                  </dl>

                  <div className="mt-auto flex gap-2 pt-1">
                    {available ? (
                      <>
                        {canEdit && (
                          <a
                            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'gap-1.5')}
                            href={formatRoute({ name: 'edit', kind })}
                          >
                            <Pencil className="size-3.5" aria-hidden />
                            {t.hubEdit}
                          </a>
                        )}
                        {canConvert && (
                          <a
                            className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'gap-1.5')}
                            href={formatRoute({ name: 'convert' })}
                          >
                            <Layers className="size-3.5" aria-hidden />
                            {t.hubConvert}
                          </a>
                        )}
                      </>
                    ) : (
                      <span className="text-[11px]">{t.hubComingSoon}</span>
                    )}
                  </div>
                </Card>
              </li>
            )
          })}
        </ul>
      </section>

      <footer className="mt-auto pt-4 text-center text-xs text-muted-foreground">
        <a className="hit-area underline underline-offset-2 hover:text-foreground" href={formatRoute({ name: 'about' })}>
          {shell.aboutLink}
        </a>
      </footer>
    </HubLayout>
  )
}

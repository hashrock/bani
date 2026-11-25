import { useState } from 'react'
import { packages, texts, version } from 'virtual:bani-licenses'
import type { LicenseEntry } from 'virtual:bani-licenses'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Caret } from '../../components/Caret'
import { HubLayout } from '../../components/HubLayout'
import { Notice } from '../../components/SidebarParts'
import { useLocalMessages } from '../../i18n/local'
import { aboutMessages } from './messages'

const SOURCE_URL = 'https://github.com/hashrock/bani'

/** 外へのリンク。押したときだけ新しいタブで開き、この画面からは何も取りに行かない */
function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a className="hit-area break-all underline underline-offset-2" href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  )
}

function LicenseItem({ entry }: { entry: LicenseEntry }) {
  const m = useLocalMessages(aboutMessages)
  const [open, setOpen] = useState(false)
  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/60">
          <Caret open={open} />
          <span className="min-w-0 flex-1 truncate font-semibold">
            {entry.name}
            {entry.version && <span className="ml-1.5 font-normal text-muted-foreground">{entry.version}</span>}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{entry.license}</span>
        </CollapsibleTrigger>
        {/* 閉じているあいだは本文を描かない（全部で 100KB ほどある） */}
        <CollapsibleContent className="flex flex-col gap-2 px-3 pt-1 pb-3 pl-8 text-xs">
          {entry.embeddedIn && <p className="text-muted-foreground">{m.embeddedIn(entry.embeddedIn)}</p>}
          {entry.author && (
            <p>
              <span className="text-muted-foreground">{m.author}: </span>
              {entry.author}
            </p>
          )}
          {entry.homepage && (
            <p>
              <span className="text-muted-foreground">{m.homepage}: </span>
              <ExternalLink href={entry.homepage}>{entry.homepage}</ExternalLink>
            </p>
          )}
          {entry.text !== undefined ? (
            <pre className="max-h-72 overflow-auto rounded-md bg-muted p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
              {texts[entry.text]}
            </pre>
          ) : (
            !entry.embeddedIn && <p className="text-muted-foreground">{m.noText}</p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}

function LicenseList({ entries }: { entries: readonly LicenseEntry[] }) {
  return (
    <ul className="divide-y divide-secondary overflow-hidden rounded-md border bg-background">
      {entries.map((entry) => (
        <LicenseItem key={`${entry.name}@${entry.version}`} entry={entry} />
      ))}
    </ul>
  )
}

/** Bani について。何をするアプリか、ファイルを送らないこと、版、使っているソフトウェアのライセンス */
export default function AboutPage() {
  const m = useLocalMessages(aboutMessages)
  const npm = packages.filter((entry) => !entry.embeddedIn)
  const embedded = packages.filter((entry) => entry.embeddedIn)

  return (
    <HubLayout>
      <section className="flex flex-col gap-2.5">
        <h1 className="text-xl font-semibold">{m.title}</h1>
        <p className="text-[13px] leading-relaxed">{m.what}</p>
        <p className="text-[13px] leading-relaxed">{m.privacy}</p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="tabular-nums">{m.version(version)}</span>
          <ExternalLink href={SOURCE_URL}>{m.source}</ExternalLink>
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold">{m.licensesTitle}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{m.licensesIntro}</p>
        <Notice>
          <p className="mb-1 font-semibold">{m.lgplTitle}</p>
          <p className="mb-1">{m.lgplHeif}</p>
          <p>{m.lgplLame}</p>
        </Notice>

        <h3 className="mt-2 text-[13px] font-semibold">{m.packagesTitle}</h3>
        <LicenseList entries={npm} />

        <h3 className="mt-2 text-[13px] font-semibold">{m.embeddedTitle}</h3>
        <p className="text-xs leading-relaxed text-muted-foreground">{m.embeddedIntro}</p>
        <LicenseList entries={embedded} />
      </section>
    </HubLayout>
  )
}

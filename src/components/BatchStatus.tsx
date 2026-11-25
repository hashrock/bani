import { CircleAlertIcon, CircleCheckIcon, ClockIcon, LoaderCircleIcon, XIcon } from 'lucide-react'
import { Fragment } from 'react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import { useI18n } from '../i18n/context'
import { useLocalMessages } from '../i18n/local'
import { CONVERT_KINDS } from '../pages/convert/kinds'
import { convertMessages } from '../pages/convert/messages'
import type { BatchEntry, BatchStatusName } from '../state/batchConversion'
import { formatBytes } from '../utils/format'

interface BatchStatusProps {
  entries: BatchEntry[]
  /** 渡したときだけ、各行に一覧から外すボタンを出す（変換中は渡さない） */
  onRemove?: (index: number) => void
}

const STATUS_ICON = {
  pending: ClockIcon,
  converting: LoaderCircleIcon,
  completed: CircleCheckIcon,
  error: CircleAlertIcon,
} satisfies Record<BatchStatusName, unknown>

/** 状態ごとの色。成否だけ色を持たせ、それ以外は無彩色に揃える */
const STATUS_TONE: Record<BatchStatusName, string> = {
  pending: 'text-muted-foreground',
  converting: 'text-foreground',
  completed: 'text-success',
  error: 'text-destructive',
}

/**
 * 一括変換の進み具合。種類ごとにまとめ、1 ファイル 1 行で状態・入力・出力（進捗か結果）を並べる。
 * 行の並びは種類ごとだが、変換は取り込んだ順に進む
 */
export function BatchStatus({ entries, onRemove }: BatchStatusProps) {
  const { t } = useI18n()
  const m = useLocalMessages(convertMessages)
  const completedCount = entries.filter((f) => f.status === 'completed').length
  const errorCount = entries.filter((f) => f.status === 'error').length
  const groups = CONVERT_KINDS.map((kind) => ({
    kind,
    rows: entries.flatMap((entry, index) => (entry.kind === kind ? [{ entry, index }] : [])),
  })).filter((group) => group.rows.length > 0)

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold" aria-live="polite">
        {t.batchStatus(completedCount, entries.length, errorCount)}
      </h3>
      <div className="rounded-md border">
        <Table className="table-fixed text-xs">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 w-24 px-3 text-muted-foreground sm:w-28">{t.batchColStatus}</TableHead>
              <TableHead className="h-8 px-3 text-muted-foreground">{t.batchColFile}</TableHead>
              <TableHead className="h-8 w-24 px-3 text-right text-muted-foreground sm:w-48">
                {t.batchColOutput}
              </TableHead>
              {onRemove && <TableHead className="h-8 w-9 px-1" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map(({ kind, rows }) => (
              <Fragment key={kind}>
                <TableRow className="bg-muted/50 hover:bg-muted/50">
                  <TableCell
                    colSpan={onRemove ? 4 : 3}
                    className="px-3 py-1.5 text-[11px] font-semibold text-muted-foreground"
                  >
                    {m.groupTitle(t.kindLabel[kind], rows.length)}
                  </TableCell>
                </TableRow>
                {rows.map(({ entry, index }) => (
                  <EntryRow
                    key={index}
                    entry={entry}
                    onRemove={onRemove && (() => onRemove(index))}
                  />
                ))}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

function EntryRow({ entry, onRemove }: { entry: BatchEntry; onRemove?: () => void }) {
  const { t } = useI18n()
  const m = useLocalMessages(convertMessages)
  const Icon = STATUS_ICON[entry.status]
  return (
    <TableRow>
      <TableCell className={cn('px-3 align-top', STATUS_TONE[entry.status])}>
        <span className="flex items-center gap-1.5">
          <Icon
            aria-hidden="true"
            className={cn('size-3.5', entry.status === 'converting' && 'animate-spin')}
          />
          {t.batchStateLabel[entry.status]}
        </span>
      </TableCell>
      <TableCell className="px-3 align-top whitespace-normal">
        <div className="truncate font-medium" title={entry.file.name}>
          {entry.file.name}
        </div>
        <div className="text-muted-foreground">{formatBytes(entry.file.size)}</div>
        {entry.status === 'error' && (
          <div className="mt-1 break-words text-destructive">{entry.error}</div>
        )}
      </TableCell>
      <TableCell className="px-3 text-right align-top tabular-nums whitespace-normal">
        {entry.status === 'converting' && (
          <div className="flex items-center gap-2">
            <Progress value={entry.progress} className="h-1 flex-1" />
            <span className="w-9 text-right">{entry.progress}%</span>
          </div>
        )}
        {entry.status === 'completed' && (
          <>
            <div className="truncate text-success" title={m.renamed(entry.outputName)}>
              {entry.outputName}
            </div>
            <div className="text-muted-foreground">→ {formatBytes(entry.convertedSize)}</div>
          </>
        )}
      </TableCell>
      {onRemove && (
        <TableCell className="px-1 align-top">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-muted-foreground"
            aria-label={m.removeFile(entry.file.name)}
            title={m.removeFile(entry.file.name)}
            onClick={onRemove}
          >
            <XIcon aria-hidden="true" className="size-3.5" />
          </Button>
        </TableCell>
      )}
    </TableRow>
  )
}

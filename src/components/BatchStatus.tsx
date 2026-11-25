import { CircleAlertIcon, CircleCheckIcon, ClockIcon, LoaderCircleIcon } from 'lucide-react'
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
import type { BatchFileStatus } from '../types'
import { formatBytes } from '../utils/format'

interface BatchStatusProps {
  files: BatchFileStatus[]
}

const STATUS_ICON = {
  pending: ClockIcon,
  converting: LoaderCircleIcon,
  completed: CircleCheckIcon,
  error: CircleAlertIcon,
} satisfies Record<BatchFileStatus['status'], unknown>

/** 状態ごとの色。成否だけ色を持たせ、それ以外は無彩色に揃える */
const STATUS_TONE: Record<BatchFileStatus['status'], string> = {
  pending: 'text-muted-foreground',
  converting: 'text-foreground',
  completed: 'text-success',
  error: 'text-destructive',
}

/** 一括変換の進み具合。1 ファイル 1 行で、状態・入力サイズ・出力（進捗か結果）を並べる */
export function BatchStatus({ files }: BatchStatusProps) {
  const { t } = useI18n()
  const completedCount = files.filter((f) => f.status === 'completed').length
  const errorCount = files.filter((f) => f.status === 'error').length

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold" aria-live="polite">
        {t.batchStatus(completedCount, files.length, errorCount)}
      </h3>
      <div className="rounded-md border">
        <Table className="table-fixed text-xs">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="h-8 w-28 px-3 text-muted-foreground">{t.batchColStatus}</TableHead>
              <TableHead className="h-8 px-3 text-muted-foreground">{t.batchColFile}</TableHead>
              <TableHead className="h-8 w-40 px-3 text-right text-muted-foreground">
                {t.batchColOutput}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((fileStatus, index) => {
              const Icon = STATUS_ICON[fileStatus.status]
              return (
                <TableRow key={index}>
                  <TableCell className={cn('px-3 align-top', STATUS_TONE[fileStatus.status])}>
                    <span className="flex items-center gap-1.5">
                      <Icon
                        aria-hidden="true"
                        className={cn('size-3.5', fileStatus.status === 'converting' && 'animate-spin')}
                      />
                      {t.batchStateLabel[fileStatus.status]}
                    </span>
                  </TableCell>
                  <TableCell className="px-3 align-top whitespace-normal">
                    <div className="truncate font-medium" title={fileStatus.file.name}>
                      {fileStatus.file.name}
                    </div>
                    <div className="text-muted-foreground">{formatBytes(fileStatus.file.size)}</div>
                    {fileStatus.status === 'error' && (
                      <div className="mt-1 break-words text-destructive">{fileStatus.error}</div>
                    )}
                  </TableCell>
                  <TableCell className="px-3 text-right align-top tabular-nums">
                    {fileStatus.status === 'converting' && (
                      <div className="flex items-center gap-2">
                        <Progress value={fileStatus.progress} className="h-1 flex-1" />
                        <span className="w-9 text-right">{fileStatus.progress}%</span>
                      </div>
                    )}
                    {fileStatus.status === 'completed' && (
                      <span className="text-success">→ {formatBytes(fileStatus.convertedSize)}</span>
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { pickFiles } from '../core/opened'
import type { OpenedFile } from '../core/opened'

interface FileUploadProps {
  isDragging: boolean
  message: string
  buttonLabel: string
  hint?: string
  accept?: string
  multiple?: boolean
  onFiles: (files: OpenedFile[]) => void
}

/**
 * まだ何も読み込んでいないときのドロップ領域。
 * ドロップそのものはアプリ全体で受けるので、ここは見た目と選択ボタンだけを持つ。
 */
export function FileUpload({
  isDragging,
  message,
  buttonLabel,
  hint,
  accept,
  multiple = false,
  onFiles,
}: FileUploadProps) {
  return (
    <div className={cn('preview-area', isDragging && 'drop-target-active')}>

      <div className="flex flex-col items-center gap-4">
        <div className="text-base text-muted-foreground">{message}</div>
        {hint && (
          <p className="max-w-[360px] text-center text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        )}
        <Button variant="outline" size="xs" className="h-7 px-2.5" onClick={async () => {
            const picked = await pickFiles({ multiple, accept })
            if (picked.length > 0) onFiles(picked)
          }}>
          {buttonLabel}
        </Button>
      </div>
    </div>
  )
}

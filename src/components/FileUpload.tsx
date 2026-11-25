import { useRef } from 'react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface FileUploadProps {
  isDragging: boolean
  message: string
  buttonLabel: string
  hint?: string
  accept?: string
  multiple?: boolean
  onFiles: (files: File[]) => void
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
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div className={cn('preview-area', isDragging && 'drop-target-active')}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          const selected = e.target.files
          if (selected && selected.length > 0) onFiles(Array.from(selected))
          e.target.value = ''
        }}
      />

      <div className="flex flex-col items-center gap-4">
        <div className="text-base text-muted-foreground">{message}</div>
        {hint && (
          <p className="max-w-[360px] text-center text-xs leading-relaxed text-muted-foreground">
            {hint}
          </p>
        )}
        <Button variant="outline" size="xs" className="h-7 px-2.5" onClick={() => inputRef.current?.click()}>
          {buttonLabel}
        </Button>
      </div>
    </div>
  )
}

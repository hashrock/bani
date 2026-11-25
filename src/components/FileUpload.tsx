import { useRef } from 'react'

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
    <div className={`preview-area drop-zone ${isDragging ? 'dragging' : ''}`}>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          const selected = e.target.files
          if (selected && selected.length > 0) onFiles(Array.from(selected))
          e.target.value = ''
        }}
      />

      <div className="drop-content">
        <div className="drop-message">{message}</div>
        {hint && <p className="drop-hint">{hint}</p>}
        <div className="drop-actions">
          <button className="ghost-btn" onClick={() => inputRef.current?.click()}>
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

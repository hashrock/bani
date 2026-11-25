import { useEffect, useRef } from 'react'
import { collectPasted } from '../core/opened'
import type { OpenedFile } from '../core/opened'
import { isEditableTarget } from '../core/useHotkey'

/**
 * 画面のどこで貼り付けても（⌘V / Ctrl+V）ファイルとして開く。
 * 入力欄やエディタの中での貼り付けは、そちらの入力として扱うので奪わない。
 */
export function usePasteFiles(onFiles: (files: OpenedFile[]) => void) {
  const onFilesRef = useRef(onFiles)
  useEffect(() => {
    onFilesRef.current = onFiles
  })

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      if (!event.clipboardData || isEditableTarget(event.target)) return
      const files = collectPasted(event.clipboardData)
      if (files.length === 0) return
      event.preventDefault()
      onFilesRef.current(files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])
}

import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { collectDropped } from '../core/opened'
import type { OpenedFile } from '../core/opened'

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files')

/**
 * アプリ全体でファイルのドロップを受ける。
 * 子要素をまたぐたびに dragenter / dragleave が飛ぶので、入った回数を数えて
 * 本当に外へ出たときだけ表示を戻す。
 */
export function useFileDrop(onFiles: (files: OpenedFile[]) => void) {
  const [isDragging, setIsDragging] = useState(false)
  const depthRef = useRef(0)

  const onDragEnter = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return
    e.preventDefault()
    depthRef.current += 1
    setIsDragging(true)
  }, [])

  const onDragOver = useCallback((e: DragEvent) => {
    // 既定の動作（ブラウザがファイルを開く）を止めないとドロップできない
    if (hasFiles(e)) e.preventDefault()
  }, [])

  const onDragLeave = useCallback((e: DragEvent) => {
    if (!hasFiles(e)) return
    depthRef.current = Math.max(0, depthRef.current - 1)
    if (depthRef.current === 0) setIsDragging(false)
  }, [])

  const onDrop = useCallback(
    (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depthRef.current = 0
      setIsDragging(false)
      // ハンドル（上書き保存に使う）はイベントの中で取り出しておかないと消える
      void collectDropped(e.dataTransfer).then((files) => {
        if (files.length > 0) onFiles(files)
      })
    },
    [onFiles]
  )

  return { isDragging, handlers: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}

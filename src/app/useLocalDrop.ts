import { useCallback, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { collectDropped } from '../core/opened'
import type { OpenedFile } from '../core/opened'

/** ドラッグ中のものの MIME（ファイル名はドロップするまで読めないので、種類だけで決める） */
export interface DragItemKind {
  type: string
}

const draggedItems = (e: DragEvent): DragItemKind[] =>
  Array.from(e.dataTransfer.items)
    .filter((item) => item.kind === 'file')
    .map((item) => ({ type: item.type }))

/**
 * 開いている文書に足すためのドロップ先（ROADMAP.md「共通の操作モデル」の「開いている画面へのドロップ」）。
 * 受け取れるもの（accepts）だけを preventDefault して受け取り、アプリ全体の取り込み（開き直し）へは流さない。
 * 受け取れないものは何もせず、そのまま App の取り込みに任せる。
 */
export function useLocalDrop({
  enabled = true,
  accepts = () => true,
  onDrop,
}: {
  enabled?: boolean
  /** ドラッグ中のものを受け取るか。中身を読む前に、MIME だけで決める */
  accepts?: (items: DragItemKind[]) => boolean
  onDrop: (files: OpenedFile[]) => void
}) {
  const [over, setOver] = useState(false)
  const depthRef = useRef(0)

  const wanted = useCallback(
    (e: DragEvent) => enabled && e.dataTransfer.types.includes('Files') && accepts(draggedItems(e)),
    [enabled, accepts]
  )

  const handlers = {
    onDragEnter: (e: DragEvent) => {
      if (!wanted(e)) return
      depthRef.current += 1
      setOver(true)
    },
    onDragOver: (e: DragEvent) => {
      if (!wanted(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDragLeave: (e: DragEvent) => {
      if (!wanted(e)) return
      depthRef.current = Math.max(0, depthRef.current - 1)
      if (depthRef.current === 0) setOver(false)
    },
    onDrop: (e: DragEvent) => {
      depthRef.current = 0
      setOver(false)
      if (!wanted(e)) return
      // App（src/app/useFileDrop.ts）は preventDefault 済みのドロップを開き直さない
      e.preventDefault()
      void collectDropped(e.dataTransfer).then((files) => {
        if (files.length > 0) onDrop(files)
      })
    },
  }

  return { over, handlers }
}

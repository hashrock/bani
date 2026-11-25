import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { toast } from 'sonner'
import { createFolderWriter, downloadFiles, pickSaveFolder, saveFileAs, zipFiles } from '../core/save'
import type { SaveManyMethod } from '../core/save'
import { savedFilesMessage } from '../core/useSave'
import { useI18n } from '../i18n/context'
import { useLocalMessages } from '../i18n/local'
import type { RenderedFile } from '../media/types'
import { convertMessages } from '../pages/convert/messages'
import { resolveOutputNames } from '../pages/convert/outputNames'
import type { ConvertSettings } from '../pages/convert/outputs'
import { plannedOutputName } from '../pages/convert/outputs'
import { batchReducer, initialBatchState } from '../state/batchConversion'
import type { BatchEntry, BatchInput } from '../state/batchConversion'
import { isAbortError } from '../utils/abort'

export interface BatchConversion {
  entries: BatchEntry[]
  running: boolean
  /** 全体の進み具合（0〜100）。走っていなければ null */
  progress: number | null
  /** まとめた ZIP。保存先の選択をやめたときに保存し直せるよう、次のランまで持っておく */
  archive: RenderedFile | null
  add: (files: BatchInput[]) => void
  remove: (index: number) => void
  clear: () => void
  run: (method: SaveManyMethod) => Promise<void>
  cancel: () => void
  saveArchive: () => Promise<void>
}

/** ZIP の名前。同じ日に何度書き出しても取り違えないよう時刻を入れる */
function archiveName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `bani-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`
}

/**
 * 一括変換の実行。保存は複数のファイルの保存（src/core/save.ts）と同じ 3 通り:
 * フォルダへ 1 件ずつ書く・1 つの ZIP にまとめる・1 つずつダウンロード。
 * 結果は通知で知らせ、1 件ごとの失敗は一覧に出す。
 */
export function useBatchConversion(settings: ConvertSettings): BatchConversion {
  const { t } = useI18n()
  const m = useLocalMessages(convertMessages)
  const [entries, dispatch] = useReducer(batchReducer, initialBatchState)
  const [running, setRunning] = useState(false)
  const [archive, setArchive] = useState<RenderedFile | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 画面を離れたら残りの変換も止める
  useEffect(() => () => abortRef.current?.abort(), [])

  const add = useCallback((files: BatchInput[]) => {
    if (files.length > 0) dispatch({ type: 'append', files })
  }, [])

  const remove = useCallback((index: number) => dispatch({ type: 'remove', index }), [])

  const clear = useCallback(() => {
    setArchive(null)
    dispatch({ type: 'clear' })
  }, [])

  /** ZIP を保存する。保存先の選択をやめても、ZIP は手元に残す */
  const saveZip = useCallback(
    async (zip: RenderedFile, count: number) => {
      try {
        const handle = await saveFileAs(zip.blob, zip.filename)
        toast(savedFilesMessage(t, { method: 'zip', count, target: handle?.name ?? zip.filename, downloaded: !handle }))
      } catch (err) {
        if (isAbortError(err)) {
          toast(m.zipCancelled)
          return
        }
        toast.error(t.saveFailed(err instanceof Error ? err.message : String(err)))
      }
    },
    [t, m]
  )

  const run = useCallback(
    async (method: SaveManyMethod) => {
      if (entries.length === 0) return
      setArchive(null)

      // フォルダは先に選ばせる。変換のあとでは操作の直後でなくなり、ブラウザに選択画面を止められる
      let directory: FileSystemDirectoryHandle | null = null
      if (method === 'folder') {
        try {
          directory = await pickSaveFolder()
        } catch (err) {
          if (!isAbortError(err)) toast.error(t.saveFailed(err instanceof Error ? err.message : String(err)))
          return
        }
      }
      const writer = directory ? createFolderWriter(directory) : null

      const controller = new AbortController()
      abortRef.current = controller
      setRunning(true)

      // 書き出す名前はランの最初に全件ぶん決める。途中で失敗した件があっても名前はずれない
      const names = resolveOutputNames(
        entries.map((entry) => plannedOutputName(entry.file, entry.kind, settings))
      )
      const collected: RenderedFile[] = []
      let writtenCount = 0
      dispatch({ type: 'requeue' })

      try {
        const { renderEntry, describeFailure } = await import('../pages/convert/render')
        for (const [index, entry] of entries.entries()) {
          if (controller.signal.aborted) break

          dispatch({ type: 'start', index })
          try {
            const blob = await renderEntry(entry.file, entry.kind, settings, {
              signal: controller.signal,
              onProgress: (progress) =>
                dispatch({ type: 'progress', index, value: Math.round(progress * 100) }),
            })
            if (controller.signal.aborted) {
              dispatch({ type: 'requeue', index })
              break
            }
            const rendered = { blob, filename: names[index] }
            // フォルダには 1 件ずつ書く（同じ名前のファイルが既にあれば、上書きせず番号を振る）
            const written = writer ? await writer.write(rendered) : names[index]
            if (writer) writtenCount += 1
            else collected.push(rendered)
            dispatch({ type: 'complete', index, convertedSize: blob.size, outputName: written })
          } catch (err) {
            if (isAbortError(err) || controller.signal.aborted) {
              dispatch({ type: 'requeue', index })
              break
            }
            // 1 件の失敗では止めず、残りを続ける
            console.error('Conversion error for', entry.file.name, ':', err)
            dispatch({
              type: 'fail',
              index,
              message: describeFailure(err, m, t.errorConversionFailed),
            })
          }
        }

        if (directory) {
          if (writtenCount > 0) {
            toast(savedFilesMessage(t, { method: 'folder', count: writtenCount, target: directory.name, downloaded: false }))
          }
        } else if (collected.length === 0) {
          if (!controller.signal.aborted) toast.error(m.nothingToSave)
        } else if (method === 'zip') {
          // 中止したときも、変換し終えたぶんは ZIP にしておき、保存するかは利用者に任せる
          const zip = await zipFiles(collected, archiveName())
          setArchive(zip)
          if (!controller.signal.aborted) await saveZip(zip, collected.length)
        } else if (!controller.signal.aborted) {
          await downloadFiles(collected)
          toast(savedFilesMessage(t, { method: 'each', count: collected.length, target: null, downloaded: true }))
        }
      } catch (err) {
        if (!isAbortError(err)) {
          console.error('Batch conversion failed:', err)
          toast.error(err instanceof Error ? err.message : t.errorConversionFailed)
        }
      } finally {
        setRunning(false)
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [entries, settings, t, m, saveZip]
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const saveArchive = useCallback(async () => {
    if (archive) await saveZip(archive, entries.filter((entry) => entry.status === 'completed').length)
  }, [archive, saveZip, entries])

  // 全体の進み具合は、終わった件と走っている件の進み具合を合わせて数える
  const progress = running
    ? entries.length === 0
      ? 0
      : entries.reduce(
          (sum, entry) =>
            sum +
            (entry.status === 'completed' || entry.status === 'error'
              ? 100
              : entry.status === 'converting'
                ? entry.progress
                : 0),
          0
        ) / entries.length
    : null

  return { entries, running, progress, archive, add, remove, clear, run, cancel, saveArchive }
}

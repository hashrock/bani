import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { saveFileAs } from '../core/save'
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
import { pickOutputDirectory, writeFileToDirectory } from '../utils/fileSystem'

/** 保存先。フォルダは showDirectoryPicker が使えるときだけ選べる */
export type SaveTarget = 'folder' | 'zip'

export const canPickFolder = (): boolean =>
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

export interface BatchConversion {
  entries: BatchEntry[]
  running: boolean
  /** ZIP にまとめている最中か（変換は終わっている） */
  zipping: boolean
  /** 一覧の上に出す、ラン全体の失敗（保存先を選べなかったなど） */
  error: string
  /** まとめた ZIP。保存をやめたときに保存し直せるよう、次のランまで持っておく */
  archive: RenderedFile | null
  add: (files: BatchInput[]) => void
  remove: (index: number) => void
  clear: () => void
  run: (target: SaveTarget) => Promise<void>
  cancel: () => void
  saveArchive: () => Promise<void>
}

/** ZIP の名前。同じ日に何度書き出しても取り違えないよう時刻を入れる */
function archiveName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `bani-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.zip`
}

export function useBatchConversion(settings: ConvertSettings): BatchConversion {
  const { t } = useI18n()
  const m = useLocalMessages(convertMessages)
  const [entries, dispatch] = useReducer(batchReducer, initialBatchState)
  const [running, setRunning] = useState(false)
  const [zipping, setZipping] = useState(false)
  const [error, setError] = useState('')
  const [archive, setArchive] = useState<RenderedFile | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // 画面を離れたら残りの変換も止める
  useEffect(() => () => abortRef.current?.abort(), [])

  const add = useCallback((files: BatchInput[]) => {
    if (files.length > 0) dispatch({ type: 'append', files })
  }, [])

  const remove = useCallback((index: number) => dispatch({ type: 'remove', index }), [])

  const clear = useCallback(() => {
    setError('')
    setArchive(null)
    dispatch({ type: 'clear' })
  }, [])

  /** ZIP を保存する。保存先の選択をやめても、ZIP は手元に残す */
  const save = useCallback(
    async (zip: RenderedFile) => {
      try {
        await saveFileAs(zip.blob, zip.filename)
        setError('')
      } catch (err) {
        setError(
          isAbortError(err)
            ? m.zipCancelled
            : m.zipFailed(err instanceof Error ? err.message : String(err))
        )
      }
    },
    [m]
  )

  const run = useCallback(
    async (target: SaveTarget) => {
      if (entries.length === 0) return
      setError('')
      setArchive(null)

      // フォルダは先に選ばせる。変換のあとでは操作の直後でなくなり、ブラウザに選択画面を止められる
      let directory: FileSystemDirectoryHandle | null = null
      if (target === 'folder') {
        try {
          directory = await pickOutputDirectory()
        } catch (err) {
          setError(
            isAbortError(err)
              ? t.errorFolderCancelled
              : err instanceof Error
                ? err.message
                : t.errorFolderFailed
          )
          return
        }
      }

      const controller = new AbortController()
      abortRef.current = controller
      setRunning(true)

      // 書き出す名前はランの最初に全件ぶん決める。途中で失敗した件があっても名前はずれない
      const names = resolveOutputNames(
        entries.map((entry) => plannedOutputName(entry.file, entry.kind, settings))
      )
      const collected: RenderedFile[] = []
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
            if (directory) {
              await writeFileToDirectory(directory, names[index], await blob.arrayBuffer())
            } else {
              collected.push({ blob, filename: names[index] })
            }
            dispatch({ type: 'complete', index, convertedSize: blob.size, outputName: names[index] })
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

        if (target === 'zip' && collected.length > 0) {
          // 中止したときも、変換し終えたぶんは ZIP にしておき、保存するかは利用者に任せる
          setZipping(true)
          const { zipRenderedFiles } = await import('../media/archive')
          const zip = await zipRenderedFiles(collected, archiveName())
          setArchive(zip)
          setZipping(false)
          if (!controller.signal.aborted) await save(zip)
        } else if (target === 'zip' && !controller.signal.aborted) {
          setError(m.nothingToZip)
        }
      } catch (err) {
        if (!isAbortError(err)) {
          console.error('Batch conversion failed:', err)
          setError(err instanceof Error ? err.message : t.errorConversionFailed)
        }
      } finally {
        setRunning(false)
        setZipping(false)
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [entries, settings, t, m, save]
  )

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  const saveArchive = useCallback(async () => {
    if (archive) await save(archive)
  }, [archive, save])

  return { entries, running, zipping, error, archive, add, remove, clear, run, cancel, saveArchive }
}

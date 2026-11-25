import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useI18n } from '../i18n/context'
import type { RenderedFile } from '../media/types'
import { isAbortError } from '../utils/abort'
import type { OpenedFile } from './opened'
import { copyBlobToClipboard, overwriteFile, planSave, saveFileAs } from './save'
import type { SaveMethod, SavePlan } from './save'
import { useHotkey } from './useHotkey'

export interface UseSaveOptions {
  /** 開いているファイル。上書き先のハンドルを持っていればそれを使う */
  opened: OpenedFile | null
  /** 書き出す形式が可逆か */
  lossless: boolean
  /** 元と同じ形式で書き出すか */
  sameFormat: boolean
  /** 結果をクリップボードに入れられるか */
  canCopy: boolean
  /** 保存する中身を作る。保存のたびに呼ぶ（元ファイル + レシピから作り直す） */
  render: () => Promise<RenderedFile>
  /**
   * 元ファイルを上書きしたあとに呼ぶ。保存した内容が新しい元ファイルになるので、
   * 画面はこれを開き直す（レシピを積み直さないと編集が二重にかかる）。
   */
  onSourceReplaced?: (opened: OpenedFile) => void
  disabled?: boolean
}

export interface SaveState {
  plan: SavePlan
  busy: boolean
  run: (method: SaveMethod) => Promise<void>
}

/**
 * 保存ボタンの中身。方針（上書きが主か別名が主か）を決め、⌘S を主の方法に結びつける。
 * 結果とエラーは通知で知らせる。
 */
export function useSave({
  opened,
  lossless,
  sameFormat,
  canCopy,
  render,
  onSourceReplaced,
  disabled = false,
}: UseSaveOptions): SaveState {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  // 別名で保存した先。以後の上書きはそちらへ向ける（元ファイルには戻らない）
  const [savedHandle, setSavedHandle] = useState<FileSystemFileHandle | null>(null)
  const handle = savedHandle ?? opened?.handle ?? null

  const plan = planSave({
    lossless,
    sameFormat,
    canOverwrite: handle !== null,
    canCopy,
  })

  const run = useCallback(
    async (method: SaveMethod) => {
      if (disabled || busy) return
      setBusy(true)
      try {
        const rendered = await render()
        switch (method) {
          case 'overwrite': {
            if (!handle) return
            await overwriteFile(handle, rendered.blob)
            toast(t.savedTo(handle.name))
            if (!savedHandle && opened?.handle && onSourceReplaced) {
              onSourceReplaced({ file: await handle.getFile(), handle })
            }
            break
          }
          case 'saveAs': {
            const next = await saveFileAs(rendered.blob, rendered.filename)
            if (next) {
              setSavedHandle(next)
              toast(t.savedTo(next.name))
            }
            break
          }
          case 'copyToClipboard':
            await copyBlobToClipboard(rendered.blob)
            toast(t.copiedToClipboard)
            break
        }
      } catch (err) {
        if (isAbortError(err)) return
        console.error('Save failed:', err)
        toast.error(t.saveFailed(err instanceof Error ? err.message : String(err)))
      } finally {
        setBusy(false)
      }
    },
    [disabled, busy, render, handle, savedHandle, opened, onSourceReplaced, t]
  )

  useHotkey('mod+s', () => void run(plan.primary), { enabled: !disabled, inEditable: true })

  return { plan, busy, run }
}

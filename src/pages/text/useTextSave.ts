import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { copyTextToClipboard, overwriteFile, planSave, saveFileAs } from '../../core/save'
import type { SaveMethod } from '../../core/save'
import { useHotkey } from '../../core/useHotkey'
import type { SaveState } from '../../core/useSave'
import { useI18n } from '../../i18n/context'
import { isAbortError } from '../../utils/abort'

export interface TextRendered {
  /** 保存する中身。クリップボードへのコピーでは作らない（文字コードにする前の文字列をそのまま渡す） */
  blob: Blob | null
  filename: string
  /** クリップボードに入れる文字列 */
  copyText: string
}

/** 保存できた先。ダウンロードになったときは handle が null */
export interface SavedTarget {
  handle: FileSystemFileHandle | null
  name: string
}

interface TextSaveOptions<T extends TextRendered> {
  /** 上書きに使うハンドル。別名で保存したあとはその保存先になる（画面側が持つ） */
  handle: FileSystemFileHandle | null
  sameFormat: boolean
  disabled: boolean
  render: (method: SaveMethod) => Promise<T>
  /** 保存（上書き・別名・ダウンロード）できたあと。コピーでは呼ばない */
  onSaved: (rendered: T, target: SavedTarget) => void
  /** 画面で言い直したいエラー。null なら共通の文言で知らせる */
  describeError?: (error: unknown) => string | null
}

/**
 * テキスト画面の保存。src/core/useSave と同じ方針（planSave）・同じ見た目（SaveButton）・同じ ⌘S で動くが、
 * 次の 3 点が useSave にないので画面の中に持つ:
 * - 別名で保存できたことを知る口（保存した中身を新しい基準にし、変更の印を消すため）
 * - コピーでは文字コードにする前の文字列を渡す（Shift_JIS の Blob を UTF-8 として読むと化ける）
 * - 保存先（別名で選んだハンドル）を画面が持つ（新規の文書は最初の保存で初めてハンドルを持つ）
 */
export function useTextSave<T extends TextRendered>({
  handle,
  sameFormat,
  disabled,
  render,
  onSaved,
  describeError,
}: TextSaveOptions<T>): SaveState {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)

  const plan = planSave({ lossless: true, sameFormat, canOverwrite: handle !== null, canCopy: true })

  const run = useCallback(
    async (method: SaveMethod) => {
      if (disabled || busy) return
      setBusy(true)
      try {
        const rendered = await render(method)
        switch (method) {
          case 'overwrite': {
            if (!handle || !rendered.blob) return
            await overwriteFile(handle, rendered.blob)
            toast(t.savedTo(handle.name))
            onSaved(rendered, { handle, name: handle.name })
            break
          }
          case 'saveAs': {
            if (!rendered.blob) return
            const next = await saveFileAs(rendered.blob, rendered.filename)
            toast(t.savedTo(next?.name ?? rendered.filename))
            onSaved(rendered, { handle: next, name: next?.name ?? rendered.filename })
            break
          }
          case 'copyToClipboard':
            await copyTextToClipboard(rendered.copyText)
            toast(t.copiedToClipboard)
            break
        }
      } catch (err) {
        if (isAbortError(err)) return
        const described = describeError?.(err)
        if (described) {
          toast.error(described)
          return
        }
        console.error('Save failed:', err)
        toast.error(t.saveFailed(err instanceof Error ? err.message : String(err)))
      } finally {
        setBusy(false)
      }
    },
    [disabled, busy, render, handle, onSaved, describeError, t]
  )

  // 保存できないあいだも ⌘S は奪っておく（ブラウザの「ページを保存」が開くのを避ける）
  useHotkey('mod+s', () => void run(plan.primary), { inEditable: true })

  return { plan, busy, run }
}

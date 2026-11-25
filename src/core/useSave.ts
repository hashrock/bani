import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { useI18n } from '../i18n/context'
import type { Messages } from '../i18n/messages'
import type { RenderedFile } from '../media/types'
import { isAbortError } from '../utils/abort'
import type { OpenedFile } from './opened'
import { copyToClipboard, overwriteFile, planSave, saveFileAs } from './save'
import type { ClipboardPayload, SaveMethod, SavePlan, SavedFiles } from './save'
import { useHotkey } from './useHotkey'

/** 保存する中身。コピーでは copy があればそちらを入れる（なければ blob をそのまま） */
export interface SaveRendered extends RenderedFile {
  copy?: ClipboardPayload
}

/** 保存できた方法（コピーは含まない） */
export type WrittenMethod = Exclude<SaveMethod, 'copyToClipboard'>

export interface UseSaveOptions<R extends SaveRendered> {
  /** 開いているファイル。上書き先のハンドルを持っていればそれを使う */
  opened: OpenedFile | null
  /** 書き出す形式が可逆か */
  lossless: boolean
  /** 元と同じ形式で書き出すか */
  sameFormat: boolean
  /** 結果をクリップボードに入れられるか */
  canCopy: boolean
  /** コピーの項目名。既定は「クリップボードにコピー」（画像を PNG にしてコピーするときなどに言い換える） */
  copyLabel?: string
  /**
   * 保存する中身を作る。保存のたびに呼ぶ（元ファイル + レシピから作り直す）。
   * 方法ごとに作り分けてよい（コピーでは文字コードにする前の文字列を渡す、など）
   */
  render: (method: SaveMethod) => Promise<R>
  /**
   * 上書き先のハンドル。渡せば画面がこれを持つ（新規の文書が最初の保存でハンドルを持つ、など）。
   * 省略すれば、開いたファイルのハンドル → 別名で保存した先 の順に useSave が持つ。
   */
  handle?: FileSystemFileHandle | null
  /** 保存できたあと。handle は書いた先（ダウンロードになったときは null）。コピーでは呼ばない */
  onSaved?: (method: WrittenMethod, handle: FileSystemFileHandle | null, rendered: R) => void
  /**
   * 元ファイルを上書きしたあとに呼ぶ。保存した内容が新しい元ファイルになるので、
   * 画面はこれを開き直す（レシピを積み直さないと編集が二重にかかる）。
   */
  onSourceReplaced?: (opened: OpenedFile) => void
  /** 画面で言い直したい失敗の理由。null なら共通の文言で知らせる */
  describeError?: (error: unknown) => string | null
  disabled?: boolean
}

export interface SaveState {
  plan: SavePlan
  busy: boolean
  run: (method: SaveMethod) => Promise<void>
  /** 方法の表示名（ボタン・メニューの項目） */
  labelOf: (method: SaveMethod) => string
}

const LABEL: Record<SaveMethod, keyof Messages> = {
  overwrite: 'saveOverwrite',
  saveAs: 'saveAs',
  copyToClipboard: 'saveCopyToClipboard',
}

/**
 * 保存ボタンの中身。方針（上書きが主か別名が主か）を決め、⌘S を主の方法に結びつける。
 * 結果とエラーは通知で知らせる（保存・ダウンロード・コピーのどれでも 1 件出す）。
 */
export function useSave<R extends SaveRendered>({
  opened,
  lossless,
  sameFormat,
  canCopy,
  copyLabel,
  render,
  handle: ownedHandle,
  onSaved,
  onSourceReplaced,
  describeError,
  disabled = false,
}: UseSaveOptions<R>): SaveState {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  // 別名で保存した先。以後の上書きはそちらへ向ける（元ファイルには戻らない）
  const [savedHandle, setSavedHandle] = useState<FileSystemFileHandle | null>(null)
  const owned = ownedHandle !== undefined
  const handle = owned ? ownedHandle : (savedHandle ?? opened?.handle ?? null)

  const plan = planSave({
    lossless,
    sameFormat,
    canOverwrite: handle !== null,
    canCopy,
  })

  const labelOf = useCallback(
    (method: SaveMethod) =>
      method === 'copyToClipboard' && copyLabel ? copyLabel : (t[LABEL[method]] as string),
    [copyLabel, t]
  )

  const run = useCallback(
    async (method: SaveMethod) => {
      if (disabled || busy) return
      setBusy(true)
      try {
        const rendered = await render(method)
        switch (method) {
          case 'overwrite': {
            if (!handle) return
            await overwriteFile(handle, rendered.blob)
            toast(t.savedTo(handle.name))
            onSaved?.('overwrite', handle, rendered)
            // 開いたファイルそのものを書き換えたときだけ、元ファイルが変わったことを伝える
            if (onSourceReplaced && opened?.handle && handle === opened.handle) {
              onSourceReplaced({ file: await handle.getFile(), handle })
            }
            break
          }
          case 'saveAs': {
            const next = await saveFileAs(rendered.blob, rendered.filename)
            if (next && !owned) setSavedHandle(next)
            toast(next ? t.savedTo(next.name) : t.downloaded(rendered.filename))
            onSaved?.('saveAs', next, rendered)
            break
          }
          case 'copyToClipboard':
            await copyToClipboard(rendered.copy ?? { blob: rendered.blob })
            toast(t.copiedToClipboard)
            break
        }
      } catch (err) {
        if (isAbortError(err)) return
        const described = describeError?.(err)
        if (!described) console.error('Save failed:', err)
        toast.error(described ?? t.saveFailed(err instanceof Error ? err.message : String(err)))
      } finally {
        setBusy(false)
      }
    },
    [disabled, busy, render, handle, owned, opened, onSaved, onSourceReplaced, describeError, t]
  )

  // 保存できないあいだも ⌘S は奪っておく（ブラウザの「ページを保存」が開くのを避ける）
  useHotkey('mod+s', () => void run(plan.primary), { inEditable: true })

  return { plan, busy, run, labelOf }
}

/** 複数のファイルを保存できたときの通知の文（保存先・ダウンロードの別で言い分ける） */
export function savedFilesMessage(t: Messages, saved: SavedFiles): string {
  switch (saved.method) {
    case 'folder':
      return t.savedFiles(saved.count, saved.target ?? '')
    case 'zip':
      return saved.downloaded ? t.downloaded(saved.target ?? '') : t.savedTo(saved.target ?? '')
    case 'each':
      return t.downloadedFiles(saved.count)
  }
}

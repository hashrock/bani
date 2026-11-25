import { Suspense, useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import './App.css'
import { Toaster } from '@/components/ui/sonner'
import { detectKindAsync, planIntake } from './app/intake'
import { confirmDiscard, hasUnsaved, setLeaveMessage, setUnsaved } from './app/leaveGuard'
import { shellMessages } from './app/messages'
import { sessionMessages } from './app/sessionMessages'
import { currentRoute, navigate, subscribeRoute, useRoute } from './app/router'
import type { MediaKind } from './app/routes'
import { useFileDrop } from './app/useFileDrop'
import { usePasteFiles } from './app/usePasteFiles'
import type { OpenedFile } from './core/opened'
import type { ResumedSession } from './core/session'
import { listSessions, restoreSession } from './core/sessionStore'
import { useHotkey } from './core/useHotkey'
import { useI18n } from './i18n/context'
import { useLocalMessages } from './i18n/local'
import { ConvertPage } from './pages/convert/ConvertPage'
import { HubPage } from './pages/HubPage'
import { MessagePage } from './pages/MessagePage'
import { CAPABILITIES, EDIT_PAGES } from './pages/registry'

/** 取り込みの通知は 1 件ずつ出し、新しい取り込みで前のものを置き換える */
const INTAKE_TOAST_ID = 'intake'

/** 一括変換の画面にいるあいだは、何を落としても一覧に足す（編集画面へは移らない） */
const CONVERT_ONLY = { edit: [], convert: CAPABILITIES.convert }

/**
 * 各画面に渡すファイル。編集画面は key で作り直すので、
 * ファイルを選び直すたびに番号を進めて前の状態（変換結果や編集の履歴）を残さない。
 * 一括変換は作り直さず、届いた分（id で見分ける）を一覧の末尾に足す。
 */
interface Opened {
  /** file は新規の文書・圧縮ファイルの作成を再開したときだけ null。resumed は再開したときのセッション */
  edit: { file: OpenedFile | null; kind: MediaKind; resumed?: ResumedSession } | null
  editId: number
  convert: { id: number; files: OpenedFile[] } | null
}

function App() {
  const { t } = useI18n()
  const shell = useLocalMessages(shellMessages)
  const sm = useLocalMessages(sessionMessages)
  const route = useRoute()

  // ブラウザの戻る・進むで離れるときの確認（router）は React の外で出すので、文言を先に渡しておく
  useEffect(() => setLeaveMessage(shell.leaveConfirm), [shell])
  const [opened, setOpened] = useState<Opened>({ edit: null, editId: 0, convert: null })

  // 画面を離れたら、持っていたファイルも手放す。入口の「編集」「一括変換」やブラウザの戻るで
  // 来たときに、前に開いていたファイルが生き返らないようにする（空の画面・新規の文書から始める）。
  // URL の hash ではなく確認を通った画面の移動を見る（戻るを断ったときにファイルを手放さない）
  useEffect(() =>
    subscribeRoute(() => {
      const next = currentRoute()
      setOpened((prev) => {
        const keepEdit = prev.edit !== null && next.name === 'edit' && next.kind === prev.edit.kind
        const keepConvert = prev.convert !== null && next.name === 'convert'
        if ((keepEdit || prev.edit === null) && (keepConvert || prev.convert === null)) return prev
        return { ...prev, edit: keepEdit ? prev.edit : null, convert: keepConvert ? prev.convert : null }
      })
    }), [])

  /**
   * ドロップ・ファイル選択・貼り付けの入口。種類と数から開く画面を決める。
   * 編集画面に保存していない変更があれば、開き直す前に確かめる（reopen は保存直後なので確かめない）
   */
  const intake = useCallback(
    async (files: OpenedFile[], options: { reopen?: boolean } = {}) => {
      const current = currentRoute()
      const onConvert = current.name === 'convert'
      const kinds = await Promise.all(files.map(({ file }) => detectKindAsync(file)))
      const plan = planIntake(kinds, onConvert ? CONVERT_ONLY : CAPABILITIES)
      if (!plan) {
        toast(t.unsupportedFiles, { id: INTAKE_TOAST_ID })
        return
      }
      // 一括変換への追加は何も捨てないので確かめない。それ以外は開いている編集を置き換える
      if (!options.reopen && !onConvert && !confirmDiscard(t.discardConfirm)) return
      const accepted = plan.accepted.map((index) => files[index])
      const next = plan.route
      setOpened((prev) =>
        next.name === 'edit'
          ? { ...prev, edit: { file: accepted[0], kind: next.kind }, editId: prev.editId + 1 }
          : { ...prev, convert: { id: (prev.convert?.id ?? 0) + 1, files: accepted } }
      )
      if (plan.rejected.length > 0) {
        toast(t.skippedFiles(plan.rejected.length), { id: INTAKE_TOAST_ID })
      } else {
        toast.dismiss(INTAKE_TOAST_ID)
      }
      navigate(next)
    },
    [t]
  )

  /** 前回の作業を再開する。ファイルを読み直し、その画面をレシピごと開き直す（履歴は新しく始まる） */
  const resume = useCallback(
    async (id: string) => {
      if (!confirmDiscard(t.discardConfirm)) return
      const resumed = await restoreSession(id)
      if (!resumed) {
        toast.error(sm.resumeFailed, { id: INTAKE_TOAST_ID })
        return
      }
      toast.dismiss(INTAKE_TOAST_ID)
      setOpened((prev) => ({
        ...prev,
        edit: { file: resumed.opened, kind: resumed.kind, resumed },
        editId: prev.editId + 1,
      }))
      navigate({ name: 'edit', kind: resumed.kind })
    },
    [t, sm]
  )
  const onResume = useCallback((id: string) => void resume(id), [resume])

  // 編集画面を直に開いて（再読み込みして）来たとき、その画面の作業が残っていれば再開を勧める
  useEffect(() => {
    const first = currentRoute()
    if (first.name !== 'edit') return
    let cancelled = false
    void listSessions().then((sessions) => {
      const found = sessions.find((session) => session.kind === first.kind)
      const now = currentRoute()
      if (cancelled || !found || now.name !== 'edit' || now.kind !== first.kind) return
      toast(sm.found(found.name), {
        id: INTAKE_TOAST_ID,
        duration: 15000,
        action: { label: sm.resume, onClick: () => onResume(found.id) },
      })
    })
    return () => {
      cancelled = true
    }
    // 読み込んだときに一度だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const openFiles = useCallback((files: OpenedFile[]) => void intake(files), [intake])
  const reopen = useCallback((file: OpenedFile) => void intake([file], { reopen: true }), [intake])

  const drop = useFileDrop(openFiles)
  usePasteFiles(openFiles)

  // 閉じる・再読み込みの前にも、保存していない変更を確かめる
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsaved()) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // 保存の操作がない画面（入口など）でも ⌘S でブラウザの「ページを保存」を開かせない。
  // 編集画面と一括変換は自分の ⌘S を持つ（画面は App より後に読み込まれるので、ここで先に奪うと届かなくなる）
  useHotkey('mod+s', () => {}, { inEditable: true, enabled: route.name === 'hub' || route.name === 'notFound' })

  const page = (() => {
    switch (route.name) {
      case 'hub':
        return (
          <HubPage
            capabilities={CAPABILITIES}
            isDragging={drop.isDragging}
            onFiles={openFiles}
            onResume={onResume}
          />
        )
      case 'edit': {
        const EditPage = EDIT_PAGES[route.kind]
        const current = opened.edit?.kind === route.kind ? opened.edit : null
        return (
          <EditPage
            key={`${route.kind}-${opened.editId}`}
            opened={current?.file ?? null}
            resumed={current?.resumed ?? null}
            isDragging={drop.isDragging}
            onFiles={openFiles}
            onReopen={reopen}
            onDirtyChange={setUnsaved}
          />
        )
      }
      case 'convert':
        return (
          <ConvertPage incoming={opened.convert} isDragging={drop.isDragging} />
        )
      case 'notFound':
        return <MessagePage title={t.notFoundTitle} />
    }
  })()

  return (
    <div className="shell" {...drop.handlers}>
      <Suspense fallback={null}>{page}</Suspense>
      {/* 通知は読めるだけの間だけ出して、画面を移ったあとまで残さない */}
      <Toaster
        position="bottom-center"
        duration={5000}
        closeButton
        toastOptions={{ closeButtonAriaLabel: t.dismiss }}
      />
    </div>
  )
}

export default App

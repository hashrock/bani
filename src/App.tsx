import { Suspense, useCallback, useState } from 'react'
import { toast } from 'sonner'
import './App.css'
import { Toaster } from '@/components/ui/sonner'
import { detectKindAsync, planIntake } from './app/intake'
import { navigate, useRoute } from './app/router'
import type { MediaKind } from './app/routes'
import { useFileDrop } from './app/useFileDrop'
import { usePasteFiles } from './app/usePasteFiles'
import type { OpenedFile } from './core/opened'
import { useI18n } from './i18n/context'
import { ConvertPage } from './pages/convert/ConvertPage'
import { HubPage } from './pages/HubPage'
import { MessagePage } from './pages/MessagePage'
import { CAPABILITIES, EDIT_PAGES } from './pages/registry'
import type { ConversionSettings } from './types'
import { DEFAULT_SETTINGS } from './types'

/** 取り込みの通知は 1 件ずつ出し、新しい取り込みで前のものを置き換える */
const INTAKE_TOAST_ID = 'intake'

/**
 * 各画面に渡すファイル。画面は key で作り直すので、
 * ファイルを選び直すたびに番号を進めて前の状態（変換結果や編集の履歴）を残さない。
 */
interface Opened {
  edit: { file: OpenedFile; kind: MediaKind } | null
  editId: number
  convert: OpenedFile[]
  convertId: number
}

function App() {
  const { t } = useI18n()
  const route = useRoute()
  const [opened, setOpened] = useState<Opened>({
    edit: null,
    editId: 0,
    convert: [],
    convertId: 0,
  })
  // 一括変換の出力設定は画面を行き来しても残す
  const [convertSettings, setConvertSettings] = useState<ConversionSettings>(DEFAULT_SETTINGS)

  /** ドロップ・ファイル選択・貼り付けの入口。種類と数から開く画面を決める */
  const openFiles = useCallback(
    async (files: OpenedFile[]) => {
      const kinds = await Promise.all(files.map(({ file }) => detectKindAsync(file)))
      const plan = planIntake(kinds, CAPABILITIES)
      if (!plan) {
        toast(t.unsupportedFiles, { id: INTAKE_TOAST_ID })
        return
      }
      const accepted = plan.accepted.map((index) => files[index])
      const route = plan.route
      setOpened((prev) =>
        route.name === 'edit'
          ? { ...prev, edit: { file: accepted[0], kind: route.kind }, editId: prev.editId + 1 }
          : { ...prev, convert: accepted, convertId: prev.convertId + 1 }
      )
      if (plan.rejected.length > 0) {
        toast(t.skippedFiles(plan.rejected.length), { id: INTAKE_TOAST_ID })
      } else {
        toast.dismiss(INTAKE_TOAST_ID)
      }
      navigate(route)
    },
    [t]
  )

  const drop = useFileDrop(openFiles)
  usePasteFiles(openFiles)

  const page = (() => {
    switch (route.name) {
      case 'hub':
        return (
          <HubPage capabilities={CAPABILITIES} isDragging={drop.isDragging} onFiles={openFiles} />
        )
      case 'edit': {
        const EditPage = EDIT_PAGES[route.kind]
        // 入口から別の種類の編集画面へ来たときは、前のファイルを持ち込まない
        const file = opened.edit?.kind === route.kind ? opened.edit.file : null
        return (
          <EditPage
            key={`${route.kind}-${opened.editId}`}
            opened={file}
            isDragging={drop.isDragging}
            onFiles={openFiles}
          />
        )
      }
      case 'convert':
        return (
          <ConvertPage
            key={opened.convertId}
            files={opened.convert.map(({ file }) => file)}
            settings={convertSettings}
            onSettingsChange={setConvertSettings}
            isDragging={drop.isDragging}
            onFiles={openFiles}
          />
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

import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import './App.css'
import { detectKind, planIntake } from './app/intake'
import type { Capabilities } from './app/intake'
import { navigate, useRoute } from './app/router'
import { useFileDrop } from './app/useFileDrop'
import { useI18n } from './i18n/context'
import { ConvertPage } from './pages/ConvertPage'
import { HubPage } from './pages/HubPage'
import { Toaster } from '@/components/ui/sonner'
import { MessagePage } from './pages/MessagePage'
import { VideoEditPage } from './pages/VideoEditPage'
import type { ConversionSettings } from './types'
import { DEFAULT_SETTINGS } from './types'

/** いま実装済みの画面が受け付ける種類。ロードマップに沿って増やす */
const CAPABILITIES: Capabilities = {
  edit: ['video'],
  convert: ['video'],
}

/** 取り込みの通知は 1 件ずつ出し、新しい取り込みで前のものを置き換える */
const INTAKE_TOAST_ID = 'intake'

/**
 * 各画面に渡すファイル。画面は key で作り直すので、
 * ファイルを選び直すたびに番号を進めて前の状態（変換結果など）を残さない。
 */
interface Opened {
  editFile: File | null
  editId: number
  convertFiles: File[]
  convertId: number
}

function App() {
  const { t } = useI18n()
  const route = useRoute()
  const [opened, setOpened] = useState<Opened>({
    editFile: null,
    editId: 0,
    convertFiles: [],
    convertId: 0,
  })
  // 出力設定は画面を行き来しても残す
  const [editSettings, setEditSettings] = useState<ConversionSettings>(DEFAULT_SETTINGS)
  const [convertSettings, setConvertSettings] = useState<ConversionSettings>(DEFAULT_SETTINGS)

  const openFiles = useCallback(
    (files: File[]) => {
      const plan = planIntake(files.map(detectKind), CAPABILITIES)
      if (!plan) {
        toast(t.unsupportedFiles, { id: INTAKE_TOAST_ID })
        return
      }
      const accepted = plan.accepted.map((index) => files[index])
      setOpened((prev) =>
        plan.route.name === 'edit'
          ? { ...prev, editFile: accepted[0], editId: prev.editId + 1 }
          : { ...prev, convertFiles: accepted, convertId: prev.convertId + 1 }
      )
      if (plan.rejected.length > 0) {
        toast(t.skippedFiles(plan.rejected.length), { id: INTAKE_TOAST_ID })
      } else {
        toast.dismiss(INTAKE_TOAST_ID)
      }
      navigate(plan.route)
    },
    [t]
  )

  const drop = useFileDrop(openFiles)

  const page = (() => {
    switch (route.name) {
      case 'hub':
        return (
          <HubPage
            capabilities={CAPABILITIES}
            isDragging={drop.isDragging}
            onFiles={openFiles}
          />
        )
      case 'edit':
        if (route.kind === 'video') {
          return (
            <VideoEditPage
              key={opened.editId}
              file={opened.editFile}
              settings={editSettings}
              setSettings={setEditSettings}
              isDragging={drop.isDragging}
              onFiles={openFiles}
            />
          )
        }
        return (
          <MessagePage
            title={t.comingSoonTitle(t.kindLabel[route.kind])}
            body={t.comingSoonBody}
          />
        )
      case 'convert':
        return (
          <ConvertPage
            key={opened.convertId}
            files={opened.convertFiles}
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
      {page}
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

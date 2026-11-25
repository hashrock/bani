import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { SidebarHead } from '../../components/BrandMark'
import type { OpenedFile } from '../../core/opened'
import { useLocalMessages } from '../../i18n/local'
import type { TextInfo } from '../../media/text'
import { probeText } from '../../media/text'
import { formatBytes } from '../../utils/format'
import type { EditPageProps } from '../types'
import { dominantNewline } from './document'
import { detectSubtitle } from './language'
import { textMessages } from './messages'
import type { InitialDocument } from './TextEditorScreen'
import { TextEditorScreen } from './TextEditorScreen'

/**
 * テキストとして開ける上限。全体を一度に文字列にしてエディタに渡すので、
 * これを超えるとブラウザが固まりやすい（数 MB までは普通に動く）
 */
const MAX_BYTES = 64 * 1024 * 1024

type Load =
  | { status: 'loading' }
  | { status: 'ready'; doc: InitialDocument }
  | { status: 'binary'; doc: InitialDocument }
  | { status: 'tooLarge' }
  | { status: 'error'; message: string }

function untitledDocument(): InitialDocument {
  return {
    base: {
      name: 'untitled.txt',
      type: 'text/plain',
      encoding: 'utf-8',
      bom: false,
      newline: 'lf',
      newlineDetected: 'none',
      subtitle: null,
    },
    text: '',
    handle: null,
    untitled: true,
    size: null,
    decodeErrors: false,
    forcedBinary: false,
    newlineCounts: null,
  }
}

function documentFromProbe(opened: OpenedFile, info: TextInfo): InitialDocument {
  const { file } = opened
  return {
    base: {
      name: file.name,
      type: file.type.split(';')[0].trim() || 'text/plain',
      encoding: info.encoding,
      bom: info.bom,
      newline: dominantNewline(info.newlineCounts),
      newlineDetected: info.newline,
      subtitle: detectSubtitle(file),
    },
    text: info.text,
    handle: opened.handle,
    untitled: false,
    size: file.size,
    decodeErrors: info.hasDecodeErrors,
    forcedBinary: false,
    newlineCounts: info.newlineCounts,
  }
}

const initialLoad = (opened: OpenedFile | null): Load => {
  if (!opened) return { status: 'ready', doc: untitledDocument() }
  if (opened.file.size > MAX_BYTES) return { status: 'tooLarge' }
  return { status: 'loading' }
}

/** テキスト・コードの画面。ファイルを読み、文字コードを判定してからエディタを出す */
export default function EditPage({ opened, isDragging, onFiles, onDirtyChange, resumed }: EditPageProps) {
  const m = useLocalMessages(textMessages)
  const [load, setLoad] = useState<Load>(() => initialLoad(opened))
  // 新規を押したらエディタごと作り直す（取り消しの履歴も持ち越さない）
  const [documentId, setDocumentId] = useState(0)

  useEffect(() => {
    if (!opened || opened.file.size > MAX_BYTES) return
    let cancelled = false
    probeText(opened.file).then(
      (info) => {
        if (cancelled) return
        const doc = documentFromProbe(opened, info)
        setLoad(info.likelyBinary ? { status: 'binary', doc } : { status: 'ready', doc })
      },
      (error: unknown) => {
        if (!cancelled) setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    )
    return () => {
      cancelled = true
    }
  }, [opened])

  switch (load.status) {
    case 'ready':
      return (
        <TextEditorScreen
          key={documentId}
          initial={load.doc}
          isDragging={isDragging}
          onFiles={onFiles}
          onDirtyChange={onDirtyChange}
          // 新規を押したあとの文書は、開いたファイルとも再開したセッションとも別のもの
          session={documentId === 0 ? { opened, resumed: resumed ?? null } : { opened: null, resumed: null }}
          onNew={() => {
            setLoad({ status: 'ready', doc: untitledDocument() })
            setDocumentId((id) => id + 1)
          }}
        />
      )
    case 'loading':
      return <Notice>{m.loading}</Notice>
    case 'binary':
      return (
        <Notice title={m.binaryTitle}>
          <p>{m.binaryBody}</p>
          <Button
            variant="outline"
            size="xs"
            className="h-7 px-2.5"
            onClick={() => setLoad({ status: 'ready', doc: { ...load.doc, forcedBinary: true } })}
          >
            {m.openAnyway}
          </Button>
        </Notice>
      )
    case 'tooLarge':
      return <Notice title={m.tooLargeTitle}>{m.tooLargeBody(formatBytes(MAX_BYTES))}</Notice>
    case 'error':
      return <Notice>{m.loadFailed(load.message)}</Notice>
  }
}

/** エディタを出せないあいだの表示。ドロップは画面全体で受けるので、別のファイルを落とせば開き直せる */
function Notice({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="app">
      <aside className="sidebar">
        <SidebarHead />
      </aside>
      <div className="workspace">
        <div className="stage">
          <div className="preview-area">
            <div className="flex max-w-[420px] flex-col items-center gap-3 text-center text-sm text-muted-foreground">
              {title && <h1 className="text-base font-semibold text-foreground">{title}</h1>}
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

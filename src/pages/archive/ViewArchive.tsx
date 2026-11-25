import { ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SidebarHead } from '../../components/BrandMark'
import { SaveManyButton } from '../../components/SaveManyButton'
import {
  CheckboxField,
  Fact,
  Facts,
  LinkButton,
  Notice,
  SidebarFooter,
  SmallButton,
  SourceName,
} from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { openedFromFile, pickFiles } from '../../core/opened'
import type { OpenedFile } from '../../core/opened'
import { canPickFolder, pickSaveFolder, planSaveMany, saveFiles } from '../../core/save'
import type { SaveManyMethod } from '../../core/save'
import { useHotkey } from '../../core/useHotkey'
import { savedFilesMessage } from '../../core/useSave'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import {
  buildEntryTree,
  extractEntries,
  extractEntry,
  probeArchive,
  type ArchiveInfo,
  type ArchiveTreeNode,
} from '../../media/archive'
import { basename } from '../../media/archive/names'
import type { RenderedFile } from '../../media/types'
import { isAbortError } from '../../utils/abort'
import { formatBytes } from '../../utils/format'
import { EntryTree } from './EntryTree'
import { ARCHIVE_ACCEPT, describeError, type AddedFile } from './io'
import { messages } from './messages'
import {
  archiveBaseName,
  compressionRatio,
  extractionPaths,
  filesUnder,
  isMacJunk,
  planExtractLayout,
  toggleNode,
} from './treeModel'

const FORMAT_LABEL: Record<ArchiveInfo['format'], string> = {
  zip: 'ZIP',
  tar: 'tar',
  'tar.gz': 'tar.gz',
  gzip: 'gzip',
}

type Probe =
  | { status: 'loading'; progress: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; info: ArchiveInfo }

/** 根の直下がフォルダ 1 つだけのとき（よくある形）は、最初から開いておく */
function initialExpanded(root: ArchiveTreeNode): Set<string> {
  const expanded = new Set<string>()
  let node = root
  while (node.children.length === 1 && node.children[0].isDirectory) {
    node = node.children[0]
    expanded.add(node.path)
  }
  return expanded
}

/**
 * フォルダへ展開するときの置き方に直す。中身をばらまかないよう、1 つのフォルダに収まっていなければ
 * 圧縮ファイルの名前のフォルダを作ってその中へ入れる（planExtractLayout）
 */
function toFolderLayout(files: readonly RenderedFile[], archiveBase: string): RenderedFile[] {
  const layout = planExtractLayout(
    files.map((file) => file.filename),
    archiveBase
  )
  const blobs = new Map(files.map((file) => [file.filename, file.blob]))
  return layout.files.map(({ source, target }) => ({
    blob: blobs.get(source)!,
    filename: layout.folder === null ? target : `${layout.folder}/${target}`,
  }))
}

interface ViewArchiveProps {
  opened: OpenedFile
  onFiles: (files: OpenedFile[]) => void
  /** 中身を新しい圧縮ファイルの材料にして作成へ移る（null なら空から） */
  onCreate: (seed: { name: string; files: AddedFile[] } | null) => void
}

/** 開いた圧縮ファイルの中身を一覧し、選んで展開する・Bani で開く */
export function ViewArchive({ opened, onFiles, onCreate }: ViewArchiveProps) {
  const { t } = useI18n()
  const m = useLocalMessages(messages)
  const { file } = opened
  const base = archiveBaseName(file.name)
  const [probe, setProbe] = useState<Probe>({ status: 'loading', progress: 0 })
  const [showJunk, setShowJunk] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // 走っている展開の中止口と進み具合。進み具合は別に持ち、更新のたびに中止口が入れ替わらないようにする
  const [job, setJob] = useState<AbortController | null>(null)
  const [jobProgress, setJobProgress] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    probeArchive(file, {
      signal: controller.signal,
      onProgress: (progress) => setProbe({ status: 'loading', progress }),
    })
      .then((info) => {
        setExpanded(initialExpanded(buildEntryTree(info.entries.filter((entry) => !isMacJunk(entry.path)))))
        setProbe({ status: 'ready', info })
      })
      .catch((error: unknown) => {
        if (isAbortError(error)) return
        console.error('probeArchive failed:', error)
        setProbe({ status: 'error', message: describeError(error, m) })
      })
    return () => controller.abort()
    // 文言の切り替えで読み直さない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file])

  // 画面を離れたら走っている展開も止める（終わったあとの abort は何もしない）
  useEffect(() => () => job?.abort(), [job])

  const info = probe.status === 'ready' ? probe.info : null
  // macOS が圧縮のときに足す付随ファイル（__MACOSX/、._名前、.DS_Store）は、既定では一覧・展開から外す
  const junkCount = useMemo(() => info?.entries.filter((entry) => !entry.isDirectory && isMacJunk(entry.path)).length ?? 0, [info])
  const entries = useMemo(
    () => (info ? (showJunk ? info.entries : info.entries.filter((entry) => !isMacJunk(entry.path))) : null),
    [info, showJunk]
  )
  const root = useMemo(() => (entries ? buildEntryTree(entries) : null), [entries])
  const allSelectable = useMemo(() => (root ? toggleNode(root, new Set()) : new Set<string>()), [root])
  // 付随ファイルを隠したら、選択からも外す
  const selection = useMemo(() => new Set([...selected].filter((path) => allSelectable.has(path))), [selected, allSelectable])
  const folderCount = useMemo(() => entries?.filter((entry) => entry.isDirectory).length ?? 0, [entries])
  const fileCount = useMemo(() => (root ? filesUnder(root, false).length : 0), [root])
  const encryptedCount = useMemo(() => entries?.filter((entry) => entry.encrypted).length ?? 0, [entries])
  const shiftJis = useMemo(() => info?.entries.some((entry) => entry.nameEncoding === 'shift_jis') ?? false, [info])

  /**
   * 展開する中身の指定。全部を選んでいても、隠している付随ファイルがあれば「全部」とは言わず
   * 見えているファイルだけを名指しする（'all' は隠したものまで展開してしまう）
   */
  const pathsFor = (paths: ReadonlySet<string>) => {
    if (!root) return []
    const planned = extractionPaths(root, new Set(paths))
    return planned === 'all' && !showJunk && junkCount > 0 ? filesUnder(root) : planned
  }

  /** 展開して、最後の書き出しを work に任せる。中止・進み具合・失敗の通知をまとめて持つ */
  const withJob = useCallback(
    async (work: (signal: AbortSignal, onProgress: (p: number) => void) => Promise<void>) => {
      if (job) return
      const controller = new AbortController()
      setJob(controller)
      setJobProgress(0)
      try {
        await work(controller.signal, setJobProgress)
      } catch (error) {
        if (isAbortError(error)) return
        console.error('Extract failed:', error)
        toast.error(describeError(error, m))
      } finally {
        setJob(null)
      }
    },
    [job, m]
  )

  const extract = async (paths: ReadonlySet<string>, method: SaveManyMethod) => {
    if (!root || paths.size === 0) return
    // フォルダ選びはクリックの直後でないと断られるので、展開より先に聞く
    let directory: FileSystemDirectoryHandle | undefined
    if (method === 'folder') {
      try {
        directory = await pickSaveFolder()
      } catch (error) {
        if (!isAbortError(error)) toast.error(describeError(error, m))
        return
      }
    }
    await withJob(async (signal, onProgress) => {
      const files = await extractEntries(file, pathsFor(paths), { signal, onProgress })
      const saved = await saveFiles(method === 'folder' ? toFolderLayout(files, base) : files, method, {
        zipName: `${base}-extracted`,
        folder: directory,
      })
      toast(savedFilesMessage(t, saved))
    })
  }

  const openInBani = (node: ArchiveTreeNode) => {
    if (node.isDirectory || node.entry?.encrypted) return
    void withJob(async (signal, onProgress) => {
      const extracted = await extractEntry(file, node.path, { signal, onProgress })
      onFiles([openedFromFile(extracted)])
    })
  }

  const seedNew = () => {
    if (!root || !info) return
    const modified = new Map(info.entries.map((entry) => [entry.path, entry.modified]))
    void withJob(async (signal, onProgress) => {
      const files: RenderedFile[] =
        allSelectable.size === 0 ? [] : await extractEntries(file, pathsFor(allSelectable), { signal, onProgress })
      onCreate({
        name: base,
        files: files.map((item) => ({
          path: item.filename,
          file: new File([item.blob], basename(item.filename), {
            type: item.blob.type,
            lastModified: modified.get(item.filename)?.getTime() ?? Date.now(),
          }),
        })),
      })
    })
  }

  const busy = job !== null
  const ratio = info ? compressionRatio(info.totalSize, info.archiveSize) : null
  // 選んだものがあればそれを、なければ全部を展開する（保存ボタンと同じく、主の操作は 1 つ）
  const targets = selection.size > 0 ? selection : allSelectable
  const extractLabel = selection.size > 0 ? m.extractSelected(selection.size) : m.extractAll

  // ⌘S は主の展開方法で展開する（ほかの画面の保存と同じキー）。展開できないあいだもブラウザの保存は開かせない
  useHotkey(
    'mod+s',
    () => {
      if (busy || targets.size === 0) return
      void extract(targets, planSaveMany({ canPickFolder: canPickFolder(), count: targets.size }).primary)
    },
    { inEditable: true }
  )
  useHotkey('mod+a', () => setSelected(new Set(allSelectable)), { enabled: allSelectable.size > 0 })
  useHotkey('escape', () => setSelected(new Set()), { enabled: selection.size > 0 })

  return (
    <div className="app">
      <aside className="sidebar">
        <SidebarHead />
        <div className="sidebar-scroll">
          <Step index={1} title={t.stepInput}>
            <div className="flex flex-col gap-2">
              <SourceName title={file.name}>{file.name}</SourceName>
              {info && (
                <Facts>
                  <Fact label={m.factFormat}>{FORMAT_LABEL[info.format]}</Fact>
                  <Fact label={m.factEntries}>{fileCount}</Fact>
                  {folderCount > 0 && <Fact label={m.factFolders}>{folderCount}</Fact>}
                  <Fact label={m.factTotal}>{formatBytes(info.totalSize)}</Fact>
                  <Fact label={m.factCompressed}>{formatBytes(info.archiveSize)}</Fact>
                  {ratio !== null && <Fact label={m.factRatio}>{Math.round(ratio * 100)}%</Fact>}
                </Facts>
              )}
              {probe.status === 'loading' && (
                <StepHint>
                  {probe.progress > 0 ? m.readingProgress(Math.round(probe.progress * 100)) : m.reading}
                </StepHint>
              )}
              {probe.status === 'error' && <Notice tone="warn">{probe.message}</Notice>}
              {shiftJis && <Notice>{m.shiftJisNotice}</Notice>}
              {encryptedCount > 0 && <Notice tone="warn">{m.encryptedNotice(encryptedCount)}</Notice>}
              {junkCount > 0 && (
                <CheckboxField checked={showJunk} onChange={setShowJunk}>
                  {m.showMacJunk(junkCount)}
                </CheckboxField>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <SmallButton
                onClick={async () => {
                  const [picked] = await pickFiles({ accept: ARCHIVE_ACCEPT })
                  if (picked) onFiles([picked])
                }}
              >
                {t.selectFile}
              </SmallButton>
              <SmallButton onClick={() => onCreate(null)}>{m.newArchive}</SmallButton>
            </div>
          </Step>

          {root && (
            <Step index={2} title={m.stepActions}>
              <StepHint>{canPickFolder() ? m.extractHintFolder : m.extractHintDownload}</StepHint>
              <LinkButton disabled={busy} onClick={seedNew}>
                {m.seedNew}
              </LinkButton>
            </Step>
          )}
        </div>

        <SidebarFooter progress={job ? jobProgress * 100 : null} onCancel={() => job?.abort()}>
          <SaveManyButton
            count={targets.size}
            disabled={busy || targets.size === 0}
            primaryLabel={() => extractLabel}
            onSave={(method) => void extract(targets, method)}
          />
        </SidebarFooter>
      </aside>

      <div className="workspace">
        <div className="stage">
          {root ? (
            root.children.length === 0 ? (
              <div className="preview-area text-sm text-muted-foreground">{m.emptyArchive}</div>
            ) : (
              <EntryTree
                root={root}
                expanded={expanded}
                onExpandedChange={setExpanded}
                selected={selection}
                onSelectedChange={setSelected}
                showCompression={info?.format === 'zip' || info?.format === 'gzip'}
                onActivate={openInBani}
                renderActions={(node) =>
                  node.isDirectory || node.entry?.encrypted ? null : (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 focus-visible:opacity-100"
                      tabIndex={-1}
                      disabled={busy}
                      onClick={(e) => {
                        e.stopPropagation()
                        openInBani(node)
                      }}
                    >
                      <ExternalLink />
                      {m.openInBani}
                    </Button>
                  )
                }
              />
            )
          ) : (
            <div className="preview-area">
              <p className="max-w-[420px] text-center text-sm text-muted-foreground">
                {probe.status === 'error'
                  ? probe.message
                  : probe.status === 'loading' && probe.progress > 0
                    ? m.readingProgress(Math.round(probe.progress * 100))
                    : m.reading}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

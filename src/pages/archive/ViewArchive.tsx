import { ExternalLink } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { SidebarHead } from '../../components/BrandMark'
import { SourceName } from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { openedFromFile, pickFiles } from '../../core/opened'
import type { OpenedFile } from '../../core/opened'
import { downloadBlob } from '../../core/save'
import { useLocalMessages } from '../../i18n/local'
import {
  buildEntryTree,
  extractEntries,
  extractEntry,
  probeArchive,
  zipRenderedFiles,
  type ArchiveInfo,
  type ArchiveTreeNode,
} from '../../media/archive'
import { basename } from '../../media/archive/names'
import type { RenderedFile } from '../../media/types'
import { isAbortError } from '../../utils/abort'
import { formatBytes } from '../../utils/format'
import { pickOutputDirectory } from '../../utils/fileSystem'
import { EntryTree } from './EntryTree'
import { ARCHIVE_ACCEPT, canPickDirectory, describeError, writeToDirectory, type AddedFile } from './io'
import { messages } from './messages'
import { Fact, Facts, Notice, SplitButton, type SplitAction } from './parts'
import { archiveBaseName, compressionRatio, downloadNames, extractionPaths, filesUnder, toggleNode } from './treeModel'

const FORMAT_LABEL: Record<ArchiveInfo['format'], string> = {
  zip: 'ZIP',
  tar: 'tar',
  'tar.gz': 'tar.gz',
  gzip: 'gzip',
}

type Probe =
  | { status: 'loading'; progress: number }
  | { status: 'error'; message: string }
  | { status: 'ready'; info: ArchiveInfo; root: ArchiveTreeNode }

type Method = 'folder' | 'zip' | 'each'

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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

interface ViewArchiveProps {
  opened: OpenedFile
  onFiles: (files: OpenedFile[]) => void
  /** 中身を新しい圧縮ファイルの材料にして作成へ移る（null なら空から） */
  onCreate: (seed: { name: string; files: AddedFile[] } | null) => void
}

/** 開いた圧縮ファイルの中身を一覧し、選んで展開する・Bani で開く */
export function ViewArchive({ opened, onFiles, onCreate }: ViewArchiveProps) {
  const m = useLocalMessages(messages)
  const { file } = opened
  const base = archiveBaseName(file.name)
  const [probe, setProbe] = useState<Probe>({ status: 'loading', progress: 0 })
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
        const root = buildEntryTree(info.entries)
        setExpanded(initialExpanded(root))
        setProbe({ status: 'ready', info, root })
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

  const root = probe.status === 'ready' ? probe.root : null
  const info = probe.status === 'ready' ? probe.info : null
  const allSelectable = useMemo(() => (root ? toggleNode(root, new Set()) : new Set<string>()), [root])
  const folderCount = useMemo(() => info?.entries.filter((entry) => entry.isDirectory).length ?? 0, [info])
  const fileCount = useMemo(() => (root ? filesUnder(root, false).length : 0), [root])
  const encryptedCount = useMemo(() => info?.entries.filter((entry) => entry.encrypted).length ?? 0, [info])
  const shiftJis = useMemo(() => info?.entries.some((entry) => entry.nameEncoding === 'shift_jis') ?? false, [info])

  /** 展開して、最後の書き出しを do に任せる。中止・進み具合・失敗の通知をまとめて持つ */
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

  const extract = async (paths: Set<string>, method: Method) => {
    if (!root || paths.size === 0) return
    // フォルダ選びはクリックの直後でないと断られるので、展開より先に聞く
    let directory: FileSystemDirectoryHandle | null = null
    if (method === 'folder') {
      try {
        directory = await pickOutputDirectory()
      } catch (error) {
        if (!isAbortError(error)) toast.error(describeError(error, m))
        return
      }
    }
    await withJob(async (signal, onProgress) => {
      const files = await extractEntries(file, extractionPaths(root, paths), { signal, onProgress })
      if (directory) {
        const folder = await writeToDirectory(directory, files, base)
        toast(m.extractedTo(files.length, folder))
        return
      }
      if (files.length === 1 || method === 'each') {
        const names = downloadNames(files.map((item) => item.filename))
        for (const [i, item] of files.entries()) {
          downloadBlob(item.blob, names[i])
          // 続けざまのダウンロードはブラウザに間引かれることがあるので、少し間を空ける
          if (i < files.length - 1) await pause(200)
        }
        toast(m.downloaded(files.length))
        return
      }
      const zipped = await zipRenderedFiles(files, `${base}-extracted`, { signal })
      downloadBlob(zipped.blob, zipped.filename)
      toast(m.downloaded(files.length))
    })
  }

  /** 展開のしかたの候補。フォルダに書き出せるならそれが主、なければダウンロード */
  const actionsFor = (paths: Set<string>, label: string): { primary: SplitAction; others: SplitAction[] } => {
    const folder: SplitAction = { key: 'folder', label: m.extractToFolder, run: () => void extract(paths, 'folder') }
    const zip: SplitAction = { key: 'zip', label: m.downloadZip, run: () => void extract(paths, 'zip') }
    const each: SplitAction = {
      key: 'each',
      label: paths.size === 1 ? m.downloadOne : m.downloadEach,
      run: () => void extract(paths, 'each'),
    }
    const downloads = paths.size === 1 ? [each] : [zip, each]
    if (canPickDirectory()) return { primary: { ...folder, label }, others: downloads }
    const [first, ...rest] = downloads
    return { primary: { ...first, label }, others: rest }
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
        allSelectable.size === 0 ? [] : await extractEntries(file, extractionPaths(root, allSelectable), { signal, onProgress })
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
  const selectedActions = actionsFor(selected, m.extractSelected(selected.size))
  const allActions = actionsFor(allSelectable, m.extractAll)

  return (
    <div className="app">
      <aside className="sidebar">
        <SidebarHead />
        <div className="sidebar-scroll">
          <Step index={1} title={m.stepInput}>
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
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                variant="outline"
                size="xs"
                className="h-7 px-2.5"
                onClick={async () => {
                  const [picked] = await pickFiles({ accept: ARCHIVE_ACCEPT })
                  if (picked) onFiles([picked])
                }}
              >
                {m.openArchive}
              </Button>
              <Button variant="outline" size="xs" className="h-7 px-2.5" onClick={() => onCreate(null)}>
                {m.newArchive}
              </Button>
            </div>
          </Step>

          {root && (
            <Step index={2} title={m.stepActions}>
              <SplitButton
                primary={selectedActions.primary}
                others={selectedActions.others}
                disabled={busy || selected.size === 0}
                moreLabel={m.extractMore}
              />
              <SplitButton
                variant="outline"
                primary={allActions.primary}
                others={allActions.others}
                disabled={busy || allSelectable.size === 0}
                moreLabel={m.extractMore}
              />
              <StepHint>{canPickDirectory() ? m.extractHintFolder : m.extractHintDownload}</StepHint>
              <Button
                variant="link"
                size="xs"
                className="h-auto self-start px-0 text-[11px] font-normal text-muted-foreground underline hover:text-foreground"
                disabled={busy}
                onClick={seedNew}
              >
                {m.seedNew}
              </Button>
            </Step>
          )}
        </div>

        {job && (
          <div className="sidebar-footer">
            <Progress value={jobProgress * 100} className="h-1" />
            <Button variant="destructive" className="w-full" onClick={() => job.abort()}>
              {m.cancelWithProgress(Math.round(jobProgress * 100))}
            </Button>
          </div>
        )}
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
                selected={selected}
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

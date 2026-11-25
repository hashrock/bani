import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  FilePlus,
  ImagePlus,
  Redo2,
  RotateCcw,
  RotateCw,
  Trash2,
  Undo2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { solidOnClass } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { SidebarHead } from '../../components/BrandMark'
import { FileUpload } from '../../components/FileUpload'
import { SaveButton } from '../../components/SaveButton'
import { SourceName } from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { pickFiles } from '../../core/opened'
import { usePersistentState } from '../../core/usePersistentState'
import { useRecipeHistory } from '../../core/useRecipeHistory'
import { useSave } from '../../core/useSave'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import {
  applyPdfEdit,
  chunkPageRanges,
  createPdfRecipe,
  imagesToPdf,
  isPdfError,
  parsePageRanges,
  probePdf,
  renderPdf,
  splitPdf,
  type PdfEdit,
  type PdfErrorCode,
  type PdfInfo,
  type PdfRecipe,
} from '../../media/pdf'
import { isAbortError } from '../../utils/abort'
import { formatBytes } from '../../utils/format'
import type { EditPageProps } from '../types'
import { messages } from './messages'
import {
  clickSelection,
  dropSlotToMoveTarget,
  emptySelection,
  pageKeys,
  pruneSelection,
  selectAll,
  selectedIndices,
  stepMoveTarget,
  type Selection,
} from './pageModel'
import { PageGrid } from './PageGrid'
import { saveFiles } from './saveFiles'
import { ThumbnailStore } from './thumbnailStore'

/** レシピの source が指す入力。0 番は開いたファイルで、結合で後ろに増えるだけ（位置は変わらない） */
interface Source {
  file: File
  info: PdfInfo
}

type Status = { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; code: PdfErrorCode }

type SplitMode = 'ranges' | 'each'

const EMPTY_RECIPE: PdfRecipe = { pages: [] }
// 一覧の 1 枠は 132px 前後。高精細な画面でもぼやけないよう 2 倍まで描く
const THUMBNAIL_SIZE = 160 * Math.min(2, Math.max(1, globalThis.devicePixelRatio || 1))
// 画像から作るページは、ほかの PDF と並べても違和感のない A4 にそろえる
const IMAGE_PAGE = { pageSize: 'a4', margin: 24, orientation: 'auto' } as const

const errorCode = (error: unknown): PdfErrorCode => (isPdfError(error) ? error.code : 'invalid')

/** PDF を開き、ページの並べ替え・回転・削除・抽出、結合、分割をして保存する画面 */
export default function EditPage({ opened, isDragging, onFiles }: EditPageProps) {
  const { t } = useI18n()
  const m = useLocalMessages(messages)
  const file = opened?.file ?? null

  const [status, setStatus] = useState<Status>({ kind: 'loading' })
  const [sources, setSources] = useState<Source[]>([])
  // 追加のたびに入力の位置を決めるので、描画を待たずに最新の並びを読めるようにする
  const sourcesRef = useRef<Source[]>([])
  const history = useRecipeHistory<PdfRecipe>(EMPTY_RECIPE)
  const { recipe, update, replace } = history
  const [selectionState, setSelection] = useState<Selection>(emptySelection)
  const [store] = useState(() => new ThumbnailStore(THUMBNAIL_SIZE))
  const [busy, setBusy] = useState<'adding' | 'splitting' | null>(null)

  const [keepText, setKeepText] = useState('')
  const [keepError, setKeepError] = useState<string | null>(null)
  const [splitMode, setSplitMode] = usePersistentState<SplitMode>('pdf.splitMode', 'ranges')
  const [splitText, setSplitText] = useState('')

  const keys = useMemo(() => pageKeys(recipe.pages), [recipe.pages])
  // 削除や取り消しで消えたページは、描画のたびに選択から落とす（effect で直すと 1 回ずれる）
  const selection = pruneSelection(selectionState, keys)
  const selected = useMemo(() => selectedIndices(selection, keys), [selection, keys])
  const ready = status.kind === 'ready'
  const pageCount = recipe.pages.length

  const addSources = useCallback((added: Source[]) => {
    const next = [...sourcesRef.current, ...added]
    sourcesRef.current = next
    setSources(next)
    return next
  }, [])

  // サムネイルの描き手は画面を閉じたら手放す（pdf.js のワーカー側の文書と画像の URL）
  useEffect(() => {
    store.activate()
    return () => store.dispose()
  }, [store])
  useEffect(() => {
    sources.forEach((source, index) => store.setSource(index, source.file))
  }, [store, sources])

  // 開いたファイルを読む。暗号化されていれば編集はさせず、理由だけを示す
  useEffect(() => {
    if (!file) return
    let cancelled = false
    probePdf(file).then(
      (info) => {
        if (cancelled) return
        if (info.encrypted) {
          setStatus({ kind: 'failed', code: 'encrypted' })
          return
        }
        sourcesRef.current = []
        addSources([{ file, info }])
        replace(createPdfRecipe([info]))
        setStatus({ kind: 'ready' })
      },
      (error: unknown) => {
        if (cancelled) return
        console.error('PDF probe failed:', error)
        setStatus({ kind: 'failed', code: errorCode(error) })
      }
    )
    return () => {
      cancelled = true
    }
  }, [file, addSources, replace])

  const apply = useCallback(
    (edit: PdfEdit) =>
      update((current) =>
        applyPdfEdit(
          current,
          edit,
          sourcesRef.current.map((source) => source.info)
        )
      ),
    [update]
  )

  const rotate = (by: 90 | -90) => apply({ type: 'rotate', indices: selected, by })
  const remove = () => apply({ type: 'remove', indices: selected })
  const step = (delta: -1 | 1) => {
    const to = stepMoveTarget(selected, delta, pageCount)
    if (to !== null) apply({ type: 'move', indices: selected, to })
  }

  /** 読めた PDF を入力に足し、そのページを末尾につなぐ（1 回の取り消しで戻せるよう 1 段にまとめる） */
  const appendFiles = async (files: File[]) => {
    const probed: Source[] = []
    for (const added of files) {
      try {
        const info = await probePdf(added)
        if (info.encrypted) toast.error(m.skippedEncrypted(added.name))
        else if (info.pageCount > 0) probed.push({ file: added, info })
      } catch (error) {
        console.error('PDF probe failed:', error)
        toast.error(m.skippedInvalid(added.name))
      }
    }
    if (probed.length === 0) return
    const start = sourcesRef.current.length
    const all = addSources(probed)
    const shapes = all.map((source) => source.info)
    update((current) =>
      probed.reduce(
        (next, _, offset) => applyPdfEdit(next, { type: 'appendSource', source: start + offset }, shapes),
        current
      )
    )
    toast(m.appended(probed.reduce((sum, source) => sum + source.info.pageCount, 0)))
  }

  const withBusy = async (kind: 'adding' | 'splitting', task: () => Promise<void>) => {
    setBusy(kind)
    try {
      await task()
    } finally {
      setBusy(null)
    }
  }

  const addPdfs = async () => {
    const picked = await pickFiles({ multiple: true, accept: 'application/pdf' })
    if (picked.length === 0) return
    await withBusy('adding', () => appendFiles(picked.map(({ file }) => file)))
  }

  const addImages = async () => {
    const picked = await pickFiles({ multiple: true, accept: 'image/*' })
    if (picked.length === 0) return
    await withBusy('adding', async () => {
      try {
        const rendered = await imagesToPdf(
          picked.map(({ file }) => file),
          IMAGE_PAGE
        )
        await appendFiles([new File([rendered.blob], rendered.filename, { type: 'application/pdf' })])
      } catch (error) {
        console.error('imagesToPdf failed:', error)
        toast.error(isPdfError(error) ? m.pdfError[error.code] : m.imagesFailed)
      }
    })
  }

  const keep = () => {
    const parsed = parsePageRanges(keepText, pageCount)
    if (!parsed.ok) {
      setKeepError(m.rangeError(parsed.error, pageCount))
      return
    }
    setKeepError(null)
    setKeepText('')
    apply({ type: 'keepRanges', ranges: parsed.ranges })
  }

  // 分割は打っている途中から件数や誤りを見せる（空欄はまだ誤りとしない）
  const splitRanges =
    splitMode === 'each'
      ? ({ ok: true, ranges: chunkPageRanges(pageCount, 1) } as const)
      : parsePageRanges(splitText, pageCount)
  const splitError =
    !splitRanges.ok && splitText.trim() !== '' ? m.rangeError(splitRanges.error, pageCount) : null

  const files = sources.map((source) => source.file)
  const usedSources = new Set(recipe.pages.map((page) => page.source))

  const split = () =>
    withBusy('splitting', async () => {
      if (!splitRanges.ok || !file) return
      try {
        // 分割は編集後の並びに対して行う。いったん 1 つにまとめてから範囲ごとに切り出す
        const edited = await renderPdf(files, recipe)
        const merged = new File([edited.blob], file.name, { type: 'application/pdf' })
        const parts = await splitPdf(merged, splitRanges.ranges)
        const saved = await saveFiles(parts)
        toast(
          saved.kind === 'folder'
            ? m.splitSaved(saved.count, saved.folder)
            : m.splitDownloaded(saved.count)
        )
      } catch (error) {
        if (isAbortError(error)) return
        console.error('Split failed:', error)
        const message = isPdfError(error)
          ? m.pdfError[error.code]
          : error instanceof Error
            ? error.message
            : String(error)
        toast.error(m.splitFailed(message))
      }
    })

  // ページの編集は劣化しない。開いたファイルだけからできていれば上書きが主になる
  const save = useSave({
    opened,
    lossless: true,
    sameFormat: usedSources.size === 1 && usedSources.has(0),
    canCopy: false,
    disabled: !ready || pageCount === 0 || busy !== null,
    render: () => renderPdf(files, recipe),
    onSourceReplaced: (next) => onFiles([next]),
  })

  const pageInfo = useCallback(
    (source: number, page: number) => sources[source]?.info.pages[page],
    [sources]
  )
  const sourceLabel = useMemo(
    () => (sources.length > 1 ? (source: number) => `${source + 1}` : null),
    [sources.length]
  )

  const info = sources[0]?.info
  const noSelection = selected.length === 0
  const locked = !ready || busy !== null

  return (
    <div className="app">
      <aside className="sidebar">
        <SidebarHead />

        <div className="sidebar-scroll">
          <Step index={1} title={m.stepInput}>
            {file ? (
              <div className="flex flex-col gap-2">
                <SourceName title={file.name}>{file.name}</SourceName>
                <Facts>
                  <Fact label={m.factSize}>{formatBytes(file.size)}</Fact>
                  <Fact label={m.factPages}>{info ? m.pageCount(info.pageCount) : '—'}</Fact>
                  {info?.title && <Fact label={m.factTitle}>{info.title}</Fact>}
                  {info?.author && <Fact label={m.factAuthor}>{info.author}</Fact>}
                </Facts>
                {sources.length > 1 && (
                  <div className="flex flex-col gap-1 border-t border-secondary pt-2">
                    <div className="text-[11px] text-muted-foreground">{m.factSources}</div>
                    <ol className="flex flex-col gap-0.5 text-xs">
                      {sources.map((source, index) => (
                        <li key={index} className="flex gap-2">
                          <span className="w-4 shrink-0 text-right text-muted-foreground tabular-nums">
                            {index + 1}
                          </span>
                          <span className="truncate" title={source.file.name}>
                            {source.file.name}
                          </span>
                          <span className="ml-auto shrink-0 text-muted-foreground">
                            {m.pageCount(source.info.pageCount)}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            ) : (
              <StepHint>{t.inputEmpty}</StepHint>
            )}

            <div className="flex flex-wrap gap-1.5">
              {ready ? (
                <>
                  <SmallButton onClick={() => void addPdfs()} disabled={locked}>
                    <FilePlus />
                    {busy === 'adding' ? m.adding : m.addPdf}
                  </SmallButton>
                  <SmallButton onClick={() => void addImages()} disabled={locked}>
                    <ImagePlus />
                    {m.addImages}
                  </SmallButton>
                </>
              ) : (
                <SmallButton
                  onClick={async () => {
                    const [picked] = await pickFiles({ accept: 'application/pdf' })
                    if (picked) onFiles([picked])
                  }}
                >
                  {m.selectFile}
                </SmallButton>
              )}
            </div>
            {ready && <StepHint>{m.addHint}</StepHint>}
          </Step>

          {ready && (
            <>
              <Step index={2} title={m.stepEdit}>
                <div className="flex flex-wrap gap-1.5">
                  <IconButton label={t.undo} onClick={history.undo} disabled={!history.canUndo}>
                    <Undo2 />
                  </IconButton>
                  <IconButton label={t.redo} onClick={history.redo} disabled={!history.canRedo}>
                    <Redo2 />
                  </IconButton>
                  <span className="mx-0.5 w-px self-stretch bg-border" />
                  <IconButton label={m.rotateLeft} onClick={() => rotate(-90)} disabled={noSelection}>
                    <RotateCcw />
                  </IconButton>
                  <IconButton label={m.rotateRight} onClick={() => rotate(90)} disabled={noSelection}>
                    <RotateCw />
                  </IconButton>
                  <IconButton
                    label={m.moveLeft}
                    onClick={() => step(-1)}
                    disabled={stepMoveTarget(selected, -1, pageCount) === null}
                  >
                    <ArrowLeft />
                  </IconButton>
                  <IconButton
                    label={m.moveRight}
                    onClick={() => step(1)}
                    disabled={stepMoveTarget(selected, 1, pageCount) === null}
                  >
                    <ArrowRight />
                  </IconButton>
                  <IconButton label={m.removeSelected} onClick={remove} disabled={noSelection}>
                    <Trash2 />
                  </IconButton>
                </div>
                <StepHint>{noSelection ? m.editNeedsSelection : m.selection(selected.length, pageCount)}</StepHint>

                <RangeField
                  id="pdf-keep"
                  label={m.keepRanges}
                  placeholder={m.keepRangesPlaceholder}
                  value={keepText}
                  error={keepError}
                  onChange={(value) => {
                    setKeepText(value)
                    setKeepError(null)
                  }}
                  onSubmit={keep}
                  action={
                    <SmallButton onClick={keep} disabled={pageCount === 0}>
                      {m.keepApply}
                    </SmallButton>
                  }
                />
                <StepHint>{m.keepHint}</StepHint>
              </Step>

              <Step index={3} title={m.stepSplit}>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  spacing={0}
                  size="sm"
                  value={splitMode}
                  onValueChange={(value) => {
                    if (value === 'ranges' || value === 'each') setSplitMode(value)
                  }}
                  aria-label={m.splitMode}
                >
                  <ToggleGroupItem value="ranges" className={cn('h-7 px-2.5 text-xs', solidOnClass)}>
                    {m.splitByRanges}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="each" className={cn('h-7 px-2.5 text-xs', solidOnClass)}>
                    {m.splitEachPage}
                  </ToggleGroupItem>
                </ToggleGroup>
                {splitMode === 'ranges' && (
                  <RangeField
                    id="pdf-split"
                    label={m.splitRanges}
                    placeholder={m.splitRangesPlaceholder}
                    value={splitText}
                    error={splitError}
                    onChange={setSplitText}
                    onSubmit={() => void split()}
                  />
                )}
                <SmallButton
                  onClick={() => void split()}
                  disabled={locked || !splitRanges.ok || pageCount === 0}
                >
                  {busy === 'splitting'
                    ? m.splitRunning
                    : m.splitRun(splitRanges.ok ? splitRanges.ranges.length : 0)}
                </SmallButton>
                <StepHint>{m.splitHint}</StepHint>
              </Step>

              <Step index={4} title={m.stepOutput}>
                {pageCount === 0 ? (
                  <p className="text-[11px] leading-normal text-destructive">{m.outputEmpty}</p>
                ) : (
                  <StepHint>
                    {m.outputPages(pageCount)}
                    {usedSources.size > 1 && <br />}
                    {usedSources.size > 1 && m.outputMerged(usedSources.size)}
                  </StepHint>
                )}
              </Step>
            </>
          )}
        </div>

        {file && (
          <div className="sidebar-footer">
            <SaveButton save={save} disabled={!ready || pageCount === 0 || busy !== null} />
          </div>
        )}
      </aside>

      <div className="workspace">
        <div className={cn('stage', isDragging && 'drop-target-active')}>
          {!file ? (
            <FileUpload
              isDragging={isDragging}
              message={m.dropHere}
              hint={m.dropHint}
              buttonLabel={m.selectFile}
              accept="application/pdf"
              onFiles={onFiles}
            />
          ) : status.kind === 'loading' ? (
            <Notice>{m.loading}</Notice>
          ) : status.kind === 'failed' ? (
            <Notice title={status.code === 'encrypted' ? m.encryptedTitle : m.invalidTitle}>
              {status.code === 'encrypted' ? m.encryptedBody : m.pdfError[status.code]}
            </Notice>
          ) : (
            <>
              <div className="flex items-center gap-3 border-b bg-background py-2 pr-14 pl-4 text-xs">
                <span className="font-medium tabular-nums">{m.selection(selected.length, pageCount)}</span>
                <span className="truncate text-muted-foreground">{m.selectionHint}</span>
                <div className="ml-auto flex shrink-0 gap-1">
                  <SmallButton
                    variant="ghost"
                    onClick={() => setSelection(selectAll(keys))}
                    disabled={pageCount === 0}
                  >
                    {m.selectAll}
                  </SmallButton>
                  <SmallButton
                    variant="ghost"
                    onClick={() => setSelection(emptySelection)}
                    disabled={noSelection}
                  >
                    {m.clearSelection}
                  </SmallButton>
                </div>
              </div>
              {pageCount === 0 ? (
                <Notice>{m.outputEmpty}</Notice>
              ) : (
                (
                  <PageGrid
                    pages={recipe.pages}
                    keys={keys}
                    selection={selection}
                    store={store}
                    pageInfo={pageInfo}
                    sourceLabel={sourceLabel}
                    onSelect={(index, modifiers) =>
                      setSelection((current) =>
                        clickSelection(pruneSelection(current, keys), keys, index, modifiers)
                      )
                    }
                    onSelectAll={() => setSelection(selectAll(keys))}
                    onClearSelection={() => setSelection(emptySelection)}
                    onDragStartPage={(index) => {
                      if (selection.keys.has(keys[index])) return selected
                      setSelection(clickSelection(selection, keys, index))
                      return [index]
                    }}
                    onDropAt={(slot, indices) =>
                      apply({ type: 'move', indices, to: dropSlotToMoveTarget(slot, indices) })
                    }
                    onRemove={remove}
                    onRotate={rotate}
                    onStep={step}
                  />
                )
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** 名前と値を左右に振り分けた 1 行（動画の画面と同じ見た目） */
function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  )
}

function Facts({ children }: { children: ReactNode }) {
  return <dl className="flex flex-col gap-1 text-xs">{children}</dl>
}

function SmallButton({
  variant = 'outline',
  className,
  ...props
}: ComponentProps<typeof Button>) {
  return <Button variant={variant} size="xs" className={cn('h-7 px-2.5', className)} {...props} />
}

function IconButton({
  label,
  children,
  ...props
}: { label: string } & Omit<ComponentProps<typeof Button>, 'aria-label'>) {
  return (
    <Button variant="outline" size="icon-sm" className="size-7" aria-label={label} title={label} {...props}>
      {children}
    </Button>
  )
}

/** ページ範囲の入力欄。Enter で決める */
function RangeField({
  id,
  label,
  placeholder,
  value,
  error,
  onChange,
  onSubmit,
  action,
}: {
  id: string
  label: string
  placeholder: string
  value: string
  error: string | null
  onChange: (value: string) => void
  onSubmit: () => void
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[11px] text-muted-foreground">
        {label}
      </label>
      <div className="flex gap-1.5">
        <Input
          id={id}
          value={value}
          placeholder={placeholder}
          aria-invalid={error !== null}
          aria-describedby={error ? `${id}-error` : undefined}
          className="h-7 text-xs md:text-xs"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onSubmit()
            }
          }}
        />
        {action}
      </div>
      {error && (
        <p id={`${id}-error`} className="text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

/** 一覧の代わりに出す案内（読み込み中、開けない理由など） */
function Notice({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="flex max-w-[420px] flex-col gap-2 text-center">
        {title && <h2 className="text-base font-semibold">{title}</h2>}
        <p className="text-[13px] leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, ArrowRight, FilePlus, ImagePlus, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { solidOnClass } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { useReportUnsaved } from '../../app/leaveGuard'
import { useLocalDrop } from '../../app/useLocalDrop'
import type { DragItemKind } from '../../app/useLocalDrop'
import { SidebarHead } from '../../components/BrandMark'
import { FileUpload } from '../../components/FileUpload'
import { SaveButton } from '../../components/SaveButton'
import { SaveManyButton } from '../../components/SaveManyButton'
import {
  Fact,
  Facts,
  HistoryButtons,
  IconButton,
  ResetSettingsButton,
  SidebarFooter,
  SmallButton,
  SourceName,
  ToolbarDivider,
} from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { openedFromFile, pickFiles } from '../../core/opened'
import type { OpenedFile } from '../../core/opened'
import { canPickFolder, pickSaveFolder, planSaveMany, saveFiles } from '../../core/save'
import type { SaveManyMethod } from '../../core/save'
import { shouldHandle, useHotkey } from '../../core/useHotkey'
import { usePersistentState } from '../../core/usePersistentState'
import { useRecipeHistory } from '../../core/useRecipeHistory'
import { useSessionRecipe } from '../../core/useSessionRecipe'
import { savedFilesMessage, useSave } from '../../core/useSave'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import {
  applyPdfEdit,
  chunkPageRanges,
  compressImageSettings,
  compressPdf,
  createPdfRasterizer,
  createPdfRecipe,
  imagesToPdf,
  isPdfError,
  pageImageNames,
  parsePageRanges,
  probePdf,
  renderPageToImageFile,
  renderPagesToImages,
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
import { OutputSteps } from './OutputSteps'
import { DEFAULT_OUTPUT, targetPages, type PdfOutputSettings } from './output'
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
import { ThumbnailStore } from './thumbnailStore'
import { useRasterEstimate } from './useRasterEstimate'

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

const stemOf = (name: string) => name.replace(/\.pdf$/i, '') || 'document'

const errorMessage = (error: unknown, pdfError: Record<PdfErrorCode, string>) =>
  isPdfError(error) ? pdfError[error.code] : error instanceof Error ? error.message : String(error)

const errorCode = (error: unknown): PdfErrorCode => (isPdfError(error) ? error.code : 'invalid')

const isPdfItem = (item: DragItemKind) => item.type === 'application/pdf'
const isImageItem = (item: DragItemKind) => item.type.startsWith('image/') && item.type !== 'image/svg+xml'
/** ページ一覧に落としたとき、足せるもの（PDF と画像）だけなら足す。ほかが混ざれば開き直しに任せる */
const acceptsPages = (items: DragItemKind[]) =>
  items.length > 0 && items.every((item) => isPdfItem(item) || isImageItem(item))

/** PDF を開き、ページの並べ替え・回転・削除・抽出、結合、分割をして保存する画面 */
export default function EditPage({ opened, isDragging, onFiles, onReopen, onDirtyChange, resumed }: EditPageProps) {
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
  const [busy, setBusy] = useState<'adding' | 'splitting' | 'exporting' | 'opening' | null>(null)
  // ページを画像に描く書き出し（画像・圧縮）は時間がかかるので、進み具合と中止を下端に出す
  const [progress, setProgress] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [rasterizer] = useState(() => createPdfRasterizer())
  const [output, setOutput] = usePersistentState<PdfOutputSettings>('pdf.output', DEFAULT_OUTPUT)
  // 圧縮して保存した大きさ。どのページ・設定で作ったかも持ち、変われば出さない
  const [actual, setActual] = useState<{ key: string; bytes: number } | null>(null)
  // 圧縮して保存した先。PDF の上書き先とは分けて持つ（下の useSave）
  const [compressHandle, setCompressHandle] = useState<FileSystemFileHandle | null>(null)

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
  useEffect(() => {
    sources.forEach((source, index) => rasterizer.setSource(index, source.file))
  }, [rasterizer, sources])
  // StrictMode で一度閉じても、次に描くときに開き直すので作り直さなくてよい
  useEffect(() => () => void rasterizer.destroy(), [rasterizer])
  // 画面を離れたら、走っている書き出しも止める
  useEffect(() => () => abortRef.current?.abort(), [])

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

  const withBusy = async (kind: NonNullable<typeof busy>, task: () => Promise<void>) => {
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

  /** 画像を A4 のページにして末尾に足す */
  const appendImages = async (images: File[]) => {
    try {
      const rendered = await imagesToPdf(images, IMAGE_PAGE)
      await appendFiles([new File([rendered.blob], rendered.filename, { type: 'application/pdf' })])
    } catch (error) {
      console.error('imagesToPdf failed:', error)
      toast.error(isPdfError(error) ? m.pdfError[error.code] : m.imagesFailed)
    }
  }

  const addImages = async () => {
    const picked = await pickFiles({ multiple: true, accept: 'image/*' })
    if (picked.length === 0) return
    await withBusy('adding', () => appendImages(picked.map(({ file }) => file)))
  }

  // 開いている PDF のページ一覧に落とした PDF・画像は、開き直さずに末尾へ足す（PDF を追加・画像を追加と同じ）
  const pageDrop = useLocalDrop({
    enabled: status.kind === 'ready' && busy === null,
    accepts: acceptsPages,
    onDrop: (dropped: OpenedFile[]) =>
      void withBusy('adding', async () => {
        const files = dropped.map(({ file }) => file)
        const pdfs = files.filter((item) => item.type === 'application/pdf')
        const images = files.filter((item) => item.type !== 'application/pdf')
        if (pdfs.length > 0) await appendFiles(pdfs)
        if (images.length > 0) await appendImages(images)
      }),
  })

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

  const split = (method: SaveManyMethod) =>
    withBusy('splitting', async () => {
      if (!splitRanges.ok || !file) return
      try {
        // 分割は編集後の並びに対して行う。いったん 1 つにまとめてから範囲ごとに切り出す
        const edited = await renderPdf(files, recipe)
        const merged = new File([edited.blob], file.name, { type: 'application/pdf' })
        const parts = await splitPdf(merged, splitRanges.ranges)
        const saved = await saveFiles(parts, method, { zipName: `${file.name.replace(/\.pdf$/i, '')}-split` })
        toast(savedFilesMessage(t, saved))
      } catch (error) {
        if (isAbortError(error)) return
        console.error('Split failed:', error)
        toast.error(m.splitFailed(errorMessage(error, m.pdfError)))
      }
    })

  const stem = stemOf(file?.name ?? 'document.pdf')
  const target = targetPages(recipe.pages, selected, output.scope)
  const firstUsed = sources[recipe.pages[0]?.source ?? 0]
  const originalBytes = [...usedSources].reduce((sum, source) => sum + (sources[source]?.file.size ?? 0), 0)
  const compressing = output.kind === 'compress'
  const imagesMode = ready && output.kind === 'images'
  const compressKey = JSON.stringify([recipe.pages, output.compress])
  const { estimate, estimating } = useRasterEstimate(
    rasterizer,
    compressing ? recipe.pages : target.pages,
    compressing ? compressImageSettings(output.compress) : output.images,
    compressing,
    ready && output.kind !== 'pdf' && pageCount > 0 && busy === null
  )

  /** 中止できる書き出しを走らせ、進み具合を下端に出す */
  const withProgress = async <T,>(
    task: (options: { signal: AbortSignal; onProgress: (progress: number) => void }) => Promise<T>
  ) => {
    const controller = new AbortController()
    abortRef.current = controller
    setProgress(0)
    try {
      return await task({ signal: controller.signal, onProgress: (value) => setProgress(value * 100) })
    } finally {
      abortRef.current = null
      setProgress(null)
    }
  }

  const saveImages = (method: SaveManyMethod) =>
    withBusy('exporting', async () => {
      if (target.pages.length === 0) return
      try {
        // 描き終えるまで待つと、フォルダを選ぶ画面を開ける操作の猶予が切れるので、先に選ばせる
        const folder = method === 'folder' ? await pickSaveFolder() : undefined
        const names = pageImageNames(stem, target.numbers, pageCount, output.images.format)
        const images = await withProgress((options) =>
          renderPagesToImages(rasterizer, target.pages, output.images, names, options)
        )
        const saved = await saveFiles(images, method, { zipName: `${stem}-images`, folder })
        toast(savedFilesMessage(t, saved))
      } catch (error) {
        if (isAbortError(error)) return
        console.error('PDF to images failed:', error)
        toast.error(m.exportFailed(errorMessage(error, m.pdfError)))
      }
    })

  const openInImage = () =>
    withBusy('opening', async () => {
      if (selected.length !== 1) return
      const [index] = selected
      try {
        const [name] = pageImageNames(stem, [index + 1], pageCount, output.images.format)
        const image = await renderPageToImageFile(rasterizer, recipe.pages[index], output.images, name)
        // 開き直しは振り分け（planIntake）を通るので、保存していない編集があれば先に確かめられる
        onFiles([{ file: image, handle: null }])
      } catch (error) {
        console.error('PDF page to image failed:', error)
        toast.error(m.exportFailed(errorMessage(error, m.pdfError)))
      }
    })

  const save = useSave({
    opened,
    // ページの編集は劣化しないので上書きが主。圧縮は画像に描き直す非可逆な保存なので別名が主
    lossless: !compressing,
    sameFormat: usedSources.size === 1 && usedSources.has(0),
    canCopy: false,
    disabled: !ready || pageCount === 0 || busy !== null,
    // 圧縮して保存した先を、PDF の上書き先にしない（逆も）。圧縮のあいだは上書き先をこちらで持つ
    handle: compressing ? (compressHandle ?? opened?.handle ?? null) : undefined,
    render: () =>
      compressing
        ? withProgress((options) =>
            compressPdf(rasterizer, recipe.pages, output.compress, `${stem}-compressed.pdf`, {
              ...options,
              metadata: { title: firstUsed?.info.title, author: firstUsed?.info.author },
            })
          )
        : renderPdf(files, recipe),
    onSaved: (_method, handle, rendered) => {
      if (!compressing) return history.markSaved()
      setActual({ key: compressKey, bytes: rendered.blob.size })
      if (handle && handle !== opened?.handle) setCompressHandle(handle)
    },
    describeError: (error) => (isPdfError(error) ? m.pdfError[error.code] : null),
    onSourceReplaced: onReopen,
  })

  // 画像の書き出しは複数のファイルなので、⌘S は保存ボタンの主の方法（フォルダ・ZIP）に向ける。
  // useSave も ⌘S を拾うので、捕獲の段階で先に受けて preventDefault し、そちらには渡さない
  const imagesSaveRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    imagesSaveRef.current = () => {
      if (!ready || busy !== null || target.pages.length === 0) return
      void saveImages(planSaveMany({ canPickFolder: canPickFolder(), count: target.pages.length }).primary)
    }
  })
  useEffect(() => {
    if (!imagesMode) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandle(event, 'mod+s', { inEditable: true })) return
      event.preventDefault()
      imagesSaveRef.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [imagesMode])
  useReportUnsaved(history.dirty, onDirtyChange)
  // 作業を残し、入口から再開できるようにする。結合した PDF（2 つ目以降の入力）も同じ並びで残す
  const extraSources = useMemo(() => sources.slice(1).map((source) => openedFromFile(source.file)), [sources])
  useSessionRecipe('pdf', recipe, {
    opened,
    resumed,
    enabled: !!file,
    dirty: history.dirty,
    version: 1,
    ready,
    extras: extraSources,
    onResume: async (saved, session) => {
      const added: Source[] = []
      for (const extra of session.extras) {
        const info = await probePdf(extra.file)
        if (info.encrypted) return
        added.push({ file: extra.file, info })
      }
      const all = addSources(added)
      const fits = saved.pages.every(
        ({ source, page }) =>
          Number.isInteger(source) && Number.isInteger(page) && page >= 0 && page < (all[source]?.info.pageCount ?? 0)
      )
      if (fits) history.restore(saved)
    },
  })

  // 一覧にフォーカスがなくても、⌘A で全ページを選び、Delete で選んだページを消す
  // （一覧にフォーカスがあるときは一覧が自分で処理する）
  useHotkey('mod+a', () => setSelection(selectAll(keys)), { enabled: ready && pageCount > 0 })
  useHotkey('delete', () => remove(), { enabled: ready && selected.length > 0 })
  useHotkey('escape', () => setSelection(emptySelection), { enabled: ready && selected.length > 0 })

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
          <Step index={1} title={t.stepInput}>
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
                  {t.selectFile}
                </SmallButton>
              )}
            </div>
            {ready && <StepHint>{m.addHint}</StepHint>}
          </Step>

          {ready && (
            <>
              <Step index={2} title={t.stepEdit}>
                <div className="flex flex-wrap gap-1">
                  <HistoryButtons
                    canUndo={history.canUndo}
                    canRedo={history.canRedo}
                    onUndo={history.undo}
                    onRedo={history.redo}
                  />
                  <ToolbarDivider />
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

              <OutputSteps
                settings={output}
                onChange={setOutput}
                pageCount={pageCount}
                selectedCount={selected.length}
                targetCount={target.pages.length}
                mergedCount={usedSources.size}
                originalBytes={originalBytes}
                estimate={estimate}
                estimating={estimating}
                actualBytes={actual?.key === compressKey ? actual.bytes : null}
                locked={locked}
                opening={busy === 'opening'}
                onOpenInImage={() => void openInImage()}
              />
              <Step index={5} title={m.stepSplit}>
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
                    onSubmit={() => {
                      if (splitRanges.ok) void split(planSaveMany({ canPickFolder: canPickFolder(), count: splitRanges.ranges.length }).primary)
                    }}
                  />
                )}
                <SaveManyButton
                  variant="outline"
                  count={splitRanges.ok ? splitRanges.ranges.length : 0}
                  disabled={locked || !splitRanges.ok || pageCount === 0}
                  primaryLabel={() =>
                    busy === 'splitting'
                      ? m.splitRunning
                      : m.splitRun(splitRanges.ok ? splitRanges.ranges.length : 0)
                  }
                  onSave={(method) => void split(method)}
                />
                <StepHint>{m.splitHint}</StepHint>
              </Step>
              <ResetSettingsButton onClick={() => setOutput(DEFAULT_OUTPUT)} />
            </>
          )}
        </div>

        <SidebarFooter progress={progress} onCancel={() => abortRef.current?.abort()}>
          {imagesMode ? (
            <SaveManyButton
              count={target.pages.length}
              disabled={locked || target.pages.length === 0}
              primaryLabel={(method) =>
                busy === 'exporting' ? m.exportingImages : m.saveImages(target.pages.length, method)
              }
              onSave={(method) => void saveImages(method)}
            />
          ) : (
            <SaveButton save={save} disabled={!ready || pageCount === 0 || busy !== null} />
          )}
        </SidebarFooter>
      </aside>

      <div className="workspace">
        <div
          className={cn('stage', (pageDrop.over || (isDragging && !ready)) && 'drop-target-active')}
          {...pageDrop.handlers}
        >
          {!file ? (
            <FileUpload
              isDragging={isDragging}
              message={m.dropHere}
              hint={m.dropHint}
              buttonLabel={t.selectFile}
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
              <div className="flex items-center gap-3 border-b bg-background px-4 py-2 text-xs">
                <span className="shrink-0 font-medium whitespace-nowrap tabular-nums">
                  {m.selection(selected.length, pageCount)}
                </span>
                {/* 狭い画面（多くはタッチ）では Shift・⌘ の案内を省き、件数とボタンを 1 行に収める */}
                <span className="min-w-0 truncate text-muted-foreground max-sm:hidden">{m.selectionHint}</span>
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

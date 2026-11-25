import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Copy,
  FlipHorizontal2,
  FlipVertical2,
  ImagePlus,
  Pause,
  Play,
  Repeat,
  RotateCcw,
  RotateCw,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { solidOnClass } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { useReportUnsaved } from '../../app/leaveGuard'
import { useLocalDrop } from '../../app/useLocalDrop'
import type { DragItemKind } from '../../app/useLocalDrop'
import { SidebarHead } from '../../components/BrandMark'
import { CompatibilityList } from '../../components/CompatibilityList'
import { SaveButton } from '../../components/SaveButton'
import {
  Chip,
  EstimateBox,
  EstimateRow,
  Fact,
  Facts,
  HistoryButtons,
  IconButton,
  IconToggle,
  Notice,
  ResetSettingsButton,
  SidebarFooter,
  SmallButton,
  SourceName,
  SwitchField,
  ToolbarDivider,
} from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { openedFromFile, pickFiles } from '../../core/opened'
import type { OpenedFile } from '../../core/opened'
import { isRectOrNull } from '../../core/session'
import { useHotkey } from '../../core/useHotkey'
import { useRememberedChoice } from '../../core/usePersistentState'
import { useRecipeHistory } from '../../core/useRecipeHistory'
import { useSave } from '../../core/useSave'
import { useSessionRecipe } from '../../core/useSessionRecipe'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import {
  ANIMATION_FORMATS,
  COLOR_PRESETS,
  DEFAULT_ANIMATION_OUTPUT,
  animationPlan,
  applyGifEdit,
  closeSource,
  createGifRecipe,
  decodeAnimation,
  defaultAnimationFormat,
  detectAnimationFormats,
  fitSourceToCanvas,
  renderAnimation,
  totalDuration,
  type AnimationFormat,
  type AnimationOutput,
  type AnimationSource,
  type GifDither,
  type GifEdit,
  type GifFrameInput,
  type GifPalette,
  type GifRecipe,
} from '../../media/gif'
import { MAX_DIMENSION, NO_PADDING, computeOutputSize } from '../../media/image'
import { isAbortError } from '../../utils/abort'
import { formatBytes } from '../../utils/format'
import { fitAspect, sourceRectToView, viewRectToSource, viewSize } from '../image/crop'
import type { Rect } from '../image/crop'
import { FieldLabel, NumberField } from '../image/fields'
import { ImagePreview } from '../image/ImagePreview'
import {
  clickSelection,
  dropSlotToMoveTarget,
  emptySelection,
  pruneSelection,
  selectAll,
  selectedIndices,
  stepMoveTarget,
  type Selection,
} from '../pdf/pageModel'
import type { EditPageProps } from '../types'
import { DurationField } from './DurationField'
import { FrameStrip } from './FrameStrip'
import { takeHandedOffFrames } from './handoff'
import { messages } from './messages'
import { useAnimationEstimate } from './useAnimationEstimate'
import { usePlayer } from './usePlayer'

type Status = 'loading' | 'ready' | 'failed'

const EMPTY_RECIPE = createGifRecipe()
/** 再開したレシピの形を確かめる見本（フレームの形も比べられるよう 1 枚入れておく） */
const SESSION_TEMPLATE = createGifRecipe({ width: 1, height: 1 }, [{ source: 0, frame: 0, duration: 100 }])
/** 静止画から新しく作るとき、キャンバスの長辺をここまでに抑える（写真をそのままの大きさで GIF にしない） */
const MAX_NEW_CANVAS = 1280
/** 一定の速さにするときの候補（fps → 1 フレームの表示時間） */
const FPS_PRESETS = [10, 12, 15, 24, 30]
const SCALE_PRESETS = [0.75, 0.5, 0.25]
const ASPECT_PRESETS: { label: string | null; value: number | null }[] = [
  { label: null, value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '16:9', value: 16 / 9 },
]
const FORMAT_LABEL: Record<AnimationFormat, string> = { gif: 'GIF', webp: 'WebP', mp4: 'MP4', webm: 'WebM' }
const DITHERS: GifDither[] = ['floydSteinberg', 'ordered', 'none']
const PALETTES: GifPalette[] = ['global', 'local']

/** 一覧に落とせるもの（画像。SVG はテキストとして扱うので除く） */
const isImageItem = (item: DragItemKind) => item.type.startsWith('image/') && item.type !== 'image/svg+xml'
const acceptsImages = (items: DragItemKind[]) => items.length > 0 && items.every(isImageItem)

/** 新しいアニメーションのキャンバス。開いたアニメーションはそのまま、静止画は長辺を抑える */
function canvasFor(source: AnimationSource): { width: number; height: number } {
  const animated = source.frames.length > 1
  const scale = animated ? 1 : Math.min(1, MAX_NEW_CANVAS / Math.max(source.width, source.height))
  return { width: Math.max(1, Math.round(source.width * scale)), height: Math.max(1, Math.round(source.height * scale)) }
}

const formatSeconds = (ms: number) => `${(ms / 1000).toFixed(2)}s`

/**
 * アニメーション GIF（と APNG・アニメーション WebP）を開き、フレームの並べ替え・追加・削除・複製、
 * 表示時間・ループ回数、全フレームの切り抜き・サイズ変更をして、GIF・WebP・動画で保存する画面。
 * 何も開かずに来たら、画像を落としてアニメーションを作るところから始める。
 */
export default function EditPage({ opened, isDragging, onFiles, onReopen, onDirtyChange, resumed }: EditPageProps) {
  const { t } = useI18n()
  const m = useLocalMessages(messages)
  const file = opened?.file ?? null

  const [status, setStatus] = useState<Status>(file ? 'loading' : 'ready')
  // レシピの source が指す入力。開いたファイルがあれば 0 番。足すたびに後ろへ増えるだけ
  const [sources, setSources] = useState<AnimationSource[]>([])
  const sourcesRef = useRef<AnimationSource[]>([])
  const history = useRecipeHistory<GifRecipe>(EMPTY_RECIPE)
  const { recipe, update, replace } = history
  const [selectionState, setSelection] = useState<Selection>(emptySelection)
  const [busy, setBusy] = useState<'adding' | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const [cropping, setCropping] = useState(false)
  const [aspect, setAspect] = useState<number | null>(null)

  const [formats, setFormats] = useState<AnimationFormat[]>(['gif'])
  useEffect(() => {
    let cancelled = false
    void detectAnimationFormats().then((found) => {
      if (!cancelled) setFormats(found)
    })
    return () => {
      cancelled = true
    }
  }, [])
  // 出力形式は、選ぶまでは元と同じ形式（WebP を開いたら WebP）。選んだら別のファイルを開いても残す
  const derivedOutput = useMemo<AnimationOutput>(
    () => ({ ...DEFAULT_ANIMATION_OUTPUT, format: defaultAnimationFormat(file?.type ?? null, formats.includes('webp')) }),
    [file, formats]
  )
  const [savedOutput, setOutput, resetOutput] = useRememberedChoice<AnimationOutput>('gif.output', derivedOutput)
  const output = useMemo(
    () => (formats.includes(savedOutput.format) ? savedOutput : { ...savedOutput, format: 'gif' as const }),
    [formats, savedOutput]
  )

  const keys = useMemo(() => recipe.frames.map((frame) => String(frame.id)), [recipe.frames])
  // 削除や取り消しで消えたフレームは、描画のたびに選択から落とす
  const selection = pruneSelection(selectionState, keys)
  const selected = useMemo(() => selectedIndices(selection, keys), [selection, keys])
  const frameCount = recipe.frames.length
  const ready = status === 'ready'
  const player = usePlayer(recipe.frames)

  const addSources = useCallback((added: AnimationSource[]) => {
    const next = [...sourcesRef.current, ...added]
    sourcesRef.current = next
    setSources(next)
    return next
  }, [])

  // 画面を閉じたら、読んだ絵と走っている書き出しを手放す
  useEffect(
    () => () => {
      sourcesRef.current.forEach(closeSource)
      sourcesRef.current = []
      abortRef.current?.abort()
    },
    []
  )

  // 開いたファイルを読む
  useEffect(() => {
    if (!file) return
    let cancelled = false
    decodeAnimation(file).then(
      (source) => {
        if (cancelled) return closeSource(source)
        sourcesRef.current.forEach(closeSource)
        sourcesRef.current = []
        addSources([source])
        replace(
          createGifRecipe(
            { width: source.width, height: source.height },
            source.frames.map((frame, index) => ({ source: 0, frame: index, duration: frame.duration })),
            source.plays
          )
        )
        setStatus('ready')
      },
      (error: unknown) => {
        if (cancelled) return
        console.error('Animation decode failed:', error)
        setStatus('failed')
      }
    )
    return () => {
      cancelled = true
    }
  }, [file, addSources, replace])

  const apply = useCallback((edit: GifEdit) => update((current) => applyGifEdit(current, edit)), [update])

  /** 読めたファイルを入力に足し、そのフレームを末尾につなぐ（1 回の取り消しで戻せるよう 1 段にまとめる） */
  const appendFiles = useCallback(
    async (files: File[]) => {
      const decoded: AnimationSource[] = []
      for (const added of files) {
        try {
          decoded.push(await decodeAnimation(added))
        } catch (error) {
          console.error('Could not read a frame source:', error)
          toast.error(m.skipped(added.name))
        }
      }
      if (decoded.length === 0) return
      // キャンバスがまだなければ最初の入力で決め、ほかはその大きさにそろえる
      const size = recipe.width > 0 ? { width: recipe.width, height: recipe.height } : canvasFor(decoded[0])
      const fitted = await Promise.all(decoded.map((source) => fitSourceToCanvas(source, size.width, size.height)))
      const start = sourcesRef.current.length
      addSources(fitted)
      const frames: GifFrameInput[] = fitted.flatMap((source, offset) =>
        source.frames.map((frame, index) => ({ source: start + offset, frame: index, duration: frame.duration }))
      )
      apply({ type: 'append', frames, size })
      toast(m.appended(frames.length))
    },
    [recipe.width, recipe.height, addSources, apply, m]
  )

  const withBusy = async (task: () => Promise<void>) => {
    setBusy('adding')
    try {
      await task()
    } finally {
      setBusy(null)
    }
  }

  const addImages = async () => {
    const picked = await pickFiles({ multiple: true, accept: 'image/*' })
    if (picked.length > 0) await withBusy(() => appendFiles(picked.map(({ file: f }) => f)))
  }

  // 一括変換の「GIF にまとめる」から来たら、渡された画像をフレームにする（空で開いたときに 1 回だけ）
  const handedOff = useRef(false)
  useEffect(() => {
    if (file || resumed || handedOff.current) return
    handedOff.current = true
    const files = takeHandedOffFrames()
    if (!files) return
    void Promise.resolve()
      .then(() => {
        setBusy('adding')
        return appendFiles(files)
      })
      .finally(() => setBusy(null))
  }, [file, resumed, appendFiles])

  // フレームの一覧・プレビューに落とした画像と GIF は、開き直さずに末尾へ足す
  const drop = useLocalDrop({
    enabled: ready && busy === null && progress === null,
    accepts: acceptsImages,
    onDrop: (dropped: OpenedFile[]) => void withBusy(() => appendFiles(dropped.map(({ file: f }) => f))),
  })

  const lookup = useCallback(
    (source: number, frame: number) => sources[source]?.frames[frame]?.bitmap ?? null,
    [sources]
  )

  const remove = () => apply({ type: 'remove', indices: selected })
  const step = (delta: -1 | 1) => {
    const to = stepMoveTarget(selected, delta, frameCount)
    if (to !== null) apply({ type: 'move', indices: selected, to })
  }

  const name = file?.name ?? null
  const estimate = useAnimationEstimate(recipe, output, lookup, name, ready && busy === null && progress === null)

  /** 中止できる書き出しを走らせ、進み具合を下端に出す */
  const withProgress = async <T,>(task: (options: { signal: AbortSignal; onProgress: (p: number) => void }) => Promise<T>) => {
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

  const save = useSave({
    opened,
    // GIF は減色、WebP・動画は非可逆なので、別名で保存を主にする
    lossless: false,
    sameFormat: !!file && ANIMATION_FORMATS[output.format].mime === file.type,
    canCopy: false,
    disabled: !ready || frameCount === 0 || busy !== null,
    render: async () =>
      estimate.rendered ?? (await withProgress((options) => renderAnimation(recipe, lookup, output, { ...options, name }))),
    onSaved: () => history.markSaved(),
    describeError: (error) =>
      isAbortError(error) ? null : m.exportFailed(error instanceof Error ? error.message : String(error)),
    onSourceReplaced: onReopen,
  })

  useReportUnsaved(history.dirty, onDirtyChange)
  // 作業を残し、入口から再開できるようにする。足した画像（2 つ目以降の入力）も同じ並びで残す
  const extras = useMemo(() => sources.slice(file ? 1 : 0).map((source) => openedFromFile(source.file)), [sources, file])
  const resuming = useRef<{ id: string; done: Promise<void> } | null>(null)
  useSessionRecipe('gif', recipe, {
    opened,
    resumed,
    enabled: true,
    dirty: history.dirty,
    version: 1,
    ready,
    template: SESSION_TEMPLATE,
    check: (saved) =>
      saved.width >= 1 &&
      saved.height >= 1 &&
      new Set(saved.frames.map((frame) => frame.id)).size === saved.frames.length &&
      isRectOrNull(saved.image.crop) &&
      (saved.image.resize === null || typeof saved.image.resize === 'object') &&
      (saved.image.background === null || typeof saved.image.background === 'string'),
    extras,
    label: file?.name ?? 'animation.gif',
    onResume: (saved, session) => {
      // 開発時の StrictMode では effect が 2 回走り、ここも 2 回呼ばれる。足したファイルを二重に読まないよう、
      // 同じセッションなら 1 回目の読み込みを待つだけにする
      if (resuming.current?.id === session.id) return resuming.current.done
      const done = (async () => {
        const added: AnimationSource[] = []
        for (const extra of session.extras) {
          const source = await decodeAnimation(extra.file)
          added.push(await fitSourceToCanvas(source, saved.width, saved.height))
        }
        const all = addSources(added)
        const fits = saved.frames.every(
          ({ source, frame }) => Number.isInteger(frame) && frame >= 0 && frame < (all[source]?.frames.length ?? 0)
        )
        if (fits) history.restore(saved)
      })()
      resuming.current = { id: session.id, done }
      return done
    },
  })

  // Space で再生・一時停止。⌘A・Delete・Esc は一覧にフォーカスがなくても効かせる（あるときは一覧が自分で処理する）
  useHotkey('space', player.toggle, { enabled: ready && frameCount > 0 })
  useHotkey('mod+a', () => setSelection(selectAll(keys)), { enabled: ready && frameCount > 0 })
  useHotkey('delete', remove, { enabled: ready && selected.length > 0 })
  useHotkey('escape', () => setSelection(emptySelection), { enabled: ready && !cropping && selected.length > 0 })
  // 切り抜き中は Enter / Esc で抜ける
  useHotkey('enter', () => setCropping(false), { enabled: cropping })
  useHotkey('escape', () => setCropping(false), { enabled: cropping })

  // ---- 全フレームの切り抜き・サイズ変更（画像の画面と同じ部品と計算） ----
  const canvas = recipe.width > 0 ? { width: recipe.width, height: recipe.height } : null
  const imageRecipe = recipe.image
  const view = canvas ? viewSize(canvas, imageRecipe.rotation) : null
  const cropRect: Rect | null =
    canvas && view
      ? imageRecipe.crop
        ? sourceRectToView(imageRecipe.crop, canvas, imageRecipe)
        : { x: 0, y: 0, width: view.width, height: view.height }
      : null
  const commitCrop = (rect: Rect) => {
    if (!canvas) return
    apply({ type: 'image', edit: { type: 'crop', rect: viewRectToSource(rect, canvas, imageRecipe) } })
  }
  const changeAspect = (next: number | null) => {
    setAspect(next)
    setCropping(true)
    if (next !== null && cropRect && view) commitCrop(fitAspect(cropRect, view, next))
  }
  const cropBase = useMemo(() => ({ ...imageRecipe, crop: null, resize: null, padding: NO_PADDING, background: null }), [imageRecipe])
  const size = canvas ? computeOutputSize(canvas, imageRecipe) : null
  const base = canvas ? computeOutputSize(canvas, { ...imageRecipe, resize: null }) : null
  const resizeTo = (width: number | null, height: number | null) =>
    apply({
      type: 'image',
      edit: {
        type: 'resize',
        resize: width === null && height === null ? null : { width, height, keepAspect: true, allowUpscale: true },
      },
    })

  // ---- 表示 ----
  const selectedDurations = new Set(selected.map((index) => recipe.frames[index].duration))
  const allDurations = new Set(recipe.frames.map((frame) => frame.duration))
  const durationValue =
    selected.length > 0
      ? selectedDurations.size === 1
        ? [...selectedDurations][0]
        : null
      : allDurations.size === 1
        ? [...allDurations][0]
        : null
  const total = totalDuration(recipe)
  const plan = animationPlan(recipe)
  const format = ANIMATION_FORMATS[output.format]
  const shownSize = estimate.rendered?.blob.size ?? estimate.last?.blob.size ?? null
  const locked = !ready || busy !== null || progress !== null
  const noSelection = selected.length === 0
  const firstSource = file ? sources[0] : null
  const currentRef = player.current >= 0 ? recipe.frames[player.current] : null
  const currentBitmap = currentRef ? lookup(currentRef.source, currentRef.frame) : null

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
                  <Fact label={t.factSize}>{formatBytes(file.size)}</Fact>
                  {firstSource && (
                    <>
                      <Fact label={t.factResolution}>
                        {firstSource.width}×{firstSource.height}
                      </Fact>
                      <Fact label={m.factFrames}>{m.frameCount(firstSource.frames.length)}</Fact>
                      <Fact label={m.factLoop}>
                        {firstSource.plays === 0 ? m.loopInfinite : m.loopTimes(firstSource.plays)}
                      </Fact>
                    </>
                  )}
                </Facts>
              </div>
            ) : (
              <StepHint>{t.inputEmpty}</StepHint>
            )}
            {sources.length > (file ? 1 : 0) && (
              <div className="flex flex-col gap-1 border-t border-secondary pt-2">
                <div className="text-[11px] text-muted-foreground">{m.factSources}</div>
                <ol className="flex flex-col gap-0.5 text-xs">
                  {sources.slice(file ? 1 : 0).map((source, index) => (
                    <li key={index} className="flex gap-2">
                      <span className="truncate" title={source.file.name}>
                        {source.file.name}
                      </span>
                      <span className="ml-auto shrink-0 text-muted-foreground">{m.frameCount(source.frames.length)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {ready ? (
                <SmallButton onClick={() => void addImages()} disabled={locked}>
                  <ImagePlus />
                  {busy === 'adding' ? m.adding : m.addFrames}
                </SmallButton>
              ) : (
                <SmallButton
                  onClick={async () => {
                    const [picked] = await pickFiles({ accept: 'image/*' })
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
                  <IconButton
                    label={m.moveLeft}
                    onClick={() => step(-1)}
                    disabled={stepMoveTarget(selected, -1, frameCount) === null}
                  >
                    <ArrowLeft />
                  </IconButton>
                  <IconButton
                    label={m.moveRight}
                    onClick={() => step(1)}
                    disabled={stepMoveTarget(selected, 1, frameCount) === null}
                  >
                    <ArrowRight />
                  </IconButton>
                  <IconButton label={m.duplicate} onClick={() => apply({ type: 'duplicate', indices: selected })} disabled={noSelection}>
                    <Copy />
                  </IconButton>
                  <IconButton label={m.reverse} onClick={() => apply({ type: 'reverse', indices: selected })} disabled={frameCount < 2}>
                    <Repeat />
                  </IconButton>
                  <IconButton label={m.removeSelected} onClick={remove} disabled={noSelection}>
                    <Trash2 />
                  </IconButton>
                </div>
                <StepHint>{m.selection(selected.length, frameCount)}</StepHint>

                <DurationField
                  value={durationValue}
                  disabled={frameCount === 0}
                  hasSelection={!noSelection}
                  onApply={(duration) => apply({ type: 'duration', indices: selected, duration })}
                  onApplyAll={(duration) => apply({ type: 'durationAll', duration })}
                />
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{m.fpsLabel}</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    {FPS_PRESETS.map((fps) => {
                      const duration = Math.round(1000 / fps / 10) * 10
                      return (
                        <Chip
                          key={fps}
                          active={allDurations.size === 1 && allDurations.has(duration)}
                          disabled={frameCount === 0}
                          onClick={() => apply({ type: 'durationAll', duration })}
                        >
                          {fps}fps
                        </Chip>
                      )
                    })}
                  </div>
                </div>
                <StepHint>{m.durationHint}</StepHint>

                <div className="flex flex-col gap-1.5">
                  <SwitchField
                    label={m.loopForever}
                    checked={recipe.plays === 0}
                    onChange={(forever) => apply({ type: 'plays', plays: forever ? 0 : 1 })}
                  />
                  {recipe.plays !== 0 && (
                    <div className="flex items-end">
                      <NumberField
                        id="gif-plays"
                        label={m.loopCountLabel}
                        value={recipe.plays}
                        min={1}
                        onCommit={(plays) => {
                          if (plays !== null && plays >= 1) apply({ type: 'plays', plays })
                        }}
                      />
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-1">
                  <IconButton label={m.rotateLeft} disabled={!canvas} onClick={() => apply({ type: 'image', edit: { type: 'rotate', turns: -1 } })}>
                    <RotateCcw />
                  </IconButton>
                  <IconButton label={m.rotateRight} disabled={!canvas} onClick={() => apply({ type: 'image', edit: { type: 'rotate', turns: 1 } })}>
                    <RotateCw />
                  </IconButton>
                  {/* lucide の名前は「反転の軸」の向きなので、左右反転には縦軸の FlipVertical2 を使う */}
                  <IconToggle
                    label={m.flipH}
                    disabled={!canvas}
                    pressed={imageRecipe.flipH}
                    onPressedChange={() => apply({ type: 'image', edit: { type: 'flipH' } })}
                  >
                    <FlipVertical2 />
                  </IconToggle>
                  <IconToggle
                    label={m.flipV}
                    disabled={!canvas}
                    pressed={imageRecipe.flipV}
                    onPressedChange={() => apply({ type: 'image', edit: { type: 'flipV' } })}
                  >
                    <FlipHorizontal2 />
                  </IconToggle>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <FieldLabel>{m.cropLabel}</FieldLabel>
                    <span className="text-[11px] text-muted-foreground tabular-nums">
                      {imageRecipe.crop ? `${imageRecipe.crop.width}×${imageRecipe.crop.height}` : m.cropNone}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {ASPECT_PRESETS.map((preset) => (
                      <Chip
                        key={preset.label ?? 'free'}
                        active={cropping && aspect === preset.value}
                        disabled={!canvas || frameCount === 0}
                        onClick={() => changeAspect(preset.value)}
                      >
                        {preset.label ?? m.cropFree}
                      </Chip>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      variant={cropping ? 'default' : 'outline'}
                      size="xs"
                      className="h-7 px-2.5"
                      disabled={!canvas || frameCount === 0}
                      onClick={() => setCropping(!cropping)}
                    >
                      {cropping ? m.cropDone : m.cropStart}
                    </Button>
                    <SmallButton
                      disabled={!canvas || imageRecipe.crop === null}
                      onClick={() => apply({ type: 'image', edit: { type: 'crop', rect: null } })}
                    >
                      {m.cropClear}
                    </SmallButton>
                  </div>
                  {cropping && <StepHint>{m.cropHint}</StepHint>}
                </div>

                <div className="flex flex-col gap-1.5">
                  <FieldLabel>{m.resizeLabel}</FieldLabel>
                  <div className="flex flex-wrap gap-1.5">
                    <Chip active={imageRecipe.resize === null} disabled={!canvas} onClick={() => resizeTo(null, null)}>
                      {m.resizeOriginal}
                    </Chip>
                    {base &&
                      SCALE_PRESETS.map((scale) => {
                        const width = Math.max(1, Math.round(base.contentWidth * scale))
                        return (
                          <Chip
                            key={scale}
                            active={imageRecipe.resize !== null && size?.contentWidth === width}
                            onClick={() => resizeTo(width, null)}
                          >
                            {Math.round(scale * 100)}%
                          </Chip>
                        )
                      })}
                  </div>
                  <div className="flex items-end gap-1.5">
                    <NumberField
                      id="gif-width"
                      label={t.width}
                      value={size?.contentWidth ?? null}
                      min={1}
                      max={MAX_DIMENSION}
                      disabled={!canvas}
                      onCommit={(width) => {
                        if (width !== size?.contentWidth) resizeTo(width, null)
                      }}
                    />
                    <span className="pb-2 text-input">×</span>
                    <NumberField
                      id="gif-height"
                      label={t.height}
                      value={size?.contentHeight ?? null}
                      min={1}
                      max={MAX_DIMENSION}
                      disabled={!canvas}
                      onCommit={(height) => {
                        if (height !== size?.contentHeight) resizeTo(null, height)
                      }}
                    />
                  </div>
                </div>
              </Step>

              <Step index={3} title={t.stepOutput}>
                <ToggleGroup
                  type="single"
                  variant="outline"
                  spacing={0}
                  className="w-full"
                  value={output.format}
                  onValueChange={(value) => {
                    if (value) setOutput({ ...output, format: value as AnimationFormat })
                  }}
                >
                  {formats.map((f) => (
                    <ToggleGroupItem key={f} value={f} size="sm" className={cn('flex-1 text-xs', solidOnClass)}>
                      {FORMAT_LABEL[f]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <StepHint>{m.formatHint[output.format]}</StepHint>

                {output.format === 'gif' && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <FieldLabel>{m.colorsLabel}</FieldLabel>
                      <div className="flex flex-wrap gap-1.5">
                        {COLOR_PRESETS.map((colors) => (
                          <Chip key={colors} active={output.colors === colors} onClick={() => setOutput({ ...output, colors })}>
                            {colors}
                          </Chip>
                        ))}
                      </div>
                    </div>
                    <OptionGroup
                      label={m.ditherLabel}
                      value={output.dither}
                      options={DITHERS.map((value) => ({ value, label: m.dither[value] }))}
                      onChange={(dither) => setOutput({ ...output, dither })}
                    />
                    <StepHint>{m.ditherHint}</StepHint>
                    <OptionGroup
                      label={m.paletteLabel}
                      value={output.palette}
                      options={PALETTES.map((value) => ({ value, label: m.palette[value] }))}
                      onChange={(palette) => setOutput({ ...output, palette })}
                    />
                    <StepHint>{m.paletteHint}</StepHint>
                  </>
                )}
                {output.format === 'webp' && (
                  <div className="flex flex-col gap-2">
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{m.qualityLabel}</span>
                      <span className="font-semibold text-foreground">{output.quality}</span>
                    </div>
                    <Slider
                      min={1}
                      max={100}
                      value={[output.quality]}
                      onValueChange={([quality]) => setOutput({ ...output, quality })}
                      aria-label={m.qualityLabel}
                    />
                    <StepHint>{m.qualityLossless}</StepHint>
                  </div>
                )}
                {formats.length < 4 && <StepHint>{m.formatUnavailable}</StepHint>}
              </Step>

              <Step index={4} title={t.stepEstimate}>
                <EstimateBox>
                  <EstimateRow label={m.outputResolution}>
                    {plan && frameCount > 0 ? `${plan.canvasWidth}×${plan.canvasHeight}` : '—'}
                  </EstimateRow>
                  <EstimateRow label={m.factFrames}>{frameCount}</EstimateRow>
                  <EstimateRow label={m.factDuration}>{formatSeconds(total)}</EstimateRow>
                  <EstimateRow label={t.estimatedSize}>
                    {estimate.deferred
                      ? m.estimateDeferred
                      : estimate.estimating && shownSize === null
                        ? t.estimating
                        : shownSize !== null
                          ? formatBytes(shownSize)
                          : '—'}
                  </EstimateRow>
                </EstimateBox>
                {estimate.error != null && (
                  <Notice tone="warn">
                    {m.estimateError}: {estimate.error instanceof Error ? estimate.error.message : String(estimate.error)}
                  </Notice>
                )}
                {shownSize !== null ? (
                  <CompatibilityList estimatedSize={shownSize} duration={total / 1000} />
                ) : (
                  <StepHint>{t.estimateEmpty}</StepHint>
                )}
              </Step>
              <ResetSettingsButton onClick={resetOutput} />
            </>
          )}
        </div>

        <SidebarFooter progress={progress} onCancel={() => abortRef.current?.abort()}>
          <SaveButton save={save} disabled={!ready || frameCount === 0 || busy !== null} />
        </SidebarFooter>
      </aside>

      <div className={cn('workspace', drop.over && 'drop-target-active')} {...drop.handlers}>
        <div className="stage">
          {status === 'loading' ? (
            <Message>{m.loading}</Message>
          ) : status === 'failed' ? (
            <Message>{m.loadFailed}</Message>
          ) : frameCount === 0 || !canvas ? (
            <div className={cn('preview-area', (isDragging || drop.over) && 'drop-target-active')}>
              <div className="flex flex-col items-center gap-4 px-6">
                <div className="text-center text-base text-muted-foreground">{m.dropHere}</div>
                <p className="max-w-[420px] text-center text-xs leading-relaxed text-muted-foreground">{m.dropHint}</p>
                <SmallButton onClick={() => void addImages()} disabled={locked}>
                  {busy === 'adding' ? m.adding : m.pickImages}
                </SmallButton>
              </div>
            </div>
          ) : currentBitmap && cropRect ? (
            <ImagePreview
              bitmap={currentBitmap}
              info={canvas}
              {...(cropping
                ? {
                    recipe: cropBase,
                    keepsAlpha: true,
                    crop: { rect: cropRect, aspect, onCommit: commitCrop, label: m.cropOverlay },
                  }
                : { recipe: imageRecipe, keepsAlpha: format.alpha })}
            />
          ) : (
            <Message>{m.loading}</Message>
          )}
        </div>

        {ready && frameCount > 0 && (
          <div className="bottom-bar gap-2">
            <div className="flex items-center gap-3">
              <IconButton label={player.playing ? m.pause : m.play} onClick={player.toggle}>
                {player.playing ? <Pause /> : <Play />}
              </IconButton>
              <Slider
                className="flex-1"
                min={0}
                max={Math.max(1, total - 1)}
                step={10}
                value={[player.time]}
                onValueChange={([time]) => player.seek(time)}
                aria-label={m.scrub}
              />
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {m.position(player.current + 1, frameCount)} · {formatSeconds(player.time)} / {formatSeconds(total)}
              </span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="shrink-0 font-medium whitespace-nowrap tabular-nums">{m.selection(selected.length, frameCount)}</span>
              <span className="min-w-0 truncate text-muted-foreground max-sm:hidden">{m.selectionHint}</span>
              <div className="ml-auto flex shrink-0 gap-1">
                <SmallButton variant="ghost" onClick={() => setSelection(selectAll(keys))}>
                  {m.selectAll}
                </SmallButton>
                <SmallButton variant="ghost" onClick={() => setSelection(emptySelection)} disabled={noSelection}>
                  {m.clearSelection}
                </SmallButton>
              </div>
            </div>
            <FrameStrip
              frames={recipe.frames}
              keys={keys}
              selection={selection}
              current={player.current}
              bitmapOf={lookup}
              onSelect={(index, modifiers) => {
                setSelection((current) => clickSelection(pruneSelection(current, keys), keys, index, modifiers))
                player.show(index)
              }}
              onSelectAll={() => setSelection(selectAll(keys))}
              onClearSelection={() => setSelection(emptySelection)}
              onDragStartFrame={(index) => {
                if (selection.keys.has(keys[index])) return selected
                setSelection(clickSelection(selection, keys, index))
                return [index]
              }}
              onDropAt={(slot, indices) => apply({ type: 'move', indices, to: dropSlotToMoveTarget(slot, indices) })}
              onRemove={remove}
              onStep={step}
              onTogglePlay={player.toggle}
            />
          </div>
        )}
      </div>
    </div>
  )
}

/** 選択肢が少ない設定（ディザ・パレット）の切り替え */
function OptionGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <ToggleGroup
        type="single"
        variant="outline"
        spacing={0}
        size="sm"
        className="w-full"
        value={value}
        onValueChange={(next) => {
          if (next) onChange(next as T)
        }}
        aria-label={label}
      >
        {options.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value} className={cn('h-7 flex-1 px-2 text-xs', solidOnClass)}>
            {option.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

/** プレビューの代わりに出す案内（読み込み中、開けない理由） */
function Message({ children }: { children: ReactNode }) {
  return <div className="preview-area p-8 text-center text-sm text-muted-foreground">{children}</div>
}

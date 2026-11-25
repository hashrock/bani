import { Copy, Redo2, Undo2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { FileUpload } from '../../components/FileUpload'
import { copyBlobToClipboard } from '../../core/save'
import { isEditableTarget } from '../../core/useHotkey'
import { usePersistentState } from '../../core/usePersistentState'
import { useRecipeHistory } from '../../core/useRecipeHistory'
import { useSave } from '../../core/useSave'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import {
  IMAGE_FORMATS,
  NO_PADDING,
  applyImageEdit,
  createImageOutput,
  createImageRecipe,
  detectEncodableFormats,
  renderImage,
} from '../../media/image'
import type { ImageEdit, ImageFormat, ImageOutput, ImageRecipe } from '../../media/image'
import { isAbortError } from '../../utils/abort'
import { formatBytes } from '../../utils/format'
import type { EditPageProps } from '../types'
import { fitAspect, sourceRectToView, viewRectToSource, viewSize } from './crop'
import type { Rect } from './crop'
import { ImagePreview } from './ImagePreview'
import { ImageSidebar } from './ImageSidebar'
import { imageMessages } from './messages'
import { useImageEstimate } from './useImageEstimate'
import { useImageSource } from './useImageSource'

/** どのブラウザでもまず書き出せる形式。実際に書き出せるかは detectEncodableFormats で確かめる */
const BASELINE_FORMATS: ImageFormat[] = ['png', 'jpeg', 'webp']
/** 編集前の表示に使う、何もしないレシピ */
const IDENTITY = createImageRecipe()

/** 画像 1 枚を開き、回転・切り抜き・リサイズ・余白を決めて書き出す画面 */
export default function EditPage({ opened, isDragging, onFiles }: EditPageProps) {
  const { t } = useI18n()
  const m = useLocalMessages(imageMessages)
  const file = opened?.file ?? null
  const { source, error: loadError, loading } = useImageSource(file)
  const info = source?.info ?? null

  const history = useRecipeHistory<ImageRecipe>(createImageRecipe)
  const { recipe, update } = history
  // 出力設定は別の画像を開いても残す（同じ設定で続けて書き出すことが多いので）
  const [savedOutput, setOutput] = usePersistentState<ImageOutput>('image.output', () => createImageOutput())

  const [formats, setFormats] = useState<ImageFormat[]>(BASELINE_FORMATS)
  useEffect(() => {
    let cancelled = false
    void detectEncodableFormats().then((found) => {
      if (!cancelled && found.length > 0) setFormats(found)
    })
    return () => {
      cancelled = true
    }
  }, [])
  // 前に選んだ形式がこのブラウザで書き出せなければ PNG に倒す（PNG はどこでも書き出せる）
  const output = useMemo(
    () => (formats.includes(savedOutput.format) ? savedOutput : { ...savedOutput, format: 'png' as const }),
    [formats, savedOutput]
  )

  const [showAfter, setShowAfter] = useState(true)
  const [cropping, setCropping] = useState(false)
  const [aspect, setAspect] = useState<number | null>(null)
  const [backgroundDraft, setBackgroundDraft] = useState<string | null | undefined>(undefined)

  const edit = useCallback(
    (e: ImageEdit) => {
      if (!info) return
      update((current) => applyImageEdit(current, e, info))
    },
    [info, update]
  )

  const estimate = useImageEstimate(source ? file : null, recipe, output)

  // 書き出しの結果は見込みで作ったものを使い回す。設定が変わった直後なら作り直す
  const render = useCallback(async () => {
    if (!file) throw new DOMException('No file', 'AbortError')
    return estimate.rendered ?? (await renderImage(file, recipe, output))
  }, [file, estimate.rendered, recipe, output])

  const save = useSave({
    opened,
    lossless: output.format === 'png',
    sameFormat: !!info && IMAGE_FORMATS[output.format].mime === info.mime,
    // クリップボードは PNG しか受け付けない。ほかの形式は「PNG でコピー」を別に出す
    canCopy: output.format === 'png',
    disabled: !source,
    render,
    onSourceReplaced: (next) => onFiles([next]),
  })

  // 出力が PNG 以外でも、貼り付け先で使えるよう PNG にしてコピーできるようにする
  const copyAsPng = useCallback(async () => {
    if (!file) return
    try {
      const rendered =
        output.format === 'png' && estimate.rendered
          ? estimate.rendered
          : await renderImage(file, recipe, { format: 'png', quality: 100, targetBytes: null })
      await copyBlobToClipboard(rendered.blob)
      toast(t.copiedToClipboard)
    } catch (err) {
      if (isAbortError(err)) return
      console.error('Copy failed:', err)
      toast.error(t.saveFailed(err instanceof Error ? err.message : String(err)))
    }
  }, [file, output.format, estimate.rendered, recipe, t])

  // ⌘C: 文字を選んでいなければ、編集結果の画像をコピーする
  useEffect(() => {
    if (!source) return
    const onCopy = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target) || isEditableTarget(document.activeElement)) return
      const selection = window.getSelection()
      if (selection && !selection.isCollapsed) return
      event.preventDefault()
      void copyAsPng()
    }
    document.addEventListener('copy', onCopy)
    return () => document.removeEventListener('copy', onCopy)
  }, [source, copyAsPng])

  // 切り抜き中は Enter / Esc で抜ける
  useEffect(() => {
    if (!cropping) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return
      if (event.key === 'Enter' || event.key === 'Escape') setCropping(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cropping])

  // 背景色を選んでいる最中は、その色をプレビューにだけ効かせる
  const previewRecipe = useMemo(
    () => (backgroundDraft === undefined ? recipe : { ...recipe, background: backgroundDraft }),
    [recipe, backgroundDraft]
  )
  // 切り抜き中は切り抜く前の全体（回転・反転だけ反映）を見せ、その上に枠を重ねる
  const cropBaseRecipe = useMemo(
    () => ({ ...previewRecipe, crop: null, resize: null, padding: NO_PADDING, background: null }),
    [previewRecipe]
  )

  const view = info ? viewSize(info, recipe.rotation) : null
  const cropRect: Rect | null =
    info && view
      ? recipe.crop
        ? sourceRectToView(recipe.crop, info, recipe)
        : { x: 0, y: 0, width: view.width, height: view.height }
      : null

  const commitCrop = (rect: Rect) => {
    if (!info) return
    update((current) => applyImageEdit(current, { type: 'crop', rect: viewRectToSource(rect, info, current) }, info))
  }

  const changeAspect = (next: number | null) => {
    setAspect(next)
    setCropping(true)
    if (next !== null && cropRect && view) commitCrop(fitAspect(cropRect, view, next))
  }

  const keepsAlpha = IMAGE_FORMATS[output.format].alpha
  const afterSize = estimate.rendered?.blob.size ?? estimate.last?.blob.size ?? null

  return (
    <div className="app">
      <ImageSidebar
        file={file}
        info={info}
        recipe={recipe}
        onEdit={edit}
        backgroundDraft={backgroundDraft}
        onBackgroundDraft={setBackgroundDraft}
        cropping={cropping}
        onCroppingChange={setCropping}
        aspect={aspect}
        onAspectChange={changeAspect}
        output={output}
        onOutputChange={setOutput}
        formats={formats}
        estimate={estimate}
        onFileSelect={(selected) => onFiles([selected])}
        save={save}
      />

      <div className="workspace">
        <div className="stage">
          {!file ? (
            <FileUpload
              isDragging={isDragging}
              message={m.dropHere}
              hint={m.dropHint}
              buttonLabel={t.selectFile}
              accept="image/*"
              onFiles={onFiles}
            />
          ) : source && cropRect ? (
            <ImagePreview
              bitmap={source.bitmap}
              info={source.info}
              className={isDragging ? 'drop-target-active' : undefined}
              {...(cropping
                ? {
                    recipe: cropBaseRecipe,
                    keepsAlpha: true,
                    crop: { rect: cropRect, aspect, onCommit: commitCrop, label: m.cropOverlay },
                  }
                : showAfter
                  ? { recipe: previewRecipe, keepsAlpha }
                  : { recipe: IDENTITY, keepsAlpha: true })}
            />
          ) : (
            <div className="preview-area text-sm text-muted-foreground">
              {loading ? t.estimating : loadError ? m.loadFailed : null}
            </div>
          )}
        </div>

        {source && (
          <div className="bottom-bar">
            <div className="adjust-row">
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={history.undo}
                  disabled={!history.canUndo}
                  title={`${t.undo} (⌘Z)`}
                  aria-label={t.undo}
                >
                  <Undo2 />
                </Button>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={history.redo}
                  disabled={!history.canRedo}
                  title={`${t.redo} (⇧⌘Z)`}
                  aria-label={t.redo}
                >
                  <Redo2 />
                </Button>
              </div>

              <div className="result-actions">
                <ToggleGroup
                  type="single"
                  spacing={1}
                  className="rounded-md bg-secondary p-[3px]"
                  value={showAfter ? 'after' : 'before'}
                  disabled={cropping}
                  // 押し直しで両方が外れないよう、空の値は無視する
                  onValueChange={(value) => value && setShowAfter(value === 'after')}
                >
                  <ToggleGroupItem value="before" size="sm" className={compareItemClass}>
                    {m.before}
                    <span className="text-[10px] opacity-70">{formatBytes(source.file.size)}</span>
                  </ToggleGroupItem>
                  <ToggleGroupItem value="after" size="sm" className={compareItemClass}>
                    {m.after}
                    <span className="text-[10px] opacity-70">
                      {afterSize === null ? '…' : formatBytes(afterSize)}
                    </span>
                  </ToggleGroupItem>
                </ToggleGroup>
                {output.format !== 'png' && (
                  <Button variant="outline" size="sm" onClick={() => void copyAsPng()} title={m.copyAsPngTitle}>
                    <Copy />
                    {m.copyAsPng}
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 編集前後の切り替え。選ばれている側を白く浮かせる（動画の画面と同じ見た目） */
const compareItemClass =
  'h-7 gap-1.5 px-2.5 text-xs text-muted-foreground hover:bg-transparent data-[state=on]:bg-background data-[state=on]:text-foreground data-[state=on]:shadow-xs'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { detectKindAsync } from '../../app/intake'
import { BatchStatus } from '../../components/BatchStatus'
import { SidebarHead } from '../../components/BrandMark'
import { FileUpload } from '../../components/FileUpload'
import { OutputSteps } from '../../components/OutputSteps'
import { ResetSettingsButton, SourceName } from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { pickFiles } from '../../core/opened'
import type { OpenedFile } from '../../core/opened'
import { usePersistentState } from '../../core/usePersistentState'
import { canPickFolder, useBatchConversion } from '../../hooks/useBatchConversion'
import type { SaveTarget } from '../../hooks/useBatchConversion'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import type { BatchInput } from '../../state/batchConversion'
import type { ConversionSettings } from '../../types'
import { CONVERT_ACCEPT, CONVERT_KINDS, isConvertKind } from './kinds'
import type { ConvertKind } from './kinds'
import { convertMessages } from './messages'
import { DEFAULT_CONVERT_SETTINGS } from './outputs'
import type { ConvertSettings } from './outputs'
import { AudioSteps, ImageSteps, TextSteps } from './SettingsSteps'

interface ConvertPageProps {
  /** 画面を開いたときに一覧へ入れるファイル。App が選び直すと画面ごと作り直す */
  files: File[]
  /**
   * 以前は動画の出力設定を App が持っていた名残。いまは種類ごとに画面の中で持つので使わない
   * （App.tsx から外したら、ここも消す）
   */
  settings?: ConversionSettings
  onSettingsChange?: (settings: ConversionSettings) => void
  isDragging: boolean
  /** 種類と数による振り分け（planIntake）を通す入口。この画面では使わず、追加は画面の中で受ける */
  onFiles?: (files: OpenedFile[]) => void
}

/** 種類ごとに手順がいくつあるか。サイドバーの手順番号を通しで振るのに使う */
const STEP_COUNT: Record<ConvertKind, number> = { video: 3, audio: 2, image: 3, text: 3 }

/**
 * 種類の混ざった複数のファイルを、種類ごとの出力設定でまとめて書き出す画面。
 * 編集はせず、常に全体を変換する。保存はフォルダへ書き込むか、1 つの ZIP にまとめる。
 */
export function ConvertPage({ files, isDragging }: ConvertPageProps) {
  const { t } = useI18n()
  const m = useLocalMessages(convertMessages)

  // 種類ごとの出力設定は、画面を作り直しても（ファイルを選び直しても）残す
  const [video, setVideo] = usePersistentState('convert.video', DEFAULT_CONVERT_SETTINGS.video)
  const [audio, setAudio] = usePersistentState('convert.audio', DEFAULT_CONVERT_SETTINGS.audio)
  const [image, setImage] = usePersistentState('convert.image', DEFAULT_CONVERT_SETTINGS.image)
  const [text, setText] = usePersistentState('convert.text', DEFAULT_CONVERT_SETTINGS.text)
  const [savedTarget, setSaveTarget] = usePersistentState<SaveTarget>('convert.saveTarget', () =>
    canPickFolder() ? 'folder' : 'zip'
  )
  const folderAvailable = canPickFolder()
  // フォルダを選べないブラウザでは ZIP しかない
  const saveTarget: SaveTarget = folderAvailable ? savedTarget : 'zip'

  const settings = useMemo<ConvertSettings>(
    () => ({ video, audio, image, text }),
    [video, audio, image, text]
  )
  const batch = useBatchConversion(settings)
  const { add } = batch

  /** 種類を調べて一覧の末尾に足す。扱えない種類は外して知らせる */
  const addFiles = useCallback(
    async (selected: File[]) => {
      const kinds = await Promise.all(selected.map((file) => detectKindAsync(file)))
      const accepted: BatchInput[] = []
      selected.forEach((file, i) => {
        const kind = kinds[i]
        if (isConvertKind(kind)) accepted.push({ file, kind })
      })
      add(accepted)
      const skipped = selected.length - accepted.length
      if (skipped > 0) toast(accepted.length === 0 ? t.unsupportedFiles : t.skippedFiles(skipped))
    },
    [add, t]
  )

  // App から渡された最初のファイルは 1 回だけ入れる。App は描き直すたびに配列を作り直し、
  // 言語を切り替えると addFiles も作り直されるので、そのたびに入れ直すと外したファイルが戻ってしまう
  const [initialFiles] = useState(files)
  const initialAdded = useRef(false)
  useEffect(() => {
    if (initialAdded.current) return
    initialAdded.current = true
    void addFiles(initialFiles)
  }, [addFiles, initialFiles])

  const pickMore = async () => {
    const picked = await pickFiles({ multiple: true, accept: CONVERT_ACCEPT })
    if (picked.length > 0) await addFiles(picked.map(({ file }) => file))
  }

  const count = batch.entries.length
  const presentKinds = CONVERT_KINDS.filter((kind) =>
    batch.entries.some((entry) => entry.kind === kind)
  )
  const countOf = (kind: ConvertKind) => batch.entries.filter((entry) => entry.kind === kind).length

  // 手順の番号は入力を 1 として、表示している種類の手順を通しで振る
  const groups = presentKinds.map((kind, i) => ({
    kind,
    startIndex: 2 + presentKinds.slice(0, i).reduce((sum, k) => sum + STEP_COUNT[k], 0),
  }))
  const saveIndex = 2 + presentKinds.reduce((sum, k) => sum + STEP_COUNT[k], 0)

  const resetAll = () => {
    setVideo(DEFAULT_CONVERT_SETTINGS.video)
    setAudio(DEFAULT_CONVERT_SETTINGS.audio)
    setImage(DEFAULT_CONVERT_SETTINGS.image)
    setText(DEFAULT_CONVERT_SETTINGS.text)
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <SidebarHead />

        <div className="sidebar-scroll">
          <Step index={1} title={t.stepInput}>
            {count > 0 ? (
              <SourceName>{m.queued(count)}</SourceName>
            ) : (
              <StepHint>{t.batchEmpty}</StepHint>
            )}
            <div className="flex gap-1.5">
              <Button
                variant="outline"
                size="xs"
                className="h-7 px-2.5"
                onClick={pickMore}
                disabled={batch.running}
              >
                {count > 0 ? m.addFiles : t.selectFiles}
              </Button>
              {count > 0 && (
                <Button
                  variant="ghost"
                  size="xs"
                  className="h-7 px-2.5 text-muted-foreground"
                  onClick={batch.clear}
                  disabled={batch.running}
                >
                  {m.clearAll}
                </Button>
              )}
            </div>
          </Step>

          {groups.map(({ kind, startIndex }) => {
            return (
              <div key={kind} role="group" aria-label={t.kindLabel[kind]}>
                <GroupHead>{m.groupTitle(t.kindLabel[kind], countOf(kind))}</GroupHead>
                {kind === 'video' && (
                  <OutputSteps
                    startIndex={startIndex}
                    settings={video}
                    onSettingsChange={setVideo}
                    dimensions={null}
                  />
                )}
                {kind === 'audio' && (
                  <AudioSteps startIndex={startIndex} output={audio} onChange={setAudio} />
                )}
                {kind === 'image' && (
                  <ImageSteps startIndex={startIndex} value={image} onChange={setImage} />
                )}
                {kind === 'text' && (
                  <TextSteps startIndex={startIndex} value={text} onChange={setText} />
                )}
              </div>
            )
          })}

          {count > 0 && (
            <Step index={saveIndex} title={m.stepSave}>
              <div className="flex gap-1.5" role="radiogroup" aria-label={m.stepSave}>
                <TargetButton
                  active={saveTarget === 'folder'}
                  disabled={!folderAvailable || batch.running}
                  onClick={() => setSaveTarget('folder')}
                >
                  {m.saveFolder}
                </TargetButton>
                <TargetButton
                  active={saveTarget === 'zip'}
                  disabled={batch.running}
                  onClick={() => setSaveTarget('zip')}
                >
                  {m.saveZip}
                </TargetButton>
              </div>
              <StepHint>
                {!folderAvailable
                  ? m.folderUnavailable
                  : saveTarget === 'folder'
                    ? m.saveFolderHint
                    : m.saveZipHint}
              </StepHint>
            </Step>
          )}

          {count > 0 && <ResetSettingsButton onClick={resetAll} />}
        </div>

        <div className="sidebar-footer flex flex-col gap-2">
          {batch.running ? (
            <Button variant="destructive" className="w-full" onClick={batch.cancel}>
              {batch.zipping ? m.zipping : t.cancel}
            </Button>
          ) : (
            <>
              {batch.archive && (
                <Button variant="outline" className="w-full" onClick={batch.saveArchive}>
                  {m.saveZipAgain}
                </Button>
              )}
              <Button className="w-full" onClick={() => batch.run(saveTarget)} disabled={count === 0}>
                {m.convert(count)}
              </Button>
            </>
          )}
        </div>
      </aside>

      <div className="workspace">
        <div className="stage">
          {count > 0 ? (
            <div
              className={cn(
                'flex-1 overflow-y-auto bg-background px-5 py-4',
                isDragging && 'drop-target-active'
              )}
            >
              {batch.error && (
                <div
                  role="alert"
                  className="mb-3 rounded-md border border-destructive px-3 py-2.5 text-[13px] text-destructive"
                >
                  {batch.error}
                </div>
              )}
              <BatchStatus entries={batch.entries} onRemove={batch.running ? undefined : batch.remove} />
            </div>
          ) : (
            <FileUpload
              isDragging={isDragging}
              message={m.dropHere}
              hint={m.dropHint}
              buttonLabel={t.selectFiles}
              accept={CONVERT_ACCEPT}
              multiple
              onFiles={(picked) => void addFiles(picked.map(({ file }) => file))}
            />
          )}
        </div>
      </div>
    </div>
  )
}

/** サイドバーで種類ごとの設定を区切る見出し */
function GroupHead({ children }: { children: ReactNode }) {
  return (
    <h2 className="border-b border-secondary bg-muted/50 px-4 py-2 text-xs font-semibold">
      {children}
    </h2>
  )
}

/** 保存先の選択。フォルダを選べないブラウザでは、選べないまま理由を下に添える */
function TargetButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Button
      variant={active ? 'default' : 'outline'}
      size="sm"
      className="flex-1 text-xs"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  )
}

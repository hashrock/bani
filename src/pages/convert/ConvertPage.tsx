import { useCallback, useEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import type { ReactNode } from 'react'
import { toast } from 'sonner'
import { detectKindAsync } from '../../app/intake'
import { BatchStatus } from '../../components/BatchStatus'
import { SidebarHead } from '../../components/BrandMark'
import { FileUpload } from '../../components/FileUpload'
import { OutputSteps } from '../../components/OutputSteps'
import { SaveManyButton } from '../../components/SaveManyButton'
import { ResetSettingsButton, SidebarFooter, SmallButton, SourceName } from '../../components/SidebarParts'
import { Step, StepHint } from '../../components/Step'
import { canPickFolder, planSaveMany } from '../../core/save'
import { pickFiles } from '../../core/opened'
import type { OpenedFile } from '../../core/opened'
import { useHotkey } from '../../core/useHotkey'
import { usePersistentState } from '../../core/usePersistentState'
import { useBatchConversion } from '../../hooks/useBatchConversion'
import { useI18n } from '../../i18n/context'
import { useLocalMessages } from '../../i18n/local'
import type { BatchInput } from '../../state/batchConversion'
import { isSvgFile } from '../../media/image/svg'
import { CONVERT_ACCEPT, CONVERT_KINDS, batchKindOf, isConvertKind } from './kinds'
import type { ConvertKind } from './kinds'
import { convertMessages } from './messages'
import { DEFAULT_CONVERT_SETTINGS } from './outputs'
import type { ConvertSettings } from './outputs'
import { AudioSteps, ImageSteps, TextSteps } from './SettingsSteps'

interface ConvertPageProps {
  /**
   * App が受け取ったファイル（ドロップ・貼り付け・入口での選択）。id が変わるたびに一覧の末尾へ足す。
   * この画面にいるあいだに落としたものも、一覧を作り直さずに足す
   */
  incoming: { id: number; files: OpenedFile[] } | null
  isDragging: boolean
}

/** 種類ごとに手順がいくつあるか。サイドバーの手順番号を通しで振るのに使う */
const STEP_COUNT: Record<ConvertKind, number> = { video: 3, audio: 2, image: 3, text: 3 }

/**
 * 種類の混ざった複数のファイルを、種類ごとの出力設定でまとめて書き出す画面。
 * 編集はせず、常に全体を変換する。保存はフォルダへ書き込むか、1 つの ZIP にまとめるか、1 つずつダウンロード。
 */
export function ConvertPage({ incoming, isDragging }: ConvertPageProps) {
  const { t } = useI18n()
  const m = useLocalMessages(convertMessages)

  // 種類ごとの出力設定は、画面を作り直しても（ファイルを選び直しても）残す
  const [video, setVideo] = usePersistentState('convert.video', DEFAULT_CONVERT_SETTINGS.video)
  const [audio, setAudio] = usePersistentState('convert.audio', DEFAULT_CONVERT_SETTINGS.audio)
  const [image, setImage] = usePersistentState('convert.image', DEFAULT_CONVERT_SETTINGS.image)
  const [text, setText] = usePersistentState('convert.text', DEFAULT_CONVERT_SETTINGS.text)

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
        const kind = batchKindOf(file, kinds[i])
        if (isConvertKind(kind)) accepted.push({ file, kind })
      })
      add(accepted)
      const skipped = selected.length - accepted.length
      if (skipped > 0) toast(accepted.length === 0 ? t.unsupportedFiles : t.skippedFiles(skipped))
    },
    [add, t]
  )

  // 届いたファイルは id ごとに 1 回だけ入れる。言語を切り替えると addFiles も作り直されるので、
  // そのたびに入れ直すと外したファイルが戻ってしまう
  const takenRef = useRef<number | null>(null)
  useEffect(() => {
    if (!incoming || takenRef.current === incoming.id) return
    takenRef.current = incoming.id
    void addFiles(incoming.files.map(({ file }) => file))
  }, [incoming, addFiles])

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

  const resetAll = () => {
    setVideo(DEFAULT_CONVERT_SETTINGS.video)
    setAudio(DEFAULT_CONVERT_SETTINGS.audio)
    setImage(DEFAULT_CONVERT_SETTINGS.image)
    setText(DEFAULT_CONVERT_SETTINGS.text)
  }

  // ⌘S は主の保存方法で変換して保存する（ほかの画面の保存と同じキー）
  useHotkey(
    'mod+s',
    () => {
      if (count > 0 && !batch.running) void batch.run(planSaveMany({ canPickFolder: canPickFolder(), count }).primary)
    },
    { inEditable: true }
  )

  return (
    <div className="app">
      <aside className="sidebar">
        <SidebarHead />

        <div className="sidebar-scroll">
          <Step index={1} title={t.stepInput}>
            {count > 0 ? (
              <SourceName>{m.queued(count)}</SourceName>
            ) : (
              <StepHint>{t.inputEmpty}</StepHint>
            )}
            <div className="flex gap-1.5">
              <SmallButton onClick={pickMore} disabled={batch.running}>
                {count > 0 ? m.addFiles : t.selectFile}
              </SmallButton>
              {count > 0 && (
                <SmallButton
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={batch.clear}
                  disabled={batch.running}
                >
                  {m.clearAll}
                </SmallButton>
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
                    presetScope="convert.video"
                  />
                )}
                {kind === 'audio' && (
                  <AudioSteps startIndex={startIndex} output={audio} onChange={setAudio} />
                )}
                {kind === 'image' && (
                  <ImageSteps
                    startIndex={startIndex}
                    value={image}
                    onChange={setImage}
                    hasSvg={batch.entries.some((entry) => entry.kind === 'image' && isSvgFile(entry.file))}
                  />
                )}
                {kind === 'text' && (
                  <TextSteps startIndex={startIndex} value={text} onChange={setText} />
                )}
              </div>
            )
          })}

          {count > 0 && <ResetSettingsButton onClick={resetAll} />}
        </div>

        <SidebarFooter progress={batch.progress} onCancel={batch.cancel}>
          {batch.archive && (
            <SmallButton className="h-9 w-full" onClick={() => void batch.saveArchive()}>
              {m.saveZipAgain}
            </SmallButton>
          )}
          <SaveManyButton
            count={count}
            disabled={count === 0}
            primaryLabel={() => m.convert(count)}
            onSave={(method) => void batch.run(method)}
          />
        </SidebarFooter>
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
              <BatchStatus entries={batch.entries} onRemove={batch.running ? undefined : batch.remove} />
            </div>
          ) : (
            <FileUpload
              isDragging={isDragging}
              message={m.dropHere}
              hint={m.dropHint}
              buttonLabel={t.selectFile}
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

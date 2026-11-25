import { useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { pickFiles } from '../core/opened'
import type { OpenedFile } from '../core/opened'
import type { SaveState } from '../core/useSave'
import { SaveButton } from './SaveButton'
import { useI18n } from '../i18n/context'
import { defineMessages, useLocalMessages } from '../i18n/local'
import { usesTargetSize } from '../media/video'
import type { VideoInfo, VideoOutput, VideoSize } from '../media/video'
import { trimDuration } from '../state/trim'
import type { PreviewEstimate, Trim } from '../types'
import { formatBytes, formatTimecode } from '../utils/format'
import { SidebarHead } from './BrandMark'
import { Caret } from './Caret'
import { CompatibilityList } from './CompatibilityList'
import { OutputSteps } from './OutputSteps'
import {
  EstimateBox,
  EstimateRow,
  Fact,
  Facts,
  Notice,
  ResetSettingsButton,
  SidebarFooter,
  SmallButton,
  SourceName,
} from './SidebarParts'
import { Step, StepHint } from './Step'

const messages = defineMessages({
  ja: {
    targetOver: (size: string) =>
      `見込みでは ${size} を超えます。解像度を下げるか、トリムで短くしてください`,
  },
  en: {
    targetOver: (size: string) => `Likely over ${size}. Lower the resolution or trim it shorter`,
  },
})

interface SidebarProps {
  file: File | null
  media: VideoInfo | null
  output: VideoOutput
  onOutputChange: (output: VideoOutput) => void
  /** 書き出す区間 */
  trim: Trim
  /** 切り抜き・回転のあとの寸法。解像度のプリセットの基準にする */
  editedSize: VideoSize | null
  /** 入力の次に置く編集の手順。番号を受け取って描く */
  renderEditStep?: (index: number) => ReactNode
  /** 見込みの次に置く、ほかの書き出しの手順 */
  renderExportStep?: (index: number) => ReactNode
  onFileSelect: (file: OpenedFile) => void
  onResetSettings: () => void
  previewEstimate: PreviewEstimate
  converting: boolean
  progress: number
  hasResult: boolean
  stale: boolean
  onConvert: () => void
  onCancel: () => void
  save: SaveState
}

/**
 * 単体編集の手順（入力 → 編集 → 形式 → 画質 → 解像度 → 見込み → ほかの書き出し → 実行）を上から下に並べたパネル。
 */
export function Sidebar({
  file,
  media,
  output,
  onOutputChange,
  trim,
  editedSize,
  renderEditStep,
  renderExportStep,
  onFileSelect,
  onResetSettings,
  previewEstimate,
  converting,
  progress,
  hasResult,
  stale,
  onConvert,
  onCancel,
  save,
}: SidebarProps) {
  const { t, lang } = useI18n()
  const m = useLocalMessages(messages)
  const [detailsOpen, setDetailsOpen] = useState(false)

  const dimensions = media?.dimensions ?? null
  const trimmedDuration = trimDuration(trim)
  // 編集の手順があればその分だけ後ろの番号をずらす
  const outputIndex = renderEditStep ? 3 : 2
  const estimateIndex = outputIndex + 3

  return (
    <aside className="sidebar">
      <SidebarHead />

      <div className="sidebar-scroll">
        <Step index={1} title={t.stepInput}>

          {file ? (
            <div className="flex flex-col gap-2">
              <SourceName title={file.name}>{file.name}</SourceName>
              <Facts>
                <Fact label={t.factSize}>{formatBytes(file.size)}</Fact>
                {dimensions && (
                  <Fact label={t.factResolution}>
                    {dimensions.width}×{dimensions.height}
                  </Fact>
                )}
                {media && <Fact label={t.factDuration}>{formatTimecode(media.duration)}</Fact>}
              </Facts>

              <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen} className="flex flex-col gap-2">
                <CollapsibleTrigger className="flex items-center gap-1 self-start text-[11px] text-muted-foreground hover:text-foreground">
                  <Caret open={detailsOpen} className="text-inherit" />
                  {t.details}
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <Facts className="border-t border-secondary pt-2 text-[11px]">
                    <Fact label={t.factMime}>{file.type || 'unknown'}</Fact>
                    {media?.videoCodec && <Fact label={t.factVideoCodec}>{media.videoCodec}</Fact>}
                    {media?.audioCodec && <Fact label={t.factAudioCodec}>{media.audioCodec}</Fact>}
                    {media?.tags?.title && <Fact label={t.factTitle}>{media.tags.title}</Fact>}
                    {media?.tags?.artist && <Fact label={t.factArtist}>{media.tags.artist}</Fact>}
                    <Fact label={t.factModified}>
                      {new Date(file.lastModified).toLocaleString(lang)}
                    </Fact>
                  </Facts>
                </CollapsibleContent>
              </Collapsible>
            </div>
          ) : (
            <StepHint>{t.inputEmpty}</StepHint>
          )}

          <div className="flex gap-1.5">
            <SmallButton
              onClick={async () => {
                const [picked] = await pickFiles({ accept: 'video/*' })
                if (picked) onFileSelect(picked)
              }}
            >
              {t.selectFile}
            </SmallButton>
          </div>
        </Step>

        {renderEditStep?.(2)}

        <OutputSteps
          startIndex={outputIndex}
          settings={output}
          onSettingsChange={onOutputChange}
          dimensions={editedSize}
          duration={trimmedDuration}
          presetScope="video"
        />

        <Step index={estimateIndex} title={t.stepEstimate}>
          <EstimateBox>
            <EstimateRow label={t.estimatedSize}>
              {previewEstimate.isEstimating
                ? t.estimating
                : previewEstimate.estimatedSize > 0
                  ? formatBytes(previewEstimate.estimatedSize)
                  : '—'}
            </EstimateRow>
            <EstimateRow label={t.outputDuration}>
              {trimmedDuration > 0 ? formatTimecode(trimmedDuration) : '—'}
            </EstimateRow>
          </EstimateBox>

          {/* 目標サイズを狙ってもエンコーダが守りきれないことがあるので、見込みで超えていれば知らせる */}
          {usesTargetSize(output) &&
            !previewEstimate.isEstimating &&
            output.targetSize !== undefined &&
            previewEstimate.estimatedSize > output.targetSize && (
              <Notice tone="warn">{m.targetOver(formatBytes(output.targetSize))}</Notice>
            )}

          {previewEstimate.estimatedSize > 0 ? (
            <CompatibilityList
              estimatedSize={previewEstimate.estimatedSize}
              duration={trimmedDuration}
            />
          ) : (
            <StepHint>{t.estimateEmpty}</StepHint>
          )}
        </Step>

        {renderExportStep?.(estimateIndex + 1)}

        <ResetSettingsButton onClick={onResetSettings} />
      </div>

      {/* 動画は書き出しに時間がかかるので、変換して結果を確かめてから保存する（保存だけ押せば変換もする） */}
      <SidebarFooter progress={converting ? progress : null} onCancel={onCancel}>
        <Button
          variant={hasResult && !stale ? 'outline' : 'default'}
          className="w-full"
          onClick={onConvert}
          disabled={!file}
        >
          {hasResult ? (stale ? t.reconvertLong : t.convertAgain) : t.convert}
        </Button>
        <SaveButton save={save} disabled={!file} />
      </SidebarFooter>
    </aside>
  )
}

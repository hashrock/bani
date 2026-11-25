// 画面と一緒に読み込まれるので、エンコーダやデコーダを引き込まない純粋な部分だけを直接読む
// （書き出しそのものは render.ts に分け、変換を始めたときに読み込む）
import { audioFilename, createAudioOutput } from '../../media/audio/output'
import type { AudioOutput } from '../../media/audio/types'
import { createImageOutput, outputImageFilename } from '../../media/image/output'
import type { ImageOutput } from '../../media/image/output'
import { MAX_DIMENSION, createImageRecipe } from '../../media/image/recipe'
import type { ImageRecipe } from '../../media/image/recipe'
import type { TextEncodingName } from '../../media/text/encoding'
import { DEFAULT_VIDEO_OUTPUT } from '../../media/video/output'
import type { VideoOutput } from '../../media/video/types'
import type { BomSetting, NewlineSetting } from '../../media/text/recipe'
import type { ConvertKind } from './kinds'
import { splitExtension } from './outputNames'

/** 画像の一括変換。切り抜きのような 1 枚ごとの編集はせず、形式と長辺の上限だけを選ぶ */
export interface ImageBatchOutput {
  output: ImageOutput
  /** 長辺の上限（px）。null なら元の大きさ */
  maxSize: number | null
}

/** テキストの一括変換。文字コード・改行・BOM の付け替えだけを行う */
export interface TextBatchOutput {
  encoding: 'keep' | TextEncodingName
  newline: NewlineSetting
  bom: BomSetting
}

/** 種類ごとの出力設定。画面では種類ごとに別々に持ち、書き出しのときにまとめて渡す */
export interface ConvertSettings {
  video: VideoOutput
  audio: AudioOutput
  image: ImageBatchOutput
  text: TextBatchOutput
}

export const DEFAULT_CONVERT_SETTINGS: ConvertSettings = {
  video: DEFAULT_VIDEO_OUTPUT,
  audio: createAudioOutput('mp3'),
  image: { output: createImageOutput('webp'), maxSize: null },
  text: { encoding: 'keep', newline: 'keep', bom: 'keep' },
}

/** 長辺の上限を受け付けられる値に収める。0 以下や読めない値は「上限なし」 */
export function clampMaxSize(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 1) return null
  return Math.min(MAX_DIMENSION, Math.round(value))
}

export function imageBatchRecipe({ maxSize }: ImageBatchOutput): ImageRecipe {
  const size = clampMaxSize(maxSize)
  const recipe = createImageRecipe()
  if (size === null) return recipe
  // 幅・高さとも上限にした縦横比を保つ枠に収めると、回転後の長辺が上限以下になる
  return { ...recipe, resize: { width: size, height: size, keepAspect: true, allowUpscale: false } }
}

const withExtension = (name: string, extension: string) => {
  const { base } = splitExtension(name)
  return `${base || 'output'}.${extension}`
}

/**
 * 書き出したときの名前。衝突を書き出す前にまとめて解く（outputNames.ts）ため、
 * 変換を走らせずに決められるよう、各エンジンの名前の付け方をここで先に当てる
 */
export function plannedOutputName(file: File, kind: ConvertKind, settings: ConvertSettings): string {
  switch (kind) {
    case 'video':
      return withExtension(file.name, settings.video.format)
    case 'audio':
      return audioFilename(file.name, settings.audio.format)
    case 'image':
      return outputImageFilename(file.name, settings.image.output.format)
    case 'text':
      // 中身の文字コードが変わるだけなので名前はそのまま
      return file.name
  }
}

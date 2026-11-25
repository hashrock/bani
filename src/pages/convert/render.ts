import { encode } from '../../converters'
import {
  AUDIO_FORMATS,
  NoAudioTrackError,
  UnsupportedAudioFormatError,
  createAudioRecipe,
  probeAudio,
  renderAudio,
} from '../../media/audio'
import { renderImage } from '../../media/image'
import { DEFAULT_TEXT_RECIPE, UnrepresentableCharactersError, renderText } from '../../media/text'
import type { RenderOptions } from '../../media/types'
import type { ConvertKind } from './kinds'
import type { ConvertMessages } from './messages'
import type { ConvertSettings } from './outputs'
import { imageBatchRecipe } from './outputs'

/*
 * 一括変換の書き出し。各エンジン（エンコーダ・デコーダ・文字コード表）を引き込むので、
 * 変換を始めたときに useBatchConversion から読み込む。
 */

const VIDEO_MIME = { mp4: 'video/mp4', webm: 'video/webm', gif: 'image/gif' } as const

/** 1 件を種類に合った設定で書き出す。保存先への書き込みは呼び出し側が行う */
export async function renderEntry(
  file: File,
  kind: ConvertKind,
  settings: ConvertSettings,
  options: RenderOptions
): Promise<Blob> {
  switch (kind) {
    case 'video': {
      const encoded = await encode({
        file,
        // 長さの異なるファイルが混ざるため、バッチでは常に全体を変換する
        trim: null,
        settings: settings.video,
        signal: options.signal,
        onProgress: options.onProgress,
      })
      return new Blob([encoded.buffer], { type: VIDEO_MIME[settings.video.format] })
    }
    case 'audio': {
      const info = await probeAudio(file)
      return (await renderAudio(file, createAudioRecipe(info), settings.audio, options)).blob
    }
    case 'image':
      return (await renderImage(file, imageBatchRecipe(settings.image), settings.image.output, options))
        .blob
    case 'text':
      return (
        await renderText(file, { ...DEFAULT_TEXT_RECIPE, ...settings.text }, options)
      ).blob
  }
}

/** 失敗の理由を一覧に出す文に直す。エンジンの例外のうち、利用者が手を打てるものは言い換える */
export function describeFailure(err: unknown, m: ConvertMessages, fallback: string): string {
  if (err instanceof NoAudioTrackError) return m.errorNoAudio
  if (err instanceof UnsupportedAudioFormatError) {
    return m.errorAudioFormat(AUDIO_FORMATS[err.format].extension.toUpperCase())
  }
  if (err instanceof UnrepresentableCharactersError) {
    return m.errorUnrepresentable(err.characters.length, err.encoding)
  }
  return err instanceof Error && err.message ? err.message : fallback
}

import { useCallback, useEffect, useReducer, useRef } from 'react'
import { useI18n } from '../i18n/context'
import { renderVideo } from '../media/video'
import type { VideoInfo, VideoOutput, VideoRecipe } from '../media/video'
import {
  initialJobState,
  isJobRunning,
  jobErrorMessage,
  jobProgress,
  jobReducer,
  jobResult,
} from '../state/conversionJob'
import type { JobState } from '../state/conversionJob'
import type { ConversionResult } from '../types'
import { isAbortError } from '../utils/abort'

interface UseConversionJobOptions {
  file: File | null
  recipe: VideoRecipe
  output: VideoOutput
  media: VideoInfo | null
}

export interface ConversionJob {
  state: JobState
  running: boolean
  progress: number
  result: ConversionResult | null
  error: string
  /** 変換結果を返す。失敗・中断時は null */
  convert: () => Promise<ConversionResult | null>
  cancel: () => void
  reset: () => void
}

/** 元ファイル + レシピ + 出力設定 から 1 本を書き出す。結果はプレビューと保存に使う */
export function useConversionJob({
  file,
  recipe,
  output,
  media,
}: UseConversionJobOptions): ConversionJob {
  const { t } = useI18n()
  const [state, dispatch] = useReducer(jobReducer, initialJobState)
  const abortRef = useRef<AbortController | null>(null)

  // 画面を離れたら走っている変換も止める
  useEffect(() => () => abortRef.current?.abort(), [])

  const convert = useCallback(async () => {
    if (!file) return null

    const controller = new AbortController()
    abortRef.current = controller
    dispatch({ type: 'start' })

    try {
      const rendered = await renderVideo(file, recipe, output, {
        info: media,
        signal: controller.signal,
        onProgress: (progress) => dispatch({ type: 'progress', value: Math.round(progress * 100) }),
      })
      const converted: ConversionResult = {
        blob: rendered.blob,
        originalSize: file.size,
        convertedSize: rendered.blob.size,
        filename: rendered.filename,
      }
      dispatch({ type: 'done', result: converted })
      return converted
    } catch (err) {
      // 中断は cancel() 側で状態に反映済みなので、ここでは何もしない
      if (isAbortError(err)) return null
      console.error('Conversion error:', err)
      dispatch({
        type: 'fail',
        message: err instanceof Error ? err.message : t.errorConversionFailed,
      })
      return null
    } finally {
      if (abortRef.current === controller) abortRef.current = null
    }
  }, [file, recipe, output, media, t])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ type: 'cancel' })
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    dispatch({ type: 'reset' })
  }, [])

  return {
    state,
    running: isJobRunning(state),
    progress: jobProgress(state),
    result: jobResult(state),
    error: state.kind === 'cancelled' ? t.errorCancelled : jobErrorMessage(state),
    convert,
    cancel,
    reset,
  }
}

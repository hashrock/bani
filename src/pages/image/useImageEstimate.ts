import { useEffect, useState } from 'react'
import { renderImage } from '../../media/image'
import type { ImageOutput, ImageRecipe, RenderedImage } from '../../media/image'
import { isAbortError } from '../../utils/abort'

/** 設定を触っている最中に何度も書き出さないよう、止まってから書き出すまでの間 */
const DEBOUNCE_MS = 350

type Estimate =
  | { recipe: ImageRecipe; output: ImageOutput; ok: true; rendered: RenderedImage }
  | { recipe: ImageRecipe; output: ImageOutput; ok: false; error: unknown }

/**
 * いまのレシピと出力設定で実際に書き出してみて、サイズを見込む。
 * 画像は 1 枚なので推定より実際に書き出すほうが速く正確で、結果は保存にもそのまま使える。
 * レシピと出力設定は不変オブジェクトなので、同じものかどうかは参照で比べる。
 */
export function useImageEstimate(file: File | null, recipe: ImageRecipe, output: ImageOutput) {
  const [estimate, setEstimate] = useState<Estimate | null>(null)

  useEffect(() => {
    if (!file) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const rendered = await renderImage(file, recipe, output, { signal: controller.signal })
        if (!controller.signal.aborted) setEstimate({ recipe, output, ok: true, rendered })
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return
        setEstimate({ recipe, output, ok: false, error })
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [file, recipe, output])

  const fresh = estimate && estimate.recipe === recipe && estimate.output === output ? estimate : null
  return {
    /** いまの設定で書き出した結果。まだなら null */
    rendered: fresh?.ok ? fresh.rendered : null,
    error: fresh && !fresh.ok ? fresh.error : null,
    estimating: !!file && fresh === null,
    /** 直前の結果（計算中でも数字を消さずに出しておくため） */
    last: estimate?.ok ? estimate.rendered : null,
  }
}

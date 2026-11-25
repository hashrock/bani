import { useEffect, useState } from 'react'
import { animationPlan, renderAnimation } from '../../media/gif'
import type { AnimationOutput, FrameLookup, GifRecipe } from '../../media/gif'
import type { RenderedFile } from '../../media/types'
import { isAbortError } from '../../utils/abort'

/** 触っている最中に何度も書き出さないよう、止まってから書き出すまでの間 */
const DEBOUNCE_MS = 500
/**
 * 裏で書き出して見込むのは、フレーム数 × 画素数がこれ以下のときだけ。
 * 大きなアニメーションを編集のたびに書き出すと重いので、それより大きければ保存のときに計算する
 */
const AUTO_BUDGET = 24_000_000

type Estimate =
  | { recipe: GifRecipe; output: AnimationOutput; ok: true; rendered: RenderedFile }
  | { recipe: GifRecipe; output: AnimationOutput; ok: false; error: unknown }

/**
 * いまのレシピと出力設定で実際に書き出してみて、大きさを見込む（画像の画面と同じ考え方）。
 * 結果は保存にもそのまま使う。レシピと出力設定は不変なので、同じものかは参照で比べる
 */
export function useAnimationEstimate(
  recipe: GifRecipe,
  output: AnimationOutput,
  lookup: FrameLookup,
  name: string | null,
  enabled: boolean
) {
  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const plan = animationPlan(recipe)
  const workload = plan ? plan.canvasWidth * plan.canvasHeight * recipe.frames.length : 0
  const auto = enabled && recipe.frames.length > 0 && workload > 0 && workload <= AUTO_BUDGET

  useEffect(() => {
    if (!auto) return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const rendered = await renderAnimation(recipe, lookup, output, { signal: controller.signal, name })
        if (!controller.signal.aborted) setEstimate({ recipe, output, ok: true, rendered })
      } catch (error) {
        if (controller.signal.aborted || isAbortError(error)) return
        console.error('Animation estimate failed:', error)
        setEstimate({ recipe, output, ok: false, error })
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [auto, recipe, output, lookup, name])

  const fresh = estimate && estimate.recipe === recipe && estimate.output === output ? estimate : null
  return {
    rendered: fresh?.ok ? fresh.rendered : null,
    error: fresh && !fresh.ok ? fresh.error : null,
    estimating: auto && fresh === null,
    /** 大きすぎて裏では書き出さない */
    deferred: enabled && recipe.frames.length > 0 && !auto,
    last: estimate?.ok ? estimate.rendered : null,
  }
}

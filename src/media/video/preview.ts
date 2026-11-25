import type { VideoSize } from './recipe'
import type { VideoRecipe } from './types'

/**
 * プレビューにレシピを映すための計算。元の映像は CSS の transform で回転・反転して見せ、
 * 切り抜きは元の向きの座標で重ねて描く（書き出しと同じく「切り抜いてから回す」）。
 * ドラッグの移動量は画面の向きなので、元の向きへ戻してから切り抜き範囲に足す。
 */

/** 元の映像を、回転したうえで area に収めたときの拡大率。回転前の要素の大きさは size × scale */
export function previewScale(area: VideoSize, size: VideoSize, recipe: Pick<VideoRecipe, 'rotation'>): number {
  if (!(size.width > 0 && size.height > 0 && area.width > 0 && area.height > 0)) return 0
  const quarter = recipe.rotation % 180 !== 0
  const rotatedWidth = quarter ? size.height : size.width
  const rotatedHeight = quarter ? size.width : size.height
  return Math.min(area.width / rotatedWidth, area.height / rotatedHeight)
}

/**
 * 要素に掛ける transform。CSS は右から順に効くので、回転してから画面の軸で反転する
 * （レシピの「回転してから反転」と同じ順）。
 */
export function previewTransform(recipe: Pick<VideoRecipe, 'rotation' | 'flipH' | 'flipV'>): string {
  return `scale(${recipe.flipH ? -1 : 1}, ${recipe.flipV ? -1 : 1}) rotate(${recipe.rotation}deg)`
}

/**
 * 画面上の移動量（CSS ピクセル）を、元の映像の画素での移動量に戻す。
 * 反転を戻してから回転を戻し、拡大率で割る。
 */
export function screenDeltaToSource(
  dx: number,
  dy: number,
  recipe: Pick<VideoRecipe, 'rotation' | 'flipH' | 'flipV'>,
  scale: number
): { dx: number; dy: number } {
  if (!(scale > 0)) return { dx: 0, dy: 0 }
  const fx = (recipe.flipH ? -dx : dx) / scale
  const fy = (recipe.flipV ? -dy : dy) / scale
  // 画面（y が下向き）で時計回りに θ 回した逆なので、-θ 回す
  switch (recipe.rotation) {
    case 0:
      return { dx: fx, dy: fy }
    case 90:
      return { dx: fy, dy: -fx }
    case 180:
      return { dx: -fx, dy: -fy }
    case 270:
      return { dx: -fy, dy: fx }
  }
}

/** 元の映像の画素での移動量を、画面上の移動量にする（screenDeltaToSource の逆） */
export function sourceDeltaToScreen(
  dx: number,
  dy: number,
  recipe: Pick<VideoRecipe, 'rotation' | 'flipH' | 'flipV'>,
  scale: number
): { dx: number; dy: number } {
  const [rx, ry] = rotateDelta(dx, dy, recipe.rotation)
  return {
    dx: (recipe.flipH ? -rx : rx) * scale,
    dy: (recipe.flipV ? -ry : ry) * scale,
  }
}

/** 画面（y が下向き）で時計回りに rotation 度回す */
function rotateDelta(dx: number, dy: number, rotation: VideoRecipe['rotation']): [number, number] {
  switch (rotation) {
    case 0:
      return [dx, dy]
    case 90:
      return [-dy, dx]
    case 180:
      return [-dx, -dy]
    case 270:
      return [dy, -dx]
  }
}

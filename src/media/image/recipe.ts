/**
 * 画像の非破壊編集（レシピ）。React にもブラウザにも依存しない純粋な計算だけを置く。
 *
 * 変換の順番（renderImage もこの順で描く）:
 * 1. デコード: EXIF の向きを反映した見た目どおりの画素（probeImage の width/height）
 * 2. クロップ: 1. の座標系で切り抜く。回転・反転の前なので、回しても切り抜き範囲は変わらない
 * 3. 回転: 時計回りに 0/90/180/270 度
 * 4. 反転: 回転後の見た目に対して左右（flipH）・上下（flipV）
 * 5. リサイズ: 回転後の寸法に対して拡大縮小する
 * 6. 余白: 外側に足し、背景色で塗る。背景色は透過部分の下地にもなる
 */

export interface ImageSize {
  width: number
  height: number
}

/** 切り抜き範囲。元画像（向き反映後）の画素座標で、常に整数かつ画像の内側 */
export interface CropRect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export type Rotation = 0 | 90 | 180 | 270

/**
 * リサイズ指定。回転後の寸法に対して効く。
 * - keepAspect: 縦横比を保つ。幅・高さの両方があれば、その枠に収まる最大の大きさにする
 * - keepAspect でない: 指定のない辺は元の長さのまま（引き伸ばし）
 * - allowUpscale: keepAspect のとき、元より大きくすることを許すか。
 *   一括処理で「長辺 1920 以下に」とするとき小さい画像を引き伸ばさないために使う
 */
export interface ImageResize {
  readonly width: number | null
  readonly height: number | null
  readonly keepAspect: boolean
  readonly allowUpscale: boolean
}

/** 回転・リサイズ後の画像の外側に足す余白（画素） */
export interface Padding {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export interface ImageRecipe {
  readonly crop: CropRect | null
  readonly rotation: Rotation
  readonly flipH: boolean
  readonly flipV: boolean
  readonly resize: ImageResize | null
  readonly padding: Padding
  /** "#rrggbb" か "#rrggbbaa"。null は透過（透過を持てない形式では白で塗る） */
  readonly background: string | null
}

export type ImageEdit =
  | { type: 'crop'; rect: CropRect | null }
  /** 見た目の時計回りに 90 度 × turns。負なら反時計回り */
  | { type: 'rotate'; turns: number }
  /** 見た目の左右を入れ替える */
  | { type: 'flipH' }
  /** 見た目の上下を入れ替える */
  | { type: 'flipV' }
  | { type: 'resize'; resize: ImageResize | null }
  | { type: 'padding'; padding: Padding }
  | { type: 'background'; color: string | null }
  | { type: 'reset' }

/** リサイズで指定できる 1 辺の上限。ブラウザの Canvas が扱える大きさに合わせる */
export const MAX_DIMENSION = 16384
/** 1 辺に足せる余白の上限 */
export const MAX_PADDING = 4096

export const NO_PADDING: Padding = { top: 0, right: 0, bottom: 0, left: 0 }

/** 何も手を加えないレシピ。そのまま書き出すと形式変換と付帯情報の削除だけになる */
export function createImageRecipe(): ImageRecipe {
  return {
    crop: null,
    rotation: 0,
    flipH: false,
    flipV: false,
    resize: null,
    padding: NO_PADDING,
    background: null,
  }
}

/**
 * 編集を 1 つ適用した新しいレシピを返す。値の丸めと範囲の制限はここだけで行う。
 * 数値として読めない入力（NaN など）の編集は無視して同じレシピを返す。
 *
 * どんな編集列をたどっても、crop は info の内側の 1px 以上の整数矩形か null で、
 * computeOutputSize は 1px 以上の整数を返す。
 */
export function applyImageEdit(recipe: ImageRecipe, edit: ImageEdit, info: ImageSize): ImageRecipe {
  switch (edit.type) {
    case 'crop': {
      if (edit.rect === null) return recipe.crop === null ? recipe : { ...recipe, crop: null }
      const crop = clampCrop(edit.rect, info)
      return crop === undefined ? recipe : { ...recipe, crop }
    }
    case 'rotate': {
      if (!Number.isFinite(edit.turns)) return recipe
      const turns = mod(Math.round(edit.turns), 4)
      if (turns === 0) return recipe
      // レシピは「回転してから反転」の順で持つ。反転が片方だけ効いているときは
      // 見た目の時計回りがレシピ上の反時計回りに当たる（鏡に映すと回る向きが逆になる）
      const mirrored = recipe.flipH !== recipe.flipV
      const rotation = mod(recipe.rotation + (mirrored ? -90 : 90) * turns, 360) as Rotation
      return { ...recipe, rotation, resize: turns % 2 === 1 ? swapResize(recipe.resize) : recipe.resize }
    }
    // 反転は回転の後に効くので、見た目の反転はそのままフラグの切り替えになる
    case 'flipH':
      return { ...recipe, flipH: !recipe.flipH }
    case 'flipV':
      return { ...recipe, flipV: !recipe.flipV }
    case 'resize': {
      if (edit.resize === null) return recipe.resize === null ? recipe : { ...recipe, resize: null }
      const resize = normalizeResize(edit.resize)
      return resize === undefined ? recipe : { ...recipe, resize }
    }
    case 'padding': {
      const values = [edit.padding.top, edit.padding.right, edit.padding.bottom, edit.padding.left]
      if (!values.every(Number.isFinite)) return recipe
      const [top, right, bottom, left] = values.map((v) => clamp(Math.round(v), 0, MAX_PADDING))
      return { ...recipe, padding: { top, right, bottom, left } }
    }
    case 'background': {
      if (edit.color === null) return { ...recipe, background: null }
      const color = normalizeHexColor(edit.color)
      return color === null ? recipe : { ...recipe, background: color }
    }
    case 'reset':
      return createImageRecipe()
  }
}

/**
 * 別の画像にレシピを当てはめ直す。一括処理で同じレシピを寸法の違う画像に使うときや、
 * probe の寸法とデコード結果がずれたときに、切り抜きを画像の内側へ収め直す。
 */
export function fitRecipeToImage(recipe: ImageRecipe, info: ImageSize): ImageRecipe {
  if (recipe.crop === null) return recipe
  const crop = clampCrop(recipe.crop, info) ?? null
  if (crop !== null && sameRect(crop, recipe.crop)) return recipe
  return { ...recipe, crop }
}

export interface OutputSize extends ImageSize {
  /** 余白を除いた、画像が描かれる部分の寸法 */
  contentWidth: number
  contentHeight: number
}

/** 書き出し後の寸法。常に 1px 以上の整数 */
export function computeOutputSize(info: ImageSize, recipe: ImageRecipe): OutputSize {
  const source = sourceRect(info, recipe)
  const rotated = recipe.rotation % 180 === 0 ? source : { width: source.height, height: source.width }
  const content = resolveResize(rotated, recipe.resize)
  const { top, right, bottom, left } = recipe.padding
  return {
    width: content.width + left + right,
    height: content.height + top + bottom,
    contentWidth: content.width,
    contentHeight: content.height,
  }
}

/**
 * Canvas に描くための手順。次の順に呼べばレシピどおりの絵になる:
 *   ctx.translate(centerX, centerY)
 *   ctx.scale(scaleX, scaleY)
 *   ctx.rotate(rotation * Math.PI / 180)
 *   ctx.drawImage(bitmap, source.x, source.y, source.width, source.height,
 *                 -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
 * 座標の計算を描画から切り離しておけば、ブラウザなしで確かめられる。
 */
export interface ImageDrawPlan {
  canvasWidth: number
  canvasHeight: number
  source: CropRect
  centerX: number
  centerY: number
  scaleX: 1 | -1
  scaleY: 1 | -1
  rotation: Rotation
  /** 回転前の向きでの描画寸法 */
  drawWidth: number
  drawHeight: number
}

export function computeDrawPlan(info: ImageSize, recipe: ImageRecipe): ImageDrawPlan {
  const size = computeOutputSize(info, recipe)
  const quarter = recipe.rotation % 180 !== 0
  return {
    canvasWidth: size.width,
    canvasHeight: size.height,
    source: sourceRect(info, recipe),
    centerX: recipe.padding.left + size.contentWidth / 2,
    centerY: recipe.padding.top + size.contentHeight / 2,
    scaleX: recipe.flipH ? -1 : 1,
    scaleY: recipe.flipV ? -1 : 1,
    rotation: recipe.rotation,
    drawWidth: quarter ? size.contentHeight : size.contentWidth,
    drawHeight: quarter ? size.contentWidth : size.contentHeight,
  }
}

/** 何も変えないレシピか。形式変換だけのときに UI で「編集なし」と出すのに使う */
export function isIdentityRecipe(recipe: ImageRecipe): boolean {
  const { top, right, bottom, left } = recipe.padding
  return (
    recipe.crop === null &&
    recipe.rotation === 0 &&
    !recipe.flipH &&
    !recipe.flipV &&
    recipe.resize === null &&
    top + right + bottom + left === 0
  )
}

/** "#rgb" / "#rrggbb" / "#rrggbbaa" を小文字の 6 桁か 8 桁にそろえる。読めなければ null */
export function normalizeHexColor(color: string): string | null {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color.trim())
  if (!match) return null
  const hex = match[1].toLowerCase()
  return hex.length === 3 ? `#${[...hex].map((c) => c + c).join('')}` : `#${hex}`
}

// --- 内部 ---

function sourceRect(info: ImageSize, recipe: ImageRecipe): CropRect {
  const full = { x: 0, y: 0, width: Math.max(1, Math.round(info.width)), height: Math.max(1, Math.round(info.height)) }
  return recipe.crop ? (clampCrop(recipe.crop, full) ?? full) : full
}

/**
 * 切り抜きを画像の内側の整数矩形に収める。画像全体と同じなら null（切り抜きなし）、
 * 数値として読めなければ undefined（編集を無視する）。幅・高さが負なら向きを直して扱う。
 */
function clampCrop(rect: CropRect, info: ImageSize): CropRect | null | undefined {
  const values = [rect.x, rect.y, rect.width, rect.height]
  if (!values.every(Number.isFinite)) return undefined
  const width = Math.max(1, Math.round(info.width))
  const height = Math.max(1, Math.round(info.height))
  const [x0, x1] = span(rect.x, rect.width, width)
  const [y0, y1] = span(rect.y, rect.height, height)
  if (x0 === 0 && y0 === 0 && x1 === width && y1 === height) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

/** 1 軸ぶんの [始点, 終点)。少なくとも 1px は残す */
function span(start: number, length: number, limit: number): [number, number] {
  const a = Math.round(Math.min(start, start + length))
  const b = Math.round(Math.max(start, start + length))
  const from = clamp(a, 0, limit - 1)
  return [from, clamp(b, from + 1, limit)]
}

function normalizeResize(resize: ImageResize): ImageResize | null | undefined {
  const side = (v: number | null) => {
    if (v === null) return null
    return Number.isFinite(v) ? clamp(Math.round(v), 1, MAX_DIMENSION) : undefined
  }
  const width = side(resize.width)
  const height = side(resize.height)
  if (width === undefined || height === undefined) return undefined
  // どちらの辺も決まっていなければリサイズしないのと同じ
  if (width === null && height === null) return null
  return { width, height, keepAspect: resize.keepAspect, allowUpscale: resize.allowUpscale }
}

function swapResize(resize: ImageResize | null): ImageResize | null {
  return resize && { ...resize, width: resize.height, height: resize.width }
}

function resolveResize(size: ImageSize, resize: ImageResize | null): ImageSize {
  if (resize === null) return size
  if (!resize.keepAspect) {
    return { width: resize.width ?? size.width, height: resize.height ?? size.height }
  }
  const scales = [
    resize.width === null ? Infinity : resize.width / size.width,
    resize.height === null ? Infinity : resize.height / size.height,
  ]
  let scale = Math.min(...scales)
  if (!resize.allowUpscale) scale = Math.min(scale, 1)
  // 縦横比を保つと短い辺が 1px を割ることがあるので、そこは 1px に切り上げる
  return {
    width: clamp(Math.round(size.width * scale), 1, MAX_DIMENSION),
    height: clamp(Math.round(size.height * scale), 1, MAX_DIMENSION),
  }
}

function sameRect(a: CropRect, b: CropRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n
}

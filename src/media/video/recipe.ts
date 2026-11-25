import { MIN_RANGE, applyTrim, isWholeClip, toEncodeTrim } from '../../state/trim'
import type { Trim } from '../../types'
import type { SubtitleCue } from '../text/subtitles'
import { clampSpeed } from './timing'
import type { VideoCropRect, VideoEdit, VideoInfo, VideoRecipe, VideoRotation, VideoSubtitles } from './types'

/**
 * 動画レシピの遷移と、そこから導く寸法。React にも mediabunny にも依存しない純粋な計算だけを置く。
 *
 * どんな編集列を与えても次を保つ:
 * - trim は src/state/trim.ts の applyTrim の不変条件（尺の中、MIN_RANGE 以上の長さ）
 * - crop は null か、映像の内側に収まる偶数の整数矩形（多くの動画エンコーダは奇数の寸法を受け付けない）
 * - rotation は 0/90/180/270
 * - speed は MIN_VIDEO_SPEED〜MAX_VIDEO_SPEED の 0.05 刻み
 * - subtitles の offset は ±MAX_SUBTITLE_OFFSET の整数ミリ秒
 * 値の変わらない編集は同じオブジェクトを返すので、履歴に空の段が積まれない。
 */

/** 切り抜きで残す最小の辺（画素）。映像がこれより小さければ映像の辺まで */
export const MIN_CROP_SIZE = 16
/** 字幕のずらしの上限（ミリ秒）。これより大きいずれは別の動画の字幕とみなしてよい */
export const MAX_SUBTITLE_OFFSET = 3_600_000
/**
 * レシピの形の版。保存しておいたレシピ（セッションの復元など）を読み戻すときに restoreVideoRecipe が見る。
 * 1: 区間・切り抜き・回転・反転・音声の除去 / 2: 速さ・音の高さ・字幕を追加
 */
export const VIDEO_RECIPE_VERSION = 2

export interface VideoSize {
  width: number
  height: number
}

export function createVideoRecipe(info: Pick<VideoInfo, 'duration'>): VideoRecipe {
  return {
    trim: { start: 0, end: safeDuration(info) },
    crop: null,
    rotation: 0,
    flipH: false,
    flipV: false,
    muted: false,
    speed: 1,
    preservePitch: true,
    subtitles: null,
  }
}

export function applyVideoEdit(recipe: VideoRecipe, edit: VideoEdit, info: VideoInfo): VideoRecipe {
  switch (edit.type) {
    case 'trim': {
      const { action } = edit
      if (action.type !== 'wholeClip' && !Number.isFinite(action.time)) return recipe
      const trim = applyTrim(recipe.trim, safeDuration(info), action)
      return sameTrim(trim, recipe.trim) ? recipe : { ...recipe, trim }
    }
    case 'crop': {
      if (edit.rect === null) return recipe.crop === null ? recipe : { ...recipe, crop: null }
      if (!info.dimensions) return recipe
      const crop = clampCrop(edit.rect, info.dimensions)
      if (crop === undefined) return recipe
      if (crop === null) return recipe.crop === null ? recipe : { ...recipe, crop: null }
      return recipe.crop && sameRect(crop, recipe.crop) ? recipe : { ...recipe, crop }
    }
    case 'rotate': {
      if (!Number.isFinite(edit.turns)) return recipe
      const turns = mod(Math.round(edit.turns), 4)
      if (turns === 0) return recipe
      // レシピは「回転してから反転」の順で持つ。反転が片方だけ効いているときは
      // 見た目の時計回りがレシピ上の反時計回りに当たる（鏡に映すと回る向きが逆になる）
      const mirrored = recipe.flipH !== recipe.flipV
      const rotation = mod(recipe.rotation + (mirrored ? -90 : 90) * turns, 360) as VideoRotation
      return { ...recipe, rotation }
    }
    // 反転は回転の後に効くので、見た目の反転はそのままフラグの切り替えになる
    case 'flipH':
      return { ...recipe, flipH: !recipe.flipH }
    case 'flipV':
      return { ...recipe, flipV: !recipe.flipV }
    case 'mute':
      return edit.muted === recipe.muted ? recipe : { ...recipe, muted: edit.muted }
    case 'speed': {
      if (!Number.isFinite(edit.speed)) return recipe
      const speed = clampSpeed(edit.speed)
      return speed === recipe.speed ? recipe : { ...recipe, speed }
    }
    case 'preservePitch':
      return edit.preserve === recipe.preservePitch ? recipe : { ...recipe, preservePitch: edit.preserve }
    case 'subtitles': {
      if (edit.subtitles === null) return recipe.subtitles === null ? recipe : { ...recipe, subtitles: null }
      const subtitles: VideoSubtitles = {
        name: edit.subtitles.name,
        cues: validCues(edit.subtitles.cues),
        offset: 0,
        mode: recipe.subtitles?.mode ?? 'burn',
      }
      return sameSubtitles(subtitles, recipe.subtitles) ? recipe : { ...recipe, subtitles }
    }
    case 'subtitleOffset': {
      if (!recipe.subtitles || !Number.isFinite(edit.offset)) return recipe
      const offset = clampOffset(edit.offset)
      return offset === recipe.subtitles.offset ? recipe : { ...recipe, subtitles: { ...recipe.subtitles, offset } }
    }
    case 'subtitleMode':
      return !recipe.subtitles || recipe.subtitles.mode === edit.mode
        ? recipe
        : { ...recipe, subtitles: { ...recipe.subtitles, mode: edit.mode } }
    case 'reset': {
      const initial = createVideoRecipe(info)
      return sameRecipe(recipe, initial) ? recipe : initial
    }
  }
}

/** 書き出しても元と変わらない（無加工の）レシピか */
export function isIdentityRecipe(recipe: VideoRecipe, info: Pick<VideoInfo, 'duration'>): boolean {
  return (
    isWholeClip(recipe.trim, safeDuration(info)) &&
    recipe.crop === null &&
    recipe.rotation === 0 &&
    !recipe.flipH &&
    !recipe.flipV &&
    !recipe.muted &&
    recipe.speed === 1 &&
    recipe.subtitles === null
  )
}

/** 映像の見た目の向きを変える編集（回転・反転）があるか */
export function isTransformed(recipe: VideoRecipe): boolean {
  return recipe.rotation !== 0 || recipe.flipH || recipe.flipV
}

/** 切り抜き範囲。切り抜きがなければ映像全体 */
export function sourceRect(recipe: VideoRecipe, size: VideoSize): VideoCropRect {
  return recipe.crop ?? { x: 0, y: 0, width: size.width, height: size.height }
}

/** 切り抜き・回転したあとの寸法（拡大縮小の前）。映像がなければ null */
export function editedSize(info: Pick<VideoInfo, 'dimensions'>, recipe: VideoRecipe): VideoSize | null {
  if (!info.dimensions) return null
  const { width, height } = sourceRect(recipe, info.dimensions)
  return recipe.rotation % 180 === 0 ? { width, height } : { width: height, height: width }
}

/** mediabunny の CropRectangle と同じ形 */
export interface RotatedCrop {
  left: number
  top: number
  width: number
  height: number
}

/**
 * mediabunny に渡す切り抜き範囲。mediabunny は「回転してから切り抜く」ので、
 * 元の向きで持っている範囲を回転後の座標へ移す。切り抜きがなければ null。
 */
export function rotatedCrop(recipe: VideoRecipe, size: VideoSize): RotatedCrop | null {
  if (!recipe.crop) return null
  const { x, y, width, height } = recipe.crop
  switch (recipe.rotation) {
    case 0:
      return { left: x, top: y, width, height }
    case 90:
      // 時計回りに 90 度: 点 (px, py) は (H - py, px) へ移る
      return { left: size.height - (y + height), top: x, width: height, height: width }
    case 180:
      return { left: size.width - (x + width), top: size.height - (y + height), width, height }
    case 270:
      // 時計回りに 270 度: 点 (px, py) は (py, W - px) へ移る
      return { left: y, top: size.width - (x + width), width: height, height: width }
  }
}

/** 書き出しに渡す区間。入力全体なら null（mediabunny に区間を渡さず無加工で通す） */
export function encodeTrim(recipe: VideoRecipe, info: Pick<VideoInfo, 'duration'>): Trim | null {
  const duration = safeDuration(info)
  return toEncodeTrim(recipe.trim, duration > 0 ? duration : null)
}

/**
 * 切り抜きを映像の内側の偶数の整数矩形に収める。映像全体と同じなら null（切り抜きなし）、
 * 数値として読めない・映像が小さすぎて切り抜けないときは undefined（編集を無視する）。
 * 幅・高さが負なら向きを直して扱う。
 */
export function clampCrop(rect: VideoCropRect, size: VideoSize): VideoCropRect | null | undefined {
  const values = [rect.x, rect.y, rect.width, rect.height]
  if (!values.every(Number.isFinite)) return undefined
  const limitX = evenFloor(size.width)
  const limitY = evenFloor(size.height)
  if (limitX < 2 || limitY < 2) return undefined
  const [x0, x1] = span(rect.x, rect.width, limitX)
  const [y0, y1] = span(rect.y, rect.height, limitY)
  // 奇数の辺の動画では最後の 1px が端数になるので、偶数に切り下げた全体を「全体」とみなす
  if (x0 === 0 && y0 === 0 && x1 === limitX && y1 === limitY) return null
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

// --- 内部 ---

/** 1 軸ぶんの [始点, 終点)。どちらも偶数で、少なくとも min(MIN_CROP_SIZE, limit) は残す */
function span(start: number, length: number, limit: number): [number, number] {
  const minSize = Math.min(MIN_CROP_SIZE, limit)
  const a = evenRound(Math.min(start, start + length))
  const b = evenRound(Math.max(start, start + length))
  const from = clamp(a, 0, limit - minSize)
  return [from, clamp(b, from + minSize, limit)]
}

/** 尺が読めない・壊れている場合は 0 に倒し、区間の計算に NaN を持ち込まない */
function safeDuration(info: Pick<VideoInfo, 'duration'>): number {
  return Number.isFinite(info.duration) && info.duration > 0 ? info.duration : 0
}

const evenRound = (value: number) => Math.round(value / 2) * 2
const evenFloor = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.floor(value / 2) * 2) : 0)

function sameTrim(a: Trim, b: Trim): boolean {
  return a.start === b.start && a.end === b.end
}

function sameRect(a: VideoCropRect, b: VideoCropRect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function sameRecipe(a: VideoRecipe, b: VideoRecipe): boolean {
  return (
    sameTrim(a.trim, b.trim) &&
    (a.crop === b.crop || (a.crop !== null && b.crop !== null && sameRect(a.crop, b.crop))) &&
    a.rotation === b.rotation &&
    a.flipH === b.flipH &&
    a.flipV === b.flipV &&
    a.muted === b.muted &&
    a.speed === b.speed &&
    a.preservePitch === b.preservePitch &&
    a.subtitles === b.subtitles
  )
}

/** 時刻が読めて、終わりが始まりより後の字幕だけを、始まりの順に残す（安定ソート） */
function validCues(cues: readonly SubtitleCue[]): SubtitleCue[] {
  return cues
    .filter((cue) => typeof cue === 'object' && cue !== null && typeof cue.text === 'string')
    .map((cue) => ({ ...cue, start: Math.round(cue.start) + 0, end: Math.round(cue.end) + 0 }))
    .filter((cue) => Number.isFinite(cue.start) && Number.isFinite(cue.end) && cue.end > cue.start)
    .sort((a, b) => a.start - b.start)
}

/** 同じ字幕を読み直しただけなら履歴に積まない */
function sameSubtitles(a: VideoSubtitles, b: VideoSubtitles | null): boolean {
  if (!b || a.name !== b.name || a.offset !== b.offset || a.mode !== b.mode || a.cues.length !== b.cues.length) {
    return false
  }
  return a.cues.every((cue, i) => {
    const other = b.cues[i]
    return (
      cue.start === other.start &&
      cue.end === other.end &&
      cue.text === other.text &&
      cue.id === other.id &&
      cue.settings === other.settings
    )
  })
}

function clampOffset(offset: number): number {
  // + 0 で -0 を 0 にそろえる（JSON を通すと区別が消え、比べたときに食い違う）
  return Math.round(clamp(offset, -MAX_SUBTITLE_OFFSET, MAX_SUBTITLE_OFFSET)) + 0
}

/**
 * 保存しておいたレシピを、いまの形（VIDEO_RECIPE_VERSION）と開いたファイルに合わせて読み戻す。
 * 版 1（速さ・字幕がない）は既定値で埋める。値はすべて applyVideoEdit と同じ規則で丸め直すので、
 * 壊れた値や別のファイルの寸法が混ざっていても不変条件は崩れない。形が読めなければ null
 */
export function restoreVideoRecipe(saved: unknown, info: VideoInfo): VideoRecipe | null {
  if (typeof saved !== 'object' || saved === null) return null
  const raw = saved as Partial<Record<keyof VideoRecipe, unknown>>
  const trim = raw.trim as Partial<Trim> | undefined
  if (!trim || typeof trim.start !== 'number' || typeof trim.end !== 'number') return null
  const initial = createVideoRecipe(info)
  const duration = initial.trim.end
  // 不変条件を満たす区間はそのまま使う（丸め直すと浮動小数の端で値が動く）。外れていれば編集と同じ規則で詰める
  const intact =
    trim.start >= 0 && trim.end <= duration && trim.end - trim.start >= MIN_RANGE - 1e-9
  const edits: VideoEdit[] = intact
    ? []
    : [
        { type: 'trim', action: { type: 'setEnd', time: trim.end } },
        { type: 'trim', action: { type: 'setStart', time: trim.start } },
      ]
  const crop = raw.crop as VideoCropRect | null | undefined
  if (crop && typeof crop === 'object') edits.push({ type: 'crop', rect: crop })
  let recipe = edits.reduce(
    (current, edit) => applyVideoEdit(current, edit, info),
    intact ? { ...initial, trim: { start: trim.start, end: trim.end } } : initial
  )
  const rotation = [0, 90, 180, 270].includes(raw.rotation as number) ? (raw.rotation as VideoRotation) : 0
  recipe = {
    ...recipe,
    rotation,
    flipH: raw.flipH === true,
    flipV: raw.flipV === true,
    muted: raw.muted === true,
    speed: typeof raw.speed === 'number' ? clampSpeed(raw.speed) : 1,
    preservePitch: raw.preservePitch !== false,
  }
  const subtitles = raw.subtitles as Partial<VideoSubtitles> | null | undefined
  if (subtitles && typeof subtitles === 'object' && Array.isArray(subtitles.cues)) {
    recipe = applyVideoEdit(
      recipe,
      { type: 'subtitles', subtitles: { name: String(subtitles.name ?? ''), cues: subtitles.cues } },
      info
    )
    recipe = applyVideoEdit(recipe, { type: 'subtitleOffset', offset: Number(subtitles.offset ?? 0) }, info)
    if (subtitles.mode === 'embed' || subtitles.mode === 'burn') {
      recipe = applyVideoEdit(recipe, { type: 'subtitleMode', mode: subtitles.mode }, info)
    }
  }
  return recipe
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function mod(value: number, n: number): number {
  return ((value % n) + n) % n
}

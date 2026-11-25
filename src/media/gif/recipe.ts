/**
 * アニメーションの非破壊編集（レシピ）。React にもブラウザにも依存しない純粋な計算だけを置く。
 *
 * レシピはフレームの「参照」の並びで、絵そのものは持たない。各フレームは
 * 入力（source: 開いた GIF・足した画像や GIF の番号）とその中のフレーム番号を指し、表示時間を持つ。
 * 入力の番号は足すたびに後ろへ増えるだけで、取り消しても変わらない（PDF のページ編集と同じ考え方）。
 *
 * - サイズ変更・切り抜き・回転は全フレームに同じものをかける（画像のレシピ ImageRecipe をそのまま使う）
 * - キャンバスの大きさ（width・height）は最初の入力で決まる。大きさの違う画像は、その枠に収めて真ん中に置く
 * - 各フレームの id は並べ替え・複製しても選択を保つための鍵。レシピの中で一意
 */
import { applyImageEdit, createImageRecipe } from '../image/recipe'
import type { ImageEdit, ImageRecipe } from '../image/recipe'

export interface GifFrameRef {
  readonly id: number
  /** 入力の番号 */
  readonly source: number
  /** その入力の中のフレーム番号（静止画は 0） */
  readonly frame: number
  /** 表示時間（ミリ秒）。MIN_DURATION〜MAX_DURATION の 10 の倍数 */
  readonly duration: number
}

export interface GifRecipe {
  readonly frames: readonly GifFrameRef[]
  /** 再生する回数。0 は無限 */
  readonly plays: number
  /** キャンバスの大きさ。まだ何も入れていない新しいアニメーションでは 0 */
  readonly width: number
  readonly height: number
  /** 全フレームにかけるサイズ変更・切り抜き・回転 */
  readonly image: ImageRecipe
  /** 次に振る id。取り消しても戻さず、id がぶつからないようにする */
  readonly nextId: number
}

/** 足すフレーム（入力の中の番号と表示時間） */
export interface GifFrameInput {
  source: number
  frame: number
  duration: number
}

export type GifEdit =
  /** 末尾に足す。キャンバスがまだなければ size で決める */
  | { type: 'append'; frames: readonly GifFrameInput[]; size?: { width: number; height: number } }
  | { type: 'remove'; indices: readonly number[] }
  /** 選んだフレームを抜き、残りの並びの to の位置へまとめて差し込む */
  | { type: 'move'; indices: readonly number[]; to: number }
  /** 選んだフレームの写しを、選んだうちの最後のフレームのすぐ後ろに並べる */
  | { type: 'duplicate'; indices: readonly number[] }
  /** 選んだ位置どうしで順番を逆にする（2 つ未満なら全体） */
  | { type: 'reverse'; indices: readonly number[] }
  | { type: 'duration'; indices: readonly number[]; duration: number }
  | { type: 'durationAll'; duration: number }
  | { type: 'plays'; plays: number }
  | { type: 'image'; edit: ImageEdit }

/** ブラウザは 20ms 未満の表示時間を 100ms に読み替えるので、それより短くはしない */
export const MIN_DURATION = 20
/** GIF の表示時間はセンチ秒の 16 ビット */
export const MAX_DURATION = 655_350
/** 静止画を足したときの表示時間 */
export const DEFAULT_DURATION = 100
/** ループ回数の上限（GIF の NETSCAPE 拡張は 16 ビット） */
export const MAX_PLAYS = 65_536

/** 表示時間を範囲に収め、GIF に書ける 10ms 単位に丸める。読めない値は null */
export function clampDuration(duration: number): number | null {
  if (!Number.isFinite(duration)) return null
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, Math.round(duration / 10) * 10))
}

export const clampPlays = (plays: number): number | null =>
  Number.isFinite(plays) ? Math.max(0, Math.min(MAX_PLAYS, Math.round(plays))) : null

export function createGifRecipe(
  size: { width: number; height: number } | null = null,
  frames: readonly GifFrameInput[] = [],
  plays = 0
): GifRecipe {
  const base: GifRecipe = {
    frames: [],
    plays: clampPlays(plays) ?? 0,
    width: size ? Math.max(0, Math.round(size.width)) : 0,
    height: size ? Math.max(0, Math.round(size.height)) : 0,
    image: createImageRecipe(),
    nextId: 1,
  }
  return frames.length > 0 ? applyGifEdit(base, { type: 'append', frames }) : base
}

/** 並びの中に収まる、重なりのない位置（昇順） */
function validIndices(indices: readonly number[], length: number): number[] {
  return [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < length).sort((a, b) => a - b)
}

const sameOrder = (a: readonly GifFrameRef[], b: readonly GifFrameRef[]) =>
  a.length === b.length && a.every((frame, i) => frame === b[i])

/**
 * 編集を 1 つ当てた新しいレシピを返す。何も変わらなければ同じレシピを返す（履歴に積まない）。
 * どんな編集列をたどっても、id は一意、表示時間は MIN_DURATION〜MAX_DURATION の 10 の倍数、
 * plays は 0〜MAX_PLAYS の整数に保たれる。
 */
export function applyGifEdit(recipe: GifRecipe, edit: GifEdit): GifRecipe {
  const { frames } = recipe
  switch (edit.type) {
    case 'append': {
      const added: GifFrameRef[] = []
      let nextId = recipe.nextId
      for (const input of edit.frames) {
        if (!Number.isInteger(input.source) || input.source < 0) continue
        if (!Number.isInteger(input.frame) || input.frame < 0) continue
        added.push({
          id: nextId++,
          source: input.source,
          frame: input.frame,
          duration: clampDuration(input.duration) ?? DEFAULT_DURATION,
        })
      }
      if (added.length === 0) return recipe
      const needsSize = recipe.width === 0 || recipe.height === 0
      const size = needsSize && edit.size ? edit.size : null
      return {
        ...recipe,
        frames: [...frames, ...added],
        nextId,
        ...(size && size.width >= 1 && size.height >= 1
          ? { width: Math.round(size.width), height: Math.round(size.height) }
          : {}),
      }
    }
    case 'remove': {
      const remove = new Set(validIndices(edit.indices, frames.length))
      if (remove.size === 0) return recipe
      return { ...recipe, frames: frames.filter((_, i) => !remove.has(i)) }
    }
    case 'move': {
      const indices = validIndices(edit.indices, frames.length)
      if (indices.length === 0 || !Number.isFinite(edit.to)) return recipe
      const moving = new Set(indices)
      const picked = indices.map((i) => frames[i])
      const rest = frames.filter((_, i) => !moving.has(i))
      const to = Math.max(0, Math.min(rest.length, Math.round(edit.to)))
      const next = [...rest.slice(0, to), ...picked, ...rest.slice(to)]
      return sameOrder(next, frames) ? recipe : { ...recipe, frames: next }
    }
    case 'duplicate': {
      const indices = validIndices(edit.indices, frames.length)
      if (indices.length === 0) return recipe
      let nextId = recipe.nextId
      const copies = indices.map((i) => ({ ...frames[i], id: nextId++ }))
      const after = indices[indices.length - 1] + 1
      return { ...recipe, frames: [...frames.slice(0, after), ...copies, ...frames.slice(after)], nextId }
    }
    case 'reverse': {
      let indices = validIndices(edit.indices, frames.length)
      if (indices.length < 2) indices = frames.map((_, i) => i)
      if (indices.length < 2) return recipe
      const next = [...frames]
      indices.forEach((position, k) => {
        next[position] = frames[indices[indices.length - 1 - k]]
      })
      return sameOrder(next, frames) ? recipe : { ...recipe, frames: next }
    }
    case 'duration':
    case 'durationAll': {
      const duration = clampDuration(edit.duration)
      if (duration === null) return recipe
      const targets =
        edit.type === 'durationAll' ? null : new Set(validIndices(edit.indices, frames.length))
      let changed = false
      const next = frames.map((frame, i) => {
        if ((targets && !targets.has(i)) || frame.duration === duration) return frame
        changed = true
        return { ...frame, duration }
      })
      return changed ? { ...recipe, frames: next } : recipe
    }
    case 'plays': {
      const plays = clampPlays(edit.plays)
      return plays === null || plays === recipe.plays ? recipe : { ...recipe, plays }
    }
    case 'image': {
      if (recipe.width === 0 || recipe.height === 0) return recipe
      const image = applyImageEdit(recipe.image, edit.edit, { width: recipe.width, height: recipe.height })
      return image === recipe.image ? recipe : { ...recipe, image }
    }
  }
}

/** 全体の長さ（ミリ秒） */
export const totalDuration = (recipe: Pick<GifRecipe, 'frames'>) =>
  recipe.frames.reduce((sum, frame) => sum + frame.duration, 0)

/** 再生位置（ミリ秒、1 周の中）にあたるフレームの位置。フレームがなければ -1 */
export function frameAtTime(frames: readonly Pick<GifFrameRef, 'duration'>[], time: number): number {
  if (frames.length === 0) return -1
  let elapsed = 0
  for (let i = 0; i < frames.length; i++) {
    elapsed += frames[i].duration
    if (time < elapsed) return i
  }
  return frames.length - 1
}

/** フレームの位置の開始時刻（ミリ秒） */
export function frameStartTime(frames: readonly Pick<GifFrameRef, 'duration'>[], index: number): number {
  let elapsed = 0
  for (let i = 0; i < Math.min(index, frames.length); i++) elapsed += frames[i].duration
  return elapsed
}

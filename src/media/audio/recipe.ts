import { MIN_RANGE, applyTrim } from '../../state/trim'
import {
  DEFAULT_SILENCE,
  MAX_SILENCE_DURATION,
  MAX_SILENCE_PADDING,
  MAX_SILENCE_THRESHOLD_DB,
  MIN_SILENCE_DURATION,
  MIN_SILENCE_THRESHOLD_DB,
} from './silence'
import type { AudioEdit, AudioInfo, AudioRecipe, AudioSilence, AudioTrim } from './types'

/**
 * 音声レシピの遷移。React にも mediabunny にも依存しない純粋な計算だけを置く。
 *
 * どんな編集列を与えても次を保つ（duration >= MIN_TRIM_LENGTH のとき）:
 * - 0 <= trim.start かつ trim.start + MIN_TRIM_LENGTH <= trim.end <= duration
 * - fadeIn >= 0, fadeOut >= 0, fadeIn + fadeOut <= 切り出した長さ
 * - MIN_GAIN_DB <= gainDb <= MAX_GAIN_DB
 * - 無音カットの値はそれぞれ範囲内（しきい値・最短の長さ・残す長さ）
 * フェードは切り出した区間の長さに収める。無音カットで書き出しが短くなっても、
 * 書き出し側でフェードどうしが重なるだけで（小さい方を採る）、レシピは区間に対して保つ。
 * 値の変わらない編集は同じオブジェクトを返すので、履歴に空の段が積まれない。
 */

/** 切り出し区間の最短の長さ（秒）。動画のトリムと揃える */
export const MIN_TRIM_LENGTH = MIN_RANGE

/** これより下げると実質無音で、上げると歪むだけなので範囲を切る */
export const MIN_GAIN_DB = -40
export const MAX_GAIN_DB = 20

export function createAudioRecipe(info: AudioInfo): AudioRecipe {
  return {
    trim: { start: 0, end: safeDuration(info) },
    fadeIn: 0,
    fadeOut: 0,
    gainDb: 0,
    normalize: false,
    mono: false,
    silence: DEFAULT_SILENCE,
  }
}

/** 切り出す長さ（秒） */
export function trimmedLength(recipe: AudioRecipe): number {
  return Math.max(0, recipe.trim.end - recipe.trim.start)
}

/** 書き出しても元と変わらない（無加工の）レシピか */
export function isIdentityRecipe(recipe: AudioRecipe, info: AudioInfo): boolean {
  return (
    recipe.trim.start === 0 &&
    recipe.trim.end >= safeDuration(info) &&
    recipe.fadeIn === 0 &&
    recipe.fadeOut === 0 &&
    recipe.gainDb === 0 &&
    !recipe.normalize &&
    !recipe.mono &&
    !recipe.silence.enabled
  )
}

export function applyAudioEdit(recipe: AudioRecipe, edit: AudioEdit, info: AudioInfo): AudioRecipe {
  const duration = safeDuration(info)
  switch (edit.type) {
    case 'setTrimStart':
      if (!Number.isFinite(edit.time)) return recipe
      return withTrim(recipe, applyTrim(recipe.trim, duration, { type: 'setStart', time: edit.time }))
    case 'setTrimEnd':
      if (!Number.isFinite(edit.time)) return recipe
      return withTrim(recipe, applyTrim(recipe.trim, duration, { type: 'setEnd', time: edit.time }))
    case 'resetTrim':
      return withTrim(recipe, { start: 0, end: duration })
    case 'setFadeIn': {
      if (!Number.isFinite(edit.seconds)) return recipe
      // もう片方のフェードは動かさず、残りの長さに収める
      const fadeIn = clamp(edit.seconds, 0, trimmedLength(recipe) - recipe.fadeOut)
      return fadeIn === recipe.fadeIn ? recipe : { ...recipe, fadeIn }
    }
    case 'setFadeOut': {
      if (!Number.isFinite(edit.seconds)) return recipe
      const fadeOut = clamp(edit.seconds, 0, trimmedLength(recipe) - recipe.fadeIn)
      return fadeOut === recipe.fadeOut ? recipe : { ...recipe, fadeOut }
    }
    case 'setGain': {
      if (!Number.isFinite(edit.db)) return recipe
      const gainDb = clamp(edit.db, MIN_GAIN_DB, MAX_GAIN_DB)
      return gainDb === recipe.gainDb ? recipe : { ...recipe, gainDb }
    }
    case 'setNormalize':
      return edit.enabled === recipe.normalize ? recipe : { ...recipe, normalize: edit.enabled }
    case 'setMono':
      return edit.enabled === recipe.mono ? recipe : { ...recipe, mono: edit.enabled }
    case 'setSilence': {
      const silence = withSilence(recipe.silence, edit.silence)
      return silence === recipe.silence ? recipe : { ...recipe, silence }
    }
    case 'reset': {
      const initial = createAudioRecipe(info)
      return sameRecipe(recipe, initial) ? recipe : initial
    }
  }
}

/**
 * 区間を差し替える。区間が縮んでフェードが収まらなくなったら、
 * フェードインを優先して残し、フェードアウトを残りに詰める
 */
function withTrim(recipe: AudioRecipe, trim: AudioTrim): AudioRecipe {
  if (trim.start === recipe.trim.start && trim.end === recipe.trim.end) return recipe
  const length = Math.max(0, trim.end - trim.start)
  const fadeIn = Math.min(recipe.fadeIn, length)
  const fadeOut = Math.min(recipe.fadeOut, length - fadeIn)
  return { ...recipe, trim, fadeIn, fadeOut }
}

/** 無音カットの設定を差し替える。非有限の値は無視し、範囲外は端に丸める。何も変わらなければ同じオブジェクト */
function withSilence(current: AudioSilence, patch: Partial<AudioSilence>): AudioSilence {
  const pick = (value: number | undefined, fallback: number, min: number, max: number) =>
    value === undefined || !Number.isFinite(value) ? fallback : clamp(value, min, max)
  const next: AudioSilence = {
    enabled: typeof patch.enabled === 'boolean' ? patch.enabled : current.enabled,
    thresholdDb: pick(patch.thresholdDb, current.thresholdDb, MIN_SILENCE_THRESHOLD_DB, MAX_SILENCE_THRESHOLD_DB),
    minDuration: pick(patch.minDuration, current.minDuration, MIN_SILENCE_DURATION, MAX_SILENCE_DURATION),
    padding: pick(patch.padding, current.padding, 0, MAX_SILENCE_PADDING),
  }
  return sameSilence(current, next) ? current : next
}

function sameSilence(a: AudioSilence, b: AudioSilence): boolean {
  return (
    a.enabled === b.enabled &&
    a.thresholdDb === b.thresholdDb &&
    a.minDuration === b.minDuration &&
    a.padding === b.padding
  )
}

/** 尺が読めない・壊れている場合は 0 に倒し、区間の計算に NaN を持ち込まない */
function safeDuration(info: AudioInfo): number {
  return Number.isFinite(info.duration) && info.duration > 0 ? info.duration : 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function sameRecipe(a: AudioRecipe, b: AudioRecipe): boolean {
  return (
    a.trim.start === b.trim.start &&
    a.trim.end === b.trim.end &&
    a.fadeIn === b.fadeIn &&
    a.fadeOut === b.fadeOut &&
    a.gainDb === b.gainDb &&
    a.normalize === b.normalize &&
    a.mono === b.mono &&
    sameSilence(a.silence, b.silence)
  )
}

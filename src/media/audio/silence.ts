import { dbToGain } from './dsp'
import type { AudioRecipe, AudioSilence, TimeRange } from './types'

/**
 * 無音カットの検出。React にも mediabunny にも依存しない純粋な計算だけを置く。
 *
 * 1. 音量の包絡（createLevelAccumulator）: LEVEL_WINDOW ごとに、全チャンネルの絶対値の最大を取る。
 *    窓はファイルの先頭（0 秒）から刻むので、画面（ファイル全体を読む）と書き出し（区間だけを読む）で
 *    同じ窓に同じ値が入り、画面で見せた範囲と書き出しで削る範囲が揃う
 * 2. 無音の検出（detectSilence）: しきい値を下回る窓が続く範囲を、区間で切り詰めてから
 *    最短の長さに満たないものを捨てる
 * 3. 残す範囲（keptRanges）: 無音の両側を padding だけ残して削り、その補集合を返す
 *
 * 全体が無音なら何も削らない（空のファイルを書き出しても使い道がないため）。
 */

/** 包絡の窓の長さ（秒）。声の切れ目を拾える細かさと、1 時間で 36 万個という量の折り合い */
export const LEVEL_WINDOW = 0.01

/** つなぎ目のクロスフェードの長さ（秒）。これより短い無音は削ってもつなぎ目が鳴るだけなので残す */
export const SILENCE_CROSSFADE = 0.01

export const MIN_SILENCE_THRESHOLD_DB = -80
export const MAX_SILENCE_THRESHOLD_DB = -20
export const MIN_SILENCE_DURATION = 0.1
export const MAX_SILENCE_DURATION = 5
export const MAX_SILENCE_PADDING = 1

export const DEFAULT_SILENCE: AudioSilence = {
  enabled: false,
  thresholdDb: -45,
  minDuration: 0.5,
  padding: 0.1,
}

/** 窓ごとのピーク（0〜）。levels[k] は [start + k * window, start + (k + 1) * window) 秒 */
export interface LevelEnvelope {
  levels: Float32Array
  /** 秒 */
  window: number
  /** levels[0] の窓の始まり（元ファイルの秒） */
  start: number
}

export interface LevelAccumulator {
  /** 続きのサンプル（チャンネルごと）を渡す */
  push(planes: readonly Float32Array[]): void
  result(): LevelEnvelope
}

/** サンプルレートでの 1 窓のサンプル数 */
export function levelWindowFrames(sampleRate: number): number {
  return Number.isFinite(sampleRate) && sampleRate > 0 ? Math.max(1, Math.round(sampleRate * LEVEL_WINDOW)) : 1
}

/**
 * @param startFrame 最初に渡すサンプルが元ファイルの何サンプル目か。窓の刻みを 0 サンプル目に揃えるのに使う
 */
export function createLevelAccumulator(sampleRate: number, startFrame = 0): LevelAccumulator {
  const size = levelWindowFrames(sampleRate)
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 1
  const first = Math.max(0, Math.floor(startFrame))
  const firstWindow = Math.floor(first / size)
  let frame = first
  let levels = new Float32Array(1024)
  let count = 0

  return {
    push(planes) {
      const frames = planes[0]?.length ?? 0
      for (let i = 0; i < frames; ) {
        const window = Math.floor((frame + i) / size)
        const index = window - firstWindow
        // 窓の終わりかブロックの終わりまでをまとめて見る
        const until = Math.min(frames, (window + 1) * size - frame)
        let peak = 0
        for (const plane of planes) {
          for (let j = i; j < until; j++) {
            const value = Math.abs(plane[j])
            // NaN は比較が偽になるので無視される
            if (value > peak) peak = value
          }
        }
        if (index >= levels.length) {
          const grown = new Float32Array(Math.max(levels.length * 2, index + 1))
          grown.set(levels)
          levels = grown
        }
        if (peak > levels[index]) levels[index] = peak
        count = Math.max(count, index + 1)
        i = until
      }
      frame += frames
    },
    result() {
      return { levels: levels.slice(0, count), window: size / rate, start: (firstWindow * size) / rate }
    },
  }
}

/** 浮動小数の足し引きで端がずれても、区間の端に付いているとみなす幅 */
const EDGE_EPSILON = 1e-9

/**
 * 区間 range の中の無音（しきい値を下回る窓が minDuration 以上続く範囲）。昇順で互いに重ならない。
 * 包絡が届いていない時刻は無音とみなさない（わからない部分を削らない）。
 */
export function detectSilence(
  envelope: LevelEnvelope,
  settings: Pick<AudioSilence, 'thresholdDb' | 'minDuration'>,
  range: TimeRange
): TimeRange[] {
  const { levels, window, start } = envelope
  if (!(range.end > range.start) || !(window > 0) || !Number.isFinite(start)) return []
  const threshold = dbToGain(settings.thresholdDb)
  const minDuration = Math.max(0, settings.minDuration)
  const first = Math.max(0, Math.floor((range.start - start) / window))
  const last = Math.min(levels.length, Math.ceil((range.end - start) / window))
  const silences: TimeRange[] = []
  let runStart = -1
  const close = (endWindow: number) => {
    const from = Math.max(range.start, start + runStart * window)
    const to = Math.min(range.end, start + endWindow * window)
    if (to - from >= minDuration - EDGE_EPSILON && to > from) silences.push({ start: from, end: to })
    runStart = -1
  }
  for (let k = first; k < last; k++) {
    // NaN の窓は「音がある」とみなす（削る側に倒さない）
    const silent = levels[k] < threshold
    if (silent && runStart < 0) runStart = k
    else if (!silent && runStart >= 0) close(k)
  }
  if (runStart >= 0) close(last)
  return silences
}

/**
 * 区間 range のうち残す範囲。無音の両側（区間の端に付いている側を除く）を padding だけ残し、
 * 残りが SILENCE_CROSSFADE に満たない無音は削らない。昇順で互いに重ならず、すべて range の中。
 * 全体が無音で何も残らないときは range 全体を返す。
 */
export function keptRanges(silences: readonly TimeRange[], range: TimeRange, padding: number): TimeRange[] {
  if (!(range.end > range.start)) return []
  const pad = Number.isFinite(padding) && padding > 0 ? padding : 0
  const removed: TimeRange[] = []
  for (const silence of silences) {
    const from = Math.max(range.start, silence.start)
    const to = Math.min(range.end, silence.end)
    if (!(to > from)) continue
    const a = from <= range.start + EDGE_EPSILON ? range.start : from + pad
    const b = to >= range.end - EDGE_EPSILON ? range.end : to - pad
    if (b - a < SILENCE_CROSSFADE) continue
    // 入力が昇順で重ならなければ不要だが、念のため前の範囲と重ねない
    const previous = removed[removed.length - 1]
    if (previous && a <= previous.end) previous.end = Math.max(previous.end, b)
    else removed.push({ start: a, end: b })
  }
  const kept: TimeRange[] = []
  let cursor = range.start
  for (const gap of removed) {
    if (gap.start > cursor) kept.push({ start: cursor, end: gap.start })
    cursor = Math.max(cursor, gap.end)
  }
  if (range.end > cursor) kept.push({ start: cursor, end: range.end })
  return kept.length > 0 ? kept : [{ start: range.start, end: range.end }]
}

/**
 * レシピの区間で残す範囲（元ファイルの秒）。無音カットが切ってある・包絡がまだないときは区間全体
 */
export function planKeptRanges(recipe: AudioRecipe, envelope: LevelEnvelope | null): TimeRange[] {
  const { trim, silence } = recipe
  if (!(trim.end > trim.start)) return []
  if (!silence.enabled || !envelope) return [{ start: trim.start, end: trim.end }]
  return keptRanges(detectSilence(envelope, silence, trim), trim, silence.padding)
}

/** 残す範囲の長さの合計（秒）。書き出しの長さになる */
export function keptLength(kept: readonly TimeRange[]): number {
  let total = 0
  for (const range of kept) total += Math.max(0, range.end - range.start)
  return total
}

/** 区間 trim のうち、kept に入らない（削られる）範囲 */
export function removedRanges(kept: readonly TimeRange[], trim: TimeRange): TimeRange[] {
  const removed: TimeRange[] = []
  let cursor = trim.start
  for (const range of kept) {
    if (range.start > cursor) removed.push({ start: cursor, end: range.start })
    cursor = Math.max(cursor, range.end)
  }
  if (trim.end > cursor && kept.length > 0) removed.push({ start: cursor, end: trim.end })
  return removed
}

/**
 * 元ファイルの時刻を書き出しの時間軸に写す。削られる範囲の中なら、その直後の残す範囲の頭と同じ位置
 */
export function outputTimeAt(kept: readonly TimeRange[], time: number): number {
  let output = 0
  for (const range of kept) {
    if (time <= range.start) return output
    if (time < range.end) return output + (time - range.start)
    output += range.end - range.start
  }
  return output
}

/**
 * 試聴で、元ファイルの時刻 time から次に鳴らす時刻。残す範囲の中ならそのまま、
 * 削られる範囲の中なら次の残す範囲の頭、最後の範囲より後なら null
 */
export function playableTimeFrom(kept: readonly TimeRange[], time: number): number | null {
  for (const range of kept) {
    if (time < range.start) return range.start
    if (time < range.end) return time
  }
  return null
}

import type { TimeRange } from './types'

/**
 * 残す範囲だけをつないで流す、純粋なつなぎ合わせ（無音カットの書き出し）。
 *
 * つなぎ目では、前の範囲の尻と次の範囲の頭を、削る側の音へ半分ずつはみ出させて重ね、
 * 足して 1 になる直線の重みで混ぜる（クロスフェード）。はみ出させた分で重ねるので、
 * 書き出しの長さはちょうど残す範囲の長さの合計になる。削る範囲はふつう無音に近いので、はみ出しは聞こえない。
 *
 * デコードはブロックごとに届くので、次の範囲の頭を待つあいだだけ前の範囲の尻を手元に持つ。
 * 全部をメモリに載せないので、長いファイルでも使える。
 */

/** サンプル単位の範囲 [start, end)。区間の先頭を 0 とする */
export interface FrameRange {
  start: number
  end: number
}

/**
 * 秒の範囲（元ファイルの時間軸）をサンプル単位（origin 秒を 0 とする）に直す。
 * 丸めで空になったものは捨て、触れ合うものはまとめる
 */
export function toFrameRanges(kept: readonly TimeRange[], origin: number, sampleRate: number): FrameRange[] {
  const frames: FrameRange[] = []
  for (const range of kept) {
    const start = Math.max(0, Math.round((range.start - origin) * sampleRate))
    const end = Math.round((range.end - origin) * sampleRate)
    if (end <= start) continue
    const previous = frames[frames.length - 1]
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end)
    else frames.push({ start, end })
  }
  return frames
}

export interface SplicedChunk {
  planes: Float32Array[]
  /** 書き出しの時間軸でのサンプル位置 */
  startFrame: number
}

export interface Splicer {
  /**
   * 続きのブロックを渡し、確定した分の書き出しを返す（なければ空の配列）。
   * startFrame は区間の先頭からのサンプル位置。前のブロックと重なる分は捨て、飛んだ分は無音として扱う
   */
  push(planes: readonly Float32Array[], startFrame: number): SplicedChunk[]
  /** 書き出しの長さ（サンプル） */
  readonly outputLength: number
}

interface Segment {
  start: number
  end: number
  /** 書き出しでの start の位置 */
  output: number
  /** 頭・尻のクロスフェードの半分の長さ（サンプル）。区間の端では 0 */
  headHalf: number
  tailHalf: number
}

/**
 * @param ranges 昇順で重ならないサンプル範囲（toFrameRanges の結果）
 * @param crossfadeFrames つなぎ目のクロスフェードの長さ。隙間や範囲が短ければ、そのつなぎ目だけ縮める
 */
export function createSplicer(ranges: readonly FrameRange[], channels: number, crossfadeFrames: number): Splicer {
  const half = Math.max(0, Math.floor(crossfadeFrames / 2))
  const segments: Segment[] = []
  let output = 0
  for (const range of ranges) {
    segments.push({ start: range.start, end: range.end, output, headHalf: 0, tailHalf: 0 })
    output += range.end - range.start
  }
  for (let k = 0; k + 1 < segments.length; k++) {
    const a = segments[k]
    const b = segments[k + 1]
    // はみ出しが隙間を越えず、重みの坂が範囲の中で頭と尻とで重ならない長さに抑える
    const h = Math.max(
      0,
      Math.min(
        half,
        Math.floor((b.start - a.end) / 2),
        Math.floor((a.end - a.start) / 2),
        Math.floor((b.end - b.start) / 2)
      )
    )
    a.tailHalf = h
    b.headHalf = h
  }
  const outputLength = output
  const channelCount = Math.max(1, channels)

  // buffer[c][i] は書き出しの (emitted + i) サンプル目
  let buffer = Array.from({ length: channelCount }, () => new Float32Array(4096))
  let emitted = 0
  let cursor = 0
  let segmentIndex = 0

  const ensureCapacity = (frames: number) => {
    if (frames <= buffer[0].length) return
    const size = Math.max(frames, buffer[0].length * 2)
    buffer = buffer.map((plane) => {
      const grown = new Float32Array(size)
      grown.set(plane)
      return grown
    })
  }

  /** 元のサンプル位置 cursor まで読んだとき、書き出しのどこまでが確定したか */
  const finalUpTo = (position: number): number => {
    let limit = outputLength
    for (let k = segmentIndex; k < segments.length; k++) {
      const s = segments[k]
      const extStart = s.start - s.headHalf
      const extEnd = s.end + s.tailHalf
      if (extEnd <= position) continue
      const outputAt = s.output + (Math.max(position, extStart) - s.start)
      if (outputAt < limit) limit = outputAt
      // これより後ろの範囲は、書き出しでもさらに後ろにしか届かない
      if (extStart >= position) break
    }
    return limit
  }

  const write = (planes: readonly Float32Array[], from: number, to: number, blockStart: number) => {
    for (let k = segmentIndex; k < segments.length; k++) {
      const s = segments[k]
      const extStart = s.start - s.headHalf
      const extEnd = s.end + s.tailHalf
      if (extStart >= to) break
      const lo = Math.max(from, extStart)
      const hi = Math.min(to, extEnd)
      if (hi <= lo) continue
      ensureCapacity(s.output + (hi - s.start) - emitted)
      for (let f = lo; f < hi; f++) {
        let weight = 1
        if (f < s.start + s.headHalf) weight = (f - extStart + 0.5) / (2 * s.headHalf)
        else if (f >= s.end - s.tailHalf) weight = 1 - (f - (s.end - s.tailHalf) + 0.5) / (2 * s.tailHalf)
        const at = s.output + (f - s.start) - emitted
        for (let c = 0; c < channelCount; c++) {
          // 足りないチャンネルは先頭のチャンネルで埋める（途中でチャンネル数が減っても崩さない）
          const plane = planes[c] ?? planes[0]
          const value = plane ? plane[f - blockStart] : 0
          // NaN を書き出しに持ち込まない
          if (value === value) buffer[c][at] += value * weight
        }
      }
    }
  }

  return {
    outputLength,
    push(planes, startFrame) {
      const frames = planes[0]?.length ?? 0
      const blockStart = Math.round(startFrame)
      const from = Math.max(cursor, blockStart)
      const to = blockStart + frames
      if (to > from) write(planes, from, to, blockStart)
      // 飛んだ分も読んだことにする（その範囲は無音のまま確定させる）
      cursor = Math.max(cursor, to)
      while (segmentIndex < segments.length && segments[segmentIndex].end + segments[segmentIndex].tailHalf <= cursor) {
        segmentIndex++
      }
      const done = finalUpTo(cursor)
      if (done <= emitted) return []
      const count = done - emitted
      ensureCapacity(count)
      const chunk = buffer.map((plane) => plane.slice(0, count))
      for (const plane of buffer) {
        plane.copyWithin(0, count)
        plane.fill(0, plane.length - count)
      }
      const chunkStart = emitted
      emitted = done
      return [{ planes: chunk, startFrame: chunkStart }]
    },
  }
}

/**
 * 秒の範囲で残す範囲を受け取り、時刻付きのブロックを流すつなぎ合わせ。
 * サンプルレートとチャンネル数は最初のブロックで決める（書き出しでは process に届く、変換後のレート）。
 * time は区間の先頭からの秒で、返す time は書き出しの時間軸の秒。
 */
export function createTimedSplicer(kept: readonly TimeRange[], origin: number, crossfadeSeconds: number) {
  let splicer: Splicer | null = null
  let rate = 1
  return (planes: readonly Float32Array[], time: number, sampleRate: number) => {
    if (!splicer) {
      rate = sampleRate > 0 ? sampleRate : 1
      splicer = createSplicer(toFrameRanges(kept, origin, rate), planes.length, Math.round(crossfadeSeconds * rate))
    }
    return splicer
      .push(planes, Math.round(time * rate))
      .map((chunk) => ({ planes: chunk.planes, time: chunk.startFrame / rate }))
  }
}

/**
 * 再生速度を変える DSP（純粋な TS。mediabunny にも DOM にも依存しない）。
 *
 * - createTimeStretcher: WSOLA（波形の似た位置を探して重ね合わせる）で、音の高さを保ったまま長さを 1 / speed 倍にする。
 *   声や楽器の持続音はほぼ自然に聞こえるが、打楽器の立ち上がりは少しにじみ、4 倍・0.25 倍の端ではうなりが出る
 * - createResampler: 単純な補間で詰める・伸ばす。音の高さも speed 倍に変わる（テープの早回しと同じ）が、音は崩れない
 *
 * どちらも小分けのブロックを順に受け取り（push）、最後に残りを出す（flush）。出力の総数は
 * round(入力の総数 / speed) ちょうどにそろえ、映像のタイムスタンプ（t / speed）とずれないようにする。
 */

export const MIN_SPEED = 0.25
export const MAX_SPEED = 4

export interface StreamingStretcher {
  /** チャンネルごとのブロックを足し、出せるようになった分を返す（長さ 0 のこともある） */
  push(planes: readonly Float32Array[]): Float32Array[]
  /** 残りをすべて出す。以後は使えない */
  flush(): Float32Array[]
}

export interface StretchOptions {
  channels: number
  sampleRate: number
  speed: number
}

/** 1 フレームの長さ（秒）。声の基本周期（〜20ms）を数周期含み、子音がにじまない程度に短く */
const FRAME_SECONDS = 0.04
/** 似た位置を探す幅（片側、秒）。低い声の 1 周期ぶんあれば継ぎ目を合わせられる */
const SEEK_SECONDS = 0.012
/** 粗く探すときの間引き（候補の刻みと相関を取る刻み） */
const COARSE_STEP = 4
const COARSE_STRIDE = 8
const FINE_STRIDE = 2
/** stretchAll がまとめて流すときのブロック */
const STREAM_BLOCK = 8192

/**
 * WSOLA の流れ処理。フレーム長 N、合成の歩幅 Hs = N / 2（ハン窓の 50% 重ね）、分析の歩幅 Ha = Hs × speed。
 * k 番目のフレームは入力の k·Ha 付近から、直前のフレームの「自然な続き」（前の位置 + Hs）にいちばん似た位置を
 * ±SEEK の中で選んで重ねる。重ねた窓の和で割り戻すので、先頭と末尾も音量が落ちない。
 */
export function createTimeStretcher({ channels, sampleRate, speed }: StretchOptions): StreamingStretcher {
  if (!(speed > 0) || !Number.isFinite(speed)) throw new RangeError(`invalid speed: ${speed}`)
  const frame = Math.max(16, Math.round((FRAME_SECONDS * sampleRate) / 2) * 2)
  const hop = frame / 2
  const seek = Math.max(1, Math.round(SEEK_SECONDS * sampleRate))
  const window = hann(frame)

  // 入力は「絶対位置 inStart から先」だけを持つ
  let input: Float32Array[] = Array.from({ length: channels }, () => new Float32Array(0))
  let inStart = 0
  let inTotal = 0
  // 出力の重ね合わせの途中（先頭が次に確定する位置、長さ frame）
  const acc = Array.from({ length: channels }, () => new Float32Array(frame))
  const wsum = new Float32Array(frame)
  let emitted = 0
  let k = 0
  let prevPos = 0
  let done = false

  const inEnd = () => inStart + (input[0]?.length ?? 0)

  const append = (planes: readonly Float32Array[]) => {
    const add = planes[0]?.length ?? 0
    if (add === 0) return
    input = input.map((buf, c) => {
      const next = new Float32Array(buf.length + add)
      next.set(buf)
      next.set(planes[c] ?? planes[0], buf.length)
      return next
    })
    inTotal += add
  }

  /** 位置 pos（絶対）から frame 個を窓を掛けて重ね、確定した hop 個を返す */
  const overlapAdd = (pos: number, out: Float32Array[][]) => {
    const offset = pos - inStart
    for (let c = 0; c < channels; c++) {
      const src = input[c]
      const dst = acc[c]
      for (let i = 0; i < frame; i++) dst[i] += window[i] * src[offset + i]
    }
    for (let i = 0; i < frame; i++) wsum[i] += window[i]
    // 先頭の hop 個は、次のフレームが届かないので確定
    const ready = acc.map((dst) => {
      const chunk = new Float32Array(hop)
      for (let i = 0; i < hop; i++) chunk[i] = dst[i] / Math.max(wsum[i], 1e-3)
      dst.copyWithin(0, hop)
      dst.fill(0, frame - hop)
      return chunk
    })
    wsum.copyWithin(0, hop)
    wsum.fill(0, frame - hop)
    out.push(ready)
  }

  /** 自然な続き（target から frame 個）にいちばん似た、ideal ± seek の位置 */
  const bestPosition = (ideal: number, target: number): number => {
    const lo = Math.max(inStart, ideal - seek)
    const hi = Math.min(inEnd() - frame, ideal + seek)
    if (hi <= lo) return Math.max(inStart, Math.min(ideal, inEnd() - frame))
    let coarse = lo
    let coarseScore = -Infinity
    for (let cand = lo; cand <= hi; cand += COARSE_STEP) {
      const score = similarity(cand, target, COARSE_STRIDE)
      if (score > coarseScore) [coarseScore, coarse] = [score, cand]
    }
    // 粗い候補のまわりを細かく見直す
    let best = coarse
    let bestScore = -Infinity
    for (let cand = Math.max(lo, coarse - COARSE_STEP + 1); cand <= Math.min(hi, coarse + COARSE_STEP - 1); cand++) {
      const score = similarity(cand, target, FINE_STRIDE)
      if (score > bestScore) [bestScore, best] = [score, cand]
    }
    return best
  }

  /** 正規化した相互相関（候補側の大きさで割り、大きな音の場所ばかり選ばれないようにする） */
  const similarity = (cand: number, target: number, stride: number): number => {
    const a = cand - inStart
    const b = target - inStart
    let dot = 0
    let energy = 1e-9
    for (let c = 0; c < channels; c++) {
      const src = input[c]
      for (let i = 0; i < frame; i += stride) {
        const x = src[a + i]
        dot += x * src[b + i]
        energy += x * x
      }
    }
    return dot / Math.sqrt(energy)
  }

  /** 入力が足りる限りフレームを進める */
  const run = (out: Float32Array[][]) => {
    for (;;) {
      const ideal = Math.round(k * hop * speed)
      const target = prevPos + hop
      const need = Math.max(ideal + seek, target) + frame
      if (need > inEnd()) return
      const pos = k === 0 ? 0 : bestPosition(ideal, target)
      overlapAdd(pos, out)
      prevPos = pos
      k++
      // もう参照しない入力を捨てる（次の候補の下限と、次の自然な続きのうち小さいほうより前）
      const keepFrom = Math.min(Math.round(k * hop * speed) - seek, prevPos + hop)
      const drop = Math.max(0, keepFrom - inStart)
      if (drop > 0 && drop <= (input[0]?.length ?? 0)) {
        input = input.map((buf) => buf.slice(drop))
        inStart += drop
      }
    }
  }

  // 確定したがまだ渡していない出力。入力が短いうちに速く回すと（speed が大きいとき）、
  // 1 フレームの hop が入力の 1 / speed を追い越すことがあるので、総数を超える分はここで待たせる
  let pending: Float32Array[][] = []

  /** pending を先頭から limit 個（絶対数）まで渡す */
  const collect = (limit: number): Float32Array[] => {
    const total = pending.reduce((sum, chunk) => sum + chunk[0].length, 0)
    const length = Math.max(0, Math.min(total, limit - emitted))
    const planes = Array.from({ length: channels }, () => new Float32Array(length))
    let at = 0
    const rest: Float32Array[][] = []
    for (const chunk of pending) {
      const take = Math.max(0, Math.min(chunk[0].length, length - at))
      if (take > 0) {
        for (let c = 0; c < channels; c++) planes[c].set(chunk[c].subarray(0, take), at)
        at += take
      }
      if (take < chunk[0].length) rest.push(chunk.map((plane) => plane.subarray(take)))
    }
    pending = rest
    emitted += length
    return planes
  }

  return {
    push(planes) {
      if (done) throw new Error('stretcher already flushed')
      append(planes)
      run(pending)
      return collect(Math.floor(inTotal / speed))
    },
    flush() {
      if (done) throw new Error('stretcher already flushed')
      done = true
      const expected = Math.round(inTotal / speed)
      // 末尾まで出し切れるよう無音を足してから回す（余った分は expected で切る）
      const pad = frame * 2 + seek * 2 + Math.ceil(hop * speed)
      append(Array.from({ length: channels }, () => new Float32Array(pad)))
      inTotal -= pad
      run(pending)
      // 窓の途中に残っている分（無音を足したので確定させてよい）
      const tail = acc.map((dst) => {
        const chunk = new Float32Array(frame)
        for (let i = 0; i < frame; i++) chunk[i] = dst[i] / Math.max(wsum[i], 1e-3)
        return chunk
      })
      pending.push(tail)
      const planes = collect(expected)
      // 入力が短すぎて足りないときは無音で埋め、総数を必ず expected にする
      const short = expected - emitted
      if (short > 0) {
        emitted += short
        return planes.map((plane) => {
          const filled = new Float32Array(plane.length + short)
          filled.set(plane)
          return filled
        })
      }
      return planes
    },
  }
}

/**
 * 音の高さごと速さを変える（線形補間で読み飛ばす・繰り返す）。出力 j は入力の j × speed の位置。
 * 高さが保てないかわりに、WSOLA のような継ぎ目のにじみは出ない
 */
export function createResampler({ channels, speed }: Omit<StretchOptions, 'sampleRate'>): StreamingStretcher {
  if (!(speed > 0) || !Number.isFinite(speed)) throw new RangeError(`invalid speed: ${speed}`)
  // これまでの入力の最後の値。ブロックの境目と末尾の補間に使う
  let last: number[] = Array.from({ length: channels }, () => 0)
  let inTotal = 0
  let emitted = 0
  let done = false

  const produce = (planes: readonly Float32Array[], limit: number): Float32Array[] => {
    const length = planes[0]?.length ?? 0
    const base = inTotal
    inTotal += length
    const value = (c: number, index: number): number => {
      const local = index - base
      if (local < 0) return last[c]
      const plane = planes[c] ?? planes[0]
      return local < length ? plane[local] : length > 0 ? plane[length - 1] : last[c]
    }
    const out: number[][] = Array.from({ length: channels }, () => [])
    while (emitted < limit) {
      const position = emitted * speed
      const i0 = Math.floor(position)
      // 補間に使う次の 1 個がまだ届いていなければ、次のブロックを待つ（flush では最後の値で止める）
      if (limit === Infinity && i0 + 1 >= inTotal) break
      const frac = position - i0
      for (let c = 0; c < channels; c++) {
        const a = value(c, i0)
        out[c].push(a + (value(c, i0 + 1) - a) * frac)
      }
      emitted++
    }
    if (length > 0) last = Array.from({ length: channels }, (_, c) => (planes[c] ?? planes[0])[length - 1])
    return out.map((values) => Float32Array.from(values))
  }

  return {
    push(planes) {
      if (done) throw new Error('resampler already flushed')
      return produce(planes, Infinity)
    },
    flush() {
      if (done) throw new Error('resampler already flushed')
      done = true
      return produce([], Math.round(inTotal / speed))
    },
  }
}

/** まとめて伸縮する（テストと短い音向け） */
export function stretchAll(
  planes: readonly Float32Array[],
  sampleRate: number,
  speed: number,
  preservePitch = true
): Float32Array[] {
  const options = { channels: planes.length, sampleRate, speed }
  const stretcher = preservePitch ? createTimeStretcher(options) : createResampler(options)
  // 一度に渡すと捨てる入力の詰め直しが毎フレーム全体に及ぶので、変換と同じくブロックに分けて流す
  const parts: Float32Array[][] = []
  const length = planes[0]?.length ?? 0
  for (let at = 0; at < length; at += STREAM_BLOCK) {
    parts.push(stretcher.push(planes.map((plane) => plane.subarray(at, at + STREAM_BLOCK))))
  }
  parts.push(stretcher.flush())
  return concatPlanes(parts, planes.length)
}

export function concatPlanes(parts: readonly Float32Array[][], channels: number): Float32Array[] {
  const total = parts.reduce((sum, part) => sum + (part[0]?.length ?? 0), 0)
  return Array.from({ length: channels }, (_, c) => {
    const plane = new Float32Array(total)
    let at = 0
    for (const part of parts) {
      const chunk = part[c] ?? new Float32Array(0)
      plane.set(chunk, at)
      at += chunk.length
    }
    return plane
  })
}

/** 50% 重ねで和が 1 になる周期的なハン窓 */
function hann(length: number): Float32Array {
  const window = new Float32Array(length)
  for (let i = 0; i < length; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / length)
  return window
}

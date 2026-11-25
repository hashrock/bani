/**
 * 波形表示用のピーク列。各バケツに入るサンプルの絶対値の最大を 0〜1 で持つ。
 *
 * サンプル j が入るバケツは floor(j * buckets / total) に固定する。
 * 一括（computePeaks）でも少しずつ（createPeakAccumulator）でも同じ割り当てになるので、
 * 長いファイルを全部メモリに載せずに同じ波形が作れる。
 */

export function computePeaks(samples: Float32Array, buckets: number): Float32Array {
  const accumulator = createPeakAccumulator(buckets, samples.length)
  accumulator.push(samples)
  return accumulator.result()
}

export interface PeakAccumulator {
  /** 続きのサンプルを渡す */
  push(samples: Float32Array): void
  /** ここまでのピーク列。返した配列はその後の push で書き換わらない */
  result(): Float32Array
}

/**
 * @param totalFrames 全体のサンプル数の見込み。デコード前は尺 × サンプルレートからの概算になるので、
 *   見込みを超えて届いたサンプルは最後のバケツに寄せる
 */
export function createPeakAccumulator(buckets: number, totalFrames: number): PeakAccumulator {
  const count = Number.isFinite(buckets) && buckets > 0 ? Math.floor(buckets) : 0
  const total = Number.isFinite(totalFrames) && totalFrames > 0 ? Math.floor(totalFrames) : 0
  const peaks = new Float32Array(count)
  let offset = 0

  return {
    push(samples) {
      if (count === 0 || total === 0) {
        offset += samples.length
        return
      }
      for (let i = 0; i < samples.length; i++) {
        const bucket = Math.min(count - 1, Math.floor(((offset + i) * count) / total))
        const value = Math.abs(samples[i])
        // NaN は比較が偽になるので自然に無視される
        if (value > peaks[bucket]) peaks[bucket] = value > 1 ? 1 : value
      }
      offset += samples.length
    },
    result() {
      return peaks.slice()
    },
  }
}

/**
 * サンプル列（Float32Array, -1〜1）に対する純粋な信号処理。
 * 書き出しの process フックと、ノーマライズ用のピーク計測の両方がここを通るので、
 * 計測した信号と書き出す信号が食い違わない。
 */

/** ノーマライズで揃えるピーク（dBFS）。エンコード後のオーバーシュートで割れないよう少し余裕を残す */
export const NORMALIZE_TARGET_DB = -1

/** これより小さいピークは無音とみなし、ノーマライズで持ち上げない（ノイズだけが爆音になるのを防ぐ） */
export const SILENCE_PEAK = 1e-4

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20)
}

export function gainToDb(gain: number): number {
  return 20 * Math.log10(gain)
}

/** ピークを NORMALIZE_TARGET_DB に揃えるための倍率。無音や不正な値なら 1（何もしない） */
export function normalizeGain(peak: number, targetDb = NORMALIZE_TARGET_DB): number {
  if (!(peak > SILENCE_PEAK) || !Number.isFinite(peak)) return 1
  return dbToGain(targetDb) / peak
}

/**
 * 区間内の時刻 t（秒）でのフェードの倍率（0〜1）。直線で上げ下げする。
 * フェードイン・アウトが重なる位置では小さい方を採る。
 */
export function fadeEnvelope(t: number, length: number, fadeIn: number, fadeOut: number): number {
  const rising = fadeIn > 0 ? t / fadeIn : 1
  const falling = fadeOut > 0 ? (length - t) / fadeOut : 1
  const value = Math.min(rising, falling, 1)
  // NaN を 0 に倒すため、比較の向きに注意して丸める
  return value > 0 ? value : 0
}

/**
 * チャンネル数を合わせる。
 * - 1 へ: 全チャンネルの平均
 * - 1 から増やす: 同じ信号を複製
 * - 5.1 → 2: L + √½(C + SL), R + √½(C + SR)（Web Audio・mediabunny と同じ式。LFE は捨てる）。
 *   先頭 2 本だけを残すと、映画などでセリフが入るセンターが消えてしまうため
 * - そのほかの減らし方: 先頭のチャンネルだけを残す（配置の情報がないので割り切る）
 * 入力の配列は書き換えず、複製・平均のときは新しい配列を返す。
 */
export function remixChannels(planes: readonly Float32Array[], target: number): Float32Array[] {
  if (planes.length === 0 || target <= 0) return []
  if (planes.length === target) return [...planes]
  const frames = planes[0].length
  if (target === 1) {
    const mixed = new Float32Array(frames)
    const scale = 1 / planes.length
    for (const plane of planes) {
      for (let i = 0; i < frames; i++) mixed[i] += plane[i] * scale
    }
    return [mixed]
  }
  if (planes.length === 1) {
    return Array.from({ length: target }, () => planes[0].slice())
  }
  if (planes.length === 6 && target === 2) return downmix51ToStereo(planes)
  if (planes.length > target) return planes.slice(0, target)
  // 2 → 4 などの増やし方は使わないが、足りない分は無音で埋めて形だけ合わせる
  return [...planes, ...Array.from({ length: target - planes.length }, () => new Float32Array(frames))]
}

/** チャンネル順は WebCodecs と同じ L, R, C, LFE, SL, SR */
function downmix51ToStereo(planes: readonly Float32Array[]): Float32Array[] {
  const [l, r, c, , sl, sr] = planes
  const left = new Float32Array(l.length)
  const right = new Float32Array(l.length)
  for (let i = 0; i < l.length; i++) {
    left[i] = l[i] + Math.SQRT1_2 * (c[i] + sl[i])
    right[i] = r[i] + Math.SQRT1_2 * (c[i] + sr[i])
  }
  return [left, right]
}

export interface ProcessParams {
  /** このブロックの先頭が、切り出した区間の先頭から何秒の位置か */
  startTime: number
  sampleRate: number
  /** 切り出した区間の長さ（秒） */
  length: number
  fadeIn: number
  fadeOut: number
  /** 直線の倍率（dB ではない） */
  gain: number
  channels: number
}

/**
 * 1 ブロック分の処理（チャンネル合わせ → フェード → 音量 → -1〜1 に切り詰め）。
 * 整数形式へ変換するときの回り込みを防ぐため、書き出しでは最後に切り詰める。
 * ノーマライズ用のピーク計測では 1 を超えた分も測りたいので clip = false で呼ぶ。
 */
export function processPlanes(
  planes: readonly Float32Array[],
  params: ProcessParams,
  clip = true
): Float32Array[] {
  const mixed = remixChannels(planes, params.channels)
  const frames = mixed[0]?.length ?? 0
  const envelope = new Float32Array(frames)
  for (let i = 0; i < frames; i++) {
    const t = params.startTime + i / params.sampleRate
    envelope[i] = fadeEnvelope(t, params.length, params.fadeIn, params.fadeOut) * params.gain
  }
  return mixed.map((plane) => {
    const out = new Float32Array(frames)
    for (let i = 0; i < frames; i++) {
      const value = plane[i] * envelope[i]
      out[i] = clip ? clampUnit(value) : value
    }
    return out
  })
}

/** 絶対値の最大。NaN は無視する */
export function peakOf(planes: readonly Float32Array[]): number {
  let peak = 0
  for (const plane of planes) {
    for (let i = 0; i < plane.length; i++) {
      const value = Math.abs(plane[i])
      if (value > peak) peak = value
    }
  }
  return peak
}

/** -1〜1 の浮動小数を 16bit 整数へ。範囲外は切り詰め、NaN は 0 にする */
export function floatToInt16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const value = clampUnit(samples[i])
    // 正側は 32767 までしかないので、正負で掛ける数を変えて端を潰さない
    out[i] = Math.round(value < 0 ? value * 0x8000 : value * 0x7fff)
  }
  return out
}

function clampUnit(value: number): number {
  if (value > 1) return 1
  if (value < -1) return -1
  return value === value ? value : 0
}

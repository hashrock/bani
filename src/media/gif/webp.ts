/**
 * アニメーション WebP の組み立て（mux）。ブラウザに依存しない。
 *
 * アニメーション WebP を直接書けるエンコーダはブラウザにないが、静止画の WebP は Canvas が書ける
 * （Chrome・Edge・Firefox。Safari は書けない）。そこで各フレームを静止画の WebP にしてから、
 * その中身（VP8 / VP8L と、透過の ALPH）を取り出し、ANMF に包んで 1 つのファイルにする。
 * 各フレームはキャンバス全面で、前の絵と混ぜない（透過のあるフレームでも前の絵が透けない）。
 */

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

export class WebpMuxError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebpMuxError'
  }
}

/** 静止画の WebP から、画像の本体の chunk（ALPH があればそれも、ヘッダごと）を取り出す */
export function extractWebpImageChunks(webp: Uint8Array): { chunks: Uint8Array; alpha: boolean } {
  if (webp.length < 12 || ascii(webp, 0, 4) !== 'RIFF' || ascii(webp, 8, 4) !== 'WEBP') {
    throw new WebpMuxError('Not a WebP file')
  }
  const parts: Uint8Array[] = []
  let alpha = false
  let pos = 12
  while (pos + 8 <= webp.length) {
    const type = ascii(webp, pos, 4)
    const size = u32le(webp, pos + 4)
    const end = pos + 8 + size + (size & 1)
    if (end > webp.length + 1) throw new WebpMuxError('Truncated WebP chunk')
    if (type === 'ALPH' || type === 'VP8 ' || type === 'VP8L') {
      parts.push(webp.subarray(pos, Math.min(end, webp.length)))
      if (type === 'ALPH') alpha = true
      // 可逆（VP8L）は透過を中に持つ。ヘッダのビット（28 ビット目）で見る
      if (type === 'VP8L' && pos + 13 <= webp.length) {
        const bits = u32le(webp, pos + 9)
        if ((bits >>> 28) & 1) alpha = true
      }
    } else if (type === 'ANMF') {
      throw new WebpMuxError('Already animated')
    }
    pos = end
  }
  if (!parts.some((part) => ascii(part, 0, 3) === 'VP8')) throw new WebpMuxError('WebP has no image data')
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const chunks = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    chunks.set(part, offset)
    offset += part.length
  }
  // 奇数長の最後の chunk には詰め物の 0 を足しておく（ANMF の中でも偶数にそろえる）
  if (chunks.length & 1) {
    const padded = new Uint8Array(chunks.length + 1)
    padded.set(chunks)
    return { chunks: padded, alpha }
  }
  return { chunks, alpha }
}

class Writer {
  parts: Uint8Array[] = []
  length = 0
  push(bytes: Uint8Array) {
    this.parts.push(bytes)
    this.length += bytes.length
  }
  ascii(text: string) {
    this.push(Uint8Array.from(text, (c) => c.charCodeAt(0)))
  }
  u32(value: number) {
    this.push(Uint8Array.of(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff))
  }
  u24(value: number) {
    this.push(Uint8Array.of(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff))
  }
  u16(value: number) {
    this.push(Uint8Array.of(value & 0xff, (value >> 8) & 0xff))
  }
  byte(value: number) {
    this.push(Uint8Array.of(value & 0xff))
  }
  join(): Uint8Array {
    const out = new Uint8Array(this.length)
    let offset = 0
    for (const part of this.parts) {
      out.set(part, offset)
      offset += part.length
    }
    return out
  }
}

/** WebP の 1 フレームの表示時間の上限（24 ビットのミリ秒） */
const MAX_WEBP_DURATION = 0xffffff

/**
 * 静止画の WebP の並びを、1 つのアニメーション WebP にする。
 * plays は再生する回数（0 は無限）。WebP のループ回数はそのまま再生回数として読まれる
 */
export function muxAnimatedWebp(
  frames: readonly { webp: Uint8Array; duration: number }[],
  options: { width: number; height: number; plays: number }
): Uint8Array {
  const { width, height } = options
  if (frames.length === 0) throw new WebpMuxError('No frames')
  if (!(width >= 1 && height >= 1 && width <= 1 << 24 && height <= 1 << 24)) throw new WebpMuxError('Bad size')
  const images = frames.map((frame) => extractWebpImageChunks(frame.webp))
  const alpha = images.some((image) => image.alpha)

  const body = new Writer()
  // VP8X: アニメーション（0x02）と透過（0x10）の印、キャンバスの大きさ（-1 した 24 ビット）
  body.ascii('VP8X')
  body.u32(10)
  body.byte(0x02 | (alpha ? 0x10 : 0))
  body.u24(0)
  body.u24(width - 1)
  body.u24(height - 1)
  // ANIM: 背景色（透明）とループ回数
  body.ascii('ANIM')
  body.u32(6)
  body.u32(0)
  body.u16(Math.max(0, Math.min(0xffff, Math.floor(options.plays) || 0)))

  frames.forEach((frame, index) => {
    const { chunks } = images[index]
    body.ascii('ANMF')
    body.u32(16 + chunks.length)
    body.u24(0) // X / 2
    body.u24(0) // Y / 2
    body.u24(width - 1)
    body.u24(height - 1)
    body.u24(Math.max(1, Math.min(MAX_WEBP_DURATION, Math.round(frame.duration))))
    // 前の絵と混ぜない（0x02）、後始末はしない
    body.byte(0x02)
    body.push(chunks)
  })

  const out = new Writer()
  out.ascii('RIFF')
  out.u32(4 + body.length)
  out.ascii('WEBP')
  out.push(body.join())
  return out.join()
}

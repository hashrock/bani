/**
 * 画像がアニメーションか（2 フレーム以上か）を、先頭のバイトから見分ける。デコードはしない。
 * 振り分け（src/app/intake.ts）が使う: アニメーションなら GIF の画面、1 枚なら画像の画面へ。
 *
 * - GIF: ブロックをたどって画像（0x2C）を 2 つ見つけたらアニメーション
 * - PNG（APNG）: IDAT より前に acTL があり、フレーム数が 2 以上
 * - WebP: VP8X のアニメーションの印があり、ANMF が 2 つ以上（読んだ範囲で数え切れなければ印を信じる）
 */
// 振り分け（入口の読み込み）から使うので、デコーダは読み込まない（この判定だけを持つ）
const isGif = (bytes: Uint8Array) =>
  bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38

export type AnimatedFormat = 'gif' | 'png' | 'webp'

/** 判定に読む先頭の長さ。GIF は 1 枚目の画像を飛ばさないと 2 枚目が見えないので大きめ */
export const SNIFF_BYTES: Record<AnimatedFormat, number> = {
  gif: 32 * 1024 * 1024,
  png: 1024 * 1024,
  webp: 1024 * 1024,
}

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))

const u32be = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

/** 先頭のバイトから形式を見る。アニメーションを持てる形式でなければ null */
export function sniffAnimatedFormat(head: Uint8Array): AnimatedFormat | null {
  if (isGif(head)) return 'gif'
  if (head.length >= 8 && u32be(head, 0) === 0x89504e47 && u32be(head, 4) === 0x0d0a1a0a) return 'png'
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'webp'
  return null
}

/**
 * 2 フレーム以上あるか。bytes はファイルの先頭（全部でなくてよい）。
 * truncated は、ファイルがまだ続いているのに読んだ範囲で決めきれなかったとき、どちらに倒すか
 */
export function isAnimatedImage(bytes: Uint8Array, truncated = false): boolean {
  switch (sniffAnimatedFormat(bytes)) {
    case 'gif': {
      const { count, ended } = countGifFrames(bytes, 2)
      // 読んだ範囲で決めきれず、ファイルが続いているなら、大きな GIF はたいていアニメーションなのでそちらに倒す
      return count >= 2 || (!ended && truncated)
    }
    case 'png':
      return apngFrameCount(bytes) >= 2
    case 'webp':
      return webpIsAnimated(bytes)
    default:
      return false
  }
}

/**
 * GIF の画像の数を数える（stopAt に達したらそこで止める）。
 * ended は終わり（trailer か、知らないブロック）までたどれたか。bytes が先に尽きたら false
 */
export function countGifFrames(bytes: Uint8Array, stopAt = Infinity): { count: number; ended: boolean } {
  let pos = 13
  let count = 0
  if (bytes.length < pos) return { count, ended: false }
  const packed = bytes[10]
  if (packed & 0x80) pos += 3 * (1 << ((packed & 7) + 1))
  const skipSubBlocks = () => {
    for (;;) {
      if (pos >= bytes.length) return false
      const size = bytes[pos++]
      if (size === 0) return true
      pos += size
    }
  }
  while (pos < bytes.length) {
    const introducer = bytes[pos++]
    if (introducer === 0x21) {
      pos++ // 拡張の種類
      if (!skipSubBlocks()) return { count, ended: false }
      continue
    }
    if (introducer !== 0x2c) return { count, ended: true }
    if (pos + 9 > bytes.length) return { count, ended: false }
    const local = bytes[pos + 8]
    pos += 9
    if (local & 0x80) pos += 3 * (1 << ((local & 7) + 1))
    pos++ // LZW の最小の符号長
    if (!skipSubBlocks()) return { count, ended: false }
    count++
    if (count >= stopAt) return { count, ended: false }
  }
  return { count, ended: false }
}

/** APNG のフレーム数（acTL の num_frames）。ふつうの PNG なら 1 */
export function apngFrameCount(bytes: Uint8Array): number {
  let pos = 8
  while (pos + 8 <= bytes.length) {
    const length = u32be(bytes, pos)
    const type = ascii(bytes, pos + 4, 4)
    if (type === 'acTL') return pos + 12 <= bytes.length ? u32be(bytes, pos + 8) : 1
    if (type === 'IDAT' || type === 'IEND') return 1
    pos += 12 + length
  }
  return 1
}

function webpIsAnimated(bytes: Uint8Array): boolean {
  let pos = 12
  let flagged = false
  let frames = 0
  while (pos + 8 <= bytes.length) {
    const type = ascii(bytes, pos, 4)
    const size = u32le(bytes, pos + 4)
    if (type === 'VP8X') {
      if (pos + 9 > bytes.length) return false
      flagged = (bytes[pos + 8] & 0x02) !== 0
      if (!flagged) return false
    } else if (type === 'ANMF') {
      frames++
      if (frames >= 2) return true
    } else if (type === 'VP8 ' || type === 'VP8L') {
      // アニメーションでない WebP の画像の本体
      return false
    }
    pos += 8 + size + (size & 1)
  }
  // 読んだ範囲で 2 つ目の ANMF に届かなかった。印があり、まだ続きがあるならアニメーションとみなす
  return flagged && pos > bytes.length
}

/**
 * GIF の LZW（可変長の符号、最大 12 ビット）。ブラウザに依存しない純粋な計算だけを置き、
 * デコーダ（ImageDecoder のないブラウザ向けの予備）とエンコーダの両方から使う。
 */

const MAX_CODES = 4096
const MAX_BITS = 12

/**
 * 符号列を画素の色番号へ戻す。pixelCount まで埋めたら止める。
 * データが途中で切れていても、そこまでを返す（残りは 0 のまま。壊れた GIF でも読めるところまで見せる）。
 */
export function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount)
  if (minCodeSize < 1 || minCodeSize > 11) return out
  const clear = 1 << minCodeSize
  const end = clear + 1

  // 辞書は「1 つ前の符号 + 末尾の 1 色」で持ち、展開は後ろからたどって stack に積む
  const prefix = new Int16Array(MAX_CODES)
  const suffix = new Uint8Array(MAX_CODES)
  for (let code = 0; code < clear; code++) suffix[code] = code
  const stack = new Uint8Array(MAX_CODES + 1)

  let codeSize = minCodeSize + 1
  let next = end + 1
  let previous = -1
  let first = 0
  let written = 0
  let bits = 0
  let bitCount = 0
  let position = 0

  while (written < pixelCount) {
    while (bitCount < codeSize) {
      if (position >= data.length) return out
      bits |= data[position++] << bitCount
      bitCount += 8
    }
    let code = bits & ((1 << codeSize) - 1)
    bits >>>= codeSize
    bitCount -= codeSize

    if (code === clear) {
      codeSize = minCodeSize + 1
      next = end + 1
      previous = -1
      continue
    }
    if (code === end) break

    if (previous === -1) {
      // クリア直後の最初の符号は 1 色そのもの
      if (code >= clear) return out
      out[written++] = code
      previous = code
      first = code
      continue
    }
    // 壊れた符号（まだ作られていない番号）。読めたところまでで止める
    if (code > next) return out

    const incoming = code
    let top = 0
    if (code === next) {
      // まだ辞書にない符号は「1 つ前 + 1 つ前の先頭の色」（KwKwK の場合）
      stack[top++] = first
      code = previous
    }
    while (code >= clear) {
      stack[top++] = suffix[code]
      code = prefix[code]
    }
    first = code
    stack[top++] = first
    while (top > 0 && written < pixelCount) out[written++] = stack[--top]

    if (next < MAX_CODES) {
      prefix[next] = previous
      suffix[next] = first
      next++
      // 辞書が満ちても 12 ビットのまま読み続ける（クリア符号が来るまで足さない「遅延クリア」）
      if (next === 1 << codeSize && codeSize < MAX_BITS) codeSize++
    }
    previous = incoming
  }
  return out
}

/**
 * 色番号の並びを LZW で符号にする。辞書が満ちたらクリア符号を出して作り直す。
 * 辞書の引きは「世代」付きの表にして、クリアのたびに大きな表を消し直さずに済ませる。
 */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize
  const end = clear + 1
  const writer = new BitWriter()

  // 鍵は (前の符号 << 8) | 色。12 ビット × 8 ビットで 2^20 通り
  const table = new Int16Array(1 << 20)
  const stamp = new Uint32Array(1 << 20)
  let generation = 1

  let codeSize = minCodeSize + 1
  let next = end + 1
  writer.write(clear, codeSize)
  if (indices.length === 0) {
    writer.write(end, codeSize)
    return writer.finish()
  }

  let current = indices[0]
  for (let i = 1; i < indices.length; i++) {
    const pixel = indices[i]
    const key = (current << 8) | pixel
    if (stamp[key] === generation) {
      current = table[key]
      continue
    }
    writer.write(current, codeSize)
    if (next < MAX_CODES) {
      table[key] = next
      stamp[key] = generation
      // デコーダは符号を足した直後に幅を広げるので、それに合わせて next が 2^codeSize を超えたら広げる
      if (next === 1 << codeSize && codeSize < MAX_BITS) codeSize++
      next++
    } else {
      writer.write(clear, codeSize)
      generation++
      codeSize = minCodeSize + 1
      next = end + 1
    }
    current = pixel
  }
  writer.write(current, codeSize)
  writer.write(end, codeSize)
  return writer.finish()
}

/** 下位ビットから詰めるビット列の書き手 */
class BitWriter {
  private bytes = new Uint8Array(4096)
  private length = 0
  private bits = 0
  private count = 0

  write(code: number, size: number) {
    this.bits |= code << this.count
    this.count += size
    while (this.count >= 8) {
      this.push(this.bits & 0xff)
      this.bits >>>= 8
      this.count -= 8
    }
  }

  finish(): Uint8Array {
    if (this.count > 0) this.push(this.bits & 0xff)
    this.bits = 0
    this.count = 0
    return this.bytes.slice(0, this.length)
  }

  private push(byte: number) {
    if (this.length === this.bytes.length) {
      const grown = new Uint8Array(this.bytes.length * 2)
      grown.set(this.bytes)
      this.bytes = grown
    }
    this.bytes[this.length++] = byte
  }
}

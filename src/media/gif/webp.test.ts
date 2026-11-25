import { describe, expect, it } from 'vitest'
import { readFixture } from '../../test/nodeFixtures'
import { isAnimatedImage } from './detect'
import { extractWebpImageChunks, muxAnimatedWebp, WebpMuxError } from './webp'

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...bytes.subarray(offset, offset + length))
const u32le = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
const u24le = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)

/** RIFF の中の chunk を上から並べる */
function chunks(bytes: Uint8Array, start = 12, end = bytes.length) {
  const list: { type: string; offset: number; size: number }[] = []
  let pos = start
  while (pos + 8 <= end) {
    const size = u32le(bytes, pos + 4)
    list.push({ type: ascii(bytes, pos, 4), offset: pos + 8, size })
    pos += 8 + size + (size & 1)
  }
  return list
}

describe('muxAnimatedWebp', () => {
  it('wraps still WebP frames into ANMF chunks with durations and loop count', async () => {
    const still = await readFixture('still.webp')
    const out = muxAnimatedWebp(
      [
        { webp: still, duration: 120 },
        { webp: still, duration: 40 },
        { webp: still, duration: 300 },
      ],
      { width: 16, height: 12, plays: 2 }
    )
    expect(ascii(out, 0, 4)).toBe('RIFF')
    expect(u32le(out, 4)).toBe(out.length - 8)
    const list = chunks(out)
    expect(list.map((c) => c.type)).toEqual(['VP8X', 'ANIM', 'ANMF', 'ANMF', 'ANMF'])
    const vp8x = list[0].offset
    expect(out[vp8x] & 0x02).toBe(0x02)
    expect(u24le(out, vp8x + 4) + 1).toBe(16)
    expect(u24le(out, vp8x + 7) + 1).toBe(12)
    expect(out[list[1].offset + 4]).toBe(2)
    const durations = list.slice(2).map((c) => u24le(out, c.offset + 12))
    expect(durations).toEqual([120, 40, 300])
    // ANMF の中に元の画像の chunk がそのまま入っている
    for (const anmf of list.slice(2)) {
      const inner = chunks(out, anmf.offset + 16, anmf.offset + anmf.size)
      expect(inner.some((c) => c.type.startsWith('VP8'))).toBe(true)
    }
    expect(isAnimatedImage(out)).toBe(true)
  })

  it('refuses inputs that are not still WebP', async () => {
    expect(() => extractWebpImageChunks(new Uint8Array(16))).toThrow(WebpMuxError)
    const animated = await readFixture('anim.webp')
    expect(() => extractWebpImageChunks(animated)).toThrow(WebpMuxError)
    expect(() => muxAnimatedWebp([], { width: 1, height: 1, plays: 0 })).toThrow(WebpMuxError)
  })
})

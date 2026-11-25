import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { readFixture } from '../../test/nodeFixtures'
import { apngFrameCount, countGifFrames, isAnimatedImage, sniffAnimatedFormat } from './detect'
import { decodeGif, GifDecodeError } from './gifDecode'
import { delayToCentiseconds, encodeGif } from './gifEncode'
import { lzwDecode, lzwEncode } from './lzw'
import type { GifEncodeOptions } from './types'

const options = (width: number, height: number, extra: Partial<GifEncodeOptions> = {}): GifEncodeOptions => ({
  width,
  height,
  plays: 0,
  colors: 256,
  dither: 'none',
  palette: 'global',
  ...extra,
})

describe('lzw', () => {
  it('round-trips any index stream for every code size', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 8 }).chain((bits) =>
          fc.tuple(fc.constant(bits), fc.array(fc.integer({ min: 0, max: (1 << bits) - 1 }), { maxLength: 6000 }))
        ),
        ([bits, values]) => {
          const indices = Uint8Array.from(values)
          const decoded = lzwDecode(lzwEncode(indices, bits), bits, indices.length)
          expect(Array.from(decoded)).toEqual(values)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('survives dictionary resets on long, varied input', () => {
    const indices = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 2654435761) >>> 24)
    expect(lzwDecode(lzwEncode(indices, 8), 8, indices.length)).toEqual(indices)
  })

  it('stops at truncated data without throwing', () => {
    const indices = Uint8Array.from({ length: 1000 }, (_, i) => i % 7)
    const data = lzwEncode(indices, 3)
    const decoded = lzwDecode(data.subarray(0, 10), 3, indices.length)
    expect(decoded.length).toBe(indices.length)
  })
})

describe('decodeGif', () => {
  it('matches ffmpeg frame by frame (sub-rectangle frames with transparency)', async () => {
    const gif = decodeGif(await readFixture('anim.gif'))
    const reference = await readFixture('anim.rgba')
    expect(gif.width).toBe(16)
    expect(gif.height).toBe(12)
    expect(gif.plays).toBe(0)
    expect(gif.frames).toHaveLength(4)
    const frameBytes = 16 * 12 * 4
    gif.frames.forEach((frame, index) => {
      expect(frame.duration).toBe(100)
      expect(Array.from(frame.rgba)).toEqual(Array.from(reference.subarray(index * frameBytes, (index + 1) * frameBytes)))
    })
  })

  it('reads the loop count as plays (loops + 1)', async () => {
    const gif = decodeGif(await readFixture('anim-loop2.gif'))
    expect(gif.plays).toBe(3)
    expect(gif.frames.map((frame) => frame.duration)).toEqual([200, 200])
  })

  it('rejects non-GIF data and keeps the frames read before a truncation', async () => {
    expect(() => decodeGif(new Uint8Array([1, 2, 3]))).toThrow(GifDecodeError)
    const bytes = await readFixture('anim.gif')
    const truncated = decodeGif(bytes.subarray(0, bytes.length - 40))
    expect(truncated.frames.length).toBeGreaterThanOrEqual(1)
    expect(truncated.frames.length).toBeLessThan(4)
  })
})

describe('detect', () => {
  it('tells animated files from still ones', async () => {
    expect(isAnimatedImage(await readFixture('anim.gif'))).toBe(true)
    expect(isAnimatedImage(await readFixture('still.gif'))).toBe(false)
    expect(isAnimatedImage(await readFixture('anim.apng.png'))).toBe(true)
    expect(isAnimatedImage(await readFixture('still.png'))).toBe(false)
    expect(isAnimatedImage(await readFixture('anim.webp'))).toBe(true)
    expect(isAnimatedImage(await readFixture('still.webp'))).toBe(false)
    expect(isAnimatedImage(new Uint8Array([0xff, 0xd8, 0xff]))).toBe(false)
  })

  it('counts frames and handles a head that ends early', async () => {
    const bytes = await readFixture('anim.gif')
    expect(countGifFrames(bytes)).toEqual({ count: 4, ended: true })
    // 1 枚目の途中で尽きた先頭だけでは決められない。ファイルが続いているならアニメーションに倒す
    expect(isAnimatedImage(bytes.subarray(0, 900), true)).toBe(true)
    expect(isAnimatedImage(bytes.subarray(0, 900), false)).toBe(false)
    expect(apngFrameCount(await readFixture('anim.apng.png'))).toBe(3)
    expect(sniffAnimatedFormat(await readFixture('anim.webp'))).toBe('webp')
  })
})

/** 色が少ない（減色しない）ランダムなフレーム列。透過を混ぜることもある */
const smallAnimation = fc
  .record({
    width: fc.integer({ min: 1, max: 12 }),
    height: fc.integer({ min: 1, max: 12 }),
    colors: fc.array(fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255)), { minLength: 1, maxLength: 6 }),
    transparent: fc.boolean(),
    count: fc.integer({ min: 1, max: 5 }),
    durations: fc.array(fc.integer({ min: 0, max: 5000 }), { minLength: 5, maxLength: 5 }),
    seed: fc.array(fc.nat(1000), { minLength: 1, maxLength: 64 }),
    plays: fc.integer({ min: 0, max: 10 }),
    palette: fc.constantFrom('global' as const, 'local' as const),
  })
  .map(({ width, height, colors, transparent, count, durations, seed, plays, palette }) => {
    const frames = Array.from({ length: count }, (_, f) => {
      const rgba = new Uint8ClampedArray(width * height * 4)
      for (let p = 0; p < width * height; p++) {
        const pick = seed[(p * 7 + f * 13) % seed.length] % (colors.length + (transparent ? 1 : 0))
        if (pick === colors.length) continue // 透明（0, 0, 0, 0）
        const [r, g, b] = colors[pick]
        rgba.set([r, g, b, 255], p * 4)
      }
      return { rgba, duration: durations[f] }
    })
    return { width, height, frames, plays, palette }
  })

describe('encodeGif', () => {
  it('round-trips exactly when the colors fit the palette', () => {
    fc.assert(
      fc.property(smallAnimation, ({ width, height, frames, plays, palette }) => {
        const encoded = encodeGif(frames, options(width, height, { plays, palette }))
        const decoded = decodeGif(encoded)
        expect(decoded.width).toBe(width)
        expect(decoded.height).toBe(height)
        expect(decoded.plays).toBe(plays)
        expect(decoded.frames).toHaveLength(frames.length)
        decoded.frames.forEach((frame, i) => {
          expect(frame.duration).toBe(delayToCentiseconds(frames[i].duration) * 10)
          expect(Array.from(frame.rgba)).toEqual(Array.from(frames[i].rgba))
        })
      }),
      { numRuns: 150 }
    )
  })

  it('keeps the frame count and size when it has to reduce colors', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 2, max: 32 }),
        fc.constantFrom('none' as const, 'floydSteinberg' as const, 'ordered' as const),
        fc.constantFrom('global' as const, 'local' as const),
        (colors, dither, palette) => {
          const width = 20
          const height = 10
          const frames = [0, 1, 2].map((f) => {
            const rgba = new Uint8ClampedArray(width * height * 4)
            for (let p = 0; p < width * height; p++) rgba.set([(p * 37 + f * 11) % 256, (p * 91) % 256, (p * 13 + f) % 256, 255], p * 4)
            return { rgba, duration: 50 }
          })
          const decoded = decodeGif(encodeGif(frames, options(width, height, { colors, dither, palette })))
          expect(decoded.frames).toHaveLength(3)
          for (const frame of decoded.frames) {
            const unique = new Set<number>()
            for (let i = 0; i < frame.rgba.length; i += 4) unique.add((frame.rgba[i] << 16) | (frame.rgba[i + 1] << 8) | frame.rgba[i + 2])
            expect(unique.size).toBeLessThanOrEqual(colors)
          }
        }
      ),
      { numRuns: 40 }
    )
  })

  it('writes only the changed rectangle for later frames', () => {
    const width = 64
    const height = 64
    const base = new Uint8ClampedArray(width * height * 4).fill(255)
    const changed = base.slice()
    changed.set([255, 0, 0, 255], (10 * width + 10) * 4)
    const full = encodeGif([{ rgba: base, duration: 100 }], options(width, height))
    const two = encodeGif(
      [
        { rgba: base, duration: 100 },
        { rgba: changed, duration: 100 },
        { rgba: changed, duration: 100 },
      ],
      options(width, height)
    )
    // 2 枚目以降は 1 画素ぶんの矩形なので、全面を 3 回書くよりずっと小さい
    expect(two.length).toBeLessThan(full.length + 120)
    const decoded = decodeGif(two)
    expect(Array.from(decoded.frames[2].rgba)).toEqual(Array.from(changed))
  })

  it('omits the loop extension for a single play', () => {
    const rgba = new Uint8ClampedArray(4).fill(255)
    const once = encodeGif([{ rgba, duration: 100 }], options(1, 1, { plays: 1 }))
    expect(new TextDecoder().decode(once).includes('NETSCAPE')).toBe(false)
    expect(decodeGif(once).plays).toBe(1)
  })
})

import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { clampQuality, defaultImageFormat, outputImageFilename, searchQualityForTarget } from './output'
import serviceLimits from '../../serviceLimits.json'

/** 品質 → バイト数の表を持つ偽のエンコーダ。呼ばれた品質も記録する */
function fakeEncoder(sizeOf: (quality: number) => number) {
  const calls: number[] = []
  const encode = async (quality: number) => {
    calls.push(quality)
    return { encoded: `q${quality}`, size: sizeOf(quality) }
  }
  return { encode, calls }
}

/** 品質に対して単調に増えるサイズ表（index 0 が品質 1） */
const monotonicSizes = fc
  .array(fc.integer({ min: 0, max: 5000 }), { minLength: 100, maxLength: 100 })
  .map((steps) => steps.reduce<number[]>((acc, step) => [...acc, (acc.at(-1) ?? 0) + step], []))

const qualityRange = fc
  .tuple(fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1, max: 100 }))
  .map(([a, b]) => ({ minQuality: Math.min(a, b), maxQuality: Math.max(a, b) }))

const maxAttempts = (min: number, max: number) => 2 + Math.ceil(Math.log2(max - min + 1))

describe('searchQualityForTarget', () => {
  test('サイズが単調なら、目標に収まる最も高い品質をちょうど見つける', async () => {
    await fc.assert(
      fc.asyncProperty(monotonicSizes, qualityRange, fc.integer({ min: 0, max: 600_000 }), async (sizes, range, target) => {
        const { encode, calls } = fakeEncoder((q) => sizes[q - 1])
        const result = await searchQualityForTarget(encode, target, range)
        const fitting = [...Array(range.maxQuality - range.minQuality + 1).keys()]
          .map((i) => range.minQuality + i)
          .filter((q) => sizes[q - 1] <= target)
        if (fitting.length === 0) {
          expect(result).toMatchObject({ fits: false, quality: range.minQuality })
        } else {
          expect(result).toMatchObject({ fits: true, quality: Math.max(...fitting) })
        }
        expect(result.size).toBe(sizes[result.quality - 1])
        expect(result.encoded).toBe(`q${result.quality}`)
        expect(result.attempts).toBe(calls.length)
        expect(calls.length).toBeLessThanOrEqual(maxAttempts(range.minQuality, range.maxQuality))
      })
    )
  })

  test('サイズが単調でなくても、収まったと言うなら本当に収まっていて、範囲外の品質は試さない', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 100, maxLength: 100 }),
        qualityRange,
        fc.integer({ min: 0, max: 1000 }),
        async (sizes, range, target) => {
          const { encode, calls } = fakeEncoder((q) => sizes[q - 1])
          const result = await searchQualityForTarget(encode, target, range)
          if (result.fits) expect(result.size).toBeLessThanOrEqual(target)
          // 最低品質で収まるなら、必ず収まる結果を返す
          if (sizes[range.minQuality - 1] <= target) expect(result.fits).toBe(true)
          for (const q of calls) {
            expect(q).toBeGreaterThanOrEqual(range.minQuality)
            expect(q).toBeLessThanOrEqual(range.maxQuality)
          }
          expect(calls.length).toBeLessThanOrEqual(maxAttempts(range.minQuality, range.maxQuality))
        }
      )
    )
  })

  test('最高品質で収まれば 1 回のエンコードで終わる', async () => {
    const { encode, calls } = fakeEncoder(() => 10)
    expect(await searchQualityForTarget(encode, 10, { maxQuality: 85 })).toMatchObject({ quality: 85, fits: true })
    expect(calls).toEqual([85])
  })

  test('サービス別の上限をそのまま目標に使える', async () => {
    const discord = serviceLimits.services.find((s) => s.name === 'Discord')!.limits[0].maxSize
    // 品質 1 あたり 300KB 増える画像なら、20MB に収まるのは品質 68 まで
    const { encode } = fakeEncoder((q) => q * 300 * 1024)
    expect(await searchQualityForTarget(encode, discord)).toMatchObject({ quality: 68, fits: true })
  })

  test('中断されたら次のエンコードの前に止まる', async () => {
    const controller = new AbortController()
    const { encode, calls } = fakeEncoder((q) => {
      controller.abort()
      return q
    })
    await expect(searchQualityForTarget(encode, 0, { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    })
    expect(calls).toHaveLength(1)
  })
})

describe('clampQuality', () => {
  test('1〜100 の整数に収め、読めない値は既定値にする', () => {
    fc.assert(
      fc.property(fc.double(), (q) => {
        const clamped = clampQuality(q)
        expect(Number.isInteger(clamped)).toBe(true)
        expect(clamped).toBeGreaterThanOrEqual(1)
        expect(clamped).toBeLessThanOrEqual(100)
      })
    )
    expect(clampQuality(NaN)).toBe(85)
  })
})

describe('outputImageFilename', () => {
  test('拡張子を形式に合わせて付け替え、なければ足す', () => {
    expect(outputImageFilename('photo.HEIC', 'jpeg')).toBe('photo.jpg')
    expect(outputImageFilename('archive.tar.png', 'webp')).toBe('archive.tar.webp')
    expect(outputImageFilename('noext', 'png')).toBe('noext.png')
    expect(outputImageFilename('.png', 'avif')).toBe('image.avif')
  })
})

describe('defaultImageFormat', () => {
  test('元と同じ形式を書き出せるならそれにする', () => {
    expect(defaultImageFormat('image/png', ['png', 'jpeg', 'webp'])).toBe('png')
    expect(defaultImageFormat('image/jpeg', ['png', 'jpeg', 'webp'])).toBe('jpeg')
    expect(defaultImageFormat('image/WEBP', ['png', 'jpeg', 'webp'])).toBe('webp')
  })

  test('書き出せない形式は PNG にする', () => {
    expect(defaultImageFormat('image/gif', ['png', 'jpeg', 'webp'])).toBe('png')
    expect(defaultImageFormat('image/avif', ['png', 'jpeg', 'webp'])).toBe('png')
    expect(defaultImageFormat('image/avif', ['png', 'avif'])).toBe('avif')
  })
})

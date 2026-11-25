import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  MIN_TARGET_VIDEO_BITRATE,
  TARGET_AUDIO_BITRATE,
  TARGET_SIZE_MARGIN,
  bitrateForTargetSize,
  resolveMaxShortSide,
  targetSizeEstimate,
  usesTargetSize,
  videoBitrate,
  videoOutputSize,
} from './output'

const size = fc.record({ width: fc.integer({ min: 2, max: 4000 }), height: fc.integer({ min: 2, max: 4000 }) })

describe('bitrateForTargetSize', () => {
  test('音声を足しても目標の余裕の内に収まる（下限に当たらない限り）', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 2_000_000_000 }),
        fc.double({ min: 0.5, max: 7200, noNaN: true }),
        fc.constantFrom(0, TARGET_AUDIO_BITRATE),
        (target, duration, audio) => {
          const video = bitrateForTargetSize(target, duration, audio)!
          expect(video).toBeGreaterThanOrEqual(MIN_TARGET_VIDEO_BITRATE)
          if (video > MIN_TARGET_VIDEO_BITRATE) {
            expect(((video + audio) * duration) / 8).toBeLessThanOrEqual(target * TARGET_SIZE_MARGIN + 1)
          }
        }
      )
    )
  })

  test('20 MB・60 秒なら映像は約 2.4 Mbps', () => {
    const bitrate = bitrateForTargetSize(20 * 1024 * 1024, 60, TARGET_AUDIO_BITRATE)!
    expect(bitrate).toBeGreaterThan(2_300_000)
    expect(bitrate).toBeLessThan(2_500_000)
  })

  test('長さか目標が正でなければ null', () => {
    expect(bitrateForTargetSize(0, 10)).toBeNull()
    expect(bitrateForTargetSize(1000, 0)).toBeNull()
    expect(bitrateForTargetSize(1000, Number.NaN)).toBeNull()
    expect(bitrateForTargetSize(Number.POSITIVE_INFINITY, 10)).toBeNull()
  })
})

describe('videoBitrate と目標サイズ', () => {
  const output = { format: 'mp4' as const, quality: 80, targetSize: 20 * 1024 * 1024 }

  test('画質のビットレートを上限にする', () => {
    // 短い動画では目標に余裕があるので画質どおり
    expect(videoBitrate(output, 5)).toBe(videoBitrate({ quality: 80 }))
    // 長い動画では目標のほうが低い
    expect(videoBitrate(output, 600)).toBe(bitrateForTargetSize(output.targetSize, 600, TARGET_AUDIO_BITRATE))
    expect(videoBitrate(output, 600, false)).toBe(bitrateForTargetSize(output.targetSize, 600, 0))
    // 長さがわからなければ画質どおり
    expect(videoBitrate(output)).toBe(videoBitrate({ quality: 80 }))
  })

  test('GIF では目標サイズを使わない', () => {
    expect(usesTargetSize(output)).toBe(true)
    expect(usesTargetSize({ ...output, format: 'gif' })).toBe(false)
    expect(usesTargetSize({ format: 'mp4' })).toBe(false)
  })
})

describe('targetSizeEstimate', () => {
  const output = { format: 'mp4' as const, quality: 80, targetSize: 20 * 1024 * 1024 }

  test('目標のビットレートが効くときは目標以下を見込む', () => {
    fc.assert(
      fc.property(fc.double({ min: 60, max: 600, noNaN: true }), fc.boolean(), (duration, audio) => {
        const estimate = targetSizeEstimate(output, duration, audio)
        expect(estimate).not.toBeNull()
        expect(estimate!).toBeLessThanOrEqual(output.targetSize)
      })
    )
  })

  test('画質のほうが低い短い動画や、目標がなければ null（試しにエンコードする）', () => {
    expect(targetSizeEstimate(output, 5, true)).toBeNull()
    expect(targetSizeEstimate({ format: 'mp4', quality: 80 }, 600, true)).toBeNull()
    expect(targetSizeEstimate({ ...output, format: 'gif' }, 600, true)).toBeNull()
  })
})

describe('resolveMaxShortSide', () => {
  const output = { format: 'mp4' as const, quality: 80, maxShortSide: 720 }

  test('短い辺を上限に揃え、小さい映像や寸法の指定があるときは触らない', () => {
    expect(resolveMaxShortSide(output, { width: 1920, height: 1080 })).toEqual({ format: 'mp4', quality: 80, height: 720 })
    expect(resolveMaxShortSide(output, { width: 1080, height: 1920 })).toEqual({ format: 'mp4', quality: 80, width: 720 })
    expect(resolveMaxShortSide(output, { width: 640, height: 360 })).toEqual({ format: 'mp4', quality: 80 })
    expect(resolveMaxShortSide({ ...output, width: 300 }, { width: 1920, height: 1080 })).toEqual({
      format: 'mp4',
      quality: 80,
      width: 300,
    })
  })

  test('videoOutputSize は上限を直したものと同じ寸法になる', () => {
    fc.assert(
      fc.property(size, fc.integer({ min: 2, max: 4000 }), (edited, cap) => {
        const capped = { ...output, maxShortSide: cap }
        expect(videoOutputSize(edited, capped)).toEqual(videoOutputSize(edited, resolveMaxShortSide(capped, edited)))
      })
    )
  })
})

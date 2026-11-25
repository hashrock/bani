import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  applyResolutionPreset,
  computeFrameDrawPlan,
  isResolutionPresetActive,
  resolutionPresetsFor,
  videoBitrate,
  videoFilename,
  videoOutputSize,
  DEFAULT_VIDEO_OUTPUT,
  MAX_VIDEO_BITRATE,
} from './output'
import { applyVideoEdit, createVideoRecipe, editedSize } from './recipe'
import type { VideoEdit, VideoInfo, VideoRotation } from './types'

const size = fc.record({ width: fc.integer({ min: 2, max: 4000 }), height: fc.integer({ min: 2, max: 4000 }) })
const side = fc.option(fc.integer({ min: 1, max: 4000 }), { nil: undefined })

describe('videoOutputSize', () => {
  test('寸法を指定した辺は 2 の倍数になり、指定がなければ元のまま', () => {
    fc.assert(
      fc.property(size, side, side, (edited, width, height) => {
        const out = videoOutputSize(edited, { width, height })
        if (width === undefined && height === undefined) {
          expect(out).toEqual(edited)
          return
        }
        expect(out.width % 2).toBe(0)
        expect(out.height % 2).toBe(0)
        expect(out.width).toBeGreaterThanOrEqual(2)
        expect(out.height).toBeGreaterThanOrEqual(2)
      })
    )
  })

  test('片方だけを指定したときは縦横比をほぼ保つ', () => {
    fc.assert(
      fc.property(size, fc.integer({ min: 64, max: 4000 }), (edited, height) => {
        const out = videoOutputSize(edited, { height })
        const expected = (out.height * edited.width) / edited.height
        // 2 の倍数への切り上げと四捨五入で最大 2px ずれる
        expect(Math.abs(out.width - Math.max(2, expected))).toBeLessThanOrEqual(2.5)
      })
    )
  })
})

describe('解像度のプリセット', () => {
  test('当てたプリセットはそのまま選ばれた状態になり、短い辺がプリセットの値になる', () => {
    fc.assert(
      fc.property(size, (edited) => {
        for (const preset of resolutionPresetsFor(edited)) {
          const output = applyResolutionPreset(DEFAULT_VIDEO_OUTPUT, edited, preset)
          expect(isResolutionPresetActive(output, edited, preset)).toBe(true)
          const out = videoOutputSize(edited, output)
          expect(Math.min(out.width, out.height)).toBe(preset)
        }
      })
    )
  })

  test('元より大きくなるプリセットは出さない', () => {
    fc.assert(
      fc.property(size, (edited) => {
        for (const preset of resolutionPresetsFor(edited)) {
          expect(preset).toBeLessThan(Math.min(edited.width, edited.height))
        }
      })
    )
  })
})

describe('computeFrameDrawPlan', () => {
  const info = (width: number, height: number): VideoInfo => ({
    duration: 10,
    dimensions: { width, height },
    videoCodec: null,
    audioCodec: null,
    tags: null,
  })

  test('拡大縮小しないときの Canvas は切り抜き・回転後の寸法と同じで、描画寸法は回転前の向き', () => {
    fc.assert(
      fc.property(
        size,
        fc.constantFrom<VideoRotation>(0, 90, 180, 270),
        fc.boolean(),
        fc.boolean(),
        fc.record({ x: fc.nat(4000), y: fc.nat(4000), width: fc.nat(4000), height: fc.nat(4000) }),
        ({ width, height }, rotation, flipH, flipV, rect) => {
          const meta = info(width, height)
          const turns = rotation / 90
          const edits: VideoEdit[] = [{ type: 'crop', rect }, { type: 'rotate', turns }]
          if (flipH) edits.push({ type: 'flipH' })
          if (flipV) edits.push({ type: 'flipV' })
          const recipe = edits.reduce((r, e) => applyVideoEdit(r, e, meta), createVideoRecipe(meta))
          const plan = computeFrameDrawPlan(meta, recipe, null)!
          expect({ width: plan.canvasWidth, height: plan.canvasHeight }).toEqual(editedSize(meta, recipe))
          const quarter = plan.rotation % 180 !== 0
          expect(quarter ? plan.drawHeight : plan.drawWidth).toBe(plan.canvasWidth)
          expect(plan.scaleX).toBe(flipH ? -1 : 1)
          expect(plan.scaleY).toBe(flipV ? -1 : 1)
        }
      )
    )
  })

  test('両方の辺を指定したときは枠に収め、はみ出さない', () => {
    fc.assert(
      fc.property(size, fc.integer({ min: 2, max: 2000 }), fc.integer({ min: 2, max: 2000 }), (s, width, height) => {
        const meta = info(s.width, s.height)
        const plan = computeFrameDrawPlan(meta, createVideoRecipe(meta), { width, height })!
        expect(plan.drawWidth).toBeLessThanOrEqual(plan.canvasWidth)
        expect(plan.drawHeight).toBeLessThanOrEqual(plan.canvasHeight)
      })
    )
  })

  test('映像がなければ描けない', () => {
    const meta = { ...info(10, 10), dimensions: null }
    expect(computeFrameDrawPlan(meta, createVideoRecipe(meta), null)).toBeNull()
  })
})

describe('videoBitrate / videoFilename', () => {
  test('ビットレートは 0 より大きく上限を超えない', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: false }), (quality) => {
        const bitrate = videoBitrate({ quality })
        expect(bitrate).toBeGreaterThan(0)
        expect(bitrate).toBeLessThanOrEqual(MAX_VIDEO_BITRATE)
      })
    )
  })

  test('拡張子を形式のものに付け替える', () => {
    expect(videoFilename('clip.mov', 'mp4')).toBe('clip.mp4')
    expect(videoFilename('clip.mp4', 'gif')).toBe('clip.gif')
  })
})

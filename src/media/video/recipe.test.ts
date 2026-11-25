import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { MIN_RANGE } from '../../state/trim'
import {
  MAX_SUBTITLE_OFFSET,
  MIN_CROP_SIZE,
  applyVideoEdit,
  clampCrop,
  createVideoRecipe,
  editedSize,
  encodeTrim,
  isIdentityRecipe,
  restoreVideoRecipe,
  rotatedCrop,
} from './recipe'
import { MAX_VIDEO_SPEED, MIN_VIDEO_SPEED } from './timing'
import type { VideoEdit, VideoInfo, VideoRecipe } from './types'

const infoWith = (duration: number, width: number | null, height = width): VideoInfo => ({
  duration,
  dimensions: width === null || height === null ? null : { width, height },
  videoCodec: 'avc',
  audioCodec: 'aac',
  tags: null,
})

/** 画面から来うる値に加えて、範囲外・非有限の値も混ぜる */
const wildNumber = fc.oneof(
  { weight: 8, arbitrary: fc.double({ min: -500, max: 5000, noNaN: true }) },
  { weight: 1, arbitrary: fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY) }
)

const videoEdit: fc.Arbitrary<VideoEdit> = fc.oneof(
  wildNumber.map((time) => ({ type: 'trim', action: { type: 'setStart', time } }) as const),
  wildNumber.map((time) => ({ type: 'trim', action: { type: 'setEnd', time } }) as const),
  fc.constant({ type: 'trim', action: { type: 'wholeClip' } } as const),
  fc
    .tuple(wildNumber, wildNumber, wildNumber, wildNumber)
    .map(([x, y, width, height]) => ({ type: 'crop', rect: { x, y, width, height } }) as const),
  fc.constant({ type: 'crop', rect: null } as const),
  fc.oneof(fc.integer({ min: -9, max: 9 }), wildNumber).map((turns) => ({ type: 'rotate', turns }) as const),
  fc.constant({ type: 'flipH' } as const),
  fc.constant({ type: 'flipV' } as const),
  fc.boolean().map((muted) => ({ type: 'mute', muted }) as const),
  wildNumber.map((speed) => ({ type: 'speed', speed }) as const),
  fc.boolean().map((preserve) => ({ type: 'preservePitch', preserve }) as const),
  fc
    .array(
      fc.tuple(wildNumber, wildNumber, fc.string({ maxLength: 6 })).map(([start, end, text]) => ({ start, end, text })),
      { maxLength: 6 }
    )
    .map((cues) => ({ type: 'subtitles', subtitles: { name: 'a.srt', cues } }) as const),
  fc.constant({ type: 'subtitles', subtitles: null } as const),
  fc.oneof(wildNumber, fc.double({ min: -1e8, max: 1e8, noNaN: true })).map((offset) => ({ type: 'subtitleOffset', offset }) as const),
  fc.constantFrom('embed', 'burn').map((mode) => ({ type: 'subtitleMode', mode }) as const),
  fc.constant({ type: 'reset' } as const)
)

const edits = fc.array(videoEdit, { maxLength: 25 })

/** ふつうの動画（尺が区間を詰められる長さで、寸法がある）。奇数の寸法も混ぜる */
const videoInfo = fc
  .tuple(
    fc.double({ min: MIN_RANGE, max: 1e4, noNaN: true }),
    fc.integer({ min: 1, max: 4000 }),
    fc.integer({ min: 1, max: 4000 })
  )
  .map(([duration, width, height]) => infoWith(duration, width, height))

const replay = (info: VideoInfo, list: VideoEdit[]): VideoRecipe =>
  list.reduce((recipe, edit) => applyVideoEdit(recipe, edit, info), createVideoRecipe(info))

const EPSILON = 1e-6

describe('applyVideoEdit', () => {
  test('どんな編集列をたどっても、区間・切り抜き・回転は不変条件を保つ', () => {
    fc.assert(
      fc.property(videoInfo, edits, (info, list) => {
        const recipe = replay(info, list)
        expect(recipe.trim.start).toBeGreaterThanOrEqual(0)
        expect(recipe.trim.end).toBeLessThanOrEqual(info.duration)
        expect(recipe.trim.end - recipe.trim.start).toBeGreaterThanOrEqual(MIN_RANGE - EPSILON)
        expect([0, 90, 180, 270]).toContain(recipe.rotation)

        const { width, height } = info.dimensions!
        if (recipe.crop) {
          const { x, y, width: w, height: h } = recipe.crop
          for (const value of [x, y, w, h]) {
            expect(Number.isInteger(value)).toBe(true)
            expect(value % 2).toBe(0)
          }
          expect(x).toBeGreaterThanOrEqual(0)
          expect(y).toBeGreaterThanOrEqual(0)
          expect(x + w).toBeLessThanOrEqual(width)
          expect(y + h).toBeLessThanOrEqual(height)
          expect(w).toBeGreaterThanOrEqual(Math.min(MIN_CROP_SIZE, Math.floor(width / 2) * 2))
          expect(h).toBeGreaterThanOrEqual(Math.min(MIN_CROP_SIZE, Math.floor(height / 2) * 2))
        }
      })
    )
  })

  test('尺や寸法が壊れていても NaN を持ち込まない', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, -1, 0, MIN_RANGE / 2),
        fc.option(fc.integer({ min: 0, max: 3 }), { nil: null }),
        edits,
        (duration, size, list) => {
          const recipe = replay(infoWith(duration, size), list)
          for (const value of [recipe.trim.start, recipe.trim.end]) {
            expect(Number.isFinite(value)).toBe(true)
          }
          if (recipe.crop) {
            for (const value of Object.values(recipe.crop)) expect(Number.isFinite(value)).toBe(true)
          }
        }
      )
    )
  })

  test('値の変わらない編集は同じオブジェクトを返す（履歴に空の段を積まない）', () => {
    fc.assert(
      fc.property(videoInfo, edits, videoEdit, (info, list, edit) => {
        const recipe = replay(info, list)
        const once = applyVideoEdit(recipe, edit, info)
        // 反転と回転は切り替えなので 2 回目で戻る。それ以外は 2 回当てても 1 回と同じ
        if (edit.type === 'flipH' || edit.type === 'flipV' || edit.type === 'rotate') return
        expect(applyVideoEdit(once, edit, info)).toBe(once)
      })
    )
  })

  test('見た目で時計回り 4 回、または同じ向きの反転 2 回で元に戻る', () => {
    fc.assert(
      fc.property(videoInfo, edits, (info, list) => {
        const recipe = replay(info, list)
        const rotate = { type: 'rotate', turns: 1 } as const
        const rotated = [rotate, rotate, rotate, rotate].reduce((r, e) => applyVideoEdit(r, e, info), recipe)
        expect(rotated).toEqual(recipe)
        const flipped = applyVideoEdit(applyVideoEdit(recipe, { type: 'flipH' }, info), { type: 'flipH' }, info)
        expect(flipped).toEqual(recipe)
      })
    )
  })

  test('時計回りと反時計回りは打ち消し合う（反転していても）', () => {
    fc.assert(
      fc.property(videoInfo, edits, fc.integer({ min: -7, max: 7 }), (info, list, turns) => {
        const recipe = replay(info, list)
        const there = applyVideoEdit(recipe, { type: 'rotate', turns }, info)
        expect(applyVideoEdit(there, { type: 'rotate', turns: -turns }, info)).toEqual(recipe)
      })
    )
  })

  test('左右反転してから時計回りは、反時計回りしてから左右反転と同じ見た目になる', () => {
    fc.assert(
      fc.property(videoInfo, edits, (info, list) => {
        const recipe = replay(info, list)
        const a = applyVideoEdit(applyVideoEdit(recipe, { type: 'flipH' }, info), { type: 'rotate', turns: 1 }, info)
        const b = applyVideoEdit(applyVideoEdit(recipe, { type: 'rotate', turns: -1 }, info), { type: 'flipH' }, info)
        expect(a).toEqual(b)
      })
    )
  })

  test('reset は初期のレシピに戻り、無加工とみなされる', () => {
    fc.assert(
      fc.property(videoInfo, edits, (info, list) => {
        const recipe = applyVideoEdit(replay(info, list), { type: 'reset' }, info)
        expect(recipe).toEqual(createVideoRecipe(info))
        expect(isIdentityRecipe(recipe, info)).toBe(true)
      })
    )
  })

  test('切り抜きは回転や反転をしても変わらない（元の向きの座標で持つ）', () => {
    fc.assert(
      fc.property(videoInfo, edits, fc.constantFrom<VideoEdit>({ type: 'rotate', turns: 1 }, { type: 'flipH' }, { type: 'flipV' }), (info, list, edit) => {
        const recipe = replay(info, list)
        expect(applyVideoEdit(recipe, edit, info).crop).toBe(recipe.crop)
      })
    )
  })
})

describe('clampCrop', () => {
  test('映像全体を覆う範囲は切り抜きなし（null）になる', () => {
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 4000 }), fc.integer({ min: 2, max: 4000 }), fc.nat(10), (width, height, extra) => {
        expect(clampCrop({ x: -extra, y: -extra, width: width + 2 * extra, height: height + 2 * extra }, { width, height })).toBeNull()
      })
    )
  })

  test('負の幅・高さは向きを直して扱う', () => {
    expect(clampCrop({ x: 100, y: 80, width: -50, height: -40 }, { width: 640, height: 360 })).toEqual({
      x: 50,
      y: 40,
      width: 50,
      height: 40,
    })
  })
})

describe('editedSize / rotatedCrop', () => {
  test('回転後の寸法は、90/270 度なら切り抜きの幅と高さが入れ替わる', () => {
    fc.assert(
      fc.property(videoInfo, edits, (info, list) => {
        const recipe = replay(info, list)
        const size = editedSize(info, recipe)!
        const crop = recipe.crop ?? { x: 0, y: 0, ...info.dimensions! }
        const quarter = recipe.rotation % 180 !== 0
        expect(size).toEqual(
          quarter ? { width: crop.height, height: crop.width } : { width: crop.width, height: crop.height }
        )
      })
    )
  })

  test('mediabunny に渡す範囲は回転後の映像の内側に収まり、四隅を回転したものと一致する', () => {
    fc.assert(
      fc.property(videoInfo, edits, (info, list) => {
        const recipe = replay(info, list)
        const size = info.dimensions!
        const crop = rotatedCrop(recipe, size)
        if (!recipe.crop) {
          expect(crop).toBeNull()
          return
        }
        const quarter = recipe.rotation % 180 !== 0
        const rotatedWidth = quarter ? size.height : size.width
        const rotatedHeight = quarter ? size.width : size.height
        expect(crop!.left).toBeGreaterThanOrEqual(0)
        expect(crop!.top).toBeGreaterThanOrEqual(0)
        expect(crop!.left + crop!.width).toBeLessThanOrEqual(rotatedWidth)
        expect(crop!.top + crop!.height).toBeLessThanOrEqual(rotatedHeight)
        expect({ width: crop!.width, height: crop!.height }).toEqual(editedSize(info, recipe))

        // 元の座標の点を時計回りに回したときの写り先（画素の左上の角で考える）
        const turn = (px: number, py: number): [number, number] => {
          switch (recipe.rotation) {
            case 0:
              return [px, py]
            case 90:
              return [size.height - py, px]
            case 180:
              return [size.width - px, size.height - py]
            case 270:
              return [py, size.width - px]
          }
        }
        const { x, y, width, height } = recipe.crop
        const corners = [turn(x, y), turn(x + width, y), turn(x, y + height), turn(x + width, y + height)]
        expect(Math.min(...corners.map(([cx]) => cx))).toBe(crop!.left)
        expect(Math.min(...corners.map(([, cy]) => cy))).toBe(crop!.top)
      })
    )
  })
})

describe('encodeTrim', () => {
  test('全体を指すなら null、そうでなければレシピの区間をそのまま返す', () => {
    fc.assert(
      fc.property(videoInfo, edits, (info, list) => {
        const recipe = replay(info, list)
        const trim = encodeTrim(recipe, info)
        if (trim === null) {
          expect(recipe.trim.start).toBe(0)
          expect(recipe.trim.end).toBeGreaterThanOrEqual(info.duration)
        } else {
          expect(trim).toEqual(recipe.trim)
        }
      })
    )
  })
})

describe('速さと字幕', () => {
  test('どんな編集列をたどっても、速さは範囲の中、字幕は整数の時刻で長さが正、ずらしは上限の中', () => {
    fc.assert(
      fc.property(videoInfo, edits, (info, list) => {
        const recipe = replay(info, list)
        expect(recipe.speed).toBeGreaterThanOrEqual(MIN_VIDEO_SPEED)
        expect(recipe.speed).toBeLessThanOrEqual(MAX_VIDEO_SPEED)
        if (recipe.subtitles) {
          expect(Number.isInteger(recipe.subtitles.offset)).toBe(true)
          expect(Math.abs(recipe.subtitles.offset)).toBeLessThanOrEqual(MAX_SUBTITLE_OFFSET)
          recipe.subtitles.cues.forEach((cue, i) => {
            expect(Number.isInteger(cue.start) && Number.isInteger(cue.end)).toBe(true)
            expect(cue.end).toBeGreaterThan(cue.start)
            if (i > 0) expect(cue.start).toBeGreaterThanOrEqual(recipe.subtitles!.cues[i - 1].start)
          })
        }
      })
    )
  })

  test('字幕を入れ替えるとずらしは 0 に戻り、入れ方は引き継ぐ', () => {
    const info = infoWith(10, 640, 360)
    const cues = [{ start: 0, end: 1000, text: 'a' }]
    const steps: VideoEdit[] = [
      { type: 'subtitles', subtitles: { name: 'a.srt', cues } },
      { type: 'subtitleOffset', offset: 1500 },
      { type: 'subtitleMode', mode: 'embed' },
      { type: 'subtitles', subtitles: { name: 'b.vtt', cues } },
    ]
    const recipe = replay(info, steps)
    expect(recipe.subtitles).toEqual({ name: 'b.vtt', cues, offset: 0, mode: 'embed' })
    // 字幕がないうちのずらし・入れ方は無視する
    expect(replay(info, [{ type: 'subtitleOffset', offset: 10 }])).toEqual(createVideoRecipe(info))
  })

  test('速さか字幕があれば無加工ではない', () => {
    const info = infoWith(10, 640, 360)
    expect(isIdentityRecipe(replay(info, [{ type: 'speed', speed: 2 }]), info)).toBe(false)
    expect(isIdentityRecipe(replay(info, [{ type: 'speed', speed: 2 }, { type: 'speed', speed: 1 }]), info)).toBe(true)
    expect(
      isIdentityRecipe(replay(info, [{ type: 'subtitles', subtitles: { name: 'a', cues: [] } }]), info)
    ).toBe(false)
  })
})

describe('restoreVideoRecipe', () => {
  test('いまのレシピは JSON を通しても同じものに戻る', () => {
    fc.assert(
      fc.property(videoInfo, edits, (info, list) => {
        const recipe = replay(info, list)
        expect(restoreVideoRecipe(JSON.parse(JSON.stringify(recipe)), info)).toEqual(recipe)
      })
    )
  })

  test('版 1 のレシピ（速さ・字幕がない）は既定値で埋める', () => {
    const info = infoWith(10, 640, 360)
    const v1 = { trim: { start: 1, end: 5 }, crop: null, rotation: 90, flipH: true, flipV: false, muted: true }
    expect(restoreVideoRecipe(v1, info)).toEqual({
      ...createVideoRecipe(info),
      trim: { start: 1, end: 5 },
      rotation: 90,
      flipH: true,
      muted: true,
    })
  })

  test('壊れた値でも不変条件を保ち、形が読めなければ null', () => {
    fc.assert(
      fc.property(videoInfo, fc.anything(), (info, junk) => {
        const recipe = restoreVideoRecipe(junk, info)
        if (recipe === null) return
        expect(recipe.trim.end).toBeLessThanOrEqual(info.duration)
        expect([0, 90, 180, 270]).toContain(recipe.rotation)
      })
    )
    const info = infoWith(10, 640, 360)
    expect(restoreVideoRecipe(null, info)).toBeNull()
    expect(restoreVideoRecipe({ trim: 'x' }, info)).toBeNull()
    expect(
      restoreVideoRecipe({ trim: { start: -5, end: 99 }, speed: 99, subtitles: { cues: [null, { start: 'a' }] } }, info)
    ).toMatchObject({ trim: { start: 0, end: 10 }, speed: 4, subtitles: { cues: [] } })
  })
})

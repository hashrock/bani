import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { createHistory, pushHistory } from '../../core/history'
import {
  MAX_GAIN_DB,
  MIN_GAIN_DB,
  MIN_TRIM_LENGTH,
  applyAudioEdit,
  createAudioRecipe,
  isIdentityRecipe,
  trimmedLength,
} from './recipe'
import {
  audioEdit,
  audioEditSequence,
  audioInfoWith,
  degenerateDuration,
  reachableRecipe,
  trimmableDuration,
} from './testFixtures'
import {
  MAX_SILENCE_DURATION,
  MAX_SILENCE_PADDING,
  MAX_SILENCE_THRESHOLD_DB,
  MIN_SILENCE_DURATION,
  MIN_SILENCE_THRESHOLD_DB,
} from './silence'
import type { AudioRecipe } from './types'

/** 区間の端とフェードの計算に足し引きが入るので、比較には桁落ち分の余裕を持たせる */
const EPSILON = 1e-6

function expectFadesFit(recipe: AudioRecipe) {
  expect(recipe.fadeIn).toBeGreaterThanOrEqual(0)
  expect(recipe.fadeOut).toBeGreaterThanOrEqual(0)
  expect(recipe.fadeIn + recipe.fadeOut).toBeLessThanOrEqual(trimmedLength(recipe) + EPSILON)
}

describe('applyAudioEdit', () => {
  test('どんな編集列でも、区間は尺の中で最短の長さを保ち、フェードは区間に収まり、音量は範囲内', () => {
    fc.assert(
      fc.property(trimmableDuration, audioEditSequence, (duration, edits) => {
        const recipe = reachableRecipe(audioInfoWith(duration), edits)
        expect(recipe.trim.start).toBeGreaterThanOrEqual(0)
        expect(recipe.trim.end).toBeLessThanOrEqual(duration)
        expect(trimmedLength(recipe)).toBeGreaterThanOrEqual(MIN_TRIM_LENGTH - EPSILON)
        expectFadesFit(recipe)
        expect(recipe.gainDb).toBeGreaterThanOrEqual(MIN_GAIN_DB)
        expect(recipe.gainDb).toBeLessThanOrEqual(MAX_GAIN_DB)
        const { silence } = recipe
        expect(silence.thresholdDb).toBeGreaterThanOrEqual(MIN_SILENCE_THRESHOLD_DB)
        expect(silence.thresholdDb).toBeLessThanOrEqual(MAX_SILENCE_THRESHOLD_DB)
        expect(silence.minDuration).toBeGreaterThanOrEqual(MIN_SILENCE_DURATION)
        expect(silence.minDuration).toBeLessThanOrEqual(MAX_SILENCE_DURATION)
        expect(silence.padding).toBeGreaterThanOrEqual(0)
        expect(silence.padding).toBeLessThanOrEqual(MAX_SILENCE_PADDING)
      })
    )
  })

  test('無音カットの切り替えは設定値を変えず、ほかの編集にも触れない', () => {
    fc.assert(
      fc.property(trimmableDuration, audioEditSequence, fc.boolean(), (duration, edits, enabled) => {
        const info = audioInfoWith(duration)
        const before = reachableRecipe(info, edits)
        const after = applyAudioEdit(before, { type: 'setSilence', silence: { enabled } }, info)
        expect(after.silence).toEqual({ ...before.silence, enabled })
        expect({ ...after, silence: null }).toEqual({ ...before, silence: null })
        // 入れたら無加工ではない
        if (enabled) expect(isIdentityRecipe(after, info)).toBe(false)
      })
    )
  })

  test('無音カットの値は範囲内ならそのまま、非有限なら無視される', () => {
    const info = audioInfoWith(10)
    const recipe = createAudioRecipe(info)
    const set = (silence: Parameters<typeof applyAudioEdit>[1] & { type: 'setSilence' }) =>
      applyAudioEdit(recipe, silence, info).silence
    expect(set({ type: 'setSilence', silence: { thresholdDb: -50, minDuration: 1, padding: 0.2 } })).toMatchObject({
      thresholdDb: -50,
      minDuration: 1,
      padding: 0.2,
    })
    expect(applyAudioEdit(recipe, { type: 'setSilence', silence: { thresholdDb: Number.NaN } }, info)).toBe(recipe)
    expect(set({ type: 'setSilence', silence: { thresholdDb: 0, padding: -1 } })).toMatchObject({
      thresholdDb: MAX_SILENCE_THRESHOLD_DB,
      padding: 0,
    })
  })

  test('尺が短すぎる・読めないファイルでも NaN を持ち込まず、区間とフェードは崩れない', () => {
    fc.assert(
      fc.property(degenerateDuration, audioEditSequence, (duration, edits) => {
        const recipe = reachableRecipe(audioInfoWith(duration), edits)
        for (const value of [recipe.trim.start, recipe.trim.end, recipe.fadeIn, recipe.fadeOut, recipe.gainDb]) {
          expect(Number.isFinite(value)).toBe(true)
        }
        expect(recipe.trim.start).toBeGreaterThanOrEqual(0)
        expect(recipe.trim.end).toBeGreaterThanOrEqual(recipe.trim.start)
        expectFadesFit(recipe)
      })
    )
  })

  test('同じ編集をもう一度掛けても何も変わらず、同じオブジェクトが返る（冪等）', () => {
    fc.assert(
      fc.property(trimmableDuration, audioEditSequence, audioEdit, (duration, edits, edit) => {
        const info = audioInfoWith(duration)
        const once = applyAudioEdit(reachableRecipe(info, edits), edit, info)
        expect(applyAudioEdit(once, edit, info)).toBe(once)
      })
    )
  })

  test('非有限の値を渡した編集は無視される', () => {
    const nonFinite = fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY)
    fc.assert(
      fc.property(trimmableDuration, audioEditSequence, nonFinite, (duration, edits, value) => {
        const info = audioInfoWith(duration)
        const before = reachableRecipe(info, edits)
        for (const edit of [
          { type: 'setTrimStart', time: value },
          { type: 'setTrimEnd', time: value },
          { type: 'setFadeIn', seconds: value },
          { type: 'setFadeOut', seconds: value },
          { type: 'setGain', db: value },
        ] as const) {
          expect(applyAudioEdit(before, edit, info)).toBe(before)
        }
      })
    )
  })

  test('「元に戻す」はどの状態からでも初期のレシピになり、それは無加工とみなされる', () => {
    fc.assert(
      fc.property(trimmableDuration, audioEditSequence, (duration, edits) => {
        const info = audioInfoWith(duration)
        const recipe = applyAudioEdit(reachableRecipe(info, edits), { type: 'reset' }, info)
        expect(recipe).toEqual(createAudioRecipe(info))
        expect(isIdentityRecipe(recipe, info)).toBe(true)
      })
    )
  })

  test('フェードの片方を動かしても、もう片方と区間は変わらない', () => {
    fc.assert(
      fc.property(
        trimmableDuration,
        audioEditSequence,
        fc.double({ min: -10, max: 2e4, noNaN: true }),
        fc.boolean(),
        (duration, edits, seconds, isFadeIn) => {
          const info = audioInfoWith(duration)
          const before = reachableRecipe(info, edits)
          const after = applyAudioEdit(
            before,
            isFadeIn ? { type: 'setFadeIn', seconds } : { type: 'setFadeOut', seconds },
            info
          )
          expect(after.trim).toEqual(before.trim)
          expect(isFadeIn ? after.fadeOut : after.fadeIn).toBe(isFadeIn ? before.fadeOut : before.fadeIn)
        }
      )
    )
  })

  test('収まる長さのフェードは指定どおりになる', () => {
    fc.assert(
      fc.property(
        trimmableDuration,
        audioEditSequence,
        fc.double({ min: 0, max: 1, noNaN: true }),
        (duration, edits, ratio) => {
          const info = audioInfoWith(duration)
          const before = reachableRecipe(info, edits)
          const seconds = ratio * (trimmedLength(before) - before.fadeOut)
          expect(applyAudioEdit(before, { type: 'setFadeIn', seconds }, info).fadeIn).toBe(seconds)
        }
      )
    )
  })

  test('区間を動かしてもフェードが伸びることはない', () => {
    fc.assert(
      fc.property(
        trimmableDuration,
        audioEditSequence,
        fc.double({ min: -10, max: 2e4, noNaN: true }),
        fc.boolean(),
        (duration, edits, time, movesStart) => {
          const info = audioInfoWith(duration)
          const before = reachableRecipe(info, edits)
          const after = applyAudioEdit(
            before,
            movesStart ? { type: 'setTrimStart', time } : { type: 'setTrimEnd', time },
            info
          )
          expect(after.fadeIn).toBeLessThanOrEqual(before.fadeIn)
          expect(after.fadeOut).toBeLessThanOrEqual(before.fadeOut)
        }
      )
    )
  })

  test('範囲内の音量はそのまま、範囲外は端に丸められる', () => {
    fc.assert(
      fc.property(trimmableDuration, fc.double({ min: -1e3, max: 1e3, noNaN: true }), (duration, db) => {
        const info = audioInfoWith(duration)
        const recipe = applyAudioEdit(createAudioRecipe(info), { type: 'setGain', db }, info)
        // -0 と 0 は区別しない（toBe は Object.is で比べるので == で見る）
        expect(recipe.gainDb === Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, db))).toBe(true)
      })
    )
  })

  test('値の変わらない編集は履歴に段を積まない', () => {
    fc.assert(
      fc.property(trimmableDuration, audioEditSequence, (duration, edits) => {
        const info = audioInfoWith(duration)
        let history = createHistory(createAudioRecipe(info))
        let changes = 0
        for (const edit of edits) {
          const next = applyAudioEdit(history.present, edit, info)
          if (next !== history.present) changes++
          history = pushHistory(history, next)
        }
        expect(history.past.length).toBe(Math.min(changes, 100))
      })
    )
  })
})

describe('createAudioRecipe', () => {
  test('初期のレシピは入力全体を無加工で指す', () => {
    fc.assert(
      fc.property(trimmableDuration, (duration) => {
        const info = audioInfoWith(duration)
        const recipe = createAudioRecipe(info)
        expect(recipe.trim).toEqual({ start: 0, end: duration })
        expect(isIdentityRecipe(recipe, info)).toBe(true)
      })
    )
  })
})

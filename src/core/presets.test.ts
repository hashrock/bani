import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import serviceLimits from '../serviceLimits.json'
import { videoOutputSize } from '../media/video/output'
import type { VideoOutput } from '../media/video/types'
import {
  BUILT_IN_PRESETS,
  PRESET_SCHEMA_VERSION,
  addPreset,
  applyPresetSettings,
  deletePreset,
  normalizePresetName,
  parseStoredPresets,
  presetName,
  presetsFor,
  renamePreset,
  sameSettings,
  sanitizeAudioSettings,
  sanitizeImageSettings,
  sanitizeVideoSettings,
  serializePresets,
  settingsForSaving,
} from './presets'
import type { Preset } from './presets'

const limit = (service: string, tier: string) =>
  serviceLimits.services.find((s) => s.name === service)!.limits.find((l) => l.tier === tier)!.maxSize

describe('組み込みのプリセット', () => {
  test('Discord（無料）は上限をそのまま目標サイズにした MP4', () => {
    const discord = BUILT_IN_PRESETS.video.find((preset) => preset.id === 'builtin:video:discord:free')!
    expect(discord.settings).toMatchObject({ format: 'mp4', targetSize: limit('Discord', 'Free'), maxShortSide: 720 })
    expect(presetName(discord, 'ja')).toBe('Discord（無料）に収める')
    expect(presetName(discord, 'en')).toBe('Fit Discord (Free)')
  })

  test('画像の組み込みは上限以下を目標にする', () => {
    const image = BUILT_IN_PRESETS.image.find((preset) => preset.id === 'builtin:image:discord:free')!
    expect(image.settings.targetBytes).toBe(limit('Discord', 'Free'))
  })

  test('組み込みはどれも検証を通り、id が重ならない', () => {
    const all: Preset[] = [...BUILT_IN_PRESETS.video, ...BUILT_IN_PRESETS.image, ...BUILT_IN_PRESETS.audio]
    for (const preset of all) {
      expect(preset.builtIn).toBe(true)
      const sanitize = { video: sanitizeVideoSettings, image: sanitizeImageSettings, audio: sanitizeAudioSettings }[
        preset.kind
      ]
      expect(sanitize(preset.settings)).toEqual(preset.settings)
    }
    expect(new Set(all.map((preset) => preset.id)).size).toBe(all.length)
  })

  test('一覧は種類で絞り、組み込みを先に並べる', () => {
    const saved = addPreset([], 'image', '私の', { format: 'png', quality: 85, targetBytes: null }, 'a')
    const video = presetsFor('video', saved)
    expect(video.every((preset) => preset.kind === 'video')).toBe(true)
    const image = presetsFor('image', saved)
    expect(image.at(-1)?.id).toBe('a')
    expect(image.slice(0, -1).every((preset) => preset.builtIn)).toBe(true)
  })
})

describe('保存と読み込み', () => {
  const video: VideoOutput = { format: 'webm', quality: 60, height: 480 }

  test('保存した一覧は読み直しても同じ', () => {
    let list = addPreset([], 'video', '  軽い  WebM ', video, 'v1')
    list = addPreset(list, 'audio', '声', { format: 'mp3', bitrate: 96_000, sampleRate: null }, 'a1')
    const restored = parseStoredPresets(serializePresets(list))
    expect(restored).toEqual(list)
    expect(restored[0].name).toBe('軽い WebM')
  })

  test('壊れたデータ・知らない版では落ちずに空になる', () => {
    for (const raw of [null, '', '{', 'null', '[]', '{"version":99,"presets":[]}', '{"version":1}', '"x"']) {
      expect(parseStoredPresets(raw)).toEqual([])
    }
  })

  test('読めない項目だけを捨てる', () => {
    const raw = JSON.stringify({
      version: PRESET_SCHEMA_VERSION,
      presets: [
        { id: 'ok', kind: 'video', name: 'ok', settings: { format: 'mp4', quality: 500, width: -3 } },
        { id: 'bad-kind', kind: 'pdf', name: 'x', settings: {} },
        { id: 'bad-format', kind: 'image', name: 'x', settings: { format: 'bmp' } },
        { id: '', kind: 'video', name: 'x', settings: { format: 'mp4' } },
        { id: 'builtin:video:x', kind: 'video', name: 'x', settings: { format: 'mp4' } },
        { id: 'no-name', kind: 'video', name: '   ', settings: { format: 'mp4' } },
        { id: 'ok', kind: 'video', name: 'dup', settings: { format: 'mp4' } },
        42,
      ],
    })
    const restored = parseStoredPresets(raw)
    expect(restored.map((preset) => preset.id)).toEqual(['ok'])
    expect(restored[0].settings).toEqual({ format: 'mp4', quality: 100 })
  })

  test('どんな JSON を渡しても例外を投げず、出てくるものは検証済み', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const raw = JSON.stringify({ version: PRESET_SCHEMA_VERSION, presets: [value, { settings: value }] })
        for (const preset of parseStoredPresets(raw)) {
          expect(typeof preset.name).toBe('string')
          expect(preset.builtIn).toBe(false)
        }
        expect(() => parseStoredPresets(JSON.stringify(value))).not.toThrow()
      })
    )
  })

  test('名前の変更・削除は保存したものだけに効く', () => {
    const builtIn = BUILT_IN_PRESETS.video[0]
    let list: Preset[] = [builtIn, ...addPreset([], 'video', 'a', video, 'v1')]
    list = renamePreset(list, 'v1', 'b')
    list = renamePreset(list, builtIn.id, 'hack')
    list = renamePreset(list, 'v1', '   ')
    expect(list.map((preset) => preset.name)).toEqual([builtIn.name, 'b'])
    list = deletePreset(deletePreset(list, builtIn.id), 'v1')
    expect(list).toEqual([builtIn])
    // 組み込みは保存しない
    expect(parseStoredPresets(serializePresets(list))).toEqual([])
  })

  test('空の名前・同じ id では足さない', () => {
    expect(addPreset([], 'video', ' ', video, 'x')).toEqual([])
    const once = addPreset([], 'video', 'a', video, 'x')
    expect(addPreset(once, 'video', 'b', video, 'x')).toEqual(once)
  })

  test('名前は 60 文字で切る', () => {
    expect(normalizePresetName('あ'.repeat(100))).toBe('あ'.repeat(60))
  })
})

describe('当てる・保存する・比べる', () => {
  const discord = BUILT_IN_PRESETS.video[0].settings

  test('寸法がわかれば短い辺の上限を幅・高さに直し、元が小さければ原寸', () => {
    expect(applyPresetSettings('video', discord, { width: 1920, height: 1080 })).toMatchObject({ height: 720 })
    expect(applyPresetSettings('video', discord, { width: 1080, height: 1920 })).toMatchObject({ width: 720 })
    const small = applyPresetSettings('video', discord, { width: 640, height: 360 })
    expect(small.width).toBeUndefined()
    expect(small.height).toBeUndefined()
    expect(small.maxShortSide).toBeUndefined()
  })

  test('寸法がわからなければ上限のまま持ち、書き出しの寸法は上限を守る', () => {
    const applied = applyPresetSettings('video', discord, null)
    expect(applied.maxShortSide).toBe(720)
    fc.assert(
      fc.property(fc.integer({ min: 2, max: 4000 }), fc.integer({ min: 2, max: 4000 }), (width, height) => {
        const out = videoOutputSize({ width, height }, applied)
        // 2 の倍数への切り上げで 1 だけ増えることがある
        expect(Math.min(out.width, out.height)).toBeLessThanOrEqual(Math.max(720, Math.min(width, height)) + 1)
      })
    )
  })

  test('解像度のボタンで選んだ指定は、短い辺の上限として保存する', () => {
    const saved = settingsForSaving('video', { format: 'mp4', quality: 70, height: 480 }, { width: 1920, height: 1080 })
    expect(saved).toEqual({ format: 'mp4', quality: 70, maxShortSide: 480 })
    // 縦長に当てても短い辺が 480 になる
    expect(applyPresetSettings('video', saved!, { width: 1080, height: 1920 })).toMatchObject({ width: 480 })
    // 幅・高さとも決めたものはそのまま
    const both = settingsForSaving('video', { format: 'mp4', quality: 70, width: 640, height: 480 }, null)
    expect(both).toEqual({ format: 'mp4', quality: 70, width: 640, height: 480 })
  })

  test('当てた直後は同じ、触ると違う', () => {
    const applied = applyPresetSettings('video', discord, { width: 1920, height: 1080 })
    expect(sameSettings('video', applied, { ...applied })).toBe(true)
    expect(sameSettings('video', applied, { ...applied, width: undefined })).toBe(true)
    expect(sameSettings('video', applied, { ...applied, quality: 79 })).toBe(false)
    expect(sameSettings('image', { format: 'jpeg', quality: 85, targetBytes: null }, { format: 'jpeg', quality: 85, targetBytes: 1 })).toBe(false)
  })
})

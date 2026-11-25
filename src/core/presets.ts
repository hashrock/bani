import type { Lang } from '../i18n/messages'
// 画面と一緒に読み込まれるので、エンコーダを引き込まない純粋な部分だけを直接読む
import { AUDIO_FORMATS, clampBitrate } from '../media/audio/output'
import type { AudioFormat, AudioOutput } from '../media/audio/types'
import { IMAGE_FORMATS, clampQuality } from '../media/image/output'
import type { ImageFormat, ImageOutput } from '../media/image/output'
import { resolveMaxShortSide } from '../media/video/output'
import type { VideoSize } from '../media/video/recipe'
import type { VideoFormat, VideoOutput } from '../media/video/types'
import serviceLimits from '../serviceLimits.json'

/**
 * 出力プリセット。「Discord（無料）に収める」のような組み込みと、利用者が保存したものを同じ形で扱う。
 * 中身は出力設定だけで、編集（トリム・切り抜きなど）は持たない。プリセットはファイルをまたいで使い回すもので、
 * 編集はファイルの中身に依存するため。
 * ここは純粋な計算だけを置き、localStorage の読み書きは usePresets.ts が行う。
 */

export type PresetKind = 'video' | 'image' | 'audio'

export interface PresetSettingsMap {
  video: VideoOutput
  image: ImageOutput
  audio: AudioOutput
}

export interface Preset<K extends PresetKind = PresetKind> {
  id: string
  kind: K
  /** 表示名。組み込みは言語ごとに持つので、画面は presetName で引く */
  name: string | Record<Lang, string>
  /** 組み込みは消したり名前を変えたりできない */
  builtIn: boolean
  settings: PresetSettingsMap[K]
}

export const PRESET_STORAGE_KEY = 'bani.presets'
export const PRESET_SCHEMA_VERSION = 1
export const MAX_PRESET_NAME_LENGTH = 60
/** 1 つの寸法の上限。読めない値で書き出しが固まらないよう、これより大きい保存値は捨てる */
const MAX_SIDE = 16384

export function presetName(preset: Preset, lang: Lang): string {
  return typeof preset.name === 'string' ? preset.name : preset.name[lang]
}

// ---------------------------------------------------------------------------
// 組み込み

/** serviceLimits.json のプランを言語ごとの短い名前に直す。載っていないプランは英語名のまま */
const TIER_LABELS: Record<string, Record<Lang, string>> = {
  Free: { ja: '無料', en: 'Free' },
  'Nitro Basic': { ja: 'Nitro Basic', en: 'Nitro Basic' },
  Media: { ja: 'メディア', en: 'media' },
}

function serviceLimit(service: string, tier: string): number | null {
  const found = serviceLimits.services
    .find((item) => item.name === service)
    ?.limits.find((limit) => limit.tier === tier)
  return found ? found.maxSize : null
}

interface BuiltInSpec<K extends PresetKind> {
  service: string
  tier: string
  settings: (limit: number) => PresetSettingsMap[K]
}

/**
 * 投稿先の上限から作る組み込み。上限は serviceLimits.json から読むので、上限が変わればプリセットも追従する。
 * 動画は短い辺も絞る（ビットレートが同じなら、小さい絵のほうが崩れにくい）
 */
const VIDEO_BUILT_INS: BuiltInSpec<'video'>[] = [
  {
    service: 'Discord',
    tier: 'Free',
    settings: (limit) => ({ format: 'mp4', quality: 80, maxShortSide: 720, targetSize: limit }),
  },
  {
    service: 'Discord',
    tier: 'Nitro Basic',
    settings: (limit) => ({ format: 'mp4', quality: 80, maxShortSide: 1080, targetSize: limit }),
  },
  {
    service: 'WhatsApp',
    tier: 'Media',
    settings: (limit) => ({ format: 'mp4', quality: 80, maxShortSide: 720, targetSize: limit }),
  },
]

/** 画像は JPEG にする（どこに貼っても開け、目標サイズの探索が効く） */
const IMAGE_BUILT_INS: BuiltInSpec<'image'>[] = [
  { service: 'Discord', tier: 'Free', settings: (limit) => ({ format: 'jpeg', quality: 85, targetBytes: limit }) },
  { service: 'WhatsApp', tier: 'Media', settings: (limit) => ({ format: 'jpeg', quality: 85, targetBytes: limit }) },
]

function fromSpecs<K extends PresetKind>(kind: K, specs: BuiltInSpec<K>[]): Preset<K>[] {
  return specs.flatMap((spec) => {
    const limit = serviceLimit(spec.service, spec.tier)
    // 上限の表から消えたプランは出さない
    if (limit === null) return []
    const tier = TIER_LABELS[spec.tier] ?? { ja: spec.tier, en: spec.tier }
    return [
      {
        id: `builtin:${kind}:${spec.service}:${spec.tier}`.toLowerCase().replace(/\s+/g, '-'),
        kind,
        name: { ja: `${spec.service}（${tier.ja}）に収める`, en: `Fit ${spec.service} (${tier.en})` },
        builtIn: true,
        settings: spec.settings(limit),
      },
    ]
  })
}

const WEB_IMAGE: Preset<'image'> = {
  id: 'builtin:image:web',
  kind: 'image',
  name: { ja: 'ウェブ用に軽く（1 MB 以下）', en: 'Light for the web (≤ 1 MB)' },
  builtIn: true,
  settings: { format: 'webp', quality: 80, targetBytes: 1024 * 1024 },
}

export const BUILT_IN_PRESETS: { [K in PresetKind]: Preset<K>[] } = {
  video: fromSpecs('video', VIDEO_BUILT_INS),
  image: [...fromSpecs('image', IMAGE_BUILT_INS), WEB_IMAGE],
  audio: [],
}

/** 画面に並べる順（組み込み → 保存したもの） */
export function presetsFor<K extends PresetKind>(kind: K, saved: readonly Preset[]): Preset<K>[] {
  return [...BUILT_IN_PRESETS[kind], ...saved.filter((preset): preset is Preset<K> => preset.kind === kind)]
}

// ---------------------------------------------------------------------------
// 設定の検証。保存したデータは古い版や手で書き換えたものかもしれないので、読むたびに作り直す

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function positiveInt(value: unknown, max: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.min(max, Math.round(value)) : undefined
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | null {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : null
}

const VIDEO_FORMATS: readonly VideoFormat[] = ['mp4', 'webm', 'gif']

export function sanitizeVideoSettings(value: unknown): VideoOutput | null {
  if (!isRecord(value)) return null
  const format = oneOf(value.format, VIDEO_FORMATS)
  if (!format) return null
  const quality =
    typeof value.quality === 'number' && Number.isFinite(value.quality)
      ? Math.min(100, Math.max(1, Math.round(value.quality)))
      : 80
  const settings: VideoOutput = { format, quality }
  const width = positiveInt(value.width, MAX_SIDE)
  const height = positiveInt(value.height, MAX_SIDE)
  const fps = positiveInt(value.fps, 30)
  const maxShortSide = positiveInt(value.maxShortSide, MAX_SIDE)
  const targetSize = positiveInt(value.targetSize, Number.MAX_SAFE_INTEGER)
  if (width !== undefined) settings.width = width
  if (height !== undefined) settings.height = height
  if (fps !== undefined) settings.fps = fps
  // 幅・高さを決めてあれば上限は効かないので持たない（比べたときに「変更あり」と出ないように）
  if (maxShortSide !== undefined && width === undefined && height === undefined) settings.maxShortSide = maxShortSide
  if (targetSize !== undefined) settings.targetSize = targetSize
  return settings
}

export function sanitizeImageSettings(value: unknown): ImageOutput | null {
  if (!isRecord(value)) return null
  const format = oneOf(value.format, Object.keys(IMAGE_FORMATS) as ImageFormat[])
  if (!format) return null
  const quality = typeof value.quality === 'number' ? clampQuality(value.quality) : 85
  const targetBytes = positiveInt(value.targetBytes, Number.MAX_SAFE_INTEGER) ?? null
  return { format, quality, targetBytes }
}

export function sanitizeAudioSettings(value: unknown): AudioOutput | null {
  if (!isRecord(value)) return null
  const format = oneOf(value.format, Object.keys(AUDIO_FORMATS) as AudioFormat[])
  if (!format) return null
  const bitrate = clampBitrate(format, typeof value.bitrate === 'number' ? value.bitrate : Number.NaN)
  const rates = AUDIO_FORMATS[format].sampleRates
  const sampleRate = typeof value.sampleRate === 'number' && rates.includes(value.sampleRate) ? value.sampleRate : null
  return { format, bitrate, sampleRate }
}

const SANITIZERS: { [K in PresetKind]: (value: unknown) => PresetSettingsMap[K] | null } = {
  video: sanitizeVideoSettings,
  image: sanitizeImageSettings,
  audio: sanitizeAudioSettings,
}

export function sanitizeSettings<K extends PresetKind>(kind: K, value: unknown): PresetSettingsMap[K] | null {
  return SANITIZERS[kind](value) as PresetSettingsMap[K] | null
}

/** 前後の空白を落とし、長すぎれば切る。空なら null */
export function normalizePresetName(name: string): string | null {
  const trimmed = name.replace(/\s+/g, ' ').trim()
  return trimmed ? Array.from(trimmed).slice(0, MAX_PRESET_NAME_LENGTH).join('') : null
}

// ---------------------------------------------------------------------------
// 保存の形式

/** localStorage に置く形。版を上げたら parseStoredPresets に読み替えを足す */
interface StoredPresets {
  version: typeof PRESET_SCHEMA_VERSION
  presets: { id: string; kind: PresetKind; name: string; settings: unknown }[]
}

const KINDS: readonly PresetKind[] = ['video', 'image', 'audio']

/**
 * 保存した文字列から利用者のプリセットを読む。壊れたもの・知らない版は捨て、例外は投げない
 * （プリセットが読めないせいで画面が開かなくなるのを避ける）。読めない項目は 1 件ずつ捨てる
 */
export function parseStoredPresets(raw: string | null): Preset[] {
  if (!raw) return []
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!isRecord(data) || data.version !== PRESET_SCHEMA_VERSION || !Array.isArray(data.presets)) return []
  const seen = new Set<string>()
  const presets: Preset[] = []
  for (const item of data.presets) {
    if (!isRecord(item)) continue
    const kind = oneOf(item.kind, KINDS)
    const id = typeof item.id === 'string' && item.id && !item.id.startsWith('builtin:') ? item.id : null
    const name = typeof item.name === 'string' ? normalizePresetName(item.name) : null
    if (!kind || !id || !name || seen.has(id)) continue
    const settings = sanitizeSettings(kind, item.settings)
    if (!settings) continue
    seen.add(id)
    presets.push({ id, kind, name, builtIn: false, settings } as Preset)
  }
  return presets
}

export function serializePresets(presets: readonly Preset[]): string {
  const stored: StoredPresets = {
    version: PRESET_SCHEMA_VERSION,
    presets: presets
      .filter((preset) => !preset.builtIn && typeof preset.name === 'string')
      .map((preset) => ({
        id: preset.id,
        kind: preset.kind,
        name: preset.name as string,
        settings: preset.settings,
      })),
  }
  return JSON.stringify(stored)
}

// ---------------------------------------------------------------------------
// 一覧の操作（どれも新しい配列を返す）

/** いまの設定を名前をつけて足す。名前が空・設定が読めなければ元のまま */
export function addPreset<K extends PresetKind>(
  presets: readonly Preset[],
  kind: K,
  name: string,
  settings: PresetSettingsMap[K],
  id: string
): Preset[] {
  const normalized = normalizePresetName(name)
  const sanitized = sanitizeSettings(kind, settings)
  if (!normalized || !sanitized || presets.some((preset) => preset.id === id)) return [...presets]
  return [...presets, { id, kind, name: normalized, builtIn: false, settings: sanitized } as Preset]
}

export function renamePreset(presets: readonly Preset[], id: string, name: string): Preset[] {
  const normalized = normalizePresetName(name)
  if (!normalized) return [...presets]
  return presets.map((preset) => (preset.id === id && !preset.builtIn ? { ...preset, name: normalized } : preset))
}

export function deletePreset(presets: readonly Preset[], id: string): Preset[] {
  return presets.filter((preset) => preset.id !== id || preset.builtIn)
}

// ---------------------------------------------------------------------------
// 当てる・保存する・比べる

/**
 * プリセットを当てた後の出力設定。動画の短い辺の上限は、寸法がわかれば幅・高さに直す
 * （解像度のボタンにそのまま反映させるため）。わからなければ書き出すときに直す
 */
export function applyPresetSettings<K extends PresetKind>(
  kind: K,
  settings: PresetSettingsMap[K],
  dimensions: VideoSize | null = null
): PresetSettingsMap[K] {
  const sanitized = sanitizeSettings(kind, settings) ?? settings
  if (kind === 'video' && dimensions) {
    return resolveMaxShortSide(sanitized as VideoOutput, dimensions) as PresetSettingsMap[K]
  }
  return sanitized
}

/**
 * いまの設定をプリセットに保存する形に直す。動画で「短い辺を合わせる」解像度のボタンを選んでいれば、
 * 幅・高さではなく短い辺の上限として持つ（縦長の動画に当てても横長と同じ意味になるように）
 */
export function settingsForSaving<K extends PresetKind>(
  kind: K,
  settings: PresetSettingsMap[K],
  dimensions: VideoSize | null = null
): PresetSettingsMap[K] | null {
  const sanitized = sanitizeSettings(kind, settings)
  if (!sanitized || kind !== 'video' || !dimensions) return sanitized
  const video = sanitized as VideoOutput
  const landscape = dimensions.width >= dimensions.height
  const side = landscape ? video.height : video.width
  const other = landscape ? video.width : video.height
  // 短い辺だけを元より小さく決めている = 解像度のボタン（1080p など）と同じ指定
  if (side === undefined || other !== undefined || side >= Math.min(dimensions.width, dimensions.height)) {
    return sanitized
  }
  return sanitizeVideoSettings({ ...video, width: undefined, height: undefined, maxShortSide: side }) as PresetSettingsMap[K]
}

/** 2 つの設定が同じか。未指定の項目と、検証で落ちる違い（範囲外の値など）は同じとみなす */
export function sameSettings<K extends PresetKind>(
  kind: K,
  a: PresetSettingsMap[K],
  b: PresetSettingsMap[K]
): boolean {
  return canonical(sanitizeSettings(kind, a)) === canonical(sanitizeSettings(kind, b))
}

function canonical(value: unknown): string {
  if (!isRecord(value)) return JSON.stringify(value)
  const keys = Object.keys(value)
    .filter((key) => value[key] !== undefined)
    .sort()
  return JSON.stringify(keys.map((key) => [key, value[key]]))
}

export function newPresetId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

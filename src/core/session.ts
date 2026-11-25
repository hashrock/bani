import { MEDIA_KINDS } from '../app/routes'
import type { MediaKind } from '../app/routes'
import type { OpenedFile } from './opened'

/**
 * 作業の保存（セッション）の純粋な部分。編集画面で開いているファイルとレシピを残しておき、
 * 再読み込みやタブを閉じたあとに入口から「前回の作業を再開」できるようにする。
 * IndexedDB と OPFS の読み書きは sessionStore.ts、画面からの使い方は useSessionRecipe.ts。
 *
 * 保存の中身は「セッションの記録（IndexedDB）」と「ファイルの写し（OPFS、無理なら IndexedDB の Blob）」に分かれる。
 * 記録は古い版・壊れた値でも読み込みで落とすだけにし、画面を壊さない。
 */

/** 記録の形の版。形を変えたら上げ、古い記録は読み込みで捨てる */
export const SESSION_SCHEMA = 1
/** 残すセッションの数。超えたら古いもの（最後に触った時刻）から消す */
export const MAX_SESSIONS = 5
/** すべてのセッションの写しの合計の上限 */
export const MAX_SESSION_BYTES = 1024 ** 3
/** 空き容量が分からないときの上限 */
const FALLBACK_SESSION_BYTES = 512 * 1024 ** 2
/** ブラウザが割り当てた容量のうち、セッションに使ってよい割合 */
const QUOTA_SHARE = 0.25

/** 写したファイル 1 つ分。中身は key で OPFS（なければ IndexedDB の Blob）から引く */
export interface StoredFile {
  key: string
  name: string
  type: string
  size: number
  lastModified: number
  /** フォルダごと受け取ったときの相対パス */
  path?: string
  /** 写しを持っているか。大きすぎて写さず、ハンドルだけで読み直すものは false */
  copied: boolean
  /** ドロップ・選択で受け取ったハンドル。IndexedDB にそのまま入る（構造化複製できる） */
  handle?: FileSystemFileHandle
}

/** 画面のレシピ。画面ごとの版を付けて、合わない版は読み込まない */
export interface RecipeEnvelope {
  version: number
  data: unknown
}

export interface SessionRecord {
  schema: typeof SESSION_SCHEMA
  id: string
  kind: MediaKind
  /** 一覧に出す名前（元ファイルの名前など） */
  name: string
  /** 最後に書いた・再開した時刻（ミリ秒）。古いものから消す */
  updatedAt: number
  /** 写しの合計の大きさ */
  bytes: number
  /** 画面が開いていたファイル。新規の文書・圧縮ファイルの作成のようにないこともある */
  source: StoredFile | null
  /** 足したファイル（PDF の結合、圧縮ファイルに入れるもの）。並びの意味は画面が決める */
  extras: StoredFile[]
  recipe: RecipeEnvelope
}

/** 再開するときに画面へ渡すもの。ファイルは読み直してある */
export interface ResumedSession {
  id: string
  kind: MediaKind
  opened: OpenedFile | null
  extras: OpenedFile[]
  recipe: RecipeEnvelope
}

/** 入口の一覧に出すもの */
export interface SessionSummary {
  id: string
  kind: MediaKind
  name: string
  updatedAt: number
  bytes: number
}

// ---------------------------------------------------------------------------
// 読み込みの検証

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)

const isHandle = (value: unknown): value is FileSystemFileHandle =>
  isObject(value) && (value as { kind?: unknown }).kind === 'file' && typeof (value as { getFile?: unknown }).getFile === 'function'

function parseStoredFile(value: unknown): StoredFile | null {
  if (!isObject(value)) return null
  const { key, name, type, size, lastModified, path, copied, handle } = value
  if (typeof key !== 'string' || key === '' || typeof name !== 'string' || typeof type !== 'string') return null
  if (!isFiniteNumber(size) || size < 0 || !isFiniteNumber(lastModified) || typeof copied !== 'boolean') return null
  if (path !== undefined && typeof path !== 'string') return null
  const parsedHandle = handle === undefined || handle === null ? undefined : isHandle(handle) ? handle : null
  if (parsedHandle === null) return null
  // 写しもハンドルもなければ読み直せない
  if (!copied && !parsedHandle) return null
  return {
    key,
    name,
    type,
    size,
    lastModified,
    copied,
    ...(path !== undefined && { path }),
    ...(parsedHandle && { handle: parsedHandle }),
  }
}

/** IndexedDB から読んだ値を記録として確かめる。形が合わなければ null（呼び出し側で消す） */
export function parseSessionRecord(value: unknown): SessionRecord | null {
  if (!isObject(value) || value.schema !== SESSION_SCHEMA) return null
  const { id, kind, name, updatedAt, bytes, source, extras, recipe } = value
  if (typeof id !== 'string' || id === '' || typeof name !== 'string') return null
  if (typeof kind !== 'string' || !(MEDIA_KINDS as readonly string[]).includes(kind)) return null
  if (!isFiniteNumber(updatedAt) || !isFiniteNumber(bytes) || bytes < 0) return null
  if (!isObject(recipe) || !Number.isInteger(recipe.version) || !('data' in recipe)) return null
  const parsedSource = source === null ? null : parseStoredFile(source)
  if (source !== null && !parsedSource) return null
  if (!Array.isArray(extras)) return null
  const parsedExtras = extras.map(parseStoredFile)
  if (parsedExtras.some((file) => file === null)) return null
  return {
    schema: SESSION_SCHEMA,
    id,
    kind: kind as MediaKind,
    name,
    updatedAt,
    bytes,
    source: parsedSource,
    extras: parsedExtras as StoredFile[],
    recipe: { version: recipe.version as number, data: recipe.data },
  }
}

export const summarize = (record: SessionRecord): SessionSummary => ({
  id: record.id,
  kind: record.kind,
  name: record.name,
  updatedAt: record.updatedAt,
  bytes: record.bytes,
})

/**
 * 値が見本（template）と同じ形か。レシピの型を画面ごとに書き写さずに済むよう、
 * 開いたファイルから作った新しいレシピを見本にして比べる。
 * - 数・文字・真偽は型が同じこと（数は有限）
 * - オブジェクトはキーの集まりが同じで、各値も同じ形
 * - 配列は、見本に要素があればどの要素も見本の先頭と同じ形
 * - 見本が null（切り抜きなしなど）や空の配列のところは、JSON にできる値なら何でもよい（画面の check で確かめる）
 * レシピに項目が増えた・減った・型が変わった古い記録は、ここで落ちる。
 */
export function conformsTo(value: unknown, template: unknown): boolean {
  if (template === null) return isJsonValue(value)
  if (Array.isArray(template)) {
    if (!Array.isArray(value)) return false
    if (template.length === 0) return value.every(isJsonValue)
    return value.every((item) => conformsTo(item, template[0]))
  }
  if (typeof template === 'object') {
    if (!isObject(value)) return false
    const keys = Object.keys(template as object)
    if (Object.keys(value).length !== keys.length) return false
    return keys.every((key) => key in value && conformsTo(value[key], (template as Record<string, unknown>)[key]))
  }
  if (typeof template === 'number') return isFiniteNumber(value)
  return typeof value === typeof template
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (isObject(value)) return Object.values(value).every(isJsonValue)
  return false
}

/**
 * 記録のレシピを取り出す。版が違う・見本と形が違う・画面の確かめ（check）に通らなければ null。
 * 例外も握りつぶして null にする（古いデータで画面を壊さない）
 */
export function unwrapRecipe<T>(
  envelope: RecipeEnvelope,
  version: number,
  template: T,
  check?: (recipe: T, template: T) => boolean
): T | null {
  try {
    if (envelope.version !== version || !conformsTo(envelope.data, template)) return null
    const recipe = envelope.data as T
    return !check || check(recipe, template) ? recipe : null
  } catch {
    return null
  }
}

/** 切り抜きのような矩形（null は「なし」）か。見本が null の項目を画面の check で確かめるときに使う */
export const isRectOrNull = (value: unknown): boolean =>
  value === null ||
  (isObject(value) &&
    ['x', 'y', 'width', 'height'].every((key) => isFiniteNumber(value[key])) &&
    (value.width as number) > 0 &&
    (value.height as number) > 0)

// ---------------------------------------------------------------------------
// 容量

/** セッションの写しに使ってよい合計。割り当てが分かればその一部、分からなければ控えめに */
export function sessionBudget(quota: number | undefined): number {
  if (!quota || !Number.isFinite(quota) || quota <= 0) return FALLBACK_SESSION_BYTES
  return Math.min(MAX_SESSION_BYTES, Math.floor(quota * QUOTA_SHARE))
}

/**
 * ファイルをどう残すか。写せる大きさなら写し、大きすぎればハンドルだけ（あれば）、
 * どちらもできなければ残さない
 */
export function storagePlan(bytes: number, budget: number, hasHandle: boolean): 'copy' | 'handle' | 'skip' {
  if (bytes <= budget) return 'copy'
  return hasHandle ? 'handle' : 'skip'
}

/**
 * 消すセッション。新しい順に残していき、数（maxCount）か合計の大きさ（maxBytes）を超えたものを消す。
 * keep（いま画面で使っているもの）は消さず、数と大きさには入れる
 */
export function planEviction(
  sessions: readonly Pick<SessionSummary, 'id' | 'updatedAt' | 'bytes'>[],
  limits: { maxCount: number; maxBytes: number; keep?: ReadonlySet<string> }
): string[] {
  const keep = limits.keep ?? new Set<string>()
  const kept = sessions.filter((session) => keep.has(session.id))
  let count = kept.length
  let bytes = kept.reduce((sum, session) => sum + session.bytes, 0)
  const evicted: string[] = []
  const rest = sessions
    .filter((session) => !keep.has(session.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  for (const session of rest) {
    if (count + 1 > limits.maxCount || bytes + session.bytes > limits.maxBytes) {
      evicted.push(session.id)
      continue
    }
    count += 1
    bytes += session.bytes
  }
  return evicted
}

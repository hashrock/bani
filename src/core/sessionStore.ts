import type { MediaKind } from '../app/routes'
import type { OpenedFile } from './opened'
import {
  MAX_SESSIONS,
  parseSessionRecord,
  planEviction,
  sessionBudget,
  storagePlan,
  summarize,
} from './session'
import type { RecipeEnvelope, ResumedSession, SessionRecord, SessionSummary, StoredFile } from './session'
import { SESSION_SCHEMA } from './session'

/*
 * セッションの読み書き（IndexedDB と OPFS）。どの操作も 1 本の列に並べて順に行い、
 * 書いている最中に消す・消している最中に書く、が混ざらないようにする。
 * 失敗しても画面は止めない（作業の保存はおまけなので、警告を出して諦める）。
 */

const DB_NAME = 'bani-sessions'
const DB_VERSION = 1
const RECORDS = 'records'
/** OPFS が使えないブラウザでの写しの置き場所（key は `<id>/<file key>`） */
const BLOBS = 'blobs'
const OPFS_DIR = 'sessions'
const PERSIST_FLAG = 'bani.session.persistRequested'

let queue: Promise<unknown> = Promise.resolve()

/** 操作を列の後ろに並べる。前の操作が失敗しても次へ進む */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task)
  queue = run.catch(() => undefined)
  return run
}

export const sessionsSupported = (): boolean => typeof indexedDB !== 'undefined'

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(RECORDS)) db.createObjectStore(RECORDS, { keyPath: 'id' })
      if (!db.objectStoreNames.contains(BLOBS)) db.createObjectStore(BLOBS)
    }
    request.onsuccess = () => {
      const db = request.result
      // ほかのタブが版を上げる・消すときは手放す（つなぎっぱなしで相手を待たせない）。次に使うときに開き直す
      db.onversionchange = () => {
        db.close()
        dbPromise = null
      }
      resolve(db)
    }
    request.onerror = () => reject(request.error)
  }).catch((error: unknown) => {
    dbPromise = null
    throw error
  })
  return dbPromise
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb()
  const transaction = db.transaction(name, mode)
  const result = await requestToPromise(action(transaction.objectStore(name)))
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
  return result
}

/** 全部の記録。形の合わない記録はここで消す */
async function readRecords(): Promise<SessionRecord[]> {
  const raw = await withStore<unknown[]>(RECORDS, 'readonly', (store) => store.getAll())
  const records: SessionRecord[] = []
  for (const value of raw) {
    const record = parseSessionRecord(value)
    if (record) records.push(record)
    else {
      const id = (value as { id?: unknown } | null)?.id
      if (typeof id === 'string') await removeSession(id)
    }
  }
  return records
}

async function readRecord(id: string): Promise<SessionRecord | null> {
  const raw = await withStore<unknown>(RECORDS, 'readonly', (store) => store.get(id))
  return raw === undefined ? null : parseSessionRecord(raw)
}

// ---------------------------------------------------------------------------
// ファイルの写し

async function sessionsDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage?.getDirectory) return null
    const root = await navigator.storage.getDirectory()
    return await root.getDirectoryHandle(OPFS_DIR, { create: true })
  } catch {
    return null
  }
}

/**
 * 画面で使っているセッション。写しの File を画面がまだ読んでいるので、
 * 記録を消しても写しは残す（使い終わったら、次に一覧を作るときに片付ける）
 */
const inUse = new Set<string>()
/** 写し済みのファイル。同じ File を何度も写さない */
const copies = new Map<string, Map<File, StoredFile>>()

export function markInUse(id: string, using: boolean): void {
  if (using) inUse.add(id)
  else inUse.delete(id)
}

let fileCounter = 0
const nextFileKey = () => `f${Date.now().toString(36)}${(++fileCounter).toString(36)}`

async function writeCopy(id: string, key: string, file: File): Promise<void> {
  const dir = await sessionsDir()
  if (dir) {
    try {
      const sessionDir = await dir.getDirectoryHandle(id, { create: true })
      const handle = await sessionDir.getFileHandle(key, { create: true })
      // 大きな動画でも一度にメモリへ載せないよう、流し込む（pipeTo が閉じる）
      const writable = await handle.createWritable()
      await file.stream().pipeTo(writable)
      return
    } catch (error) {
      // Safari の古い版などは createWritable を持たない。IndexedDB の Blob に回す
      console.warn('OPFS write failed, falling back to IndexedDB:', error)
      await removeOpfsEntry(id, key)
    }
  }
  await withStore(BLOBS, 'readwrite', (store) => store.put(file, `${id}/${key}`))
}

async function removeOpfsEntry(id: string, key?: string): Promise<void> {
  const dir = await sessionsDir()
  if (!dir) return
  try {
    if (key) await (await dir.getDirectoryHandle(id)).removeEntry(key)
    else await dir.removeEntry(id, { recursive: true })
  } catch {
    // ないものを消そうとしただけ
  }
}

async function readCopy(id: string, stored: StoredFile): Promise<File | null> {
  if (!stored.copied) return null
  let blob: Blob | null = null
  const dir = await sessionsDir()
  if (dir) {
    try {
      blob = await (await (await dir.getDirectoryHandle(id)).getFileHandle(stored.key)).getFile()
    } catch {
      blob = null
    }
  }
  if (!blob) {
    const found = await withStore<unknown>(BLOBS, 'readonly', (store) => store.get(`${id}/${stored.key}`))
    blob = found instanceof Blob ? found : null
  }
  if (!blob || blob.size !== stored.size) return null
  // 名前・種類・更新日時は元のファイルのものに戻す（OPFS の名前は key なので）
  return new File([blob], stored.name, { type: stored.type, lastModified: stored.lastModified })
}

async function ensureReadPermission(handle: FileSystemFileHandle): Promise<boolean> {
  const descriptor = { mode: 'read' as const }
  const state = (await handle.queryPermission?.(descriptor)) ?? 'granted'
  if (state === 'granted') return true
  // 再開のボタンを押した流れの中なので、許可を求められる
  return ((await handle.requestPermission?.(descriptor)) ?? 'denied') === 'granted'
}

/**
 * ファイルを読み直す。ハンドルがあり、読む許可があり、写したときから変わっていなければそちらを使う
 * （上書き保存もできる）。変わっていたら写しを使い、ハンドルは渡さない（よそで変わったファイルに上書きしない）
 */
async function restoreFile(id: string, stored: StoredFile): Promise<OpenedFile | null> {
  const copy = await readCopy(id, stored)
  const path = stored.path !== undefined ? { path: stored.path } : {}
  if (stored.handle) {
    try {
      if (await ensureReadPermission(stored.handle)) {
        const live = await stored.handle.getFile()
        const unchanged = live.size === stored.size && live.lastModified === stored.lastModified
        if (unchanged || !copy) return { file: live, handle: unchanged ? stored.handle : null, ...path }
      }
    } catch (error) {
      console.warn('Could not reread through the file handle:', error)
    }
  }
  return copy ? { file: copy, handle: null, ...path } : null
}

// ---------------------------------------------------------------------------
// 公開する操作

async function removeSession(id: string): Promise<void> {
  await withStore(RECORDS, 'readwrite', (store) => store.delete(id))
  if (inUse.has(id)) return
  copies.delete(id)
  await removeOpfsEntry(id)
  await withStore(BLOBS, 'readwrite', (store) => store.delete(IDBKeyRange.bound(`${id}/`, `${id}/￿`)))
}

/** セッションを消す */
export const deleteSession = (id: string): Promise<void> => enqueue(() => removeSession(id))

export interface SaveSessionInput {
  id: string
  kind: MediaKind
  name: string
  recipe: RecipeEnvelope
  source: OpenedFile | null
  extras: readonly OpenedFile[]
}

/** 使う容量の上限。ブラウザが割り当てた容量から決める */
async function budget(): Promise<number> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    return sessionBudget(estimate?.quota)
  } catch {
    return sessionBudget(undefined)
  }
}

/** 消されにくくしてもらう（一度だけ頼む。断られても動きは変わらない） */
function requestPersistOnce(): void {
  try {
    if (localStorage.getItem(PERSIST_FLAG)) return
    localStorage.setItem(PERSIST_FLAG, '1')
    void navigator.storage?.persist?.().catch(() => false)
  } catch {
    // localStorage が使えないなら頼まない
  }
}

/**
 * セッションを書く。ファイルはまだ写していないものだけを写し、使わなくなった写しは消す。
 * 写しが上限を超えるなら、ハンドルがあるものはハンドルだけで残し、どちらもできなければ残さない（false）
 */
export function saveSession(input: SaveSessionInput): Promise<boolean> {
  return enqueue(async () => {
    const limit = await budget()
    const files = [...(input.source ? [input.source] : []), ...input.extras]
    const cache = copies.get(input.id) ?? new Map<File, StoredFile>()
    const fresh = files.filter(({ file }) => !cache.has(file))
    const total = files.reduce((sum, { file }) => sum + file.size, 0)
    const plan = storagePlan(total, limit, files.every(({ handle }) => !!handle))
    if (plan === 'skip') {
      await removeSession(input.id)
      return false
    }

    for (const opened of fresh) {
      const key = nextFileKey()
      const copied = plan === 'copy'
      if (copied) await writeCopy(input.id, key, opened.file)
      cache.set(opened.file, {
        key,
        name: opened.file.name,
        type: opened.file.type,
        size: opened.file.size,
        lastModified: opened.file.lastModified,
        copied,
        ...(opened.path !== undefined && { path: opened.path }),
        ...(opened.handle && { handle: opened.handle }),
      })
    }
    copies.set(input.id, cache)

    const stored = (opened: OpenedFile) => cache.get(opened.file)!
    const record: SessionRecord = {
      schema: SESSION_SCHEMA,
      id: input.id,
      kind: input.kind,
      name: input.name,
      updatedAt: Date.now(),
      bytes: files.reduce((sum, opened) => sum + (stored(opened).copied ? opened.file.size : 0), 0),
      source: input.source ? stored(input.source) : null,
      extras: input.extras.map(stored),
      recipe: input.recipe,
    }
    await withStore(RECORDS, 'readwrite', (store) => store.put(record))

    // 取り消しなどで使わなくなった写しを消す
    const used = new Set(files.map(({ file }) => file))
    for (const [file, entry] of cache) {
      if (used.has(file)) continue
      cache.delete(file)
      await removeOpfsEntry(input.id, entry.key)
      await withStore(BLOBS, 'readwrite', (store) => store.delete(`${input.id}/${entry.key}`))
    }

    const records = await readRecords()
    const keep = new Set([...inUse, input.id])
    for (const id of planEviction(records, { maxCount: MAX_SESSIONS, maxBytes: limit, keep })) {
      await removeSession(id)
    }
    requestPersistOnce()
    return true
  })
}

/** 入口の一覧。新しい順。記録のない写し（使い終わったもの）もここで片付ける */
export function listSessions(): Promise<SessionSummary[]> {
  if (!sessionsSupported()) return Promise.resolve([])
  return enqueue(async () => {
    const records = await readRecords()
    const ids = new Set(records.map((record) => record.id))
    const dir = await sessionsDir()
    if (dir) {
      const orphans: string[] = []
      for await (const name of dir.keys()) {
        if (!ids.has(name) && !inUse.has(name)) orphans.push(name)
      }
      for (const name of orphans) await removeOpfsEntry(name)
    }
    return records.map(summarize).sort((a, b) => b.updatedAt - a.updatedAt)
  }).catch((error: unknown) => {
    console.warn('Could not list sessions:', error)
    return []
  })
}

/**
 * 再開する。ファイルを読み直せなければ null（記録はそのまま残すので、あとで消せる）。
 * 再開した時刻を最後に触った時刻にする（古いものから消すときに残りやすく）
 */
export function restoreSession(id: string): Promise<ResumedSession | null> {
  return enqueue(async () => {
    const record = await readRecord(id)
    if (!record) {
      await removeSession(id)
      return null
    }
    const source = record.source ? await restoreFile(id, record.source) : null
    if (record.source && !source) return null
    const extras: OpenedFile[] = []
    for (const stored of record.extras) {
      const restored = await restoreFile(id, stored)
      if (!restored) return null
      extras.push(restored)
    }
    // 写しから読み直したファイルは、次に書くときに写し直さないよう覚えておく
    const cache = new Map<File, StoredFile>()
    if (source && record.source) cache.set(source.file, record.source)
    extras.forEach((opened, index) => cache.set(opened.file, record.extras[index]))
    copies.set(id, cache)
    await withStore(RECORDS, 'readwrite', (store) => store.put({ ...record, updatedAt: Date.now() }))
    return { id, kind: record.kind, opened: source, extras, recipe: record.recipe }
  }).catch((error: unknown) => {
    console.warn('Could not restore the session:', error)
    return null
  })
}

/** 保存領域の使用量と割り当て（ブラウザが教えてくれなければ null） */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    if (!estimate || estimate.usage === undefined || estimate.quota === undefined) return null
    return { usage: estimate.usage, quota: estimate.quota }
  } catch {
    return null
  }
}

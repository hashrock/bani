import { useCallback, useSyncExternalStore } from 'react'
import { PRESET_STORAGE_KEY, parseStoredPresets, serializePresets } from './presets'
import type { Preset } from './presets'

/**
 * 利用者が保存したプリセットを localStorage に置き、開いているすべての画面（と別のタブ）で同じ一覧を見る。
 * localStorage が使えない（プライベートブラウズ・容量超過など）ときは、このページの中でだけ覚える。
 */

let cache: Preset[] | null = null
const listeners = new Set<() => void>()

function readStorage(): Preset[] {
  try {
    return parseStoredPresets(globalThis.localStorage?.getItem(PRESET_STORAGE_KEY) ?? null)
  } catch {
    return []
  }
}

function snapshot(): Preset[] {
  cache ??= readStorage()
  return cache
}

function write(next: Preset[]) {
  cache = next
  try {
    globalThis.localStorage?.setItem(PRESET_STORAGE_KEY, serializePresets(next))
  } catch (err) {
    console.warn('Could not store presets:', err)
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  // 別のタブで保存・削除したものも映す
  const onStorage = (event: StorageEvent) => {
    if (event.key !== PRESET_STORAGE_KEY) return
    cache = readStorage()
    listener()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

const EMPTY: Preset[] = []

export function usePresets(): [Preset[], (update: (current: Preset[]) => Preset[]) => void] {
  const presets = useSyncExternalStore(subscribe, snapshot, () => EMPTY)
  const update = useCallback((fn: (current: Preset[]) => Preset[]) => write(fn(snapshot())), [])
  return [presets, update]
}

import { useCallback, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'

/** 画面を作り直しても残す値。ページを再読み込みすると消える（保存はしない） */
const memory = new Map<string, unknown>()

/**
 * 出力設定のように「別のファイルを開いても、画面を行き来しても残したい」値を持つ。
 * key は画面ごとに一意にする（`video.output` など）。
 */
export function usePersistentState<T>(
  key: string,
  initial: T | (() => T)
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (memory.has(key)) return memory.get(key) as T
    return typeof initial === 'function' ? (initial as () => T)() : initial
  })

  const set = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValue((current) => {
        const resolved =
          typeof next === 'function' ? (next as (value: T) => T)(current) : next
        memory.set(key, resolved)
        return resolved
      })
    },
    [key]
  )

  return [value, set]
}

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

/**
 * 出力の形式のように、利用者が選ぶまでは開いたファイルに合わせ（derived）、
 * 一度選んだらその選択を覚えて、別のファイルを開いても使うもの（ROADMAP.md「共通の操作モデル」の「出力の既定」）。
 * 更新関数は、いま効いている値（選んだもの、なければ derived）を受け取る。
 */
export function useRememberedChoice<T>(
  key: string,
  derived: T
): [T, (next: T | ((current: T) => T)) => void, () => void] {
  const [chosen, setChosen] = usePersistentState<T | null>(key, null)
  const value = chosen ?? derived
  const set = useCallback(
    (next: T | ((current: T) => T)) =>
      setChosen((current) => {
        const effective = current ?? derived
        return typeof next === 'function' ? (next as (value: T) => T)(effective) : next
      }),
    [setChosen, derived]
  )
  /** 選んだものを忘れ、また開いたファイルに合わせる */
  const reset = useCallback(() => setChosen(null), [setChosen])
  return [value, set, reset]
}

import { useCallback, useState } from 'react'
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from './history'
import type { History } from './history'
import { useHotkey } from './useHotkey'

interface Tracked<T> {
  history: History<T>
  /** 最後に開いた・保存したときのレシピ。いまのレシピと同じものなら保存していない変更はない */
  saved: T
}

const fresh = <T,>(recipe: T): Tracked<T> => ({ history: createHistory(recipe), saved: recipe })

/** 履歴だけを差し替える。変わらなければ同じ状態を返して描き直しを省く */
const withHistory = <T,>(current: Tracked<T>, history: History<T>): Tracked<T> =>
  history === current.history ? current : { ...current, history }

/**
 * レシピ（非破壊編集の内容）を履歴つきで持つ。⌘Z / ⇧⌘Z（Ctrl+Y）で取り消し・やり直し。
 * 編集関数が同じオブジェクトを返したとき（変化なし）は履歴に積まない。
 * 保存していない変更があるか（dirty）も持つ。取り消しで保存した時点まで戻れば変更なしに戻る。
 */
export function useRecipeHistory<T>(initial: T | (() => T), options: { hotkeys?: boolean } = {}) {
  const { hotkeys = true } = options
  const [state, setState] = useState(() =>
    fresh(typeof initial === 'function' ? (initial as () => T)() : initial)
  )
  const { history, saved } = state

  /** 新しいレシピを積む。前のレシピから作るときは関数で渡す */
  const update = useCallback((next: T | ((current: T) => T)) => {
    setState((current) =>
      withHistory(
        current,
        pushHistory(
          current.history,
          typeof next === 'function' ? (next as (value: T) => T)(current.history.present) : next
        )
      )
    )
  }, [])

  /** 履歴を捨てて置き換える（別のファイルを開いた、尺が判明した、など）。置き換えた時点を保存済みとみなす */
  const replace = useCallback((next: T) => setState(fresh(next)), [])
  const undo = useCallback(() => setState((current) => withHistory(current, undoHistory(current.history))), [])
  const redo = useCallback(() => setState((current) => withHistory(current, redoHistory(current.history))), [])
  /** 保存できたとき。いまのレシピを保存済みにする */
  const markSaved = useCallback(
    () => setState((current) => ({ ...current, saved: current.history.present })),
    []
  )

  useHotkey('mod+z', undo, { enabled: hotkeys, repeat: true })
  useHotkey('mod+shift+z', redo, { enabled: hotkeys, repeat: true })
  useHotkey('mod+y', redo, { enabled: hotkeys, repeat: true })

  return {
    recipe: history.present,
    update,
    replace,
    undo,
    redo,
    markSaved,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    dirty: history.present !== saved,
  }
}

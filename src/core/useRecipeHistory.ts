import { useCallback, useState } from 'react'
import {
  canRedo,
  canUndo,
  createHistory,
  pushHistory,
  redoHistory,
  undoHistory,
} from './history'
import { useHotkey } from './useHotkey'

/**
 * レシピ（非破壊編集の内容）を履歴つきで持つ。⌘Z / ⇧⌘Z（Ctrl+Y）で取り消し・やり直し。
 * 編集関数が同じオブジェクトを返したとき（変化なし）は履歴に積まない。
 */
export function useRecipeHistory<T>(initial: T | (() => T), options: { hotkeys?: boolean } = {}) {
  const { hotkeys = true } = options
  const [history, setHistory] = useState(() =>
    createHistory(typeof initial === 'function' ? (initial as () => T)() : initial)
  )

  /** 新しいレシピを積む。前のレシピから作るときは関数で渡す */
  const update = useCallback((next: T | ((current: T) => T)) => {
    setHistory((current) =>
      pushHistory(
        current,
        typeof next === 'function' ? (next as (value: T) => T)(current.present) : next
      )
    )
  }, [])

  /** 履歴を捨てて置き換える（別のファイルを開いた、尺が判明した、など） */
  const replace = useCallback((next: T) => setHistory(createHistory(next)), [])
  const undo = useCallback(() => setHistory(undoHistory), [])
  const redo = useCallback(() => setHistory(redoHistory), [])

  useHotkey('mod+z', undo, { enabled: hotkeys })
  useHotkey('mod+shift+z', redo, { enabled: hotkeys })
  useHotkey('mod+y', redo, { enabled: hotkeys })

  return {
    recipe: history.present,
    update,
    replace,
    undo,
    redo,
    canUndo: canUndo(history),
    canRedo: canRedo(history),
  }
}

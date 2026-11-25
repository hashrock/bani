import { useCallback, useRef, useState } from 'react'
import { useRecipeHistory } from '../../core/useRecipeHistory'
import { applyVideoEdit, createVideoRecipe } from '../../media/video'
import type { VideoEdit, VideoInfo, VideoRecipe } from '../../media/video'

/**
 * 動画のレシピを履歴つきで持つ。元ファイルの情報（resetFor で渡す）が来るまでは編集を受け付けない。
 *
 * ドラッグ（トリムのハンドル、切り抜きの枠）は動かしている間ずっと値が変わるので、
 * そのたびに履歴へ積むと 1 回のドラッグを取り消すのに何十回も ⌘Z を押すことになる。
 * そこでドラッグ中は下書き（draft）だけを書き換え、離したときに 1 段として積む。
 */
export function useVideoRecipe() {
  // 編集の範囲（尺・寸法）を決める元ファイルの情報。resetFor で受け取る
  const [info, setInfo] = useState<VideoInfo | null>(null)
  const history = useRecipeHistory<VideoRecipe>(() => createVideoRecipe({ duration: 0 }))
  const [draft, setDraft] = useState<VideoRecipe | null>(null)
  // 離したときに積む値。state の更新関数の中で履歴を触らないよう、最新の下書きを別に持つ
  const draftRef = useRef<VideoRecipe | null>(null)
  const { update, replace } = history

  /** 編集を 1 つ当てて履歴に積む */
  const edit = useCallback(
    (next: VideoEdit) => {
      if (!info) return
      update((current) => applyVideoEdit(current, next, info))
    },
    [info, update]
  )

  /** ドラッグ中の編集。下書きにだけ当てる */
  const preview = useCallback(
    (next: VideoEdit) => {
      if (!info) return
      const base = draftRef.current ?? history.recipe
      const applied = applyVideoEdit(base, next, info)
      draftRef.current = applied
      setDraft(applied)
    },
    [info, history.recipe]
  )

  /** ドラッグを離したとき。下書きを 1 段として積む */
  const commit = useCallback(() => {
    const pending = draftRef.current
    draftRef.current = null
    setDraft(null)
    if (pending) update(pending)
  }, [update])

  /** 新しいファイルの尺がわかったとき。履歴ごと作り直す */
  const resetFor = useCallback(
    (loaded: VideoInfo) => {
      draftRef.current = null
      setDraft(null)
      setInfo(loaded)
      replace(createVideoRecipe(loaded))
    },
    [replace]
  )

  return {
    /** 画面に映すレシピ（ドラッグ中なら下書き） */
    recipe: draft ?? history.recipe,
    /** 履歴に積まれたレシピ。書き出し・見積もりはこちらを使い、ドラッグ中に走り直さないようにする */
    committed: history.recipe,
    edit,
    preview,
    commit,
    resetFor,
    /** 前回の作業を再開する（resetFor のあとに。履歴はそこから始まる） */
    restore: history.restore,
    undo: history.undo,
    redo: history.redo,
    /** 開いた・保存したときからレシピが変わったか（ドラッグ中の下書きは数えない） */
    dirty: history.dirty,
    markSaved: history.markSaved,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
  }
}

export type VideoRecipeState = ReturnType<typeof useVideoRecipe>

import { useEffect, useRef, useState } from 'react'
import type { MediaKind } from '../app/routes'
import type { OpenedFile } from './opened'
import { unwrapRecipe } from './session'
import type { ResumedSession } from './session'
import { deleteSession, markInUse, saveSession, sessionsSupported } from './sessionStore'

/** 打つ手が止まってから書くまでの間。ドラッグや連打のたびに書かない */
const WRITE_DELAY = 800

/**
 * いまこのタブでその画面が持っているセッション。別のファイルを開き直したら（保存していない変更を
 * 捨てると確かめたあと）、前のファイルのセッションを消す。前回の訪問のセッションは、再開したときだけここに入る
 */
const active = new Map<MediaKind, string>()

function claim(kind: MediaKind, id: string | null): void {
  const previous = active.get(kind)
  if (previous && previous !== id) void deleteSession(previous)
  if (id) active.set(kind, id)
  else active.delete(kind)
}

const resolveExtras = (extras: SessionRecipeOptions<unknown>['extras']): readonly OpenedFile[] =>
  (typeof extras === 'function' ? extras() : extras) ?? []

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export interface SessionRecipeOptions<T> {
  /** 画面が開いているファイル。新規の文書のようにないこともある */
  opened: OpenedFile | null
  /** 入口から再開して来たとき（App が渡す） */
  resumed: ResumedSession | null | undefined
  /** 残すか。開いているファイルがない画面（空の動画の画面など）は false */
  enabled: boolean
  /** 保存していない変更があるか。なければ（保存した・取り消しで戻した）セッションを消す */
  dirty: boolean
  /** レシピの形の版。形を変えたら上げる（古いセッションは再開せずに捨てる） */
  version: number
  /**
   * 再開したレシピを当ててよいか（尺・ページ数などがわかり、レシピがそのファイルの新しいものになったか）。
   * そのときのレシピを見本（template）にして、残っていたレシピの形を確かめる
   */
  ready: boolean
  /** 見本を別に渡すとき（新しいレシピの配列が空で、要素の形が比べられないときなど） */
  template?: T
  /** 形のほかに確かめること（範囲がファイルの内側か、など） */
  check?: (recipe: T, template: T) => boolean
  /** 確かめたレシピを画面に当てる。履歴はそこから始める */
  onResume: (recipe: T, resumed: ResumedSession) => void | Promise<void>
  /**
   * 足したファイル（PDF の結合、圧縮ファイルの中身）。再開すると resumed.extras に同じ並びで戻る。
   * 書くときに読むので、ref から集める関数でもよい。変わるときはレシピも変わる前提で、これだけの変化では書き直さない
   */
  extras?: readonly OpenedFile[] | (() => readonly OpenedFile[])
  /** 一覧に出す名前。省けば開いているファイルの名前 */
  label?: string
}

/**
 * 画面のレシピを作業として残し、入口から再開できるようにする（ROADMAP.md Phase 8「作業の保存」）。
 * 保存していない変更があるあいだだけ、少し待ってから裏で書く。画面の操作は待たせない。
 */
export function useSessionRecipe<T>(kind: MediaKind, recipe: T, options: SessionRecipeOptions<T>): void {
  const { opened, resumed, enabled, dirty, version, ready, label } = options
  const idRef = useRef<string | null>(resumed?.id ?? null)
  // 再開したレシピを当てるまでは書かない（当てる前の新しいレシピで上書き・削除しない）
  const [live, setLive] = useState(!resumed)
  const latest = useRef(options)
  useEffect(() => {
    latest.current = options
  })

  // 開き直したファイル・新しい文書は、このタブでその画面が持っていたセッションを置き換える。
  // 再開したものはこの画面のセッションにし、写しの File を読んでいるあいだは写しを消させない
  useEffect(() => {
    if (resumed) {
      claim(kind, resumed.id)
      markInUse(resumed.id, true)
      return () => markInUse(resumed.id, false)
    }
    if (enabled) claim(kind, null)
  }, [kind, resumed, enabled])

  useEffect(() => {
    if (!resumed || live || !ready) return
    const { template, check, onResume } = latest.current
    const restored = unwrapRecipe(resumed.recipe, version, template ?? recipe, check)
    if (!restored) {
      // 版が古い・形が合わないレシピは捨て、ファイルだけを開いた状態から始める
      console.warn('Discarded a saved session whose recipe no longer fits')
      void deleteSession(resumed.id)
      setLive(true)
      return
    }
    // 足したファイルを読み直すような画面は待ってから書き始める（当てる前の状態で消さない）
    void Promise.resolve()
      .then(() => onResume(restored, resumed))
      .catch((error: unknown) => console.warn('Could not resume the session:', error))
      .finally(() => setLive(true))
  }, [resumed, live, ready, version, recipe])

  // 書く・消す。待っているあいだに画面を閉じたら、閉じるときに書く
  const pending = useRef<(() => void) | null>(null)
  useEffect(() => {
    if (!live || !enabled || !sessionsSupported()) return
    const run = () => {
      pending.current = null
      const id = idRef.current
      if (!dirty) {
        if (id) void deleteSession(id)
        return
      }
      const sessionId = id ?? newId()
      idRef.current = sessionId
      claim(kind, sessionId)
      void saveSession({
        id: sessionId,
        kind,
        name: label ?? opened?.file.name ?? kind,
        recipe: { version, data: recipe },
        source: opened,
        extras: resolveExtras(latest.current.extras),
      }).catch((error: unknown) => console.warn('Could not save the session:', error))
    }
    pending.current = run
    const timer = setTimeout(run, dirty ? WRITE_DELAY : 0)
    return () => clearTimeout(timer)
  }, [live, enabled, dirty, kind, version, recipe, opened, label])

  // 画面を閉じる・タブを閉じるときは、待っている分をすぐ書く
  useEffect(() => {
    const flush = () => pending.current?.()
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])
}

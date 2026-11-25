import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * 全画面で同じ意味に使うショートカット（ROADMAP.md「共通の操作モデル」の「キーボード」）。
 * `mod` は macOS では ⌘、それ以外では Ctrl。delete は Delete と Backspace の両方。
 */
export type Hotkey =
  | 'mod+s'
  | 'mod+z'
  | 'mod+shift+z'
  | 'mod+y'
  | 'mod+c'
  | 'mod+a'
  | 'space'
  | 'delete'
  | 'enter'
  | 'escape'

export const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/** ボタンの title などに添える修飾キーの書き方 */
export const modKey = () => (isMac() ? '⌘' : 'Ctrl+')

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

export function matchesHotkey(event: KeyLike, hotkey: Hotkey, mac = isMac()): boolean {
  const mod = mac ? event.metaKey : event.ctrlKey
  // 修飾キーなしのものは、修飾キー付き（⌘⌫ など）を別の操作に残しておく
  const bare = !event.metaKey && !event.ctrlKey && !event.altKey
  const key = event.key.toLowerCase()
  switch (hotkey) {
    case 'space':
      return bare && !event.shiftKey && key === ' '
    case 'delete':
      return bare && !event.shiftKey && (key === 'delete' || key === 'backspace')
    case 'enter':
      return bare && !event.shiftKey && key === 'enter'
    case 'escape':
      return bare && key === 'escape'
  }
  if (!mod || event.altKey) return false
  switch (hotkey) {
    case 'mod+s':
      return key === 's' && !event.shiftKey
    case 'mod+z':
      return key === 'z' && !event.shiftKey
    case 'mod+shift+z':
      return key === 'z' && event.shiftKey
    case 'mod+y':
      return key === 'y' && !event.shiftKey
    case 'mod+c':
      return key === 'c' && !event.shiftKey
    case 'mod+a':
      return key === 'a' && !event.shiftKey
  }
}

/** 入力欄やエディタの中か。そこでは取り消しなどを入力欄自身に任せる */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  // スライダーやチェックボックスは文字を打たないので、ショートカットを奪わない
  return !['range', 'checkbox', 'radio', 'button', 'submit'].includes(type)
}

/** Space・Enter で自分自身が動く部品（ボタン、つまみ、選択肢）。そこではその部品に任せる */
const CONTROL_SELECTOR =
  'button, a[href], summary, [role="button"], [role="slider"], [role="radio"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="treeitem"], [role="tab"]'

export function isControlTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CONTROL_SELECTOR) !== null
}

export interface HotkeyOptions {
  enabled?: boolean
  /** 入力欄の中でも効かせる（⌘S など） */
  inEditable?: boolean
  /** この要素の中にフォーカスがあるときだけ効かせる（一覧が自分のキーを持つとき） */
  scope?: RefObject<HTMLElement | null>
  /** 押しっぱなしの繰り返しも拾う */
  repeat?: boolean
}

/** 押されたキーをこのショートカットとして扱ってよいか（matchesHotkey の先の判定） */
export function shouldHandle(
  event: KeyboardEvent,
  hotkey: Hotkey,
  options: Pick<HotkeyOptions, 'inEditable' | 'repeat'> & { scope?: HTMLElement | null } = {}
): boolean {
  if (!matchesHotkey(event, hotkey)) return false
  // 近くの部品（ページ一覧・エディタなど）が先に処理したものは横取りしない
  if (event.defaultPrevented) return false
  if (event.repeat && !options.repeat) return false
  if (options.scope !== undefined) {
    if (!options.scope || !(event.target instanceof Node) || !options.scope.contains(event.target)) return false
  }
  if (!options.inEditable && isEditableTarget(event.target)) return false
  if ((hotkey === 'space' || hotkey === 'enter') && isControlTarget(event.target)) return false
  return true
}

/**
 * 画面全体のキーボードショートカット。
 * 既定では入力欄の中では反応しない（⌘S のように入力中でも効かせたいものは inEditable を付ける）。
 * 一覧やエディタが同じキーを自分で処理して preventDefault したときは動かない。
 */
export function useHotkey(
  hotkey: Hotkey,
  handler: (event: KeyboardEvent) => void,
  options: HotkeyOptions = {}
) {
  const { enabled = true, inEditable = false, scope, repeat = false } = options
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!shouldHandle(event, hotkey, { inEditable, repeat, scope: scope ? scope.current : undefined })) return
      event.preventDefault()
      handlerRef.current(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hotkey, enabled, inEditable, scope, repeat])
}

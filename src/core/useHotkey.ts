import { useEffect, useRef } from 'react'

/** `mod` は macOS では ⌘、それ以外では Ctrl */
export type Hotkey = 'mod+s' | 'mod+z' | 'mod+shift+z' | 'mod+y' | 'mod+c'

const isMac = () => /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export function matchesHotkey(event: KeyboardEvent, hotkey: Hotkey, mac = isMac()): boolean {
  const mod = mac ? event.metaKey : event.ctrlKey
  if (!mod || event.altKey) return false
  const key = event.key.toLowerCase()
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

/**
 * 画面全体のキーボードショートカット。
 * 既定では入力欄の中では反応しない（⌘S のように入力中でも効かせたいものは inEditable を付ける）。
 */
export function useHotkey(
  hotkey: Hotkey,
  handler: (event: KeyboardEvent) => void,
  options: { enabled?: boolean; inEditable?: boolean } = {}
) {
  const { enabled = true, inEditable = false } = options
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  })

  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (!matchesHotkey(event, hotkey)) return
      if (!inEditable && isEditableTarget(event.target)) return
      event.preventDefault()
      handlerRef.current(event)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [hotkey, enabled, inEditable])
}

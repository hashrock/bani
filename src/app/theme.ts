import { useSyncExternalStore } from 'react'

/*
 * 配色の切り替え。既定は OS の設定（prefers-color-scheme）に従い、ライト・ダークを選べば固定する。
 * 選んだ値は localStorage に置く。最初の描画で白く光らないよう、index.html の先頭でも同じ判定をして
 * <html> に .dark を付けておく（キーと判定を変えるときは index.html も合わせる）。
 */
export type ThemePreference = 'light' | 'dark' | 'system'
export type Theme = 'light' | 'dark'

export const THEME_PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system']

export const THEME_STORAGE_KEY = 'bani.theme'

export function parsePreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system'
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): Theme {
  if (preference === 'system') return systemDark ? 'dark' : 'light'
  return preference
}

/** index.html の theme-color。背景（--background）と同じにして、ブラウザの枠と画面をつなげる */
const THEME_COLOR: Record<Theme, string> = { light: '#ffffff', dark: '#0a0a0a' }

const listeners = new Set<() => void>()
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function readPreference(): ThemePreference {
  try {
    return parsePreference(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    // localStorage を読めない（プライベートモードなど）ときは OS に従う
    return 'system'
  }
}

let preference: ThemePreference = typeof window !== 'undefined' ? readPreference() : 'system'

const currentTheme = () => resolveTheme(preference, media?.matches ?? false)

function apply() {
  const theme = currentTheme()
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme])
  listeners.forEach((listener) => listener())
}

if (media) {
  media.addEventListener('change', apply)
  apply()
}

export function setThemePreference(next: ThemePreference): void {
  preference = next
  try {
    if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    // 保存できなくても、開いているあいだは選んだ配色にする
  }
  apply()
}

function subscribe(onChange: () => void) {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/** 選んだ値と、実際に使う配色（system を OS の設定で読み替えたもの） */
export function useTheme(): { preference: ThemePreference; theme: Theme } {
  const pref = useSyncExternalStore(subscribe, () => preference)
  const theme = useSyncExternalStore(subscribe, currentTheme)
  return { preference: pref, theme }
}

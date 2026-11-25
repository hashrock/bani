import { describe, expect, it } from 'vitest'
import { parsePreference, resolveTheme } from './theme'

describe('theme', () => {
  it('保存した値が読めなければ OS に従う', () => {
    expect(parsePreference('dark')).toBe('dark')
    expect(parsePreference('light')).toBe('light')
    expect(parsePreference(null)).toBe('system')
    expect(parsePreference('sepia')).toBe('system')
  })

  it('system だけが OS の設定で変わる', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })
})

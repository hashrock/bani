import { describe, expect, test } from 'vitest'
import { detectKind } from '../../app/intake'
import { LANGUAGES, LANGUAGE_EXTENSIONS, detectLanguage, detectSubtitle, extensionOf, withExtension } from './language'

describe('detectLanguage', () => {
  test.each([
    ['data.json', '', 'json'],
    ['tsconfig.jsonc', '', 'json'],
    ['index.HTML', 'text/html', 'html'],
    ['style.scss', '', 'css'],
    ['app.js', 'text/javascript', 'javascript'],
    ['app.mjs', '', 'javascript'],
    ['main.ts', '', 'typescript'],
    // OS は .ts を MPEG-TS とみなすことがある。テキストとして開いたなら拡張子を信じる
    ['main.ts', 'video/mp2t', 'typescript'],
    ['App.jsx', '', 'jsx'],
    ['App.tsx', '', 'tsx'],
    ['README.md', '', 'markdown'],
    ['feed.xml', 'application/xml', 'xml'],
    ['icon.svg', 'image/svg+xml', 'xml'],
    ['config.yml', '', 'yaml'],
    ['script.py', '', 'python'],
    ['query.sql', '', 'sql'],
    ['notes.txt', 'text/plain', 'plain'],
    ['data.csv', 'text/csv', 'plain'],
    ['movie.srt', '', 'plain'],
  ])('%s (%s) → %s', (name, type, expected) => {
    expect(detectLanguage({ name, type })).toBe(expected)
  })

  test('拡張子がなければ MIME で決める（charset は無視）', () => {
    expect(detectLanguage({ name: 'clipboard', type: 'application/json; charset=utf-8' })).toBe('json')
    expect(detectLanguage({ name: 'Makefile', type: '' })).toBe('plain')
    expect(detectLanguage({ name: '.gitignore', type: '' })).toBe('plain')
  })

  test('入口がテキストとして振り分ける拡張子のうち、言語を持つものは強調される', () => {
    for (const extension of ['json', 'html', 'css', 'js', 'jsx', 'tsx', 'md', 'xml', 'yaml', 'yml', 'py', 'sql']) {
      const name = `file.${extension}`
      expect(detectKind({ name, type: '' })).toBe('text')
      expect(detectLanguage({ name, type: '' })).not.toBe('plain')
    }
  })

  test('新規の文書の拡張子から、同じ言語に戻れる', () => {
    for (const id of LANGUAGES) {
      expect(detectLanguage({ name: `untitled.${LANGUAGE_EXTENSIONS[id]}`, type: '' })).toBe(id)
    }
  })
})

describe('detectSubtitle', () => {
  test('拡張子か MIME で字幕を見分ける', () => {
    expect(detectSubtitle({ name: 'a.SRT', type: '' })).toBe('srt')
    expect(detectSubtitle({ name: 'a.vtt', type: '' })).toBe('vtt')
    expect(detectSubtitle({ name: 'captions', type: 'text/vtt' })).toBe('vtt')
    expect(detectSubtitle({ name: 'a.txt', type: 'text/plain' })).toBeNull()
  })
})

describe('拡張子', () => {
  test('extensionOf は隠しファイルの先頭のドットを拡張子とみなさない', () => {
    expect(extensionOf('a.tar.GZ')).toBe('gz')
    expect(extensionOf('.env')).toBe('')
    expect(extensionOf('noext')).toBe('')
  })

  test('withExtension は付け替えるか足す', () => {
    expect(withExtension('movie.srt', 'vtt')).toBe('movie.vtt')
    expect(withExtension('movie', 'vtt')).toBe('movie.vtt')
    expect(withExtension('.hidden', 'txt')).toBe('.hidden.txt')
  })
})

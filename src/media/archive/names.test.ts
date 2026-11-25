import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  createPathRegistry,
  decodeEntryName,
  numberedName,
  pathKey,
  sanitizePath,
  sanitizeSegment,
} from './names'

const bytes = (...values: number[]) => new Uint8Array(values)
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0))

describe('decodeEntryName', () => {
  test('UTF-8 の印があれば UTF-8 として読む', () => {
    expect(decodeEntryName(new TextEncoder().encode('写真/夏.jpg'), true)).toEqual({
      name: '写真/夏.jpg',
      encoding: 'utf-8',
    })
  })

  test('印がなくても正しい UTF-8 なら UTF-8 として読む（macOS や 7-Zip の ZIP）', () => {
    expect(decodeEntryName(new TextEncoder().encode('資料.pdf'), false)).toEqual({ name: '資料.pdf', encoding: 'utf-8' })
  })

  test('Windows の Shift_JIS 名を読む', () => {
    // 日本語.txt
    expect(decodeEntryName(bytes(0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, ...ascii('.txt')), false)).toEqual({
      name: '日本語.txt',
      encoding: 'shift_jis',
    })
    // 半角カナ ｱｲｳ.txt（1 バイトの Shift_JIS）
    expect(decodeEntryName(bytes(0xb1, 0xb2, 0xb3, ...ascii('.txt')), false).name).toBe('ｱｲｳ.txt')
  })

  test('2 バイト目が 0x5C（\\）の文字（表・ソ）を区切りと取り違えない', () => {
    // 表/ソフト.txt
    const name = bytes(0x95, 0x5c, 0x2f, 0x83, 0x5c, 0x83, 0x74, 0x83, 0x67, ...ascii('.txt'))
    const decoded = decodeEntryName(name, false)
    expect(decoded).toEqual({ name: '表/ソフト.txt', encoding: 'shift_jis' })
    expect(sanitizePath(decoded.name)).toBe('表/ソフト.txt')
  })

  test('UTF-8 でも Shift_JIS でもないものは CP437 として読む', () => {
    // 0x82 のあとに 2 バイト目になれない空白、0xFF は Shift_JIS にない
    expect(decodeEntryName(bytes(0x82, 0x20, 0xff), false)).toEqual({ name: 'é \u00a0', encoding: 'cp437' })
  })

  test('どんな文字列も UTF-8 で書けば印の有無にかかわらずそのまま戻る', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme' }), fc.boolean(), (text, flag) => {
        expect(decodeEntryName(new TextEncoder().encode(text), flag)).toEqual({ name: text, encoding: 'utf-8' })
      })
    )
  })

  test('どんなバイト列でも例外を出さずに文字列を返す', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 64 }), fc.boolean(), (raw, flag) => {
        expect(typeof decodeEntryName(raw, flag).name).toBe('string')
      })
    )
  })
})

/** 危ないパスを作りやすいように、意地の悪い部品を多めに混ぜる */
const nastyPath = fc
  .array(
    fc.oneof(
      fc.constantFrom('..', '.', '', '/', '\\', 'C:', 'c:\\', '../', '..\\', ' ', 'a.', 'CON', 'nul.txt', '\u0000', '<>'),
      fc.string({ maxLength: 6 }),
      fc.string({ unit: 'grapheme', maxLength: 4 })
    ),
    { maxLength: 12 }
  )
  .map((parts) => parts.join(''))

describe('sanitizePath', () => {
  test('どんなパスも展開先のフォルダの外を指さない（zip-slip）', () => {
    fc.assert(
      fc.property(nastyPath, (raw) => {
        const safe = sanitizePath(raw)
        // 展開先からの深さをたどり、一度も根より上へ出ないことを確かめる（OS の解決と同じ規則）
        let depth = 0
        for (const segment of safe.split(/[/\\]/)) {
          if (segment === '..') depth--
          else if (segment !== '' && segment !== '.') depth++
          expect(depth).toBeGreaterThanOrEqual(0)
        }
        expect(safe.startsWith('/')).toBe(false)
        expect(safe).not.toContain('\\')
        if (safe !== '') {
          for (const segment of safe.split('/')) {
            expect(segment).not.toBe('')
            expect(segment).not.toBe('.')
            expect(segment).not.toBe('..')
            // eslint-disable-next-line no-control-regex
            expect(segment).not.toMatch(/[\u0000-\u001f<>:"|?*]|[ .]$/)
          }
        }
      })
    )
  })

  test('2 回かけても変わらない（冪等）', () => {
    fc.assert(
      fc.property(nastyPath, (raw) => {
        expect(sanitizePath(sanitizePath(raw))).toBe(sanitizePath(raw))
      })
    )
  })

  test('ふつうの相対パスはそのまま通す', () => {
    expect(sanitizePath('写真/2024/夏.jpg')).toBe('写真/2024/夏.jpg')
    expect(sanitizePath('folder/')).toBe('folder')
  })

  test.each([
    ['../../etc/passwd', 'etc/passwd'],
    ['/absolute/file.txt', 'absolute/file.txt'],
    ['C:\\Windows\\system.ini', 'Windows/system.ini'],
    ['a/../../b.txt', 'b.txt'],
    ['a/./b//c.txt', 'a/b/c.txt'],
    ['dir\\sub\\file.txt', 'dir/sub/file.txt'],
    ['con.txt', '_con.txt'],
    ['what?.txt', 'what_.txt'],
    ['trailing. ', 'trailing'],
  ])('%s → %s', (raw, expected) => {
    expect(sanitizePath(raw)).toBe(expected)
  })
})

describe('numberedName', () => {
  test.each([
    ['a.txt', 'a (2).txt'],
    ['archive.tar.gz', 'archive (2).tar.gz'],
    ['.gitignore', '.gitignore (2)'],
    ['README', 'README (2)'],
  ])('%s → %s', (name, expected) => {
    expect(numberedName(name, 2)).toBe(expected)
  })

  test('フォルダ名は拡張子を割らない', () => {
    expect(numberedName('v1.2', 3, true)).toBe('v1.2 (3)')
  })
})

/** 衝突が起きやすいよう、少ない部品からパスを組む */
const crowdedPath = fc
  .array(fc.constantFrom('a', 'A', 'b', 'a.txt', 'A.TXT', 'b.txt', 'a (2).txt', 'x.tar.gz'), {
    minLength: 1,
    maxLength: 3,
  })
  .map((parts) => parts.join('/'))

function assertConsistent(paths: readonly string[]) {
  const keys = paths.map(pathKey)
  expect(new Set(keys).size).toBe(keys.length)
  // どのファイルも、ほかのファイルの途中のフォルダと同じ名前にならない（展開できなくなる）
  const files = new Set(keys)
  for (const key of keys) {
    const parts = key.split('/')
    for (let i = 1; i < parts.length; i++) expect(files.has(parts.slice(0, i).join('/'))).toBe(false)
  }
  for (const path of paths) expect(sanitizePath(path)).toBe(path)
}

describe('createPathRegistry', () => {
  test('どんな順に確保しても、パスは一意で、ファイルとフォルダが同じ名前を取り合わない', () => {
    fc.assert(
      fc.property(fc.array(crowdedPath, { maxLength: 30 }), (paths) => {
        const registry = createPathRegistry()
        assertConsistent(paths.map((path) => registry.claimFile(path)))
      })
    )
  })

  test('同じ順に同じパスを渡せば同じ結果になる（一覧と展開で同じパスが付く）', () => {
    fc.assert(
      fc.property(fc.array(crowdedPath, { maxLength: 20 }), (paths) => {
        const first = createPathRegistry()
        const second = createPathRegistry()
        expect(paths.map((path) => first.claimFile(path))).toEqual(paths.map((path) => second.claimFile(path)))
      })
    )
  })

  test('重なりがなければ名前は変えない', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.stringMatching(/^[a-z]{1,8}\.txt$/), { maxLength: 20 }), (names) => {
        const registry = createPathRegistry()
        expect(names.map((name) => registry.claimFile(`dir/${name}`))).toEqual(names.map((name) => `dir/${name}`))
      })
    )
  })

  test('重なった名前には (2)、(3) と番号を付ける。大文字小文字の違いも重なりとみなす', () => {
    const registry = createPathRegistry()
    expect(['a.txt', 'a.txt', 'A.TXT'].map((path) => registry.claimFile(path))).toEqual([
      'a.txt',
      'a (2).txt',
      'A (3).TXT',
    ])
  })

  test('大文字小文字だけ違うフォルダは最初の表記にまとめる', () => {
    const registry = createPathRegistry()
    expect(registry.claimFile('Docs/a.txt')).toBe('Docs/a.txt')
    expect(registry.claimFile('docs/b.txt')).toBe('Docs/b.txt')
  })

  test('ファイルと同じ名前のフォルダはずらす', () => {
    const registry = createPathRegistry()
    expect(registry.claimFile('a')).toBe('a')
    expect(registry.claimFile('a/b.txt')).toBe('a (2)/b.txt')
  })
})

describe('sanitizeSegment', () => {
  test('区切り文字を含む名前は 1 つの名前のまま残す', () => {
    expect(sanitizeSegment('a/b\\c')).toBe('a_b_c')
  })
})

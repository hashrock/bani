import { describe, expect, it } from 'vitest'
import { EMBEDDED, collectLicenses, homepageOf } from './plugin'

const root = new URL('..', import.meta.url).pathname

describe('ライセンスの一覧', () => {
  const { packages, texts } = collectLicenses(root)
  const names = new Set(packages.map((item) => item.name))

  it('実行時の依存と、その先の依存を含む', () => {
    for (const name of ['react', 'scheduler', 'mediabunny', 'pdfjs-dist', 'libheif-js', 'libarchive.js', 'comlink']) {
      expect(names).toContain(name)
    }
  })

  it('開発にだけ使うもの・型だけのもの・Node でだけ使う別の OS 向けの部品は含めない', () => {
    for (const name of ['vite', 'vitest', 'typescript', 'tailwindcss', '@types/dom-webcodecs', '@napi-rs/canvas']) {
      expect(names).not.toContain(name)
    }
  })

  it('本文は重複を除いて 1 か所に置き、どの番号も texts の中を指す', () => {
    expect(new Set(texts).size).toBe(texts.length)
    for (const item of packages) {
      if (item.text !== undefined) expect(texts[item.text]).toBeTruthy()
    }
    const lgpl = packages.find((item) => item.name === 'libheif-js')
    expect(lgpl?.license).toBe('LGPL-3.0')
    expect(texts[lgpl!.text!]).toMatch(/GNU LESSER GENERAL PUBLIC LICENSE/)
  })

  it('WASM に組み込まれたものは、組み込んでいるパッケージが一覧にある', () => {
    for (const item of EMBEDDED) expect(names).toContain(item.embeddedIn)
  })
})

describe('homepageOf', () => {
  it('リポジトリの書き方の揺れを https のページに直し、開けないものは出さない', () => {
    expect(homepageOf({ repository: 'git+https://github.com/a/b.git' })).toBe('https://github.com/a/b')
    expect(homepageOf({ repository: { url: 'git://github.com/a/b.git' } })).toBe('https://github.com/a/b')
    expect(homepageOf({ repository: 'github:a/b' })).toBe('https://github.com/a/b')
    expect(homepageOf({ repository: 'a/b' })).toBe('https://github.com/a/b')
    expect(homepageOf({ repository: 'git+ssh://git@github.com/a/b.git' })).toBeUndefined()
    expect(homepageOf({ homepage: 'http://example.com' })).toBeUndefined()
    expect(homepageOf({})).toBeUndefined()
  })
})

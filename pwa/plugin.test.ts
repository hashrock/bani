import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findUncached, readPrecache, serviceWorker } from './plugin'

/*
 * オフラインで動くことの自動の確かめ。本物のビルドは重いので、Service Worker のプラグインに
 * ビルドの出力に見立てたファイルを渡し、出力したものがすべて事前キャッシュに入ることを見る。
 * 本物のビルドでも writeBundle が同じ照合をして、漏れがあれば `pnpm build` が失敗する。
 */

type Hook = (this: unknown, ...args: unknown[]) => unknown

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** プラグインを一通り動かし、出力のフォルダに書いた sw.js の中身を返す */
function build(bundle: Record<string, string>, publicFiles: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'bani-sw-'))
  roots.push(root)
  const publicDir = join(root, 'public')
  const outDir = join(root, 'dist')
  for (const [name, content] of Object.entries(publicFiles)) write(join(publicDir, name), content)

  const plugin = serviceWorker()
  ;(plugin.configResolved as Hook).call({}, { root, publicDir, build: { outDir: 'dist' } })

  let sw = ''
  const outputs = Object.fromEntries(
    Object.entries(bundle).map(([fileName, code]) => [
      fileName,
      fileName.endsWith('.js') ? { type: 'chunk', code } : { type: 'asset', source: code },
    ])
  )
  ;(plugin.generateBundle as Hook).call(
    {
      emitFile: (file: { fileName: string; source: string }) => {
        sw = file.source
      },
    },
    {},
    outputs
  )

  // vite が書き出すのと同じものを出力のフォルダに置く（public/ は丸ごと写される）
  for (const [name, content] of Object.entries(bundle)) write(join(outDir, name), content)
  for (const [name, content] of Object.entries(publicFiles)) write(join(outDir, name), content)
  write(join(outDir, 'sw.js'), sw)

  const check = () =>
    (plugin.writeBundle as Hook).call(
      {
        error: (message: string) => {
          throw new Error(message)
        },
      },
      {},
      {}
    )
  return { sw, outDir, check }
}

const BUNDLE = {
  'index.html': '<!doctype html>',
  'assets/index-abc.js': 'console.log(1)',
  'assets/index-abc.css': 'body{}',
  'assets/pdf.worker-def.mjs': 'self.onmessage=()=>{}',
  'assets/codec-123.wasm': '\0asm',
}
const PUBLIC = {
  'icon.svg': '<svg/>',
  'manifest.webmanifest': '{}',
  'gif.worker.js': 'gif',
  'icons/192.png': 'png',
  'sw.js': 'ignored',
}

describe('serviceWorker', () => {
  it('出力したファイルと public/ のファイルをすべて事前キャッシュに入れる（sw.js 自身は除く）', () => {
    const { sw, check } = build(BUNDLE, PUBLIC)
    const precache = readPrecache(sw)
    for (const name of [...Object.keys(BUNDLE), ...Object.keys(PUBLIC)]) {
      if (name === 'sw.js') expect(precache).not.toContain(name)
      else expect(precache).toContain(name)
    }
    expect(() => check()).not.toThrow()
  })

  it('一覧から漏れたファイルが出力にあれば、ビルドを失敗させる', () => {
    const { outDir, check } = build(BUNDLE, PUBLIC)
    write(join(outDir, 'assets/late-plugin.js'), 'x')
    expect(() => check()).toThrow(/assets\/late-plugin\.js/)
  })

  it('中身が変われば版も変わる（古いキャッシュを使い続けない）', () => {
    const version = (sw: string) => /const VERSION = "([0-9a-f]+)"/.exec(sw)?.[1]
    const a = version(build(BUNDLE, PUBLIC).sw)
    const b = version(build({ ...BUNDLE, 'assets/index-abc.js': 'console.log(2)' }, PUBLIC).sw)
    const c = version(build(BUNDLE, { ...PUBLIC, 'icon.svg': '<svg></svg>' }).sw)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(b).not.toBe(a)
    expect(c).not.toBe(a)
  })
})

describe('findUncached', () => {
  it('一覧にないものだけを返し、sw.js は数えない', () => {
    expect(findUncached(['a.js', 'sw.js', 'b.css'], ['a.js'])).toEqual(['b.css'])
  })
})

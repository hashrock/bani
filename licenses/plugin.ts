import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'

/**
 * 画面の「Bani について」に出すライセンスの一覧。
 * package.json の dependencies（実行時に配るもの）から辿れるパッケージを、
 * node_modules の package.json と LICENSE から集める。devDependencies は配らないので含めない。
 * 型だけのパッケージ（@types/*）はバンドルに入らないので除く。
 */
export interface LicenseEntry {
  name: string
  version: string
  /** SPDX の識別子（package.json の license） */
  license: string
  author?: string
  /** 元のリポジトリ・サイト。画面では文字のリンクとして出すだけで、自動では取りに行かない */
  homepage?: string
  /** LICENSE ファイルの本文（texts の何番目か）。同じ本文（MPL-2.0 など）は 1 つにまとめる。見つからなければ無い */
  text?: number
  /** npm のパッケージではなく、ほかのパッケージの WASM に組み込まれて配られるもの */
  embeddedIn?: string
}

/**
 * WASM に組み込まれて配られるライブラリ。node_modules からは辿れないので手で並べる。
 * 版は WASM の中の文字列で確かめたもの（わからないものは書かない）
 */
export const EMBEDDED: readonly LicenseEntry[] = [
  {
    name: 'LAME',
    version: '3.100',
    license: 'LGPL-2.0-or-later',
    homepage: 'https://lame.sourceforge.io/',
    embeddedIn: '@mediabunny/mp3-encoder',
  },
  {
    name: 'libFLAC',
    version: '',
    license: 'BSD-3-Clause',
    author: 'Xiph.Org Foundation',
    homepage: 'https://github.com/xiph/flac',
    embeddedIn: '@mediabunny/flac-encoder',
  },
  {
    name: 'libheif',
    version: '',
    license: 'LGPL-3.0',
    author: 'struktur AG',
    homepage: 'https://github.com/strukturag/libheif',
    embeddedIn: 'libheif-js',
  },
  {
    name: 'libde265',
    version: '',
    license: 'LGPL-3.0',
    author: 'struktur AG',
    homepage: 'https://github.com/strukturag/libde265',
    embeddedIn: 'libheif-js',
  },
  {
    name: 'dav1d',
    version: '',
    license: 'BSD-2-Clause',
    author: 'VideoLAN and dav1d authors',
    homepage: 'https://code.videolan.org/videolan/dav1d',
    embeddedIn: 'libheif-js',
  },
  {
    name: 'libarchive',
    version: '3.7.2',
    license: 'BSD-2-Clause',
    author: 'Tim Kientzle and libarchive contributors',
    homepage: 'https://github.com/libarchive/libarchive',
    embeddedIn: 'libarchive.js',
  },
  {
    name: 'zlib',
    version: '',
    license: 'Zlib',
    author: 'Jean-loup Gailly and Mark Adler',
    homepage: 'https://zlib.net/',
    embeddedIn: 'libarchive.js',
  },
  {
    name: 'bzip2',
    version: '1.0.6',
    license: 'bzip2-1.0.6',
    author: 'Julian Seward',
    homepage: 'https://sourceware.org/bzip2/',
    embeddedIn: 'libarchive.js',
  },
  {
    name: 'XZ Utils (liblzma)',
    version: '',
    license: '0BSD',
    author: 'Lasse Collin and XZ Utils contributors',
    homepage: 'https://tukaani.org/xz/',
    embeddedIn: 'libarchive.js',
  },
  {
    name: 'OpenSSL (libcrypto)',
    version: '',
    license: 'OpenSSL OR Apache-2.0',
    author: 'The OpenSSL Project',
    homepage: 'https://www.openssl.org/',
    embeddedIn: 'libarchive.js',
  },
]

interface PackageJson {
  name: string
  version: string
  license?: string | { type?: string }
  licenses?: { type?: string }[]
  author?: string | { name?: string }
  homepage?: string
  repository?: string | { url?: string }
  dependencies?: Record<string, string>
}

const LICENSE_FILE = /^(licen[cs]e|copying)(\.(md|txt))?$/i

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8')) as PackageJson

/** Node と同じく、置き場所から上へ node_modules/<name> を探す（pnpm の .pnpm の中でも兄弟として見つかる） */
export function findPackageDir(from: string, name: string): string | null {
  let dir = from
  for (;;) {
    const candidate = join(dir, 'node_modules', name, 'package.json')
    if (existsSync(candidate)) return realpathSync(dirname(candidate))
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function licenseOf(pkg: PackageJson): string {
  if (typeof pkg.license === 'string') return pkg.license
  if (pkg.license?.type) return pkg.license.type
  const types = (pkg.licenses ?? []).map((item) => item.type).filter(Boolean)
  return types.length > 0 ? types.join(' OR ') : 'UNKNOWN'
}

function authorOf(pkg: PackageJson): string | undefined {
  return typeof pkg.author === 'string' ? pkg.author : pkg.author?.name
}

/** 画面に出すのは https のページだけ（git+ssh などはそのまま開けない） */
export function homepageOf(pkg: Pick<PackageJson, 'homepage' | 'repository'>): string | undefined {
  const raw = pkg.homepage ?? (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url)
  if (!raw) return undefined
  const url = raw
    .replace(/^git\+/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/')
    .replace(/\.git(#.*)?$/, '')
  if (/^[\w.-]+\/[\w.-]+$/.test(url)) return `https://github.com/${url}`
  return /^https:\/\//.test(url) ? url : undefined
}

function licenseText(dir: string): string | undefined {
  const file = readdirSync(dir).find((name) => LICENSE_FILE.test(name))
  return file ? readFileSync(join(dir, file), 'utf8').trim() : undefined
}

/** 集めた一覧。本文は重複を除いて texts に置く */
export interface LicenseList {
  packages: LicenseEntry[]
  texts: string[]
}

/**
 * root の dependencies から辿れる実行時のパッケージを、名前の順に集める。
 * optionalDependencies は辿らない（pdfjs-dist の @napi-rs/canvas のように、Node でだけ使う別の OS 向けの部品で、ブラウザには配られない）
 */
export function collectLicenses(root: string): LicenseList {
  const rootPkg = readJson(join(root, 'package.json'))
  const seen = new Map<string, LicenseEntry>()
  const texts: string[] = []
  const textIndex = (text: string | undefined) => {
    if (text === undefined) return undefined
    const found = texts.indexOf(text)
    return found >= 0 ? found : texts.push(text) - 1
  }
  const queue: { from: string; name: string }[] = Object.keys(rootPkg.dependencies ?? {}).map((name) => ({
    from: root,
    name,
  }))

  while (queue.length > 0) {
    const { from, name } = queue.shift()!
    if (name.startsWith('@types/')) continue
    const dir = findPackageDir(from, name)
    if (!dir) throw new Error(`ライセンスの一覧: ${name} が node_modules に見つからない`)
    const pkg = readJson(join(dir, 'package.json'))
    const key = `${pkg.name}@${pkg.version}`
    if (seen.has(key)) continue
    seen.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: licenseOf(pkg),
      author: authorOf(pkg),
      homepage: homepageOf(pkg),
      text: textIndex(licenseText(dir)),
    })
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      queue.push({ from: dir, name: dep })
    }
  }

  const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { packages, texts }
}

const VIRTUAL_ID = 'virtual:bani-licenses'
const RESOLVED_ID = `\0${VIRTUAL_ID}`

/**
 * `import('virtual:bani-licenses')` で版とライセンスの一覧を読めるようにする。
 * 本文だけで数百 KB になるので、画面が遅延読み込みしたときだけ取り込まれる別の塊にする
 * （ビルドの出力に入るので、Service Worker の事前キャッシュでオフラインでも読める）
 */
export function licenses(root: string): Plugin {
  return {
    name: 'bani-licenses',
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined
    },
    load(id) {
      if (id !== RESOLVED_ID) return undefined
      const { version } = readJson(join(root, 'package.json'))
      const { packages, texts } = collectLicenses(root)
      return [
        `export const version = ${JSON.stringify(version)}`,
        `export const packages = ${JSON.stringify([...packages, ...EMBEDDED])}`,
        `export const texts = ${JSON.stringify(texts)}`,
      ].join('\n')
    },
  }
}

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'

/** キャッシュに入れない public/ のファイル（Service Worker 自身は別に出力する） */
const EXCLUDED = new Set(['sw.js'])

export function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? listFiles(path) : [path]
  })
}

const toUrlPath = (path: string) => path.split(sep).join('/')

/** 出力のフォルダにあるのに事前キャッシュの一覧にないファイル。オフラインでは読めなくなる */
export function findUncached(outputFiles: readonly string[], precache: readonly string[]): string[] {
  const cached = new Set(precache)
  return outputFiles.filter((file) => !EXCLUDED.has(file) && !cached.has(file)).sort()
}

/** できあがった sw.js から事前キャッシュの一覧を読み戻す */
export function readPrecache(swSource: string): string[] {
  const match = /const PRECACHE = (\[[^\]]*\])/.exec(swSource)
  if (!match) throw new Error('sw.js に事前キャッシュの一覧が見つからない')
  return JSON.parse(match[1]) as string[]
}

/**
 * ビルドの出力から Service Worker を作る。
 * 出力したファイルと public/ のファイルをすべて事前キャッシュの一覧に入れ、
 * それらの中身から版を決めるので、何か変われば必ず新しい Service Worker になる。
 * 開発サーバーでは何もしない（HMR とキャッシュが衝突するため）。
 *
 * 書き出した後に出力のフォルダを見直し、一覧から漏れたファイルがあればビルドを失敗させる
 * （後から足したプラグインや public/ の外から出たファイルがオフラインで欠けるのを、毎回のビルドで止める）。
 */
export function serviceWorker(): Plugin {
  let config: ResolvedConfig
  let precache: string[] = []

  return {
    name: 'bani-service-worker',
    apply: 'build',
    // index.html はビルドの最後のほうで出力されるので、それより後に一覧を作る
    enforce: 'post',
    configResolved(resolved) {
      config = resolved
    },
    generateBundle(_options, bundle) {
      const hash = createHash('sha256')
      const entries: string[] = []

      for (const [fileName, output] of Object.entries(bundle)) {
        entries.push(fileName)
        hash.update(fileName)
        hash.update(output.type === 'chunk' ? output.code : output.source)
      }

      const publicDir = config.publicDir
      if (publicDir) {
        for (const path of listFiles(publicDir)) {
          const fileName = toUrlPath(relative(publicDir, path))
          if (EXCLUDED.has(fileName)) continue
          entries.push(fileName)
          hash.update(fileName)
          hash.update(readFileSync(path))
        }
      }

      // 起点の URL（`./`）は index.html を返すので、一覧には index.html だけを入れる
      precache = [...new Set(entries)].sort()
      const version = hash.digest('hex').slice(0, 16)

      const template = readFileSync(new URL('./sw.js', import.meta.url), 'utf8')
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: template
          .replace('self.__BANI_PRECACHE__', JSON.stringify(precache))
          .replace('self.__BANI_VERSION__', JSON.stringify(version)),
      })
    },
    writeBundle() {
      const outDir = resolve(config.root, config.build.outDir)
      const written = listFiles(outDir).map((path) => toUrlPath(relative(outDir, path)))
      const missing = findUncached(written, precache)
      if (missing.length > 0) {
        this.error(`オフラインで読めないファイルがある（Service Worker の事前キャッシュに入っていない）: ${missing.join(', ')}`)
      }
    },
  }
}

/**
 * テスト専用: node の API でファイルの見本（src/test/fixtures/）や WASM を読む。
 * アプリの型検査（tsconfig.app.json）に node の型を混ぜないように、型を付けずに動的 import で借りる。
 */
interface NodeFs {
  readFileSync(path: URL | string): Uint8Array
}
interface NodeModule {
  createRequire(from: string): { (id: string): unknown; resolve(id: string): string }
}

const nodeImport = <T>(id: string) => import(/* @vite-ignore */ id) as Promise<T>

export async function readFixture(name: string): Promise<Uint8Array<ArrayBuffer>> {
  const fs = await nodeImport<NodeFs>('node:fs')
  return new Uint8Array(fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url)))
}

/** CommonJS のパッケージ（libheif-js）を読み込み、あわせて同梱ファイルの場所も引けるようにする */
export async function nodeRequire() {
  const { createRequire } = await nodeImport<NodeModule>('node:module')
  const fs = await nodeImport<NodeFs>('node:fs')
  const require = createRequire(import.meta.url)
  return {
    require: (id: string) => require(id),
    readPackageFile: (id: string) => new Uint8Array(fs.readFileSync(require.resolve(id))),
  }
}

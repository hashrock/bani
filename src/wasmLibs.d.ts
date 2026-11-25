/**
 * 型を持たない WASM ライブラリ（Emscripten の工場関数）の宣言。
 * 使う側（src/media/image/heif.ts・src/media/archive/libarchive.ts）が必要な形だけを型にするので、ここは unknown で受ける。
 */
interface EmscriptenModuleOptions {
  locateFile?: (path: string, prefix: string) => string
  wasmBinary?: ArrayBuffer | Uint8Array
  onRuntimeInitialized?: () => void
  onAbort?: (reason: unknown) => void
  print?: (...text: unknown[]) => void
  printErr?: (...text: unknown[]) => void
}

declare module 'libheif-js/libheif-wasm/libheif.js' {
  /** 初期化はモジュールを返したあと非同期に終わる（onRuntimeInitialized で知る） */
  const createLibHeif: (options?: EmscriptenModuleOptions) => unknown
  export default createLibHeif
}

declare module 'libarchive.js/src/webworker/wasm-gen/libarchive.js' {
  const createLibarchive: (options?: EmscriptenModuleOptions) => Promise<unknown>
  export default createLibarchive
}

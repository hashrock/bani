/**
 * libheif（WASM 約 1.5MB）のブラウザでの読み込み。HEIC を開いたときに初めて import される
 * （decode.ts から動的 import）ので、HEIC を使わない人の起動には影響しない。
 *
 * libheif は LGPL-3.0。アプリ本体とは別のファイル（JS のチャンクと .wasm）として配り、
 * 実行時に読み込むだけなので、差し替えができる形を保っている。
 */
import createLibHeif from 'libheif-js/libheif-wasm/libheif.js'
import wasmUrl from 'libheif-js/libheif-wasm/libheif.wasm?url'
import { HeifUnavailableError, decodeHeif, readHeifSize } from './heif'
import type { LibHeif, PixelBuffer } from './heif'

let loading: Promise<LibHeif> | null = null

/**
 * この libheif-js は wasm を同期でコンパイルする作りで、URL だけ渡すと同期の取得を試みて失敗する。
 * そこで中身を先に fetch して wasmBinary として渡す（Service Worker のキャッシュもここで効く）
 */
async function fetchWasm(): Promise<ArrayBuffer> {
  try {
    const response = await fetch(wasmUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.arrayBuffer()
  } catch (error) {
    throw new HeifUnavailableError({ cause: error })
  }
}

function loadLibHeif(): Promise<LibHeif> {
  loading ??= fetchWasm()
    .then(
      (wasmBinary) =>
        new Promise<LibHeif>((resolve, reject) => {
          // onRuntimeInitialized は工場関数が返る前に呼ばれることもあるので、返り値は後から拾う
          let module: LibHeif | null = null
          let ready = false
          const settle = () => (module && ready ? resolve(module) : undefined)
          module = createLibHeif({
            wasmBinary,
            onRuntimeInitialized: () => {
              ready = true
              queueMicrotask(settle)
            },
            // コンパイルできないと Emscripten は abort する
            onAbort: (reason: unknown) => reject(new HeifUnavailableError({ cause: reason })),
            print: () => {},
            printErr: () => {},
          }) as LibHeif
          settle()
        })
    )
    .catch((error: unknown) => {
      // オフラインで取れなかったときなどに、次に開いたとき取り直せるようにする
      loading = null
      throw error
    })
  return loading
}

export async function probeHeif(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  return readHeifSize(await loadLibHeif(), bytes)
}

export async function decodeHeifToImageData(bytes: Uint8Array): Promise<ImageData> {
  const pixels: PixelBuffer = await decodeHeif(await loadLibHeif(), bytes)
  return new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height)
}

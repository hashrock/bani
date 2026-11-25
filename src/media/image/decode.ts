/**
 * 画像のデコード。まずブラウザに任せ、読めなかった HEIC / HEIF だけ libheif（WASM）に回す。
 * Safari は HEIC を自前で読めるので、WASM を読み込むのはそれ以外のブラウザで HEIC を開いたときだけ。
 *
 * このファイルはブラウザの API に頼るので vitest（node）では動かさない。
 * libheif を使う部分は heif.ts にあり、そちらは node で本物の HEIC を使って確かめている。
 */
import { createWorkerClient, type WorkerClient } from '../workerClient'
import { HeifDecodeError, HeifUnavailableError } from './heif'
import { sniffImageMime } from './metadata'

const isHeif = (bytes: Uint8Array) => sniffImageMime(bytes) === 'image/heic'

/** 形式の判定に足りる先頭（ftyp の箱） */
const SNIFF_LENGTH = 32

/** heifWorker.ts とのやりとり */
export type HeifWorkerRequest = { type: 'probe' | 'decode'; file: Blob }
export type HeifWorkerResult = { width: number; height: number } | ImageBitmap

/** HEIC を読む窓口。Worker で読む（画面を止めない）か、Worker のない環境では同じスレッドで読む */
interface HeifReader {
  probe(file: Blob): Promise<{ width: number; height: number }>
  decode(file: Blob, signal?: AbortSignal): Promise<ImageBitmap>
}

let heifReader: HeifReader | null = null

function workerReader(): HeifReader {
  const client: WorkerClient<HeifWorkerRequest, HeifWorkerResult> = createWorkerClient({
    // libheif ごと Worker のチャンクに入るので、このファイルも HEIC を開くまで取りに行かない（pwa/plugin.ts の LAZY）
    create: () => new Worker(new URL('./heifWorker.ts', import.meta.url), { type: 'module' }),
    revive: ({ name, message }) => {
      if (name === 'HeifUnavailableError') return new HeifUnavailableError()
      if (name === 'HeifDecodeError') return new HeifDecodeError(message)
      return Object.assign(new Error(message), { name })
    },
    // Worker のスクリプトを取れない（オフラインで、まだ一度も HEIC を開いていない）
    loadError: (event) => new HeifUnavailableError({ cause: event.message }),
  })
  return {
    probe: async (file) => (await client.call({ type: 'probe', file })) as { width: number; height: number },
    decode: async (file, signal) => (await client.call({ type: 'decode', file }, { signal })) as ImageBitmap,
  }
}

/** Worker のない環境の予備。libheif の部品は初めて使うときに取りに行く */
function inProcessReader(): HeifReader {
  const load = () =>
    import('./heifLoader').catch((error: unknown) => {
      throw new HeifUnavailableError({ cause: error })
    })
  const bytesOf = async (file: Blob) => new Uint8Array(await file.arrayBuffer())
  return {
    probe: async (file) => (await load()).probeHeif(await bytesOf(file)),
    decode: async (file) => createImageBitmap(await (await load()).decodeHeifToImageData(await bytesOf(file))),
  }
}

const getHeifReader = () => (heifReader ??= typeof Worker === 'undefined' ? inProcessReader() : workerReader())

async function head(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, SNIFF_LENGTH).arrayBuffer())
}

/**
 * 見た目どおりの向きでデコードした ImageBitmap を返す。呼び出し側が close する。
 * ブラウザでも libheif でも読めなければ例外を投げる（部品を取れなかったときは HeifUnavailableError）。
 * signal で止めると、HEIC のデコード中なら Worker ごと止める。
 */
export async function decodeImage(file: Blob, signal?: AbortSignal): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (error) {
    if (!isHeif(await head(file))) throw error
    // libheif が向きを反映済みなので、ここで EXIF を見て回し直さない
    return getHeifReader().decode(file, signal)
  }
}

/** ブラウザが読めない HEIC の寸法を libheif で読む。HEIC でなければ null */
export async function probeHeifFallback(file: Blob, bytes: Uint8Array): Promise<{ width: number; height: number } | null> {
  if (!isHeif(bytes)) return null
  return getHeifReader().probe(file)
}

/**
 * 画像のデコード。まずブラウザに任せ、読めなかった HEIC / HEIF だけ libheif（WASM）に回す。
 * Safari は HEIC を自前で読めるので、WASM を読み込むのはそれ以外のブラウザで HEIC を開いたときだけ。
 *
 * このファイルはブラウザの API に頼るので vitest（node）では動かさない。
 * libheif を使う部分は heif.ts にあり、そちらは node で本物の HEIC を使って確かめている。
 */
import { HeifUnavailableError } from './heif'
import { sniffImageMime } from './metadata'

const isHeif = (bytes: Uint8Array) => sniffImageMime(bytes) === 'image/heic'

/** 形式の判定に足りる先頭（ftyp の箱） */
const SNIFF_LENGTH = 32

/** libheif の部品は初めて使うときに取りに行く。オフラインで取れなければ、それと分かるエラーにする */
const loadHeif = () =>
  import('./heifLoader').catch((error: unknown) => {
    throw new HeifUnavailableError({ cause: error })
  })

async function head(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, SNIFF_LENGTH).arrayBuffer())
}

/**
 * 見た目どおりの向きでデコードした ImageBitmap を返す。呼び出し側が close する。
 * ブラウザでも libheif でも読めなければ例外を投げる（部品を取れなかったときは HeifUnavailableError）。
 */
export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (error) {
    if (!isHeif(await head(file))) throw error
    const { decodeHeifToImageData } = await loadHeif()
    const imageData = await decodeHeifToImageData(new Uint8Array(await file.arrayBuffer()))
    // libheif が向きを反映済みなので、ここで EXIF を見て回し直さない
    return createImageBitmap(imageData)
  }
}

/** ブラウザが読めない HEIC の寸法を libheif で読む。HEIC でなければ null */
export async function probeHeifFallback(bytes: Uint8Array): Promise<{ width: number; height: number } | null> {
  if (!isHeif(bytes)) return null
  const { probeHeif } = await loadHeif()
  return probeHeif(bytes)
}

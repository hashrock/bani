/**
 * HEIC / HEIF（iPhone の写真）を libheif（WASM）で読む部分のうち、ライブラリの読み込み方に依らないところ。
 * Chrome・Firefox は HEIC を createImageBitmap でデコードできないので、そのときだけここを使う。
 * ライブラリは引数で受け取るので、vitest（node）でも本物の libheif で確かめられる。
 * ブラウザでの読み込み（wasm の場所の解決・遅延読み込み）は heifLoader.ts にある。
 */
import { MAX_DIMENSION } from './recipe'

/** libheif-js（libheif-wasm/libheif.js）のうち、ここで使う部分だけの型 */
export interface LibHeif {
  HeifDecoder: new () => HeifDecoder
}

interface HeifDecoder {
  decode(bytes: Uint8Array): HeifImage[]
  /** libheif の文脈（embind のオブジェクト）。解放しないと WASM のメモリに残り続ける */
  decoder: { delete(): void } | null
}

interface HeifImage {
  get_width(): number
  get_height(): number
  is_primary(): boolean
  display(target: PixelBuffer, callback: (result: PixelBuffer | null) => void): void
  free(): void
}

/** ImageData と同じ形。node には ImageData がないので素のオブジェクトで受け渡す */
export interface PixelBuffer {
  data: Uint8ClampedArray
  width: number
  height: number
}

export class HeifDecodeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'HeifDecodeError'
  }
}

/**
 * libheif の WASM を取得できなかった（オフラインで、まだ一度も HEIC を開いておらずキャッシュにない）。
 * 画面では「一度オンラインで開けば次からはオフラインでも開ける」と案内する
 */
export class HeifUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super('HEIC を読む部品（libheif）を読み込めませんでした', options)
    this.name = 'HeifUnavailableError'
  }
}

/** エラーの原因（cause）をたどり、HEIC の部品が取れなかったせいかを調べる */
export function isHeifUnavailable(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if (current instanceof HeifUnavailableError) return true
  }
  return false
}

/**
 * HEIF の中から主画像を選んで fn に渡し、終わったら必ず解放する。
 * 連写（バースト）や深度マップなど複数の画像が入っていることがあるが、写真アプリが見せるのは主画像なので、
 * 主画像の印がなければ先頭を使う。
 */
async function withPrimaryImage<T>(lib: LibHeif, bytes: Uint8Array, fn: (image: HeifImage) => Promise<T> | T): Promise<T> {
  const decoder = new lib.HeifDecoder()
  let images: HeifImage[] = []
  try {
    images = decoder.decode(bytes)
    const primary = images.find((image) => image.is_primary()) ?? images[0]
    if (!primary) throw new HeifDecodeError('HEIC / HEIF の中に画像が見つかりません')
    return await fn(primary)
  } finally {
    for (const image of images) image.free()
    decoder.decoder?.delete()
  }
}

/**
 * 寸法だけを読む。画素はデコードしないので速い。
 * libheif は回転（irot）・反転（imir）を反映した寸法を返す。HEIF では EXIF ではなくこちらが向きの正本で、
 * Safari も同じ向きで描く。
 */
export function readHeifSize(lib: LibHeif, bytes: Uint8Array): Promise<{ width: number; height: number }> {
  return withPrimaryImage(lib, bytes, (image) => ({ width: image.get_width(), height: image.get_height() }))
}

/** 主画像を RGBA の画素にデコードする。向きは反映済み */
export function decodeHeif(lib: LibHeif, bytes: Uint8Array): Promise<PixelBuffer> {
  return withPrimaryImage(lib, bytes, (image) => {
    const width = image.get_width()
    const height = image.get_height()
    // 壊れたファイルの寸法をそのまま信じて巨大な配列を確保しないように、書き出せる上限で断る
    if (!(width > 0 && height > 0 && width <= MAX_DIMENSION && height <= MAX_DIMENSION)) {
      throw new HeifDecodeError(`画像の寸法が扱える範囲を超えています（${width}×${height}）`)
    }
    const target: PixelBuffer = { data: new Uint8ClampedArray(width * height * 4), width, height }
    return new Promise<PixelBuffer>((resolve, reject) => {
      image.display(target, (result) =>
        result ? resolve(result) : reject(new HeifDecodeError('HEIC / HEIF をデコードできませんでした'))
      )
    })
  })
}

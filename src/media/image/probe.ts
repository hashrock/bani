import { isSvgBlob, probeHeifFallback } from './decode'
import { EMPTY_METADATA, orientationSwapsAxes, parseImageHeader, sniffImageMime } from './metadata'
import type { ImageHeader, ImageMetadata } from './metadata'
import type { ImageSize } from './recipe'
import { sanitizeSvg } from './svg'

export interface ImageInfo extends ImageSize {
  /** 見た目どおりの寸法（EXIF の向きを反映済み）。レシピの座標はこの寸法に対して取る */
  width: number
  height: number
  mime: string
  fileSize: number
  metadata: ImageMetadata
  /**
   * 付帯情報を読めたか。AVIF・HEIC などヘッダを解釈しない形式では false で、
   * metadata は「なし」ではなく「不明」を意味する
   */
  metadataKnown: boolean
}

/** ヘッダから見た目どおりの寸法を決める。ブラウザは既定で EXIF の向きを反映して描く */
export function imageInfoFromHeader(header: ImageHeader, fileSize: number): ImageInfo {
  const swap = orientationSwapsAxes(header.metadata.orientation)
  return {
    width: swap ? header.storedHeight : header.storedWidth,
    height: swap ? header.storedWidth : header.storedHeight,
    mime: header.mime,
    fileSize,
    metadata: header.metadata,
    metadataKnown: true,
  }
}

/**
 * 画像の寸法・形式・付帯情報を読む。
 * JPEG / PNG / WebP / GIF / BMP はヘッダを読むだけで、デコードはしない。
 * それ以外はブラウザにデコードさせて寸法だけを得る（付帯情報は不明になる）。
 * ブラウザが読めない HEIC / HEIF は libheif（WASM）を読み込んで寸法を得る。
 * SVG は width / height / viewBox から寸法を決める（読めない SVG は SvgParseError）。
 * どれでも読めなければ例外を投げる。
 */
export async function probeImage(file: Blob): Promise<ImageInfo> {
  if (await isSvgBlob(file)) {
    // SVG は書かれた大きさ（1 倍、整数に丸めたもの）を寸法にする。decodeImage が既定で描く大きさと同じ
    const { size } = sanitizeSvg(await file.text())
    return { ...size, mime: 'image/svg+xml', fileSize: file.size, metadata: EMPTY_METADATA, metadataKnown: false }
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const header = parseImageHeader(bytes)
  if (header) return imageInfoFromHeader(header, file.size)

  // ここから先はブラウザでしか動かない（テストしていない）
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (error) {
    const heif = await probeHeifFallback(file, bytes).catch((heifError: unknown) => {
      throw new Error('この画像は読み込めません', { cause: heifError })
    })
    if (!heif) throw new Error('この画像は読み込めません', { cause: error })
    return {
      ...heif,
      mime: 'image/heic',
      fileSize: file.size,
      metadata: EMPTY_METADATA,
      metadataKnown: false,
    }
  }
  try {
    return {
      width: bitmap.width,
      height: bitmap.height,
      mime: sniffImageMime(bytes) ?? (file.type || 'application/octet-stream'),
      fileSize: file.size,
      metadata: EMPTY_METADATA,
      metadataKnown: false,
    }
  } finally {
    bitmap.close()
  }
}

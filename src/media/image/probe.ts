import { EMPTY_METADATA, orientationSwapsAxes, parseImageHeader, sniffImageMime } from './metadata'
import type { ImageHeader, ImageMetadata } from './metadata'
import type { ImageSize } from './recipe'

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
 * どちらでも読めなければ例外を投げる。
 */
export async function probeImage(file: Blob): Promise<ImageInfo> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const header = parseImageHeader(bytes)
  if (header) return imageInfoFromHeader(header, file.size)

  // ここから先はブラウザでしか動かない（テストしていない）
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch (error) {
    throw new Error('この画像は読み込めません', { cause: error })
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

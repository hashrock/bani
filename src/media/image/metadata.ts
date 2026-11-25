/**
 * 画像ファイル先頭のバイト列から、寸法・形式・付帯情報（EXIF や位置情報）を読む。
 * デコードはせず、ブラウザにも依存しない純粋な処理だけを置く。
 *
 * 壊れたファイルや途中で切れたファイルでも例外は投げず、読めたところまでを返す。
 * 位置情報の有無は「書き出すと消える」ことを利用者に見せるための判断材料なので、
 * 見落とすより読めなかったと分かるほうがよい。そのため寸法が読めなければ null を返す。
 */

/** EXIF の Orientation（1〜8）。1 が無回転 */
export type ExifOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8

export interface ImageMetadata {
  /** EXIF ブロックを持つ */
  exif: boolean
  /** EXIF に緯度か経度が入っている */
  gps: boolean
  /** XMP を持つ（編集ソフトの履歴や位置情報が入ることがある） */
  xmp: boolean
  /** その他の付帯情報（JPEG のコメント・IPTC、PNG のテキストチャンクなど） */
  other: boolean
  /** EXIF の向き。なければ 1 */
  orientation: ExifOrientation
}

export interface ImageHeader {
  mime: string
  /** ファイルに書かれた画素の寸法（EXIF の向きは反映しない） */
  storedWidth: number
  storedHeight: number
  metadata: ImageMetadata
}

export const EMPTY_METADATA: ImageMetadata = {
  exif: false,
  gps: false,
  xmp: false,
  other: false,
  orientation: 1,
}

/** 向き 5〜8 は 90 度回すので、見た目の幅と高さが入れ替わる */
export function orientationSwapsAxes(orientation: ExifOrientation): boolean {
  return orientation >= 5
}

/**
 * 形式だけを判定する。寸法を読めない形式（AVIF・HEIC）も含む。
 * 拡張子や File.type は当てにならないので中身の署名で決める。
 */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, 0, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp'
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(bytes, 0, 2) === 'BM') return 'image/bmp'
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (['heic', 'heix', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic'
  }
  return null
}

/** 先頭バイト列を読む。寸法まで読めた場合だけ値を返す */
export function parseImageHeader(bytes: Uint8Array): ImageHeader | null {
  try {
    switch (sniffImageMime(bytes)) {
      case 'image/jpeg':
        return parseJpeg(bytes)
      case 'image/png':
        return parsePng(bytes)
      case 'image/webp':
        return parseWebp(bytes)
      case 'image/gif':
        return parseGif(bytes)
      case 'image/bmp':
        return parseBmp(bytes)
      default:
        return null
    }
  } catch {
    // 境界は個別に確かめているが、見落としがあっても読み取り失敗として扱う
    return null
  }
}

// --- EXIF (TIFF) ---

const TAG_ORIENTATION = 0x0112
const TAG_GPS_IFD = 0x8825
const TAG_GPS_LATITUDE = 0x0002
const TAG_GPS_LONGITUDE = 0x0004

export interface ExifSummary {
  gps: boolean
  orientation: ExifOrientation
}

/**
 * TIFF 形式の EXIF 本体（"II*\0" / "MM\0*" から始まる）を読む。
 * GPS IFD があっても版番号だけで座標を持たない機種があるので、
 * 緯度か経度のタグがあるときだけ位置情報ありとみなす。
 */
export function parseExifTiff(bytes: Uint8Array, start = 0): ExifSummary {
  const summary: ExifSummary = { gps: false, orientation: 1 }
  const order = ascii(bytes, start, 2)
  if (order !== 'II' && order !== 'MM') return summary
  const little = order === 'II'
  const u16 = (offset: number) => readU16(bytes, start + offset, little)
  const u32 = (offset: number) => readU32(bytes, start + offset, little)
  if (u16(2) !== 42) return summary

  const entries = readIfd(bytes, start, u32(4), little)
  for (const entry of entries) {
    if (entry.tag === TAG_ORIENTATION) {
      // SHORT 値は値フィールドの先頭 2 バイトに詰めて入る
      const value = u16(entry.valueOffset)
      if (value !== null && value >= 1 && value <= 8) summary.orientation = value as ExifOrientation
    } else if (entry.tag === TAG_GPS_IFD) {
      const gpsEntries = readIfd(bytes, start, u32(entry.valueOffset), little)
      summary.gps = gpsEntries.some((e) => e.tag === TAG_GPS_LATITUDE || e.tag === TAG_GPS_LONGITUDE)
    }
  }
  return summary
}

interface IfdEntry {
  tag: number
  /** TIFF 先頭からの、値フィールド（12 バイトのエントリの末尾 4 バイト）の位置 */
  valueOffset: number
}

/** IFD のエントリを読む。範囲外を指していれば空、途中で切れていれば読めた分だけ */
function readIfd(bytes: Uint8Array, start: number, offset: number | null, little: boolean): IfdEntry[] {
  if (offset === null || offset < 8) return []
  const count = readU16(bytes, start + offset, little)
  if (count === null) return []
  const entries: IfdEntry[] = []
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12
    const tag = readU16(bytes, start + at, little)
    if (tag === null || start + at + 12 > bytes.length) break
    entries.push({ tag, valueOffset: at + 8 })
  }
  return entries
}

function exifToMetadata(metadata: ImageMetadata, bytes: Uint8Array, start: number): ImageMetadata {
  const exif = parseExifTiff(bytes, start)
  return { ...metadata, exif: true, gps: metadata.gps || exif.gps, orientation: exif.orientation }
}

// --- JPEG ---

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00] // "Exif\0\0"
const XMP_HEADER = 'http://ns.adobe.com/xap/1.0/\0'

function parseJpeg(bytes: Uint8Array): ImageHeader | null {
  let metadata = EMPTY_METADATA
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]
    // マーカー前の詰め物の 0xFF は読み飛ばす
    if (marker === 0xff) {
      offset++
      continue
    }
    // 長さを持たない単独マーカー
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    // 画像データに入る前に SOF が出てこなければ寸法は分からない
    if (marker === 0xd9 || marker === 0xda) return null
    const length = readU16(bytes, offset + 2, false)
    if (length === null || length < 2) return null
    const payload = offset + 4
    const payloadLength = length - 2

    if (marker === 0xe1) {
      if (startsWith(bytes, payload, EXIF_HEADER)) {
        metadata = exifToMetadata(metadata, bytes, payload + EXIF_HEADER.length)
      } else if (ascii(bytes, payload, XMP_HEADER.length) === XMP_HEADER) {
        metadata = { ...metadata, xmp: true }
      }
    } else if (marker === 0xed || marker === 0xfe) {
      // APP13（Photoshop / IPTC）とコメント
      metadata = { ...metadata, other: true }
    } else if (isSofMarker(marker)) {
      if (payloadLength < 5) return null
      const height = readU16(bytes, payload + 1, false)
      const width = readU16(bytes, payload + 3, false)
      if (!width || !height) return null
      // 付帯情報は SOF より前の APPn に置かれるので、ここで読み終えてよい
      return { mime: 'image/jpeg', storedWidth: width, storedHeight: height, metadata }
    }
    offset = payload + payloadLength
  }
  return null
}

/** SOF0〜SOF15 のうち DHT(C4)・JPG(C8)・DAC(CC) を除いたもの */
function isSofMarker(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

// --- PNG ---

function parsePng(bytes: Uint8Array): ImageHeader | null {
  if (ascii(bytes, 12, 4) !== 'IHDR') return null
  const width = readU32(bytes, 16, false)
  const height = readU32(bytes, 20, false)
  if (!width || !height) return null
  let metadata = EMPTY_METADATA
  let offset = 8
  while (offset + 8 <= bytes.length) {
    const length = readU32(bytes, offset, false)
    if (length === null) break
    const type = ascii(bytes, offset + 4, 4)
    const data = offset + 8
    if (type === 'IEND') break
    if (type === 'eXIf') {
      metadata = exifToMetadata(metadata, bytes, data)
    } else if (type === 'iTXt' && ascii(bytes, data, 18) === 'XML:com.adobe.xmp\0') {
      metadata = { ...metadata, xmp: true }
    } else if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      metadata = { ...metadata, other: true }
    }
    // 長さ + 種別 + 本体 + CRC
    offset = data + length + 4
  }
  return { mime: 'image/png', storedWidth: width, storedHeight: height, metadata }
}

// --- WebP ---

function parseWebp(bytes: Uint8Array): ImageHeader | null {
  let metadata = EMPTY_METADATA
  let size: { width: number; height: number } | null = null
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const type = ascii(bytes, offset, 4)
    const length = readU32(bytes, offset + 4, true)
    if (length === null) break
    const data = offset + 8
    if (type === 'VP8X' && size === null) {
      const w = readU24(bytes, data + 4)
      const h = readU24(bytes, data + 7)
      if (w !== null && h !== null) size = { width: w + 1, height: h + 1 }
    } else if (type === 'VP8 ' && size === null) {
      // フレームタグ 3 バイト + 開始コード 9D 01 2A の後に 14 ビットずつ
      if (startsWith(bytes, data + 3, [0x9d, 0x01, 0x2a])) {
        const w = readU16(bytes, data + 6, true)
        const h = readU16(bytes, data + 8, true)
        if (w !== null && h !== null) size = { width: w & 0x3fff, height: h & 0x3fff }
      }
    } else if (type === 'VP8L' && size === null) {
      const bits = bytes[data] === 0x2f ? readU32(bytes, data + 1, true) : null
      if (bits !== null) size = { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    } else if (type === 'EXIF') {
      // "Exif\0\0" を前置する書き出し器もある
      const start = startsWith(bytes, data, EXIF_HEADER) ? data + EXIF_HEADER.length : data
      metadata = exifToMetadata(metadata, bytes, start)
    } else if (type === 'XMP ') {
      metadata = { ...metadata, xmp: true }
    }
    // チャンクは偶数バイト境界にそろえて並ぶ
    offset = data + length + (length % 2)
  }
  if (!size || !size.width || !size.height) return null
  return { mime: 'image/webp', storedWidth: size.width, storedHeight: size.height, metadata }
}

// --- GIF / BMP（付帯情報は扱わず、寸法だけ） ---

function parseGif(bytes: Uint8Array): ImageHeader | null {
  const width = readU16(bytes, 6, true)
  const height = readU16(bytes, 8, true)
  if (!width || !height) return null
  return { mime: 'image/gif', storedWidth: width, storedHeight: height, metadata: EMPTY_METADATA }
}

function parseBmp(bytes: Uint8Array): ImageHeader | null {
  const width = readU32(bytes, 18, true)
  const rawHeight = readU32(bytes, 22, true)
  if (!width || rawHeight === null) return null
  // 高さが負（符号付き）なら上から下へ並ぶ形式で、寸法としては絶対値
  const height = Math.abs(rawHeight | 0)
  if (!height || (width | 0) <= 0) return null
  return { mime: 'image/bmp', storedWidth: width, storedHeight: height, metadata: EMPTY_METADATA }
}

// --- バイト読み取り。範囲外は null ---

function readU16(bytes: Uint8Array, offset: number, little: boolean): number | null {
  if (offset < 0 || offset + 2 > bytes.length) return null
  return little ? bytes[offset] | (bytes[offset + 1] << 8) : (bytes[offset] << 8) | bytes[offset + 1]
}

function readU24(bytes: Uint8Array, offset: number): number | null {
  if (offset < 0 || offset + 3 > bytes.length) return null
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function readU32(bytes: Uint8Array, offset: number, little: boolean): number | null {
  if (offset < 0 || offset + 4 > bytes.length) return null
  const b = [bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]
  const [b0, b1, b2, b3] = little ? [b[3], b[2], b[1], b[0]] : b
  // ビット演算だと符号付きになるので掛け算で組む
  return b0 * 0x1000000 + ((b1 << 16) | (b2 << 8) | b3)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  if (offset < 0 || offset + length > bytes.length) return ''
  return String.fromCharCode(...bytes.subarray(offset, offset + length))
}

function startsWith(bytes: Uint8Array, offset: number, prefix: readonly number[]): boolean {
  if (offset < 0 || offset + prefix.length > bytes.length) return false
  return prefix.every((b, i) => bytes[offset + i] === b)
}

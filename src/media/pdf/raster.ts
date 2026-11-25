/**
 * ページを画像にするときの、純粋な計算（大きさ・ファイル名・サイズの見込み）。
 * pdf.js には依存しないので node のテストから読める。実際に描くのは rasterize.ts（ブラウザ専用）。
 */

/** ページを書き出す画像の形式。PDF のページは透明を持たないので、この 2 つで足りる */
export type PdfImageFormat = 'png' | 'jpeg'

/** 解像度の決め方。印刷の感覚なら DPI、画面に貼るなら長い辺の px で決めるほうがわかりやすい */
export type PdfRasterResolution = { kind: 'dpi'; dpi: number } | { kind: 'longEdge'; pixels: number }

export interface PdfImageSettings {
  format: PdfImageFormat
  /** 1〜100。JPEG のときだけ効く */
  quality: number
  resolution: PdfRasterResolution
}

export interface PdfCompressSettings {
  dpi: number
  /** 1〜100 の JPEG の画質 */
  quality: number
}

export const MIN_DPI = 36
export const MAX_DPI = 600
export const MIN_LONG_EDGE = 16
/**
 * canvas の上限。Safari（iOS を含む）は面積がおよそ 1677 万 px を超えると何も描かないので、
 * どのブラウザでも描ける大きさに抑える。A4 なら 300 DPI（約 870 万 px）までは縮めずに描ける
 */
export const MAX_CANVAS_SIDE = 16384
export const MAX_CANVAS_AREA = 16_777_216

/** 1 pt は 1/72 インチ。PDF のページの大きさは pt で持つ */
const POINTS_PER_INCH = 72

export const IMAGE_EXTENSION: Record<PdfImageFormat, string> = { png: 'png', jpeg: 'jpg' }
export const IMAGE_MIME: Record<PdfImageFormat, string> = { png: 'image/png', jpeg: 'image/jpeg' }

export interface RasterSize {
  /** 描く画像の大きさ（px） */
  width: number
  height: number
  /** 1 pt を何 px にするか */
  scale: number
  /** canvas の上限に当たって、頼まれたより小さく描くか */
  clamped: boolean
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/**
 * 見た目の大きさ（回転を当てたあとの pt）のページを、どの大きさの画像にするか。
 * 指定がおかしな値（0 や NaN）でも、1px 以上・canvas の上限以下の大きさを返す。
 */
export function rasterSize(page: { width: number; height: number }, resolution: PdfRasterResolution): RasterSize {
  const width = Math.max(page.width, 1e-3)
  const height = Math.max(page.height, 1e-3)
  const requested =
    resolution.kind === 'dpi'
      ? clamp(resolution.dpi || MIN_DPI, MIN_DPI, MAX_DPI) / POINTS_PER_INCH
      : Math.max(resolution.pixels || MIN_LONG_EDGE, MIN_LONG_EDGE) / Math.max(width, height)
  const limit = Math.min(
    MAX_CANVAS_SIDE / Math.max(width, height),
    Math.sqrt(MAX_CANVAS_AREA / (width * height))
  )
  const scale = Math.min(requested, limit)
  // 丸めで上限をわずかに超えないよう、上限に当たったときは切り捨てる
  const round = scale < requested ? Math.floor : Math.round
  return {
    width: clamp(round(width * scale), 1, MAX_CANVAS_SIDE),
    height: clamp(round(height * scale), 1, MAX_CANVAS_SIDE),
    scale,
    clamped: scale < requested,
  }
}

/**
 * ページ画像のファイル名。番号は「いまの並びでのページ番号」で、ファイルの一覧で順に並ぶよう
 * 全体のページ数の桁にそろえて 0 を詰める（report-p01.png … report-p12.png）。
 */
export function pageImageNames(
  stem: string,
  numbers: readonly number[],
  total: number,
  format: PdfImageFormat
): string[] {
  const digits = String(Math.max(total, ...numbers, 1)).length
  return numbers.map((number) => `${stem}-p${String(number).padStart(digits, '0')}.${IMAGE_EXTENSION[format]}`)
}

/**
 * サイズを見込むために実際に描くページの位置。全部描くと遅いので、先頭・中ほど・末尾から少しだけ取る
 * （表紙だけ写真、本文は文字、のような文書でも偏りにくい）
 */
export function samplePositions(count: number, max = 3): number[] {
  if (count <= 0 || max <= 0) return []
  if (count <= max) return Array.from({ length: count }, (_, index) => index)
  if (max === 1) return [0]
  const positions = Array.from({ length: max }, (_, index) => Math.round((index * (count - 1)) / (max - 1)))
  return [...new Set(positions)]
}

// 画像だけのページを並べた PDF の、画像のほかにかかるおおよその量（ページの辞書・相互参照など）
const PDF_BASE_BYTES = 1024
const PDF_PAGE_BYTES = 320

/**
 * 描いてみた何ページかの大きさから、全体の大きさを見込む。
 * asPdf なら画像を並べた PDF（圧縮）の大きさ、そうでなければ画像ファイルの合計。
 */
export function extrapolateSize(sampleBytes: readonly number[], count: number, asPdf: boolean): number {
  if (count <= 0 || sampleBytes.length === 0) return 0
  const mean = sampleBytes.reduce((sum, bytes) => sum + bytes, 0) / sampleBytes.length
  const images = Math.round(mean * count)
  return asPdf ? images + PDF_BASE_BYTES + PDF_PAGE_BYTES * count : images
}

/** 圧縮の設定を、ページを画像にする設定に言い換える（圧縮は JPEG で描いて並べ直すだけ） */
export const compressImageSettings = (settings: PdfCompressSettings): PdfImageSettings => ({
  format: 'jpeg',
  quality: settings.quality,
  resolution: { kind: 'dpi', dpi: settings.dpi },
})

/** canvas.toBlob の画質（0〜1）。1〜100 の外は端に寄せる */
export const encoderQuality = (quality: number) => clamp(Math.round(quality) || 1, 1, 100) / 100

import type { PdfCompressSettings, PdfImageSettings, PdfPageRef } from '../../media/pdf'

/**
 * 「出力」の手順で選ぶもの。PDF はページの編集をそのまま（劣化しない）、
 * 画像はページを 1 枚ずつ画像ファイルに、圧縮はページを JPEG に描き直した PDF にする
 */
export type PdfOutputKind = 'pdf' | 'images' | 'compress'

/** 画像にするページ。選んだページがなければ、選んだページの指定でもすべてを書き出す */
export type PageScope = 'all' | 'selected'

export interface PdfOutputSettings {
  kind: PdfOutputKind
  images: PdfImageSettings
  scope: PageScope
  compress: PdfCompressSettings
}

// 開いた PDF をそのまま保存できるよう、利用者が選ぶまでは PDF（元と同じ形式）にしておく
export const DEFAULT_OUTPUT: PdfOutputSettings = {
  kind: 'pdf',
  images: { format: 'png', quality: 90, resolution: { kind: 'dpi', dpi: 150 } },
  scope: 'all',
  compress: { dpi: 150, quality: 70 },
}

export const DPI_PRESETS = [72, 150, 300] as const
export const LONG_EDGE_PRESETS = [1080, 2048, 4096] as const
export const COMPRESS_DPI_PRESETS = [72, 110, 150, 200] as const

/**
 * 書き出すページと、その「いまの並びでのページ番号」（1 始まり、ファイル名に使う）。
 * selected は昇順の位置（selectedIndices の結果）
 */
export function targetPages(
  pages: readonly PdfPageRef[],
  selected: readonly number[],
  scope: PageScope
): { pages: PdfPageRef[]; numbers: number[] } {
  const positions =
    scope === 'selected' && selected.length > 0
      ? selected.filter((index) => index >= 0 && index < pages.length)
      : pages.map((_, index) => index)
  return { pages: positions.map((index) => pages[index]), numbers: positions.map((index) => index + 1) }
}

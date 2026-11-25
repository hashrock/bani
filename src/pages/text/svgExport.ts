import type { ImageFormat } from '../../media/image/output'
import type { SvgRasterOptions } from '../../media/image/svg'

/** テキストの画面で SVG を画像として書き出す設定。別の SVG を開いても残す */
export interface SvgExportSettings {
  sizeMode: 'scale' | 'width' | 'dpi'
  scale: number
  /** 幅（px）。空欄なら null（元の幅） */
  width: number | null
  dpi: number
  /** 背景色。null なら透明（透過できない形式では白） */
  background: string | null
  format: Extract<ImageFormat, 'png' | 'jpeg' | 'webp'>
}

export const DEFAULT_SVG_EXPORT: SvgExportSettings = {
  sizeMode: 'scale',
  scale: 2,
  width: null,
  dpi: 300,
  background: null,
  format: 'png',
}

export const SVG_EXPORT_SCALES = [1, 2, 4] as const
export const SVG_EXPORT_FORMATS = ['png', 'jpeg', 'webp'] as const
/** 非可逆の形式の画質。この画面では選ばせない（細かく選ぶなら画像の画面や一括変換で） */
export const SVG_EXPORT_QUALITY = 92

/** 画面の設定から、描く大きさの指定を作る。選んでいない方式の値は使わない */
export function rasterOptionsOf(settings: SvgExportSettings): SvgRasterOptions {
  switch (settings.sizeMode) {
    case 'width':
      return settings.width === null ? {} : { width: settings.width }
    case 'dpi':
      return { dpi: settings.dpi }
    case 'scale':
      return { scale: settings.scale }
  }
}

/** 下見に描く倍率。枠（box × box の CSS px）に収まる大きさを、画面の画素密度で描く */
export function previewScale(intrinsic: { width: number; height: number }, box: number, pixelRatio: number): number {
  const fit = Math.min(box / intrinsic.width, box / intrinsic.height)
  return fit * Math.max(1, pixelRatio)
}

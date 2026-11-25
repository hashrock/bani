/** アニメーションの出力設定。ブラウザに依存しない */
import type { GifDither, GifPalette } from './types'

export type AnimationFormat = 'gif' | 'webp' | 'mp4' | 'webm'

export interface AnimationOutput {
  format: AnimationFormat
  /** GIF の色数（2〜256） */
  colors: number
  dither: GifDither
  palette: GifPalette
  /** WebP の画質（1〜100）。100 は可逆 */
  quality: number
}

export const DEFAULT_ANIMATION_OUTPUT: AnimationOutput = {
  format: 'gif',
  colors: 256,
  dither: 'floydSteinberg',
  palette: 'global',
  quality: 85,
}

export const ANIMATION_FORMATS: Record<AnimationFormat, { mime: string; extension: string; alpha: boolean; loops: boolean }> = {
  gif: { mime: 'image/gif', extension: 'gif', alpha: true, loops: true },
  webp: { mime: 'image/webp', extension: 'webp', alpha: true, loops: true },
  // 動画は透過もループ回数も持てない（透過は白で塗る）
  mp4: { mime: 'video/mp4', extension: 'mp4', alpha: false, loops: false },
  webm: { mime: 'video/webm', extension: 'webm', alpha: false, loops: false },
}

export const COLOR_PRESETS = [256, 128, 64, 32, 16] as const

/** 開いた GIF などの名前から、拡張子を付け替えた保存名を作る */
export function animationFilename(name: string | null, format: AnimationFormat): string {
  const stem = (name ?? '').replace(/\.[^./\\]+$/, '') || 'animation'
  return `${stem}.${ANIMATION_FORMATS[format].extension}`
}

/** 入力の MIME から、選ぶまでの出力形式（元と同じ形式）。GIF 以外の WebP も、書けるなら WebP のまま */
export function defaultAnimationFormat(mime: string | null, canWebp: boolean): AnimationFormat {
  if (mime === 'image/webp' && canWebp) return 'webp'
  return 'gif'
}

/** 寸法をそろえる。H.264 などは奇数の寸法を受け付けないので、動画は偶数に切り上げる */
export const videoDimension = (value: number) => Math.max(2, Math.ceil(value / 2) * 2)

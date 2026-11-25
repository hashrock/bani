/** GIF・アニメーションのエンジンの公開窓口。UI からはここだけを読み込む */
export * from './recipe'
export * from './output'
export * from './render'
export * from './decode'
export { isAnimatedImage, sniffAnimatedFormat, SNIFF_BYTES } from './detect'
export type { GifDither, GifPalette } from './types'

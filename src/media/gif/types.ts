/** GIF・アニメーションのエンジンで共有する形 */

/** 読んだアニメーション（キャンバス全体の RGBA、重ね合わせ済み） */
export interface DecodedAnimation {
  width: number
  height: number
  /** 再生する回数。0 は無限 */
  plays: number
  frames: { rgba: Uint8ClampedArray; duration: number }[]
}

/** ディザ（減色したときの色の混ぜ方） */
export type GifDither = 'none' | 'floydSteinberg' | 'ordered'

/** パレットを全フレームで 1 つにするか、フレームごとに作るか */
export type GifPalette = 'global' | 'local'

export interface GifEncodeOptions {
  width: number
  height: number
  /** 再生する回数。0 は無限、1 は 1 回だけ（ループの拡張を書かない） */
  plays: number
  /** 色数（2〜256）。透過があれば 1 色を透明に使う */
  colors: number
  dither: GifDither
  palette: GifPalette
}

export interface GifEncodeFrame {
  /** width × height × 4 の RGBA */
  rgba: Uint8ClampedArray
  /** 表示時間（ミリ秒） */
  duration: number
}

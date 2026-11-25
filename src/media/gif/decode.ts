/**
 * アニメーション（と、フレームとして足す静止画）を ImageBitmap の並びに読む。ブラウザの API に頼る。
 *
 * - ImageDecoder（WebCodecs）が使えればそれで読む。GIF・APNG・アニメーション WebP のどれも、
 *   重ね合わせと後始末を反映したキャンバス全体の絵で返ってくる
 * - 使えないブラウザでは、GIF だけを自前のデコーダ（gifDecode.ts）で読む。
 *   APNG・WebP は 1 枚目だけになる（ブラウザの画像の読み込みに任せる）
 * - 静止画は画像の画面と同じ decodeImage（HEIC も読める）
 */
import { decodeImage } from '../image'
import { createAbortError, throwIfAborted } from '../../utils/abort'
import { sniffAnimatedFormat } from './detect'
import { decodeGif } from './gifDecode'
import { DEFAULT_DURATION } from './recipe'
import { fitToCanvas } from './render'

export interface AnimationFrame {
  bitmap: ImageBitmap
  /** 元の表示時間（ミリ秒） */
  duration: number
}

/** 読んだ入力。フレームはどれもキャンバス全体（width × height）の絵 */
export interface AnimationSource {
  file: File
  width: number
  height: number
  /** 再生する回数（0 は無限）。静止画は 0 */
  plays: number
  frames: AnimationFrame[]
  mime: string
}

/** ブラウザが 20ms 未満を 100ms に読み替えるのに合わせる */
const normalizeDuration = (ms: number | null | undefined) =>
  ms === null || ms === undefined || !Number.isFinite(ms) || ms < 20 ? DEFAULT_DURATION : ms

const MIME_OF = { gif: 'image/gif', png: 'image/png', webp: 'image/webp' } as const

export const closeSource = (source: AnimationSource) => source.frames.forEach((frame) => frame.bitmap.close())

async function decodeWithImageDecoder(
  file: File,
  bytes: Uint8Array<ArrayBuffer>,
  mime: string,
  signal?: AbortSignal
): Promise<AnimationSource | null> {
  if (typeof ImageDecoder === 'undefined') return null
  if (!(await ImageDecoder.isTypeSupported(mime).catch(() => false))) return null
  const decoder = new ImageDecoder({ data: bytes, type: mime })
  const frames: AnimationFrame[] = []
  try {
    await decoder.tracks.ready
    const track = decoder.tracks.selectedTrack
    if (!track) return null
    await decoder.completed
    let width = 0
    let height = 0
    for (let index = 0; index < track.frameCount; index++) {
      throwIfAborted(signal)
      const { image } = await decoder.decode({ frameIndex: index })
      try {
        width ||= image.displayWidth
        height ||= image.displayHeight
        // VideoFrame の表示時間はマイクロ秒
        const duration = normalizeDuration(image.duration === null ? null : image.duration / 1000)
        frames.push({ bitmap: await createImageBitmap(image), duration })
      } finally {
        image.close()
      }
    }
    if (frames.length === 0) return null
    // repetitionCount は「繰り返す回数」。Infinity が無限、0 が 1 回だけ
    const repetition = track.repetitionCount
    const plays = !Number.isFinite(repetition) ? 0 : Math.max(1, Math.round(repetition) + 1)
    return { file, width, height, plays, frames, mime }
  } catch (error) {
    frames.forEach((frame) => frame.bitmap.close())
    throw error
  } finally {
    decoder.close()
  }
}

/**
 * ファイルを読む。アニメーションでなければ 1 フレームの入力として返す（静止画をフレームとして足すとき）。
 * 読めなければ例外。呼び出し側は使い終えたら closeSource で絵を手放す
 */
export async function decodeAnimation(file: File, signal?: AbortSignal): Promise<AnimationSource> {
  throwIfAborted(signal)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const format = sniffAnimatedFormat(bytes)
  if (format) {
    const mime = MIME_OF[format]
    try {
      const decoded = await decodeWithImageDecoder(file, bytes, mime, signal)
      if (decoded) return decoded
    } catch (error) {
      if (signal?.aborted) throw createAbortError()
      // ImageDecoder が読めなくても、GIF なら自前で読み直す
      if (format !== 'gif') throw error
      console.warn('ImageDecoder failed, falling back to the built-in GIF decoder:', error)
    }
    if (format === 'gif') {
      const gif = decodeGif(bytes)
      const frames: AnimationFrame[] = []
      for (const frame of gif.frames) {
        throwIfAborted(signal)
        frames.push({
          bitmap: await createImageBitmap(new ImageData(frame.rgba as Uint8ClampedArray<ArrayBuffer>, gif.width, gif.height)),
          duration: frame.duration,
        })
      }
      return { file, width: gif.width, height: gif.height, plays: gif.plays, frames, mime }
    }
  }
  const bitmap = await decodeImage(file, signal)
  return {
    file,
    width: bitmap.width,
    height: bitmap.height,
    plays: 0,
    frames: [{ bitmap, duration: DEFAULT_DURATION }],
    mime: file.type || 'image/*',
  }
}

/**
 * 入力の絵をキャンバスの大きさにそろえた入力を返す（収めて真ん中へ、余りは透明）。
 * 同じ大きさならそのまま返す。そろえたら元の絵は手放す。
 * プレビュー・サムネイル・切り抜きの座標を、どの入力でもキャンバスの座標で扱えるようにするため
 */
export async function fitSourceToCanvas(source: AnimationSource, width: number, height: number): Promise<AnimationSource> {
  if (source.width === width && source.height === height) return source
  const frames: AnimationFrame[] = []
  for (const frame of source.frames) {
    const fitted = fitToCanvas(frame.bitmap, width, height)
    frames.push({ bitmap: await createImageBitmap(fitted), duration: frame.duration })
    frame.bitmap.close()
  }
  return { ...source, width, height, frames }
}

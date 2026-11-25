/**
 * GIF のエンコードを画面の外で行う Worker。減色・ディザ・LZW は同期の重い計算なので、
 * ここで回して画面を止めない。中断は workerClient が Worker ごと止めて行う。
 */
import { serveWorkerRequests } from '../workerClient'
import { encodeGif } from './gifEncode'
import type { GifEncodeOptions } from './types'

export interface GifEncodeRequest {
  frames: { rgba: Uint8ClampedArray; duration: number }[]
  options: GifEncodeOptions
}

serveWorkerRequests<GifEncodeRequest, Uint8Array>(async ({ frames, options }, report) => {
  const bytes = encodeGif(frames, options, report)
  return { value: bytes, transfer: [bytes.buffer] }
})

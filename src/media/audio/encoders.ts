import { Quality, canEncodeAudio } from 'mediabunny'
import { AUDIO_FORMATS } from './output'
import type { AudioFormat } from './types'

/**
 * WebCodecs が持たない MP3 / FLAC のエンコーダを足す。
 * どちらも WASM を Worker ごと JS に埋め込んだ拡張で、外部から何も取りに行かない（オフラインで動く）。
 * 数百 KB あるので、その形式を初めて使うときにだけ読み込む。
 */
const pending = new Map<AudioFormat, Promise<void>>()

export function ensureAudioEncoder(format: AudioFormat): Promise<void> {
  const loaded = pending.get(format)
  if (loaded) return loaded
  const loading = loadEncoder(format)
  // 読み込みに失敗したら次の呼び出しでやり直せるよう、覚えた約束を捨てる
  loading.catch(() => pending.delete(format))
  pending.set(format, loading)
  return loading
}

async function loadEncoder(format: AudioFormat): Promise<void> {
  switch (format) {
    case 'mp3': {
      const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder')
      registerMp3Encoder()
      return
    }
    case 'flac': {
      const { registerFlacEncoder } = await import('@mediabunny/flac-encoder')
      registerFlacEncoder()
      return
    }
    // AAC / Opus は WebCodecs、WAV は mediabunny 自身が書く
    case 'm4a':
    case 'opus':
    case 'wav':
      return
  }
}

/**
 * この環境でその形式を書き出せるか。画面で選べない形式を灰色にするのに使う。
 * AAC は OS のエンコーダ頼みなので、ブラウザと OS の組み合わせによっては false になる。
 */
export async function canEncodeAudioFormat(
  format: AudioFormat,
  options: { sampleRate?: number; channels?: number; bitrate?: number } = {}
): Promise<boolean> {
  const spec = AUDIO_FORMATS[format]
  try {
    await ensureAudioEncoder(format)
    return await canEncodeAudio(spec.codec, {
      sampleRate: options.sampleRate ?? spec.sampleRates[spec.sampleRates.length - 1],
      numberOfChannels: options.channels ?? 2,
      ...(!spec.lossless && { quality: new Quality({ bitrate: options.bitrate ?? spec.bitrate.default }) }),
    })
  } catch {
    return false
  }
}

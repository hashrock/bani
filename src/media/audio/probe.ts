import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import type { MetadataTags } from 'mediabunny'
import type { AudioInfo } from './types'

/** 音声トラックが 1 本もないファイルを渡したとき */
export class NoAudioTrackError extends Error {
  constructor() {
    super('The file has no audio track')
    this.name = 'NoAudioTrackError'
  }
}

/**
 * 元ファイルから音声の情報を読む。音声ファイルでも動画ファイルでもよく、
 * 動画なら主となる音声トラックを見る。ヘッダを読むだけでデコードはしない。
 */
export async function probeAudio(file: Blob): Promise<AudioInfo> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track) throw new NoAudioTrackError()

    const [duration, sampleRate, channels, codec, videoTrack, tags] = await Promise.all([
      input.computeDuration(),
      track.getSampleRate(),
      track.getNumberOfChannels(),
      track.getCodec(),
      input.getPrimaryVideoTrack(),
      readTags(input),
    ])
    return { duration, sampleRate, channels, codec, tags, hasVideo: videoTrack !== null }
  } finally {
    input.dispose()
  }
}

/** タグは欠けていても支障がないので、読めなければ null にして他の情報を返す */
async function readTags(input: Input): Promise<MetadataTags | null> {
  try {
    return await input.getMetadataTags()
  } catch (err) {
    console.warn('Failed to get metadata tags:', err)
    return null
  }
}

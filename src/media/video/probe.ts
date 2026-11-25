import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import type { MetadataTags } from 'mediabunny'
import type { VideoInfo } from './types'

/** 元ファイルから尺・寸法・コーデックを読む。ヘッダを読むだけでデコードはしない */
export async function probeVideo(file: Blob): Promise<VideoInfo> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const [duration, videoTrack, audioTrack, tags] = await Promise.all([
      input.computeDuration(),
      input.getPrimaryVideoTrack(),
      input.getPrimaryAudioTrack(),
      readTags(input),
    ])

    return {
      duration,
      // 向きのメタデータを反映した見た目どおりの寸法。<video> の表示やレシピの座標と揃える
      dimensions: videoTrack
        ? { width: await videoTrack.getDisplayWidth(), height: await videoTrack.getDisplayHeight() }
        : null,
      videoCodec: (await videoTrack?.getCodec()) ?? null,
      audioCodec: (await audioTrack?.getCodec()) ?? null,
      tags,
    }
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

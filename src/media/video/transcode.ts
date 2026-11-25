import {
  ALL_FORMATS,
  AudioSample,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  TextSubtitleSource,
  WebMOutputFormat,
} from 'mediabunny'
import type {
  ConversionAudioOptions,
  ConversionOptions,
  ConversionVideoOptions,
  InputAudioTrack,
  VideoSample,
} from 'mediabunny'
import { concatPlanes, createResampler, createTimeStretcher } from '../audio/timeStretch'
import type { StreamingStretcher } from '../audio/timeStretch'
import { serializeVtt } from '../text/subtitles'
import type { SubtitleCue } from '../text/subtitles'
import { throwIfAborted } from '../../utils/abort'
import type { Trim } from '../../types'
import type { RenderOptions, RenderedFile } from '../types'
import {
  TARGET_AUDIO_BITRATE,
  VIDEO_MIME_TYPES,
  resolveMaxShortSide,
  usesTargetSize,
  videoBitrate,
  videoFilename,
} from './output'
import { editedSize, rotatedCrop } from './recipe'
import { drawSubtitlesAt } from './subtitleDraw'
import { cuesForOutput, effectiveSubtitleMode } from './timing'
import type { VideoInfo, VideoOutput, VideoRecipe } from './types'

/** 速くしたときの映像のフレームレートの上限。4 倍速で 30fps の元を全部残すと 120fps になり、重いうえに再生できない端末がある */
const MAX_OUTPUT_FPS = 60

/**
 * mediabunny の Conversion で MP4 / WebM に書き出す。
 * 回転・切り抜き・拡大縮小・音声の除去は Conversion の機能で、機能がないものは process フックで行う:
 * - 反転: 1 フレームずつ Canvas に鏡写しにする（mediabunny は回転 → 切り抜き → 拡大縮小 → process の順に掛けるので、
 *   反転は最後になり、レシピの順と食い違わない）
 * - 字幕の焼き込み: 反転のあとの絵に描く（文字は鏡写しにしない）
 * - 速さ: 映像はタイムスタンプを t / speed に書き換え、音声は timeStretch で 1 / speed の長さにする。
 *   process に届くタイムスタンプはどちらも区間の先頭を 0 とした元の時間軸なので、同じ式で揃う
 * 字幕を同梱するときは、字幕トラックを自分で足すため composable な Conversion にして、出力を自分で始め・閉じる。
 * mediabunny が書ける字幕は WebVTT だけ（MP4 は wvtt、WebM は S_TEXT/WEBVTT）。
 */
export async function transcodeVideo(
  file: Blob & { name?: string },
  recipe: VideoRecipe | null,
  info: Pick<VideoInfo, 'dimensions'> | null,
  output: VideoOutput,
  trim: Trim | null,
  options: RenderOptions & { duration?: number } = {}
): Promise<RenderedFile> {
  const { signal, onProgress } = options
  throwIfAborted(signal)
  const format = output.format === 'webm' ? 'webm' : 'mp4'
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  const muted = !!recipe?.muted
  const speed = recipe?.speed ?? 1

  // 短い辺の上限は寸法がわかってから幅・高さに直す。一括変換では info がないので映像トラックから読む
  let sized = output
  if (output.maxShortSide && !output.width && !output.height) {
    const track = info?.dimensions ? null : await input.getPrimaryVideoTrack()
    const dimensions =
      info?.dimensions ??
      (track ? { width: await track.getDisplayWidth(), height: await track.getDisplayHeight() } : null)
    const edited = dimensions && recipe ? editedSize({ dimensions }, recipe) : dimensions
    sized = edited ? resolveMaxShortSide(output, edited) : output
  }

  // 目標サイズは長さから決まるビットレートで狙う。音声も TARGET_AUDIO_BITRATE で作り直し、
  // 元の音声をそのまま写して見積もりより大きくなるのを防ぐ
  const targeted = usesTargetSize(output)
  let bitrate = videoBitrate(output)
  let hasAudio = false
  if (targeted) {
    const duration = options.duration ?? (trim ? trim.end - trim.start : await input.computeDuration())
    hasAudio = !muted && (await input.getPrimaryAudioTrack()) !== null
    // 書き出す長さ（速さを反映したもの）で割る
    bitrate = videoBitrate(output, duration / speed, hasAudio)
  }

  // 字幕は書き出しの時間軸に直しておく。区間がなければ入力全体
  const subtitles = recipe?.subtitles ?? null
  const range = trim ?? (subtitles ? { start: 0, end: await input.computeDuration() } : null)
  const cues = subtitles && range ? cuesForOutput(subtitles, range, speed) : []
  const subtitleMode = subtitles ? effectiveSubtitleMode(subtitles.mode, format) : null
  const burnCues = subtitleMode === 'burn' && cues.length > 0 ? cues : null
  const embedCues = subtitleMode === 'embed' && cues.length > 0 ? cues : null

  const video: ConversionVideoOptions = {
    ...(sized.width && { width: sized.width }),
    ...(sized.height && { height: sized.height }),
    ...(sized.width && sized.height && { fit: 'contain' as const }),
    quality: new Quality({ bitrate }),
    ...(targeted && { forceTranscode: true }),
  }
  if (recipe && recipe.rotation !== 0) {
    video.rotate = recipe.rotation
    // 回転をメタデータだけで済ませると、向きを読まないプレーヤーや投稿先で横倒しになる。画素に焼き込む
    video.allowRotationMetadata = false
  }
  const crop = recipe && info?.dimensions ? rotatedCrop(recipe, info.dimensions) : null
  if (crop) video.crop = crop
  const flipH = !!recipe?.flipH
  const flipV = !!recipe?.flipV
  const needsProcess = flipH || flipV || speed !== 1 || burnCues !== null
  // process は状態（Canvas・前のフレームの時刻）を持つので、トラックごとに作る
  const videoOptions: ConversionOptions['video'] = needsProcess
    ? () => ({ ...video, process: frameProcess({ flipH, flipV, speed, cues: burnCues }) })
    : video

  const baseAudio: ConversionAudioOptions | null = hasAudio
    ? { quality: new Quality({ bitrate: TARGET_AUDIO_BITRATE }), forceTranscode: true }
    : null
  let audioOptions: ConversionOptions['audio'] = muted ? { discard: true } : (baseAudio ?? undefined)
  if (!muted && speed !== 1) {
    const start = trim?.start ?? 0
    const end = trim?.end ?? Infinity
    const preservePitch = recipe?.preservePitch ?? true
    audioOptions = async (track: InputAudioTrack) => {
      // 最後のブロックで伸縮の残りを吐き出すため、このトラックが区間の中に持つ長さを先に知っておく
      const trackEnd = Math.min(end, await track.computeDuration())
      return { ...baseAudio, process: speedProcess(speed, preservePitch, Math.max(0, trackEnd - start)) }
    }
  }

  const target = new BufferTarget()
  const out = new Output({
    target,
    format: format === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat(),
  })
  const composable = embedCues !== null
  const conversionOptions: ConversionOptions = {
    input,
    output: out,
    video: videoOptions,
    ...(audioOptions && { audio: audioOptions }),
    ...(trim && { trim }),
    ...(composable && { composable: true }),
    showWarnings: false,
  }

  const conversion = await Conversion.init(conversionOptions)
  if (!conversion.isValid) {
    throw new Error(
      'Conversion is invalid: ' + conversion.discardedTracks.map((track) => track.reason).join(', ')
    )
  }

  let subtitleSource: TextSubtitleSource | null = null
  if (embedCues && subtitles) {
    subtitleSource = new TextSubtitleSource('webvtt')
    out.addSubtitleTrack(subtitleSource, { name: subtitles.name.replace(/\.[^.]+$/, '') || undefined })
    // composable では Conversion がタグを写さないので、ふつうの変換と同じく元のタグを引き継ぐ
    out.setMetadataTags(await input.getMetadataTags())
  }

  const cancel = () => {
    void conversion.cancel()
    // composable な Conversion は出力を閉じないので、こちらで止める
    if (composable) void out.cancel()
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    conversion.onProgress = (progress) => onProgress?.(progress)
    if (subtitleSource && embedCues) {
      const source = subtitleSource
      await out.start()
      // 字幕は先に全部渡す。書き手が映像・音声と時刻順に混ぜて書くので、変換と並べて流す
      await Promise.all([
        conversion.execute(),
        (async () => {
          await source.add(serializeVtt(embedCues))
          source.close()
        })(),
      ])
      throwIfAborted(signal)
      await out.finalize()
    } else {
      await conversion.execute()
    }
    // cancel() 後も execute() は正常に解決しうるので、ここで中断を確定させる
    throwIfAborted(signal)
  } catch (error) {
    // 中断で cancel() すると execute() は ConversionCanceledError で落ちる。呼び出し側には AbortError で揃える
    throwIfAborted(signal)
    throw error
  } finally {
    signal?.removeEventListener('abort', cancel)
  }

  const buffer = target.buffer
  if (!buffer) throw new Error('No buffer available after conversion')

  onProgress?.(1)
  return {
    blob: new Blob([buffer], { type: VIDEO_MIME_TYPES[format] }),
    filename: videoFilename(file.name ?? 'video', format),
  }
}

/**
 * 映像の process。タイムスタンプを speed で縮め（速いときは MAX_OUTPUT_FPS を超えるフレームを間引く）、
 * 反転と字幕の焼き込みが要るときだけ Canvas に描き直す。Canvas は使い回す（返した Canvas はすぐに VideoFrame へ写される）
 */
function frameProcess({
  flipH,
  flipV,
  speed,
  cues,
}: {
  flipH: boolean
  flipV: boolean
  speed: number
  cues: readonly SubtitleCue[] | null
}) {
  let canvas: OffscreenCanvas | null = null
  let context: OffscreenCanvasRenderingContext2D | null = null
  let lastKept = -Infinity
  const minInterval = 1 / MAX_OUTPUT_FPS
  return (sample: VideoSample) => {
    if (speed !== 1) {
      const time = sample.timestamp / speed
      // 丸めの誤差で 60fps ちょうどのフレームを落とさないよう、少しだけ甘くする
      if (speed > 1 && time < lastKept + minInterval - 1e-4) return null
      lastKept = time
      sample.setTimestamp(time)
      sample.setDuration(sample.duration / speed)
    }
    if (!flipH && !flipV && !cues) return sample
    const width = sample.displayWidth
    const height = sample.displayHeight
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height)
      context = canvas.getContext('2d')
    }
    if (!context) throw new Error('Failed to create a 2D canvas context')
    context.setTransform(flipH ? -1 : 1, 0, 0, flipV ? -1 : 1, flipH ? width : 0, flipV ? height : 0)
    sample.draw(context, 0, 0, width, height)
    if (cues) drawSubtitlesAt(context, cues, sample.timestamp * 1000, width, height)
    return canvas
  }
}

/**
 * 音声の process。ブロックを順に伸縮器へ通し、出てきた分を続きのタイムスタンプで返す。
 * process には「最後のブロック」の合図がないので、受け取った長さが expectedSeconds に届いたところで残りを吐き出す
 * （トラックが区間の途中で切れていると、最後の数十ミリ秒が落ちる）
 */
function speedProcess(speed: number, preservePitch: boolean, expectedSeconds: number) {
  let stretcher: StreamingStretcher | null = null
  let received = 0
  let emitted = 0
  let finished = false
  return (sample: AudioSample): AudioSample | null => {
    if (finished) return null
    const { numberOfChannels: channels, sampleRate } = sample
    stretcher ??= preservePitch
      ? createTimeStretcher({ channels, sampleRate, speed })
      : createResampler({ channels, speed })
    const planes = Array.from({ length: channels }, (_, planeIndex) => {
      const plane = new Float32Array(sample.numberOfFrames)
      sample.copyTo(plane, { planeIndex, format: 'f32-planar' })
      return plane
    })
    received += sample.numberOfFrames
    let out = stretcher.push(planes)
    if (received >= Math.round(expectedSeconds * sampleRate) - 1) {
      out = concatPlanes([out, stretcher.flush()], channels)
      finished = true
    }
    const frames = out[0]?.length ?? 0
    if (frames === 0) return null
    const data = new Float32Array(frames * channels)
    out.forEach((plane, channel) => data.set(plane, channel * frames))
    const result = new AudioSample({
      data,
      format: 'f32-planar',
      numberOfChannels: channels,
      sampleRate,
      timestamp: emitted / sampleRate,
    })
    emitted += frames
    return result
  }
}

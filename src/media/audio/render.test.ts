import { describe, expect, test } from 'vitest'
import { isAbortError } from '../../utils/abort'
import { NORMALIZE_TARGET_DB, dbToGain } from './dsp'
import { createAudioOutput, estimateRenderSize } from './output'
import { NoAudioTrackError, probeAudio } from './probe'
import { applyAudioEdit, createAudioRecipe } from './recipe'
import { UnsupportedAudioFormatError, renderAudio } from './render'
import { makeWav } from './testFixtures'
import type { AudioEdit, AudioInfo, AudioRecipe } from './types'
import { loadWaveform } from './waveform'

/**
 * mediabunny を通した書き出しの結合テスト。
 * node には WebCodecs がないので、WebCodecs を使わずに済む経路だけを通す:
 * - 読み込み: 16bit PCM の WAV（mediabunny 自身がデコードする）
 * - 書き出し: WAV（mediabunny 自身）、FLAC / MP3（拡張の WASM を worker_threads で動かす）
 * AAC / Opus の書き出しと、WAV 以外の入力（MP3・AAC・動画など）のデコードはブラウザでしか試せない。
 */

const SAMPLE_RATE = 8000
/** 左右で振幅の違う 2 秒のサイン波。モノラル化で平均が取られたかを見分けられる */
const tone = (name = 'tone.wav', seconds = 2) =>
  makeWav((frame, channel) => Math.sin(frame / 10) * (channel === 0 ? 0.25 : 0.125), {
    seconds,
    sampleRate: SAMPLE_RATE,
    channels: 2,
    name,
  })

function edit(info: AudioInfo, edits: AudioEdit[]): AudioRecipe {
  return edits.reduce((recipe, e) => applyAudioEdit(recipe, e, info), createAudioRecipe(info))
}

async function reprobe(rendered: { blob: Blob; filename: string }) {
  return probeAudio(new File([rendered.blob], rendered.filename))
}

describe('probeAudio', () => {
  test('音声ファイルの尺・サンプルレート・チャンネル数・コーデックを読む', async () => {
    const info = await probeAudio(tone())
    expect(info).toMatchObject({ duration: 2, sampleRate: SAMPLE_RATE, channels: 2, codec: 'pcm-s16', hasVideo: false })
  })

  test('メディアとして読めないファイルは失敗する', async () => {
    await expect(probeAudio(new File([new Uint8Array(64)], 'x.wav'))).rejects.toThrow()
  })

  test('NoAudioTrackError は名前で見分けられる', () => {
    expect(new NoAudioTrackError().name).toBe('NoAudioTrackError')
  })
})

describe('renderAudio（WAV）', () => {
  test('無加工なら尺もチャンネル数も変わらず、大きさは見積もりどおり', async () => {
    const file = tone()
    const info = await probeAudio(file)
    const recipe = createAudioRecipe(info)
    const output = createAudioOutput('wav')
    const rendered = await renderAudio(file, recipe, output)
    expect(rendered.filename).toBe('tone.wav')
    expect(rendered.blob.type).toBe('audio/wav')
    expect(rendered.blob.size).toBe(estimateRenderSize(output, recipe, info))
    expect(await reprobe(rendered)).toMatchObject({ duration: 2, channels: 2, sampleRate: SAMPLE_RATE })
  })

  test('切り出し・モノラル化・ノーマライズ・フェードインが効く', async () => {
    const file = tone()
    const info = await probeAudio(file)
    const recipe = edit(info, [
      { type: 'setTrimStart', time: 0.5 },
      { type: 'setFadeIn', seconds: 0.5 },
      { type: 'setNormalize', enabled: true },
      { type: 'setMono', enabled: true },
    ])
    const rendered = await renderAudio(file, recipe, createAudioOutput('wav'))
    const out = new File([rendered.blob], rendered.filename)
    expect(await probeAudio(out)).toMatchObject({ duration: 1.5, channels: 1 })

    // 1.5 秒を 6 等分（0.25 秒ずつ）すると、最初の 2 つがフェードインの途中、残りは目標のピーク
    const peaks = await loadWaveform(out, 6)
    const target = dbToGain(NORMALIZE_TARGET_DB)
    expect(peaks[0]).toBeLessThan(target * 0.55)
    expect(peaks[1]).toBeGreaterThan(peaks[0])
    expect(peaks[1]).toBeLessThanOrEqual(target + 1e-3)
    for (const peak of peaks.slice(2)) expect(peak).toBeCloseTo(target, 2)
  })

  test('音量を下げると、そのぶんピークが下がる', async () => {
    const file = tone()
    const info = await probeAudio(file)
    const rendered = await renderAudio(file, edit(info, [{ type: 'setGain', db: -6 }]), createAudioOutput('wav'))
    // 波形は左右の平均（0.25 と 0.125 の平均 = 0.1875）で見る
    const [peak] = await loadWaveform(new File([rendered.blob], rendered.filename), 1)
    expect(peak).toBeCloseTo(0.1875 * dbToGain(-6), 2)
  })

  test('サンプルレートを指定すると変換される', async () => {
    const file = tone()
    const info = await probeAudio(file)
    const rendered = await renderAudio(file, createAudioRecipe(info), {
      ...createAudioOutput('wav'),
      sampleRate: 16000,
    })
    expect(await reprobe(rendered)).toMatchObject({ sampleRate: 16000, duration: 2 })
  })

  test('進み具合は 0〜1 で、最後に 1 を通知する', async () => {
    const file = tone()
    const info = await probeAudio(file)
    const progress: number[] = []
    await renderAudio(file, edit(info, [{ type: 'setNormalize', enabled: true }]), createAudioOutput('wav'), {
      onProgress: (p) => progress.push(p),
    })
    expect(progress.every((p) => p >= 0 && p <= 1)).toBe(true)
    expect(progress[progress.length - 1]).toBe(1)
  })
})

describe('renderAudio（中断）', () => {
  test('始める前に中断されていれば AbortError', async () => {
    const file = tone()
    const info = await probeAudio(file)
    const controller = new AbortController()
    controller.abort()
    const error = await renderAudio(file, createAudioRecipe(info), createAudioOutput('wav'), {
      signal: controller.signal,
    }).catch((e: unknown) => e)
    expect(isAbortError(error)).toBe(true)
  })

  test('途中で中断すると AbortError（ノーマライズの計測中・書き出し中のどちらでも）', async () => {
    const file = tone('long.wav', 20)
    const info = await probeAudio(file)
    for (const normalize of [true, false]) {
      const controller = new AbortController()
      const error = await renderAudio(
        file,
        edit(info, [{ type: 'setNormalize', enabled: normalize }, { type: 'setGain', db: -1 }]),
        createAudioOutput('wav'),
        {
          signal: controller.signal,
          onProgress: (p) => {
            if (p > 0) controller.abort()
          },
        }
      ).catch((e: unknown) => e)
      expect(isAbortError(error)).toBe(true)
    }
  })
})

describe('renderAudio（FLAC / MP3 拡張）', () => {
  test('FLAC に書き出せる', async () => {
    const file = tone()
    const info = await probeAudio(file)
    const rendered = await renderAudio(file, edit(info, [{ type: 'setGain', db: -3 }]), createAudioOutput('flac'))
    expect(rendered.filename).toBe('tone.flac')
    expect(await reprobe(rendered)).toMatchObject({ codec: 'flac', channels: 2, sampleRate: SAMPLE_RATE, duration: 2 })
  })

  test('MP3 に書き出せる（加工なしでも再エンコードされる）', async () => {
    const file = tone()
    const info = await probeAudio(file)
    const rendered = await renderAudio(file, createAudioRecipe(info), {
      format: 'mp3',
      bitrate: 64_000,
      sampleRate: 16000,
    })
    const out = await reprobe(rendered)
    expect(out).toMatchObject({ codec: 'mp3', sampleRate: 16000, channels: 2 })
    // MP3 はエンコーダの遅延ぶんフレームが足される
    expect(out.duration).toBeGreaterThanOrEqual(2)
    expect(out.duration).toBeLessThan(2.2)
  })
})

describe.runIf(typeof AudioEncoder === 'undefined')('renderAudio（WebCodecs のない環境）', () => {
  test.each(['m4a', 'opus'] as const)('%s は UnsupportedAudioFormatError になる', async (format) => {
    const file = tone()
    const info = await probeAudio(file)
    await expect(renderAudio(file, createAudioRecipe(info), createAudioOutput(format))).rejects.toBeInstanceOf(
      UnsupportedAudioFormatError
    )
  })
})

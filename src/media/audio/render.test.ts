import { describe, expect, test } from 'vitest'
import { isAbortError } from '../../utils/abort'
import { NORMALIZE_TARGET_DB, dbToGain } from './dsp'
import { createAudioOutput, estimateRenderSize } from './output'
import { NoAudioTrackError, probeAudio } from './probe'
import { applyAudioEdit, createAudioRecipe } from './recipe'
import { UnsupportedAudioFormatError, renderAudio } from './render'
import { detectSilence, keptLength, planKeptRanges } from './silence'
import { makeWav } from './testFixtures'
import type { AudioEdit, AudioInfo, AudioRecipe } from './types'
import { analyzeAudio, loadWaveform } from './waveform'

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

describe('renderAudio（無音カット）', () => {
  /** 音 1 秒・無音 2 秒・音 1 秒・無音 0.3 秒・音 0.7 秒（無音の 0.3 秒は最短の長さより短いので残る） */
  const gapped = () =>
    makeWav(
      (frame, channel) => {
        const t = frame / SAMPLE_RATE
        const loud = t < 1 || (t >= 3 && t < 4) || t >= 4.3
        return loud ? Math.sin(frame / 7) * (channel === 0 ? 0.5 : 0.4) : 0
      },
      { seconds: 5, sampleRate: SAMPLE_RATE, channels: 2, name: 'gapped.wav' }
    )
  const silenceOn = { type: 'setSilence', silence: { enabled: true, thresholdDb: -40, minDuration: 0.5, padding: 0.1 } } as const

  test('無音を削った長さで書き出され、削った所に長い無音が残らない', async () => {
    const file = gapped()
    const info = await probeAudio(file)
    const recipe = edit(info, [silenceOn])
    const output = createAudioOutput('wav')
    const rendered = await renderAudio(file, recipe, output)
    const out = new File([rendered.blob], rendered.filename)
    // 1.1 + (0.1 + 1 + 0.3 + 0.7) = 3.2 秒
    const outInfo = await probeAudio(out)
    expect(outInfo.duration).toBeCloseTo(3.2, 2)

    // 画面で見積もる長さ・大きさと一致する
    const analysis = await analyzeAudio(file, 100)
    const kept = planKeptRanges(recipe, analysis.levels)
    expect(keptLength(kept)).toBeCloseTo(outInfo.duration, 2)
    expect(rendered.blob.size).toBeCloseTo(estimateRenderSize(output, recipe, info, keptLength(kept)), -2)

    // 書き出しに残る無音は、padding の両側ぶん（0.2 秒）と、削らなかった 0.3 秒だけ
    const { levels } = await analyzeAudio(out, 10)
    const silences = detectSilence(levels, { thresholdDb: -40, minDuration: 0.05 }, { start: 0, end: outInfo.duration })
    expect(silences).toHaveLength(2)
    for (const silence of silences) expect(silence.end - silence.start).toBeLessThan(0.35)
  })

  test('つなぎ目はクロスフェードでつなぎ、音が跳ばない', async () => {
    // しきい値（-20 dBFS = 0.1）より小さい、ゆっくり上がる直線を「無音」の中に置く。
    // 削る範囲の両側で値が 0.16 ほど違うので、ただ切ってつなぐとそこで段差（プツッという音）が出る
    const rate = SAMPLE_RATE
    // 0〜1 秒と 3〜4 秒に、50ms かけて立ち上がり・消える音を置く
    const bump = (t: number, from: number, to: number) =>
      Math.min(1, Math.max(0, Math.min((t - from) / 0.05, (to - t) / 0.05)))
    const envelope = (t: number) => Math.max(bump(t, 0, 1), bump(t, 3, 4))
    const file = makeWav(
      (frame) => {
        const t = frame / rate
        const quiet = -0.09 + (0.18 * Math.min(Math.max(t - 1, 0), 2)) / 2
        return quiet + 0.5 * envelope(t) * Math.sin(frame / 200)
      },
      { seconds: 4, sampleRate: rate, channels: 1, name: 'ramp.wav' }
    )
    const info = await probeAudio(file)
    const recipe = edit(info, [
      { type: 'setSilence', silence: { enabled: true, thresholdDb: -20, minDuration: 0.5, padding: 0.1 } },
    ])
    const rendered = await renderAudio(file, recipe, createAudioOutput('wav'))
    const view = new DataView(await rendered.blob.arrayBuffer())
    const frames = (view.byteLength - 44) / 2
    // 1 回は削れている
    expect(frames / rate).toBeLessThan(3)
    let maxStep = 0
    for (let i = 1; i < frames; i++) {
      const step = Math.abs(view.getInt16(44 + i * 2, true) - view.getInt16(44 + (i - 1) * 2, true)) / 0x7fff
      maxStep = Math.max(maxStep, step)
    }
    // 元の信号の 1 サンプルの差は 0.5 / 200 + 立ち上がりの分で 0.01 未満。段差なら 0.1 を超える
    expect(maxStep).toBeLessThan(0.02)
  })

  test('フェードとノーマライズは削ったあとの時間軸に掛かる', async () => {
    const file = gapped()
    const info = await probeAudio(file)
    const recipe = edit(info, [silenceOn, { type: 'setFadeOut', seconds: 0.5 }, { type: 'setNormalize', enabled: true }])
    const rendered = await renderAudio(file, recipe, createAudioOutput('wav'))
    const out = new File([rendered.blob], rendered.filename)
    const outInfo = await probeAudio(out)
    expect(outInfo.duration).toBeCloseTo(3.2, 2)
    // 32 等分（0.1 秒ずつ）。最後の 0.1 秒はフェードアウトの終わりで小さく、真ん中の音は目標のピーク
    const peaks = await loadWaveform(out, 32)
    expect(peaks[31]).toBeLessThan(peaks[20] * 0.3)
    expect(Math.max(...peaks)).toBeLessThanOrEqual(dbToGain(NORMALIZE_TARGET_DB) + 1e-3)
    expect(peaks[5]).toBeCloseTo(dbToGain(NORMALIZE_TARGET_DB) * 0.9, 1)
  })

  test('全体が無音なら何も削らない', async () => {
    const file = makeWav(() => 0, { seconds: 1, sampleRate: SAMPLE_RATE, channels: 1, name: 'quiet.wav' })
    const info = await probeAudio(file)
    const rendered = await renderAudio(file, edit(info, [silenceOn]), createAudioOutput('wav'))
    expect((await reprobe(rendered)).duration).toBeCloseTo(1, 3)
  })

  test('区間で切り出してから無音を削る', async () => {
    const file = gapped()
    const info = await probeAudio(file)
    const recipe = edit(info, [silenceOn, { type: 'setTrimStart', time: 0.5 }, { type: 'setTrimEnd', time: 3.5 }])
    const rendered = await renderAudio(file, recipe, createAudioOutput('flac'))
    // 0.5〜1.1 と 2.9〜3.5 = 1.2 秒
    expect((await reprobe(rendered)).duration).toBeCloseTo(1.2, 2)
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

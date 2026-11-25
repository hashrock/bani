import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { concatPlanes, createResampler, createTimeStretcher, stretchAll } from './timeStretch'

const RATE = 44100

const tone = (frequency: number, seconds: number, amplitude = 0.5): Float32Array =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin((2 * Math.PI * frequency * i) / RATE))

/** 区間の真ん中あたりの基本周波数を、ゼロ交差の間隔から求める（両端の窓の影響を避ける） */
function measureFrequency(signal: Float32Array): number {
  const from = Math.floor(signal.length * 0.2)
  const to = Math.floor(signal.length * 0.8)
  const crossings: number[] = []
  for (let i = from + 1; i < to; i++) {
    if (signal[i - 1] < 0 && signal[i] >= 0) crossings.push(i - signal[i] / (signal[i] - signal[i - 1]))
  }
  return ((crossings.length - 1) * RATE) / (crossings[crossings.length - 1] - crossings[0])
}

const rms = (signal: Float32Array, from = 0.2, to = 0.8): number => {
  const a = Math.floor(signal.length * from)
  const b = Math.floor(signal.length * to)
  let sum = 0
  for (let i = a; i < b; i++) sum += signal[i] * signal[i]
  return Math.sqrt(sum / (b - a))
}

/** ブロックに分けて流す（変換で届くのと同じ形） */
function streamed(input: Float32Array[], speed: number, block: number, preservePitch = true): Float32Array[] {
  const options = { channels: input.length, sampleRate: RATE, speed }
  const stretcher = preservePitch ? createTimeStretcher(options) : createResampler(options)
  const parts: Float32Array[][] = []
  for (let at = 0; at < input[0].length; at += block) {
    parts.push(stretcher.push(input.map((plane) => plane.subarray(at, at + block))))
  }
  parts.push(stretcher.flush())
  return concatPlanes(parts, input.length)
}

describe('createTimeStretcher（WSOLA）', () => {
  test.each([0.25, 0.5, 0.75, 1.25, 1.5, 2, 3, 4])('%s 倍: 長さは 1 / speed 倍、高さは変わらない', (speed) => {
    const input = tone(440, 1.5)
    const [out] = stretchAll([input], RATE, speed)
    expect(out.length).toBe(Math.round(input.length / speed))
    expect(Math.abs(measureFrequency(out) / 440 - 1)).toBeLessThan(0.01)
    // 音量もほぼ保つ（重ね合わせを窓の和で割り戻している）
    expect(Math.abs(rms(out) / rms(input) - 1)).toBeLessThan(0.1)
  })

  test('低い音・高い音でも高さを保つ', () => {
    for (const frequency of [110, 1000, 3000]) {
      const [out] = stretchAll([tone(frequency, 1)], RATE, 0.5)
      expect(Math.abs(measureFrequency(out) / frequency - 1)).toBeLessThan(0.01)
    }
  })

  test('継ぎ目で波形が飛ばない（隣どうしの差が元の音の範囲に収まる）', () => {
    const input = tone(440, 1)
    const maxStep = (2 * Math.PI * 440 * 0.5) / RATE
    for (const speed of [0.5, 2]) {
      const [out] = stretchAll([input], RATE, speed)
      let worst = 0
      for (let i = Math.floor(out.length * 0.05); i < out.length * 0.95; i++) worst = Math.max(worst, Math.abs(out[i] - out[i - 1]))
      expect(worst).toBeLessThan(maxStep * 2)
    }
  })

  test('ブロックの切り方によらず総数は同じで、まとめて流したのと同じ音になる', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0.25, 0.5, 0.8, 1, 1.7, 2, 4),
        fc.integer({ min: 64, max: 5000 }),
        fc.integer({ min: 0, max: 30000 }),
        (speed, block, length) => {
          const input = [tone(300, length / RATE), tone(500, length / RATE, 0.3)]
          const out = streamed(input, speed, block)
          const whole = stretchAll(input, RATE, speed)
          expect(out.length).toBe(2)
          expect(out[0].length).toBe(Math.round(length / speed))
          expect(out[1].length).toBe(out[0].length)
          for (let i = 0; i < out[0].length; i += 97) expect(out[0][i]).toBeCloseTo(whole[0][i], 5)
        }
      ),
      { numRuns: 30 }
    )
  })

  test('無音は無音のまま', () => {
    const [out] = stretchAll([new Float32Array(RATE)], RATE, 1.5)
    expect(out.every((x) => x === 0)).toBe(true)
  })

  test('速さが正の有限でなければ作れない', () => {
    for (const speed of [0, -1, Number.NaN, Infinity]) {
      expect(() => createTimeStretcher({ channels: 1, sampleRate: RATE, speed })).toThrow(RangeError)
      expect(() => createResampler({ channels: 1, speed })).toThrow(RangeError)
    }
  })
})

describe('createResampler（高さも変わる）', () => {
  test.each([0.5, 2, 4])('%s 倍: 長さは 1 / speed 倍、高さは speed 倍', (speed) => {
    const input = tone(440, 1)
    const [out] = stretchAll([input], RATE, speed, false)
    expect(out.length).toBe(Math.round(input.length / speed))
    expect(Math.abs(measureFrequency(out) / (440 * speed) - 1)).toBeLessThan(0.01)
  })

  test('ブロックの切り方によらず、まとめて流したのと同じ値になる', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(0.25, 0.6, 1, 1.5, 4),
        fc.integer({ min: 1, max: 3000 }),
        fc.integer({ min: 0, max: 20000 }),
        (speed, block, length) => {
          const input = [tone(250, length / RATE)]
          const [out] = streamed(input, speed, block, false)
          const [whole] = stretchAll(input, RATE, speed, false)
          expect(out.length).toBe(Math.round(length / speed))
          expect(out.length).toBe(whole.length)
          for (let i = 0; i < out.length; i += 53) expect(out[i]).toBeCloseTo(whole[i], 6)
        }
      ),
      { numRuns: 50 }
    )
  })
})

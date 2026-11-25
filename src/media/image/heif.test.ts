import { beforeAll, describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { HeifDecodeError, decodeHeif, readHeifSize } from './heif'
import type { LibHeif } from './heif'
import { sniffImageMime } from './metadata'
import { nodeRequire, readFixture } from '../../test/nodeFixtures'

let lib: LibHeif
let heic: Uint8Array

// ブラウザでは heifLoader.ts が wasm の URL を渡すが、node では中身を直接渡して同じライブラリを動かす
beforeAll(async () => {
  // macOS の sips で作った 64×48 の HEIC（ffmpeg の testsrc2 の 1 コマ）
  heic = await readFixture('tiny.heic')
  const { require, readPackageFile } = await nodeRequire()
  const factory = require('libheif-js/libheif-wasm/libheif.js') as (options: object) => LibHeif
  const wasmBinary = readPackageFile('libheif-js/libheif-wasm/libheif.wasm')
  lib = await new Promise<LibHeif>((resolve) => {
    let module: LibHeif | null = null
    let ready = false
    const settle = () => (module && ready ? resolve(module) : undefined)
    module = factory({ wasmBinary, onRuntimeInitialized: () => ((ready = true), queueMicrotask(settle)), print() {}, printErr() {} })
    settle()
  })
})

describe('libheif での HEIC の読み取り', () => {
  test('署名から HEIC と判定する（ブラウザが読めないときだけ libheif に回す判定）', () => {
    expect(sniffImageMime(heic)).toBe('image/heic')
  })

  test('画素をデコードせずに寸法を読む', async () => {
    expect(await readHeifSize(lib, heic)).toEqual({ width: 64, height: 48 })
  })

  test('RGBA の画素にデコードし、不透明で中身がある', async () => {
    const pixels = await decodeHeif(lib, heic)
    expect(pixels.width).toBe(64)
    expect(pixels.height).toBe(48)
    expect(pixels.data.length).toBe(64 * 48 * 4)
    const alphas = new Set<number>()
    const colors = new Set<string>()
    for (let i = 0; i < pixels.data.length; i += 4) {
      alphas.add(pixels.data[i + 3])
      colors.add(`${pixels.data[i]},${pixels.data[i + 1]},${pixels.data[i + 2]}`)
    }
    expect([...alphas]).toEqual([255])
    // テスト画像は色の帯なので、単色に潰れていないことだけを見る
    expect(colors.size).toBeGreaterThan(16)
  })

  test('何度読んでも同じ結果（解放漏れや状態の持ち越しがない）', async () => {
    const first = await decodeHeif(lib, heic)
    const second = await decodeHeif(lib, heic)
    expect(second.data).toEqual(first.data)
  })

  test('HEIC でないバイト列は HeifDecodeError で断り、例外以外の形で落ちない', async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ maxLength: 512 }), async (bytes) => {
        await expect(decodeHeif(lib, bytes)).rejects.toBeInstanceOf(HeifDecodeError)
      }),
      { numRuns: 50 }
    )
  })

  test('途中で切れた HEIC も例外で断る', async () => {
    await expect(decodeHeif(lib, heic.subarray(0, heic.length >> 1))).rejects.toBeInstanceOf(Error)
  })
})

/**
 * 7z・RAR の一覧と展開を、本物の libarchive（WASM）と本物のファイルで確かめる。
 * Worker は node にないので、setInProcessLibarchive で同じスレッドで動かす（Worker とのやりとり以外は同じ道を通る）。
 *
 * 見本（src/test/fixtures/）:
 * - *.7z は 7-Zip（7z a、-p でパスワード、-mhe=on で名前も暗号化）と bsdtar で作った
 * - *.rar は libarchive のテスト用のファイル（BSD 2-Clause）をそのまま使っている。
 *   RAR は作る道具が自由に使えないため
 */
import { beforeAll, describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { isAbortError } from '../../utils/abort'
import { readFixture } from '../../test/nodeFixtures'
import { ArchiveError, detectArchiveFormat, extractEntries, extractEntry, isArchiveError, probeArchive } from './index'
import { LibarchiveReader, type LibarchiveModule } from './libarchive'
import { scanRar5 } from './rar5'
import { setInProcessLibarchive } from './wasmArchive'

let loadModule: () => Promise<LibarchiveModule>

beforeAll(async () => {
  const { default: createLibarchive } = await import('libarchive.js/src/webworker/wasm-gen/libarchive.js')
  loadModule = async () => (await createLibarchive({ print() {}, printErr() {} })) as LibarchiveModule
  setInProcessLibarchive(loadModule)
})

const blobOf = async (name: string) => new Blob([await readFixture(name)])
const text = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer())

async function archiveError(promise: Promise<unknown>): Promise<ArchiveError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(isArchiveError(error)).toBe(true)
  return error as ArchiveError
}

describe('7z', () => {
  test('一覧: 日本語の名前・フォルダ・大きさ。1 つずつの圧縮後の大きさは null', async () => {
    const file = await blobOf('plain.7z')
    expect(detectArchiveFormat(await readFixture('plain.7z'))).toBe('7z')
    const info = await probeArchive(file)
    expect(info.format).toBe('7z')
    expect(info.entries.map((entry) => [entry.path, entry.isDirectory, entry.size])).toEqual([
      ['フォルダ', true, 0],
      ['a.txt', false, 9],
      ['フォルダ/b.txt', false, 19],
    ])
    expect(info.entries.every((entry) => entry.compressedSize === null && entry.nameEncoding === 'utf-8')).toBe(true)
    expect(info.hasEncryptedEntries).toBe(false)
    expect(info.totalSize).toBe(28)
  })

  test('全部・フォルダ指定・1 つの展開', async () => {
    const file = await blobOf('plain.7z')
    const all = await extractEntries(file, 'all')
    expect(all.map((entry) => entry.filename)).toEqual(['a.txt', 'フォルダ/b.txt'])
    expect(await text(all[0].blob)).toBe('hello 7z\n')
    expect(await text(all[1].blob)).toBe('日本語の中身\n')
    expect(all[0].blob.type).toBe('text/plain')

    const folder = await extractEntries(file, ['フォルダ'])
    expect(folder.map((entry) => entry.filename)).toEqual(['フォルダ/b.txt'])

    const one = await extractEntry(file, 'フォルダ/b.txt')
    expect(one.name).toBe('b.txt')
    expect(await text(one)).toBe('日本語の中身\n')
  })

  test('進み具合は 0〜1 で増えていき、最後は 1', async () => {
    const seen: number[] = []
    await extractEntries(await blobOf('plain.7z'), 'all', { onProgress: (p) => seen.push(p) })
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= seen[i - 1]))).toBe(true)
    expect(seen.at(-1)).toBe(1)
  })

  test('中断されていたら AbortError', async () => {
    const controller = new AbortController()
    controller.abort()
    const error = await extractEntries(await blobOf('plain.7z'), 'all', { signal: controller.signal }).catch((e) => e)
    expect(isAbortError(error)).toBe(true)
  })

  test('ない パスは not-found', async () => {
    const error = await archiveError(extractEntries(await blobOf('plain.7z'), ['nothing.txt']))
    expect(error.code).toBe('not-found')
  })

  test('パスワード付き: 一覧には印付きで出し、展開は始める前に encrypted で断る', async () => {
    const file = await blobOf('encrypted.7z')
    const info = await probeArchive(file)
    expect(info.hasEncryptedEntries).toBe(true)
    expect(info.entries.filter((entry) => entry.encrypted).map((entry) => entry.path)).toEqual(['a.txt', 'フォルダ/b.txt'])
    const error = await archiveError(extractEntries(file, 'all'))
    expect(error.code).toBe('encrypted')
    expect(error.path).toBe('a.txt')
  })

  test('名前まで暗号化された 7z は開く時点で encrypted', async () => {
    const error = await archiveError(probeArchive(await blobOf('encrypted-header.7z')))
    expect(error.code).toBe('encrypted')
  })

  test('「..」や絶対パス・Windows の予約名は無害化する（zip-slip 対策）', async () => {
    const file = await blobOf('slip.7z')
    const info = await probeArchive(file)
    expect(info.entries.map((entry) => entry.path)).toEqual(['evil.txt', 'abs/_CON.txt'])
    const extracted = await extractEntries(file, 'all')
    expect(extracted.map((entry) => entry.filename)).toEqual(['evil.txt', 'abs/_CON.txt'])
    expect(await text(extracted[0].blob)).toBe('hello 7z\n')
  })

  test.each([['plain.7z'], ['rar4.rar'], ['rar5.rar']])(
    '途中で切れた %s は corrupt で断る（空の一覧に見せない）',
    async (name) => {
      const bytes = await readFixture(name)
      for (const length of [8, 32, 100, bytes.length - 10]) {
        const truncated = new Blob([bytes.subarray(0, length)])
        const error = await archiveError(
          (async () => {
            await probeArchive(truncated)
            // 目録が読めても中身が欠けていれば展開で気づく
            await extractEntries(truncated, 'all')
          })()
        )
        expect(error.code).toBe('corrupt')
      }
    }
  )
})

describe('RAR', () => {
  test('RAR4: ファイルとフォルダを出し、シンボリックリンクは tar と同じく出さない', async () => {
    const file = await blobOf('rar4.rar')
    const info = await probeArchive(file)
    expect(info.format).toBe('rar')
    expect(info.entries.map((entry) => [entry.path, entry.isDirectory])).toEqual([
      ['test.txt', false],
      ['testdir/test.txt', false],
      ['testdir', true],
      ['testemptydir', true],
    ])
    const extracted = await extractEntries(file, ['testdir'])
    expect(extracted.map((entry) => entry.filename)).toEqual(['testdir/test.txt'])
    expect(await text(extracted[0].blob)).toBe('test text document\r\n')
  })

  test('RAR5: 中身と更新日時（rar5.ts で補う）', async () => {
    const file = await blobOf('rar5.rar')
    const info = await probeArchive(file)
    expect(info.entries.map((entry) => [entry.path, entry.size])).toEqual([['test.bin', 1200]])
    // unrar では 2018-09-27 13:07:39（日本時間）と出るもの。秒までを見る
    expect(info.entries[0].modified?.toISOString().slice(0, 19)).toBe('2018-09-27T04:07:39')
    const [bin] = await extractEntries(file, 'all')
    expect(bin.blob.size).toBe(1200)
  })

  test.each([['rar4-encrypted.rar'], ['rar5-encrypted.rar']])(
    '%s: パスワード付きのファイルだけに印を付け、ほかは展開できる',
    async (name) => {
      const file = await blobOf(name)
      const info = await probeArchive(file)
      expect(info.entries.map((entry) => [entry.path, entry.encrypted])).toEqual([
        ['a.txt', false],
        ['b.txt', true],
        ['c.txt', false],
        ['d.txt', true],
      ])
      const plain = await extractEntries(file, ['a.txt', 'c.txt'])
      expect(await Promise.all(plain.map((entry) => text(entry.blob)))).toEqual([
        'This is from a.txt',
        'This is from c.txt',
      ])
      const error = await archiveError(extractEntries(file, ['d.txt']))
      expect(error.code).toBe('encrypted')
      expect(error.path).toBe('d.txt')
    }
  )

  test('名前まで暗号化された RAR は開く時点で encrypted', async () => {
    const error = await archiveError(probeArchive(await blobOf('rar4-encrypted-header.rar')))
    expect(error.code).toBe('encrypted')
  })
})

describe('libarchive の読み手', () => {
  test('同じ読み手で一覧と展開を何度でもでき、閉じたあとは読めない', async () => {
    const reader = new LibarchiveReader(await loadModule(), await readFixture('plain.7z'))
    const first = reader.list()
    expect(reader.list()).toEqual(first)
    const got: [number, string][] = []
    reader.extract(new Set([first[2].index, first[1].index]), (index, data) => got.push([index, new TextDecoder().decode(data)]))
    expect(got).toEqual([
      [first[1].index, 'hello 7z\n'],
      [first[2].index, '日本語の中身\n'],
    ])
    reader.close()
    expect(() => reader.list()).toThrow()
  })

  test('でたらめなバイト列は ArchiveError で断る', async () => {
    const module = await loadModule()
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 256 }), (tail) => {
        // 7z の署名の後ろにでたらめを続ける（署名がないと libarchive は素のデータとして読むことがある）
        const bytes = new Uint8Array([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, ...tail])
        const reader = new LibarchiveReader(module, bytes)
        try {
          reader.list()
        } catch (error) {
          expect(isArchiveError(error)).toBe(true)
        } finally {
          reader.close()
        }
      }),
      { numRuns: 100 }
    )
  })
})

describe('RAR5 のヘッダーの読み手', () => {
  test('でたらめ・途中で切れたバイト列でも例外を投げない', async () => {
    const real = await readFixture('rar5-encrypted.rar')
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 512 }), fc.nat(real.length), (noise, cut) => {
        scanRar5(new Uint8Array([...real.subarray(0, 8), ...noise]))
        scanRar5(real.subarray(0, cut))
      })
    )
  })

  test('パスワード付きのファイルを見分ける', async () => {
    const scan = scanRar5(await readFixture('rar5-encrypted.rar'))
    expect(scan.headerEncrypted).toBe(false)
    if (scan.headerEncrypted) return
    expect([...scan.files].map(([name, info]) => [name, info.encrypted])).toEqual([
      ['a.txt', false],
      ['b.txt', true],
      ['c.txt', false],
      ['d.txt', true],
    ])
  })
})

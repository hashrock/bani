import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { gunzipSync, gzipSync, unzipSync, zipSync } from 'fflate'
import { IN_MEMORY_LIMIT, writeTarGz, writeZip } from './create'
import { isAbortError } from '../../utils/abort'
import {
  ArchiveError,
  applyArchiveEdit,
  buildEntryTree,
  createArchiveRecipe,
  createTarGz,
  createZip,
  detectArchiveFormat,
  extractEntries,
  extractEntry,
  isArchiveError,
  probeArchive,
  zipRenderedFiles,
  type ArchiveItem,
  type ArchiveRecipe,
  type CompressionLevel,
} from './index'
import { blobText, buildZip } from './testFixtures'

const encoder = new TextEncoder()

/** 中身つきのレシピを組む。id は並び順 */
function recipeOf(files: readonly { path: string; data: Uint8Array | string }[], level: CompressionLevel = 6) {
  const items: ArchiveItem[] = files.map((file, i) => ({
    id: String(i),
    path: file.path,
    size: 0,
    lastModified: new Date(2024, 4, 6, 7, 8, 10).getTime(),
  }))
  const recipe: ArchiveRecipe = {
    ...applyArchiveEdit(createArchiveRecipe('テスト'), { type: 'add', items }),
    level,
  }
  const sources = new Map(files.map((file, i) => [String(i), new Blob([file.data as BlobPart])]))
  return { recipe, sources }
}

const SAMPLE = [
  { path: '日本語/資料.txt', data: 'こんにちは、世界' },
  { path: '日本語/写真/夏.jpg', data: new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]) },
  { path: 'empty.txt', data: '' },
  { path: 'repeat.txt', data: 'abc'.repeat(10000) },
  { path: `${'長い名前'.repeat(30)}.txt`, data: 'long' },
]

async function expectArchiveError(promise: Promise<unknown>, code: ArchiveError['code']) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  )
  expect(isArchiveError(error, code)).toBe(true)
  return error as ArchiveError
}

describe.each([
  ['zip', createZip, 'テスト.zip'],
  ['tar.gz', createTarGz, 'テスト.tar.gz'],
] as const)('%s を作って読み戻す', (format, create, filename) => {
  test('名前（日本語・長いもの）と中身がそのまま戻る', async () => {
    const { recipe, sources } = recipeOf(SAMPLE)
    const archive = await create(recipe, sources)
    expect(archive.filename).toBe(filename)

    const info = await probeArchive(archive.blob)
    expect(info.format).toBe(format)
    expect(info.entries.map((entry) => entry.path)).toEqual(SAMPLE.map((file) => file.path))
    expect(info.entries.map((entry) => entry.size)).toEqual(SAMPLE.map((file) => new Blob([file.data]).size))
    expect(info.hasEncryptedEntries).toBe(false)
    expect(info.entries[0].modified?.getTime()).toBe(new Date(2024, 4, 6, 7, 8, 10).getTime())

    const extracted = await extractEntries(archive.blob, 'all')
    expect(extracted.map((file) => file.filename)).toEqual(SAMPLE.map((file) => file.path))
    for (const [i, file] of extracted.entries()) {
      expect(new Uint8Array(await file.blob.arrayBuffer())).toEqual(new Uint8Array(await new Blob([SAMPLE[i].data]).arrayBuffer()))
    }
  })

  test('フォルダを指定するとその下だけを展開する', async () => {
    const { recipe, sources } = recipeOf(SAMPLE)
    const archive = await create(recipe, sources)
    const extracted = await extractEntries(archive.blob, ['日本語/写真', 'empty.txt'])
    expect(extracted.map((file) => file.filename)).toEqual(['日本語/写真/夏.jpg', 'empty.txt'])
  })

  test('ない パスを指定したら not-found', async () => {
    const { recipe, sources } = recipeOf(SAMPLE)
    const archive = await create(recipe, sources)
    const error = await expectArchiveError(extractEntries(archive.blob, ['nothing.txt']), 'not-found')
    expect(error.path).toBe('nothing.txt')
  })

  test('1 つを File として取り出す。名前はファイル名だけで、type は拡張子から推す', async () => {
    const { recipe, sources } = recipeOf(SAMPLE)
    const archive = await create(recipe, sources)
    const file = await extractEntry(archive.blob, '日本語/写真/夏.jpg')
    expect(file.name).toBe('夏.jpg')
    expect(file.type).toBe('image/jpeg')
    expect(file.size).toBe(6)
    await expectArchiveError(extractEntry(archive.blob, '日本語'), 'not-found')
  })

  test('進み具合は 0〜1 で減らず、最後に 1 になる', async () => {
    const { recipe, sources } = recipeOf(SAMPLE)
    const seen: number[] = []
    const archive = await create(recipe, sources, { onProgress: (p) => seen.push(p) })
    await extractEntries(archive.blob, 'all', { onProgress: (p) => seen.push(p) })
    for (const progress of seen) expect(progress >= 0 && progress <= 1).toBe(true)
    expect(seen.at(-1)).toBe(1)
  })

  test('中断すると AbortError', async () => {
    const { recipe, sources } = recipeOf(SAMPLE)
    const controller = new AbortController()
    controller.abort()
    await expect(create(recipe, sources, { signal: controller.signal })).rejects.toSatisfy(isAbortError)
    const archive = await create(recipe, sources)
    await expect(extractEntries(archive.blob, 'all', { signal: controller.signal })).rejects.toSatisfy(isAbortError)
  })

  test('どんなファイルの組でも、作って展開すれば元に戻る', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            path: fc.array(fc.constantFrom('a', 'B', 'ファイル', 'x.txt', 'dir', 'é'), { minLength: 1, maxLength: 3 }).map((p) => p.join('/')),
            data: fc.uint8Array({ maxLength: 2000 }),
          }),
          { maxLength: 8 }
        ),
        fc.constantFrom<CompressionLevel>(0, 1, 9),
        async (files, level) => {
          const { recipe, sources } = recipeOf(files, level)
          const archive = await create(recipe, sources)
          const info = await probeArchive(archive.blob)
          expect(info.entries.map((entry) => entry.path)).toEqual(recipe.items.map((entry) => entry.path))
          const extracted = await extractEntries(archive.blob, 'all')
          for (const [i, file] of extracted.entries()) {
            expect(file.filename).toBe(recipe.items[i].path)
            expect(new Uint8Array(await file.blob.arrayBuffer())).toEqual(files[i].data)
          }
        }
      ),
      { numRuns: 40 }
    )
  })
})

/** 大きな配列を toEqual で比べると遅いので、1 バイトずつ比べる */
function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
  if (!a || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** 繰り返しの多い中身。fflate の流し込み型の圧縮はこういう入力で壊れたデータを出していた */
const repetitive = fc
  .record({ length: fc.nat({ max: 200_000 }), period: fc.integer({ min: 1, max: 300 }), seed: fc.nat() })
  .map(({ length, period, seed }) => {
    const data = new Uint8Array(length)
    let x = seed | 1
    for (let i = 0; i < length; i++) {
      x = (x * 1103515245 + 12345) >>> 0
      data[i] = x % 20 === 0 ? x >>> 24 : (i % period) * 7
    }
    return data
  })

describe.each([
  ['メモリ上で縮める', IN_MEMORY_LIMIT],
  ['CompressionStream で流しながら縮める', 0],
])('作成（%s）', (_, limit) => {
  test('繰り返しの多い中身でも、ほかの実装（fflate の unzipSync・gunzipSync）で正しく読める', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(repetitive, { minLength: 1, maxLength: 3 }), fc.integer({ min: 1, max: 9 }), async (datas, level) => {
        const { recipe, sources } = recipeOf(
          datas.map((data, i) => ({ path: `f${i}.bin`, data })),
          level as CompressionLevel
        )
        const zip = await writeZip(recipe, sources, {}, limit)
        const unzipped = unzipSync(new Uint8Array(await zip.blob.arrayBuffer()))
        datas.forEach((data, i) => expect(sameBytes(unzipped[`f${i}.bin`], data)).toBe(true))

        const tarGz = await writeTarGz(recipe, sources, {}, limit)
        const tar = gunzipSync(new Uint8Array(await tarGz.blob.arrayBuffer()))
        expect(tar.length % 512).toBe(0)
        const extracted = await extractEntries(tarGz.blob, 'all')
        for (const [i, file] of extracted.entries()) {
          expect(sameBytes(new Uint8Array(await file.blob.arrayBuffer()), datas[i])).toBe(true)
        }
      }),
      { numRuns: 40 }
    )
  })
})

describe('createZip', () => {
  test('圧縮レベル 0 は無圧縮、すでに縮んでいる形式はレベルにかかわらず無圧縮', async () => {
    const data = 'a'.repeat(50000)
    const stored = await createZip(recipeOf([{ path: 'a.txt', data }], 0).recipe, recipeOf([{ path: 'a.txt', data }]).sources)
    const deflated = await createZip(recipeOf([{ path: 'a.txt', data }], 9).recipe, recipeOf([{ path: 'a.txt', data }]).sources)
    const media = await createZip(recipeOf([{ path: 'a.mp4', data }], 9).recipe, recipeOf([{ path: 'a.mp4', data }]).sources)
    expect((await probeArchive(stored.blob)).entries[0].compressedSize).toBe(50000)
    expect((await probeArchive(deflated.blob)).entries[0].compressedSize).toBeLessThan(1000)
    expect((await probeArchive(media.blob)).entries[0].compressedSize).toBe(50000)
  })

  test('元ファイルが渡されていなければ not-found', async () => {
    const { recipe } = recipeOf([{ path: 'a.txt', data: 'a' }])
    await expectArchiveError(createZip(recipe, new Map()), 'not-found')
  })
})

describe('zipRenderedFiles', () => {
  test('一括変換の結果を 1 つの ZIP にまとめ、同じ名前は番号でずらす', async () => {
    const zip = await zipRenderedFiles(
      [
        { blob: new Blob(['1']), filename: 'out.mp4' },
        { blob: new Blob(['2']), filename: 'out.mp4' },
        { blob: new Blob(['3']), filename: 'sub/out.mp4' },
      ],
      '変換結果'
    )
    expect(zip.filename).toBe('変換結果.zip')
    const files = await extractEntries(zip.blob, 'all')
    expect(files.map((file) => file.filename)).toEqual(['out.mp4', 'out (2).mp4', 'sub/out.mp4'])
    expect(await Promise.all(files.map((file) => blobText(file.blob)))).toEqual(['1', '2', '3'])
  })
})

describe('ほかのツールで作られた ZIP', () => {
  test('UTF-8 の印のない Shift_JIS 名（Windows の ZIP）を読み、フォルダの木にできる', async () => {
    const sjis = (...values: number[]) => new Uint8Array(values)
    const zip = buildZip([
      // 資料/
      { name: sjis(0x8e, 0x91, 0x97, 0xbf, 0x2f) },
      // 資料/表.txt（2 バイト目が 0x5C）
      { name: sjis(0x8e, 0x91, 0x97, 0xbf, 0x2f, 0x95, 0x5c, 0x2e, 0x74, 0x78, 0x74), data: 'hyou' },
      // 資料/日本語.txt
      { name: sjis(0x8e, 0x91, 0x97, 0xbf, 0x2f, 0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x2e, 0x74, 0x78, 0x74), data: 'nihongo' },
      // UTF-8 の印つきの名前はそのまま
      { name: '絵文字🎉.txt', flags: 0x0800, data: 'emoji' },
    ])
    const info = await probeArchive(new Blob([zip]))
    expect(info.entries.map((entry) => [entry.path, entry.nameEncoding, entry.isDirectory])).toEqual([
      ['資料', 'shift_jis', true],
      ['資料/表.txt', 'shift_jis', false],
      ['資料/日本語.txt', 'shift_jis', false],
      ['絵文字🎉.txt', 'utf-8', false],
    ])
    expect(info.entries[1].modified).toEqual(new Date(2024, 0, 2, 3, 4, 6))
    const tree = buildEntryTree(info.entries)
    expect(tree.children.map((child) => child.name)).toEqual(['資料', '絵文字🎉.txt'])
    expect(tree.children[0].children.map((child) => child.name)).toEqual(['日本語.txt', '表.txt'].sort((a, b) => a.localeCompare(b)))
    const file = await extractEntry(new Blob([zip]), '資料/表.txt')
    expect(await blobText(file)).toBe('hyou')
  })

  test('zip-slip を狙った名前は展開先の中に収め、重なれば番号でずらす', async () => {
    const zip = buildZip([
      { name: '../../evil.sh', data: '1' },
      { name: '/etc/passwd', data: '2' },
      { name: 'C:\\Windows\\evil.dll', data: '3' },
      { name: 'evil.sh', data: '4' },
    ])
    const files = await extractEntries(new Blob([zip]), 'all')
    expect(files.map((file) => file.filename)).toEqual(['evil.sh', 'etc/passwd', 'Windows/evil.dll', 'evil (2).sh'])
  })

  test('暗号化されたファイルは一覧には出し、展開しようとすると encrypted で断る', async () => {
    const zip = new Blob([buildZip([{ name: 'plain.txt', data: 'ok' }, { name: 'secret.txt', data: 'xx', flags: 0x0001 }])])
    const info = await probeArchive(zip)
    expect(info.hasEncryptedEntries).toBe(true)
    expect(info.entries.map((entry) => entry.encrypted)).toEqual([false, true])
    const error = await expectArchiveError(extractEntries(zip, 'all'), 'encrypted')
    expect(error.path).toBe('secret.txt')
    // 暗号化されていないものだけなら展開できる
    expect(await blobText((await extractEntries(zip, ['plain.txt']))[0].blob)).toBe('ok')
  })

  test('AES 暗号化（方式 99）も暗号化として扱う', async () => {
    const zip = new Blob([buildZip([{ name: 'aes.txt', data: 'xx', method: 99 }])])
    expect((await probeArchive(zip)).entries[0].encrypted).toBe(true)
    await expectArchiveError(extractEntries(zip, 'all'), 'encrypted')
  })

  test('対応していない圧縮方式は unsupported-method', async () => {
    const zip = new Blob([buildZip([{ name: 'a.txt', data: 'xx', method: 12 }])])
    await expectArchiveError(extractEntries(zip, 'all'), 'unsupported-method')
  })

  test('CRC が合わなければ corrupt', async () => {
    // 無圧縮は写さず切り出すだけなので確かめない。deflate で作ってから CRC を書き換える
    const bytes = zipSync({ 'a.txt': encoder.encode('a'.repeat(1000)) })
    const view = new DataView(bytes.buffer)
    let central = bytes.length - 4
    while (view.getUint32(central, true) !== 0x02014b50) central--
    view.setUint32(central + 16, 0x12345678, true)
    await expectArchiveError(extractEntries(new Blob([bytes]), 'all'), 'corrupt')
  })

  test('fflate の zipSync で作った ZIP も読める', async () => {
    const bytes = zipSync({ 'dir/a.txt': encoder.encode('hello'), 'b.bin': new Uint8Array([1, 2, 3]) })
    const files = await extractEntries(new Blob([bytes]), 'all')
    expect(files.map((file) => file.filename)).toEqual(['dir/a.txt', 'b.bin'])
    expect(await blobText(files[0].blob)).toBe('hello')
  })

  test('中身のない ZIP', async () => {
    const info = await probeArchive(new Blob([buildZip([])]))
    expect(info).toMatchObject({ format: 'zip', entries: [], totalSize: 0 })
  })
})

describe('tar と gzip', () => {
  test('素の tar は中身を読まずに一覧でき、中身は写さずに切り出す', async () => {
    const { recipe, sources } = recipeOf(SAMPLE)
    const tar = gunzipSync(new Uint8Array(await (await createTarGz(recipe, sources)).blob.arrayBuffer()))
    const info = await probeArchive(new Blob([tar]))
    expect(info.format).toBe('tar')
    expect(info.entries.map((entry) => entry.path)).toEqual(SAMPLE.map((file) => file.path))
    expect(await blobText((await extractEntries(new Blob([tar]), ['日本語/資料.txt']))[0].blob)).toBe('こんにちは、世界')
  })

  test('gzip 1 つだけのファイルは、ヘッダーの名前か圧縮ファイルの名前から中身の名前を決める', async () => {
    const data = encoder.encode('log line\n'.repeat(100))
    const named = new File([gzipSync(data, { filename: 'server.log', mtime: new Date(2024, 0, 1) })], 'x.gz')
    const unnamed = new File([gzipSync(data)], 'access.log.gz')
    const namedInfo = await probeArchive(named)
    expect(namedInfo).toMatchObject({ format: 'gzip', totalSize: data.length })
    expect(namedInfo.entries[0]).toMatchObject({ path: 'server.log', size: data.length })
    expect((await probeArchive(unnamed)).entries[0].path).toBe('access.log')
    const file = await extractEntry(unnamed, 'access.log')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(data)
  })

  test('tar.gz は 1 つずつの圧縮後の大きさを持たない（null）', async () => {
    const { recipe, sources } = recipeOf(SAMPLE)
    const info = await probeArchive((await createTarGz(recipe, sources)).blob)
    expect(info.entries.every((entry) => entry.compressedSize === null)).toBe(true)
    expect(buildEntryTree(info.entries).compressedSize).toBeNull()
  })

  test('壊れた gzip は corrupt', async () => {
    const { recipe, sources } = recipeOf(SAMPLE)
    const bytes = new Uint8Array(await (await createTarGz(recipe, sources)).blob.arrayBuffer())
    await expectArchiveError(probeArchive(new Blob([bytes.subarray(0, bytes.length - 40)])), 'corrupt')
  })
})

describe('形式の判定', () => {
  test.each([
    ['7z', [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c, 0, 4]],
    ['rar', [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0]],
    ['xz', [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]],
    ['bzip2', [0x42, 0x5a, 0x68, 0x39]],
  ])('%s は判定したうえで unsupported-format として断る', async (format, head) => {
    const bytes = new Uint8Array(1024)
    bytes.set(head)
    expect(detectArchiveFormat(bytes)).toBe(format)
    const error = await expectArchiveError(probeArchive(new Blob([bytes])), 'unsupported-format')
    expect(error.format).toBe(format)
  })

  test('圧縮ファイルでないものは unknown', async () => {
    const error = await expectArchiveError(probeArchive(new Blob(['just text'])), 'unsupported-format')
    expect(error.format).toBe('unknown')
  })
})

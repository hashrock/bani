import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { createFolderWriter, downloadNames, planSave, planSaveMany } from './save'
import type { SavePolicyInput } from './save'

const policyInput: fc.Arbitrary<SavePolicyInput> = fc.record({
  lossless: fc.boolean(),
  sameFormat: fc.boolean(),
  canOverwrite: fc.boolean(),
  canCopy: fc.boolean(),
})

describe('planSave', () => {
  it('同じ方法を二度並べない', () => {
    fc.assert(
      fc.property(policyInput, (input) => {
        const { primary, others } = planSave(input)
        const all = [primary, ...others]
        expect(new Set(all).size).toBe(all.length)
      })
    )
  })

  it('別名で保存はいつでも選べる', () => {
    fc.assert(
      fc.property(policyInput, (input) => {
        const { primary, others } = planSave(input)
        expect([primary, ...others]).toContain('saveAs')
      })
    )
  })

  it('上書きはハンドルがあるときだけ、コピーはできるときだけ出る', () => {
    fc.assert(
      fc.property(policyInput, (input) => {
        const all = (({ primary, others }) => [primary, ...others])(planSave(input))
        expect(all.includes('overwrite')).toBe(input.canOverwrite)
        expect(all.includes('copyToClipboard')).toBe(input.canCopy)
      })
    )
  })

  it('劣化せず形式も同じときだけ上書きが主になる', () => {
    fc.assert(
      fc.property(policyInput, (input) => {
        const { primary } = planSave(input)
        expect(primary === 'overwrite').toBe(
          input.canOverwrite && input.lossless && input.sameFormat
        )
      })
    )
  })

  it('非可逆の変換でも、上書きはドロップダウンから選べる', () => {
    expect(
      planSave({ lossless: false, sameFormat: true, canOverwrite: true, canCopy: false })
    ).toEqual({ primary: 'saveAs', others: ['overwrite'] })
  })
})

describe('planSaveMany', () => {
  it('フォルダを選べるならフォルダが主、選べなければ ZIP が主', () => {
    expect(planSaveMany({ canPickFolder: true, count: 3 })).toEqual({ primary: 'folder', others: ['zip', 'each'] })
    expect(planSaveMany({ canPickFolder: false, count: 3 })).toEqual({ primary: 'zip', others: ['each'] })
  })

  it('1 つだけなら ZIP にまとめない', () => {
    expect(planSaveMany({ canPickFolder: true, count: 1 })).toEqual({ primary: 'folder', others: ['each'] })
    expect(planSaveMany({ canPickFolder: false, count: 1 })).toEqual({ primary: 'each', others: [] })
  })

  it('1 つずつダウンロードはいつでも選べ、同じ方法を二度並べない', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.nat(20), (canPickFolder, count) => {
        const { primary, others } = planSaveMany({ canPickFolder, count })
        const all = [primary, ...others]
        expect(all).toContain('each')
        expect(new Set(all).size).toBe(all.length)
      })
    )
  })
})

describe('downloadNames', () => {
  it('フォルダを落とし、重なれば番号を振る', () => {
    expect(downloadNames(['a/x.txt', 'b/x.txt', 'X.txt', 'y.tar.gz'])).toEqual([
      'x.txt',
      'x (2).txt',
      'X (3).txt',
      'y.tar.gz',
    ])
  })
})

/** テスト用のフォルダ。書いたパスを覚えるだけ（File System Access の必要な部分だけを真似る） */
function fakeFolder(existing: string[] = []) {
  const written = new Map<string, Blob>()
  const notFound = () => new DOMException('missing', 'NotFoundError')
  const make = (prefix: string): FileSystemDirectoryHandle => {
    const has = (path: string) => existing.includes(path) || [...written.keys()].some((key) => key === path || key.startsWith(`${path}/`))
    return {
      name: prefix || 'root',
      async getFileHandle(name: string, options?: { create?: boolean }) {
        const path = prefix ? `${prefix}/${name}` : name
        if (!options?.create && !existing.includes(path) && !written.has(path)) throw notFound()
        return {
          async createWritable() {
            return {
              async write(blob: Blob) {
                written.set(path, blob)
              },
              async close() {},
            }
          },
        }
      },
      async getDirectoryHandle(name: string, options?: { create?: boolean }) {
        const path = prefix ? `${prefix}/${name}` : name
        if (!options?.create && !existing.some((item) => item.startsWith(`${path}/`)) && !has(path)) throw notFound()
        return make(path)
      },
    } as unknown as FileSystemDirectoryHandle
  }
  return { root: make(''), written }
}

describe('createFolderWriter', () => {
  const blob = new Blob(['x'])

  it('下のフォルダを作って書き、同じ書き込みの中のフォルダにはまとめて入れる', async () => {
    const { root, written } = fakeFolder()
    const writer = createFolderWriter(root)
    await writer.write({ blob, filename: 'arc/a.txt' })
    await writer.write({ blob, filename: 'arc/sub/b.txt' })
    expect([...written.keys()]).toEqual(['arc/a.txt', 'arc/sub/b.txt'])
  })

  it('すでにあるもの・同じ書き込みで使った名前は上書きせず番号をずらす', async () => {
    const { root, written } = fakeFolder(['a.txt', 'arc/old.txt'])
    const writer = createFolderWriter(root)
    expect(await writer.write({ blob, filename: 'a.txt' })).toBe('a (2).txt')
    expect(await writer.write({ blob, filename: 'a.txt' })).toBe('a (3).txt')
    expect(await writer.write({ blob, filename: 'arc/x.txt' })).toBe('arc (2)')
    expect([...written.keys()]).toEqual(['a (2).txt', 'a (3).txt', 'arc (2)/x.txt'])
  })
})

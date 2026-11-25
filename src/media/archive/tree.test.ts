import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { createPathRegistry } from './names'
import { buildEntryTree, compareTreeNodes, type ArchiveTreeNode } from './tree'
import type { ArchiveEntry } from './types'

const segment = fc.constantFrom('a', 'b', 'c', 'img', '写真', 'file10', 'file9')

/** probeArchive が返しうる一覧: パスは一意で無害化済み、フォルダの項目はあったりなかったり */
const entries = fc
  .array(
    fc.record({
      parts: fc.array(segment, { minLength: 1, maxLength: 4 }),
      isDirectory: fc.boolean(),
      size: fc.nat({ max: 1e6 }),
      compressedSize: fc.option(fc.nat({ max: 1e6 }), { nil: null }),
    }),
    { maxLength: 40 }
  )
  .map((raws) => {
    const registry = createPathRegistry()
    return raws.map(
      (raw): ArchiveEntry => ({
        path: raw.isDirectory ? registry.claimFolder(raw.parts.join('/')) : registry.claimFile(raw.parts.join('/')),
        size: raw.isDirectory ? 0 : raw.size,
        compressedSize: raw.isDirectory ? 0 : raw.compressedSize,
        isDirectory: raw.isDirectory,
        modified: null,
        encrypted: false,
        nameEncoding: 'utf-8',
      })
    )
  })

function walk(node: ArchiveTreeNode, visit: (node: ArchiveTreeNode, parent: ArchiveTreeNode | null) => void) {
  const go = (current: ArchiveTreeNode, parent: ArchiveTreeNode | null) => {
    visit(current, parent)
    for (const child of current.children) go(child, current)
  }
  go(node, null)
}

describe('buildEntryTree', () => {
  test('どのファイルもちょうど 1 回、同じパスの葉として現れる', () => {
    fc.assert(
      fc.property(entries, (list) => {
        const leaves: ArchiveEntry[] = []
        walk(buildEntryTree(list), (node) => {
          if (!node.isDirectory) {
            expect(node.entry?.path).toBe(node.path)
            leaves.push(node.entry!)
          }
        })
        const files = list.filter((entry) => !entry.isDirectory)
        expect(leaves).toHaveLength(files.length)
        expect(new Set(leaves)).toEqual(new Set(files))
      })
    )
  })

  test('ノードのパスは親のパスと名前をつないだもの。途中のフォルダは項目がなくても作られる', () => {
    fc.assert(
      fc.property(entries, (list) => {
        const folders = new Set<string>()
        walk(buildEntryTree(list), (node, parent) => {
          if (parent) expect(node.path).toBe(parent.path === '' ? node.name : `${parent.path}/${node.name}`)
          if (node.isDirectory) folders.add(node.path)
        })
        for (const entry of list) {
          const parts = entry.path.split('/')
          for (let i = 1; i < parts.length; i++) expect(folders.has(parts.slice(0, i).join('/'))).toBe(true)
          if (entry.isDirectory) expect(folders.has(entry.path)).toBe(true)
        }
      })
    )
  })

  test('フォルダの大きさ・ファイル数は下にあるものの合計。圧縮後は 1 つでも不明なら不明', () => {
    fc.assert(
      fc.property(entries, (list) => {
        const root = buildEntryTree(list)
        const files = list.filter((entry) => !entry.isDirectory)
        expect(root.size).toBe(files.reduce((sum, entry) => sum + entry.size, 0))
        expect(root.fileCount).toBe(files.length)
        expect(root.compressedSize).toBe(
          files.some((entry) => entry.compressedSize === null)
            ? null
            : files.reduce((sum, entry) => sum + entry.compressedSize!, 0)
        )
        walk(root, (node) => {
          if (!node.isDirectory) return
          expect(node.size).toBe(node.children.reduce((sum, child) => sum + child.size, 0))
          expect(node.fileCount).toBe(node.children.reduce((sum, child) => sum + child.fileCount, 0))
        })
      })
    )
  })

  test('子はフォルダが先、そのあと名前順に並ぶ', () => {
    fc.assert(
      fc.property(entries, (list) => {
        walk(buildEntryTree(list), (node) => {
          for (let i = 1; i < node.children.length; i++) {
            expect(compareTreeNodes(node.children[i - 1], node.children[i])).toBeLessThanOrEqual(0)
          }
        })
      })
    )
  })

  test('一覧の並び順を変えても同じ木になる', () => {
    fc.assert(
      fc.property(
        entries.chain((list) => fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length }))),
        ([list, shuffled]) => {
          expect(buildEntryTree(shuffled)).toEqual(buildEntryTree(list))
        }
      )
    )
  })

  test('数字は数として並べる', () => {
    const file = (path: string): ArchiveEntry => ({
      path,
      size: 1,
      compressedSize: 1,
      isDirectory: false,
      modified: null,
      encrypted: false,
      nameEncoding: 'utf-8',
    })
    const root = buildEntryTree([file('p10.png'), file('dir/x'), file('p9.png')])
    expect(root.children.map((child) => child.name)).toEqual(['dir', 'p9.png', 'p10.png'])
  })
})

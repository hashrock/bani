import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { buildEntryTree, type ArchiveEntry } from '../../media/archive'
import {
  archiveBaseName,
  checkState,
  checkStates,
  downloadNames,
  extractionPaths,
  filesUnder,
  flattenVisible,
  foldersUnder,
  planExtractLayout,
  planFolderRename,
  planMove,
  pruneSelection,
  toggleNode,
  topSelected,
} from './treeModel'

const entry = (path: string, extra: Partial<ArchiveEntry> = {}): ArchiveEntry => ({
  path,
  size: 10,
  compressedSize: 5,
  isDirectory: false,
  modified: null,
  encrypted: false,
  nameEncoding: 'utf-8',
  ...extra,
})

const tree = (paths: string[], encrypted: string[] = []) =>
  buildEntryTree(paths.map((path) => entry(path, { encrypted: encrypted.includes(path) })))

const find = (root: ReturnType<typeof tree>, path: string) => {
  let node = root
  for (const segment of path.split('/')) node = node.children.find((child) => child.name === segment)!
  return node
}

describe('flattenVisible', () => {
  const root = tree(['a/b/c.txt', 'a/d.txt', 'e.txt'])

  it('閉じたフォルダの中は出さない', () => {
    expect(flattenVisible(root, new Set()).map((row) => row.node.path)).toEqual(['a', 'e.txt'])
  })

  it('開いたフォルダは深さと親を付けて並べる', () => {
    const rows = flattenVisible(root, new Set(['a', 'a/b']))
    expect(rows.map((row) => [row.node.path, row.depth, row.parent])).toEqual([
      ['a', 0, ''],
      ['a/b', 1, 'a'],
      ['a/b/c.txt', 2, 'a/b'],
      ['a/d.txt', 1, 'a'],
      ['e.txt', 0, ''],
    ])
  })

  it('親が閉じていれば、開いた印のある子フォルダも出さない', () => {
    expect(flattenVisible(root, new Set(['a/b'])).map((row) => row.node.path)).toEqual(['a', 'e.txt'])
  })

  it('foldersUnder は根を含めずにすべてのフォルダを返す', () => {
    expect(foldersUnder(root).sort()).toEqual(['a', 'a/b'])
  })
})

describe('選択', () => {
  const root = tree(['a/x.txt', 'a/lock.txt', 'a/b/y.txt', 'z.txt'], ['a/lock.txt'])

  it('パスワード付きは選べるファイルに入れない', () => {
    expect(filesUnder(root).sort()).toEqual(['a/b/y.txt', 'a/x.txt', 'z.txt'])
    expect(filesUnder(root, false)).toHaveLength(4)
  })

  it('フォルダのチェックは下のファイルから決まる', () => {
    const a = find(root, 'a')
    expect(checkState(a, new Set())).toBe('none')
    expect(checkState(a, new Set(['a/x.txt']))).toBe('some')
    expect(checkState(a, new Set(['a/x.txt', 'a/b/y.txt']))).toBe('all')
  })

  it('押すと全部選び、全部選ばれていれば外す', () => {
    const a = find(root, 'a')
    const once = toggleNode(a, new Set(['z.txt']))
    expect([...once].sort()).toEqual(['a/b/y.txt', 'a/x.txt', 'z.txt'])
    expect([...toggleNode(a, once)]).toEqual(['z.txt'])
  })

  it('一部だけ選ばれたフォルダを押すと全部選ぶ', () => {
    const a = find(root, 'a')
    expect(checkState(a, toggleNode(a, new Set(['a/x.txt'])))).toBe('all')
  })

  it('消えたパスは選択から落とし、変わらなければ同じ集合を返す', () => {
    const selected = new Set(['z.txt', 'gone.txt'])
    expect([...pruneSelection(root, selected)]).toEqual(['z.txt'])
    const kept = new Set(['z.txt'])
    expect(pruneSelection(root, kept)).toBe(kept)
  })

  it('checkStates は行ごとの checkState と一致する（任意の選択）', () => {
    const nodes: ReturnType<typeof tree>[] = []
    const collect = (node: ReturnType<typeof tree>) => {
      nodes.push(node)
      node.children.forEach(collect)
    }
    collect(root)
    fc.assert(
      fc.property(fc.subarray(filesUnder(root)), (picked) => {
        const selected = new Set(picked)
        const states = checkStates(root, selected)
        for (const node of nodes) {
          // パスワード付きのファイルは選べないので 'none' 扱い
          expect(states.get(node.path)).toBe(checkState(node, selected))
        }
      })
    )
  })

  it('押すたびに全部と空を行き来する（任意の木）', () => {
    const pathArb = fc
      .array(fc.constantFrom('a', 'b', 'c'), { minLength: 1, maxLength: 3 })
      .map((segments) => `${segments.join('/')}.txt`)
    fc.assert(
      fc.property(fc.uniqueArray(pathArb, { minLength: 1, maxLength: 12 }), (paths) => {
        const root = tree(paths)
        const all = toggleNode(root, new Set())
        expect(checkState(root, all)).toBe('all')
        expect(toggleNode(root, all).size).toBe(0)
      })
    )
  })
})

describe('extractionPaths', () => {
  const root = tree(['a/x.txt', 'a/b/y.txt', 'a/b/w.txt', 'c/lock.txt', 'c/ok.txt', 'z.txt'], ['c/lock.txt'])

  it('全部選ばれたフォルダはフォルダのパスにまとめる', () => {
    expect(extractionPaths(root, new Set(['a/b/y.txt', 'a/b/w.txt', 'z.txt']))).toEqual(['a/b', 'z.txt'])
    expect(extractionPaths(root, new Set(['a/x.txt', 'a/b/y.txt', 'a/b/w.txt']))).toEqual(['a'])
  })

  it('パスワード付きを含むフォルダはまとめず、選んだファイルだけ渡す', () => {
    expect(extractionPaths(root, new Set(['c/ok.txt']))).toEqual(['c/ok.txt'])
  })

  it('全部選ばれていれば all', () => {
    const plain = tree(['a/x.txt', 'y.txt'])
    expect(extractionPaths(plain, toggleNode(plain, new Set()))).toBe('all')
  })

  it('まとめても展開されるファイルは選択と同じ（任意の選択）', () => {
    const files = filesUnder(root)
    fc.assert(
      fc.property(fc.subarray(files), (picked) => {
        const result = extractionPaths(root, new Set(picked))
        const expanded =
          result === 'all'
            ? filesUnder(root, false)
            : filesUnder(root, false).filter((path) => result.some((p) => path === p || path.startsWith(`${p}/`)))
        expect(expanded.sort()).toEqual([...picked].sort())
      })
    )
  })
})

describe('移動と名前の変更', () => {
  const root = tree(['a/x.txt', 'a/b/y.txt', 'z.txt'])

  it('丸ごと選んだフォルダは構造を保ったまま移す', () => {
    const plan = planMove(root, new Set(['a/x.txt', 'a/b/y.txt', 'z.txt']), 'out')
    expect(Object.fromEntries(plan)).toEqual({
      'out/a': ['a/x.txt'],
      'out/a/b': ['a/b/y.txt'],
      out: ['z.txt'],
    })
  })

  it('一部だけ選んだフォルダの中身はファイルとして移す', () => {
    const plan = planMove(root, new Set(['a/b/y.txt']), '')
    // a/b は y.txt だけなので丸ごと選んだことになり、b ごと根へ移る
    expect(Object.fromEntries(plan)).toEqual({ b: ['a/b/y.txt'] })
    expect(topSelected(root, new Set(['a/x.txt'])).map((node) => node.path)).toEqual(['a/x.txt'])
  })

  it('フォルダの名前を変えると、中のファイルが新しい名前の下へ移る', () => {
    expect(Object.fromEntries(planFolderRename(find(root, 'a/b'), 'c'))).toEqual({ 'a/c': ['a/b/y.txt'] })
    expect(Object.fromEntries(planFolderRename(find(root, 'a'), 'q'))).toEqual({
      q: ['a/x.txt'],
      'q/b': ['a/b/y.txt'],
    })
  })
})

describe('展開先の名前', () => {
  it('ダウンロードの名前は重なれば番号を振る', () => {
    expect(downloadNames(['a/x.txt', 'b/x.txt', 'X.txt', 'y.tar.gz'])).toEqual([
      'x.txt',
      'x (2).txt',
      'X (3).txt',
      'y.tar.gz',
    ])
  })

  it('1 つのフォルダに収まるものはそのフォルダを作って入れる', () => {
    expect(planExtractLayout(['p/a.txt', 'p/q/b.txt'], 'arc')).toEqual({
      folder: 'p',
      files: [
        { source: 'p/a.txt', target: 'a.txt' },
        { source: 'p/q/b.txt', target: 'q/b.txt' },
      ],
    })
  })

  it('ばらばらのものは圧縮ファイルの名前のフォルダにまとめる', () => {
    expect(planExtractLayout(['a.txt', 'p/b.txt'], 'arc')).toEqual({
      folder: 'arc',
      files: [
        { source: 'a.txt', target: 'a.txt' },
        { source: 'p/b.txt', target: 'p/b.txt' },
      ],
    })
  })

  it('1 つだけならフォルダを作らずにファイルだけ置く', () => {
    expect(planExtractLayout(['p/q/b.txt'], 'arc')).toEqual({
      folder: null,
      files: [{ source: 'p/q/b.txt', target: 'b.txt' }],
    })
  })

  it('圧縮ファイルの拡張子を落とす', () => {
    expect(archiveBaseName('photos.tar.gz')).toBe('photos')
    expect(archiveBaseName('x.ZIP')).toBe('x')
    expect(archiveBaseName('.zip')).toBe('.zip')
  })
})

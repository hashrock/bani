import { basename } from './names'
import type { ArchiveEntry } from './types'

/** 一覧をフォルダ構造で見せるための木。フォルダの大きさは下にあるものの合計 */
export interface ArchiveTreeNode {
  /** 表示名。根は '' */
  name: string
  /** 中のパス。根は '' */
  path: string
  isDirectory: boolean
  /** 対応する一覧の項目。フォルダの項目を持たない圧縮ファイルが多いので、フォルダでは null もある */
  entry: ArchiveEntry | null
  /** フォルダが先、同じ種類の中では名前順（数字は数として並べる） */
  children: ArchiveTreeNode[]
  /** 下にあるファイルの展開後の大きさの合計 */
  size: number
  /** 下にあるファイルの圧縮後の大きさの合計。1 つでも分からなければ null */
  compressedSize: number | null
  /** 下にあるファイルの数（フォルダは数えない） */
  fileCount: number
}

const collator = new Intl.Collator(undefined, { numeric: true })

export function compareTreeNodes(a: ArchiveTreeNode, b: ArchiveTreeNode): number {
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  return collator.compare(a.name, b.name) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
}

const folderNode = (path: string): ArchiveTreeNode => ({
  name: basename(path),
  path,
  isDirectory: true,
  entry: null,
  children: [],
  size: 0,
  compressedSize: 0,
  fileCount: 0,
})

/**
 * 一覧（パスが一意で無害化済み、probeArchive の entries）から木を作る純粋関数。
 * 途中のフォルダは項目がなくても作る。ファイルとフォルダが同じパスを取り合う壊れた一覧でも、
 * 両方を別のノードとして残し、どの項目も落とさない。
 */
export function buildEntryTree(entries: readonly ArchiveEntry[]): ArchiveTreeNode {
  const root = folderNode('')
  const folders = new Map<string, ArchiveTreeNode>([['', root]])

  const ensureFolder = (path: string): ArchiveTreeNode => {
    const existing = folders.get(path)
    if (existing) return existing
    const slash = path.lastIndexOf('/')
    const parent = ensureFolder(slash < 0 ? '' : path.slice(0, slash))
    const node = folderNode(path)
    parent.children.push(node)
    folders.set(path, node)
    return node
  }

  for (const entry of entries) {
    if (entry.isDirectory) {
      ensureFolder(entry.path).entry = entry
      continue
    }
    const slash = entry.path.lastIndexOf('/')
    ensureFolder(slash < 0 ? '' : entry.path.slice(0, slash)).children.push({
      name: basename(entry.path),
      path: entry.path,
      isDirectory: false,
      entry,
      children: [],
      size: entry.size,
      compressedSize: entry.compressedSize,
      fileCount: 1,
    })
  }

  // 合計は下から積み上げる。並べ替えも同じ巡回で済ませる
  const finish = (node: ArchiveTreeNode) => {
    if (!node.isDirectory) return
    node.children.sort(compareTreeNodes)
    for (const child of node.children) {
      finish(child)
      node.size += child.size
      node.fileCount += child.fileCount
      node.compressedSize =
        node.compressedSize === null || child.compressedSize === null ? null : node.compressedSize + child.compressedSize
    }
  }
  finish(root)
  return root
}

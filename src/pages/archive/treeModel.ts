import type { ArchiveTreeNode } from '../../media/archive'
import { basename, dirname, joinPath } from '../../media/archive/names'

/**
 * 一覧（フォルダの木）の上での選択・開閉・移動の計算。画面から切り離した純粋関数にして、
 * 展開や移動で「どのパスを渡すか」をテストで確かめられるようにする。
 * 選択はファイルのパスの集合で持つ。フォルダの選択状態は下のファイルから決める
 * （フォルダ自体を選択に入れると、中身が増減したときに食い違うため）。
 */

export interface VisibleRow {
  node: ArchiveTreeNode
  depth: number
  /** 親のフォルダのパス。根の直下は ''（根そのものは行にしない） */
  parent: string
}

/** 開いているフォルダだけをたどって、画面に並ぶ順に行を作る */
export function flattenVisible(root: ArchiveTreeNode, expanded: ReadonlySet<string>): VisibleRow[] {
  const rows: VisibleRow[] = []
  const walk = (node: ArchiveTreeNode, depth: number) => {
    for (const child of node.children) {
      rows.push({ node: child, depth, parent: node.path })
      if (child.isDirectory && expanded.has(child.path)) walk(child, depth + 1)
    }
  }
  walk(root, 0)
  return rows
}

/** パスワード付きは展開できないので選ばせない */
export const isSelectableFile = (node: ArchiveTreeNode) => !node.isDirectory && !node.entry?.encrypted

/** 下にあるファイルのパス。selectableOnly なら選べるものだけ */
export function filesUnder(node: ArchiveTreeNode, selectableOnly = true): string[] {
  const paths: string[] = []
  const walk = (current: ArchiveTreeNode) => {
    if (!current.isDirectory) {
      if (!selectableOnly || isSelectableFile(current)) paths.push(current.path)
      return
    }
    for (const child of current.children) walk(child)
  }
  walk(node)
  return paths
}

/** 下にあるフォルダのパス（node 自身を含む）。すべて開くのに使う */
export function foldersUnder(node: ArchiveTreeNode): string[] {
  const paths: string[] = []
  const walk = (current: ArchiveTreeNode) => {
    if (!current.isDirectory) return
    if (current.path !== '') paths.push(current.path)
    for (const child of current.children) walk(child)
  }
  walk(node)
  return paths
}

export type CheckState = 'all' | 'some' | 'none'

/** 選べるファイルのうち、どれだけ選ばれているか。選べるものがなければ 'none' */
export function checkState(node: ArchiveTreeNode, selected: ReadonlySet<string>): CheckState {
  const files = filesUnder(node)
  let hit = 0
  for (const path of files) if (selected.has(path)) hit++
  if (hit === 0) return 'none'
  return hit === files.length ? 'all' : 'some'
}

/**
 * すべての行のチェック状態を 1 回の巡回で求める。行ごとに checkState を呼ぶと
 * 深い木で同じファイルを何度も数えることになるので、画面ではこちらを使う。
 */
export function checkStates(root: ArchiveTreeNode, selected: ReadonlySet<string>): Map<string, CheckState> {
  const states = new Map<string, CheckState>()
  // [選べるファイルの数, そのうち選ばれている数]
  const walk = (node: ArchiveTreeNode): [number, number] => {
    let total = 0
    let hit = 0
    if (!node.isDirectory) {
      if (isSelectableFile(node)) {
        total = 1
        hit = selected.has(node.path) ? 1 : 0
      }
    } else {
      for (const child of node.children) {
        const [t, h] = walk(child)
        total += t
        hit += h
      }
    }
    states.set(node.path, hit === 0 ? 'none' : hit === total ? 'all' : 'some')
    return [total, hit]
  }
  walk(root)
  return states
}

/** 行のチェックを押したとき。全部選ばれていれば外し、そうでなければ全部選ぶ */
export function toggleNode(node: ArchiveTreeNode, selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected)
  const files = filesUnder(node)
  if (checkState(node, selected) === 'all') for (const path of files) next.delete(path)
  else for (const path of files) next.add(path)
  return next
}

/** 木から消えたパスを選択から落とす（作成中に削除・移動したあと） */
export function pruneSelection(root: ArchiveTreeNode, selected: ReadonlySet<string>): Set<string> {
  const present = new Set(filesUnder(root))
  const next = new Set([...selected].filter((path) => present.has(path)))
  return next.size === selected.size ? (selected as Set<string>) : next
}

/**
 * 展開に渡すパス。下のファイルが（パスワード付きも含めて）全部選ばれたフォルダは
 * フォルダのパス 1 つにまとめる。空のフォルダも一緒に取り出せ、渡す量も減る。
 * 根が丸ごと選ばれていれば 'all'。
 */
export function extractionPaths(root: ArchiveTreeNode, selected: ReadonlySet<string>): string[] | 'all' {
  const fully = (node: ArchiveTreeNode): boolean => {
    const files = filesUnder(node, false)
    return files.length > 0 && files.every((path) => selected.has(path))
  }
  if (fully(root)) return 'all'
  const paths: string[] = []
  const walk = (node: ArchiveTreeNode) => {
    for (const child of node.children) {
      if (!child.isDirectory) {
        if (selected.has(child.path)) paths.push(child.path)
      } else if (fully(child)) {
        paths.push(child.path)
      } else {
        walk(child)
      }
    }
  }
  walk(root)
  return paths
}

/**
 * 選択のうち「いちばん上にあるもの」。中身が全部選ばれたフォルダはフォルダとして、
 * それ以外は選ばれたファイルとして数える。移動で中のフォルダ構造を保つのに使う。
 */
export function topSelected(root: ArchiveTreeNode, selected: ReadonlySet<string>): ArchiveTreeNode[] {
  const result: ArchiveTreeNode[] = []
  const walk = (node: ArchiveTreeNode) => {
    for (const child of node.children) {
      if (!child.isDirectory) {
        if (selected.has(child.path)) result.push(child)
      } else if (checkState(child, selected) === 'all') {
        result.push(child)
      } else {
        walk(child)
      }
    }
  }
  walk(root)
  return result
}

/** ファイルのパス → 移したあとのフォルダ。同じフォルダへ行くものをまとめて返す */
export type MovePlan = Map<string, string[]>

function addToPlan(plan: MovePlan, folder: string, path: string) {
  const list = plan.get(folder)
  if (list) list.push(path)
  else plan.set(folder, [path])
}

/** フォルダ node の下のファイルを、newFolder を根として同じ構造のまま置き直す */
function relocate(plan: MovePlan, node: ArchiveTreeNode, newFolder: string) {
  for (const path of filesUnder(node, false)) {
    const relative = dirname(path.slice(node.path.length + 1))
    addToPlan(plan, relative === '' ? newFolder : joinPath(newFolder, relative), path)
  }
}

/**
 * 選んだものを target フォルダへ移す計画。ファイルは target の直下へ、
 * 丸ごと選ばれたフォルダは target の下に同じ名前・同じ構造で移す。
 */
export function planMove(root: ArchiveTreeNode, selected: ReadonlySet<string>, target: string): MovePlan {
  const plan: MovePlan = new Map()
  for (const node of topSelected(root, selected)) {
    if (node.isDirectory) relocate(plan, node, joinPath(target, node.name))
    else addToPlan(plan, target, node.path)
  }
  return plan
}

/** フォルダの名前を変える計画。中のファイルを、名前を変えたフォルダの下へ同じ構造で移す */
export function planFolderRename(folder: ArchiveTreeNode, name: string): MovePlan {
  const plan: MovePlan = new Map()
  relocate(plan, folder, joinPath(dirname(folder.path), name))
  return plan
}

/**
 * フォルダへ展開するときの置き方。中身をばらまかないよう、選んだものが 1 つのフォルダに
 * 収まっていなければ圧縮ファイルの名前のフォルダを作ってその中へ入れる（macOS の展開と同じ）。
 * ファイル 1 つだけならそのまま置く。
 * - folder: 選んだ場所に作るフォルダの名前（null なら作らない）
 * - files: folder（または選んだ場所）からの相対パス
 */
export interface ExtractLayout {
  folder: string | null
  files: { source: string; target: string }[]
}

export function planExtractLayout(paths: readonly string[], archiveBase: string): ExtractLayout {
  if (paths.length === 1 && !paths[0].includes('/')) {
    return { folder: null, files: [{ source: paths[0], target: paths[0] }] }
  }
  if (paths.length === 1) {
    return { folder: null, files: [{ source: paths[0], target: basename(paths[0]) }] }
  }
  const tops = new Set(paths.map((path) => path.split('/')[0]))
  const [top] = tops
  if (tops.size === 1 && paths.every((path) => path.includes('/'))) {
    return {
      folder: top,
      files: paths.map((path) => ({ source: path, target: path.slice(top.length + 1) })),
    }
  }
  return { folder: archiveBase || 'archive', files: paths.map((path) => ({ source: path, target: path })) }
}

/** 圧縮ファイルの名前から拡張子を落とす（.tar.gz・.tgz も一体で） */
export function archiveBaseName(filename: string): string {
  return filename.replace(/\.(tar\.gz|tar\.bz2|tar\.xz|tgz|zip|tar|gz|7z|rar)$/i, '') || filename
}

/** 中身の圧縮後の割合（0〜1）。分からないとき・空のときは null */
export function compressionRatio(size: number, compressedSize: number | null): number | null {
  if (compressedSize === null || size <= 0) return null
  return compressedSize / size
}

/**
 * macOS が圧縮のときに足す付随ファイルか（__MACOSX/ の下、._名前 のリソースフォーク、.DS_Store）。
 * 中身として役に立たず、ほかの OS で展開するとゴミになるので、既定では一覧・展開から外す
 */
export function isMacJunk(path: string): boolean {
  const segments = path.split('/').filter((segment) => segment !== '')
  if (segments.includes('__MACOSX')) return true
  const name = segments[segments.length - 1] ?? ''
  return name.startsWith('._') || name === '.DS_Store'
}

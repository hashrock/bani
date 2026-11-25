import { isArchiveError } from '../../media/archive'
import type { RenderedFile } from '../../media/types'
import type { ArchiveMessages } from './messages'
import { numberedName } from '../../media/archive/names'
import { planExtractLayout } from './treeModel'

/** 画面に出すエラーの文言。圧縮ファイルの問題は code で出し分け、それ以外はそのまま見せる */
export function describeError(error: unknown, m: ArchiveMessages): string {
  if (isArchiveError(error)) {
    if (error.code === 'unsupported-format' && error.format && error.format !== 'unknown') {
      return m.unsupportedNamed(error.format.toUpperCase())
    }
    return m.errors[error.code]
  }
  return m.failed(error instanceof Error ? error.message : String(error))
}

/** 圧縮ファイルを受け付ける accept（開き直すとき用） */
export const ARCHIVE_ACCEPT = '.zip,.tar,.gz,.tgz,.7z,.rar,application/zip,application/gzip,application/x-tar'

export const canPickDirectory = () => typeof window !== 'undefined' && !!window.showDirectoryPicker

async function exists(directory: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await directory.getFileHandle(name)
    return true
  } catch {
    try {
      await directory.getDirectoryHandle(name)
      return true
    } catch {
      return false
    }
  }
}

/**
 * 展開したものを、えらんだフォルダへ書き出す。既にあるものは上書きしないよう、
 * いちばん上に作るフォルダ（またはファイル 1 つ）の名前だけをずらし、その下は新しく作る。
 * 返すのは書き出した先の名前（通知に使う）。
 */
export async function writeToDirectory(
  directory: FileSystemDirectoryHandle,
  files: readonly RenderedFile[],
  archiveBase: string
): Promise<string> {
  const layout = planExtractLayout(
    files.map((file) => file.filename),
    archiveBase
  )
  const blobs = new Map(files.map((file) => [file.filename, file.blob]))

  // 既にあるかは 1 つずつ問い合わせるしかないので、空いている名前が見つかるまで番号を進める
  const isFolder = layout.folder !== null
  const topName = layout.folder ?? layout.files[0].target
  let chosen = topName
  for (let n = 2; await exists(directory, chosen); n++) chosen = numberedName(topName, n, isFolder)

  let base = directory
  if (isFolder) base = await directory.getDirectoryHandle(chosen, { create: true })
  const folders = new Map<string, FileSystemDirectoryHandle>([['', base]])
  const folderFor = async (path: string): Promise<FileSystemDirectoryHandle> => {
    const cached = folders.get(path)
    if (cached) return cached
    const slash = path.lastIndexOf('/')
    const parent = await folderFor(slash < 0 ? '' : path.slice(0, slash))
    const handle = await parent.getDirectoryHandle(path.slice(slash + 1), { create: true })
    folders.set(path, handle)
    return handle
  }

  for (const { source, target } of layout.files) {
    const slash = target.lastIndexOf('/')
    const folder = await folderFor(slash < 0 ? '' : target.slice(0, slash))
    const name = layout.folder === null ? chosen : target.slice(slash + 1)
    const handle = await folder.getFileHandle(name, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blobs.get(source)!)
    await writable.close()
  }
  return chosen
}

/** ドロップ・フォルダ選択で受け取ったもの。path はフォルダ込みの相対パス */
export interface AddedFile {
  file: File
  path: string
}

function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  // readEntries は一度に全部を返すとは限らない（Chrome は 100 件ずつ）ので、空になるまで読む
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = []
    const next = () =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all)
        else {
          all.push(...batch)
          next()
        }
      }, reject)
    next()
  })
}

async function walkEntry(entry: FileSystemEntry, out: AddedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    out.push({ file, path: entry.fullPath.replace(/^\/+/, '') })
    return
  }
  if (entry.isDirectory) {
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader())
    for (const child of children) await walkEntry(child, out)
  }
}

/**
 * ドロップされたものをフォルダごと取り出す。共通の collectDropped はフォルダを外すが、
 * 圧縮ファイルを作るときはフォルダをそのまま入れたいので、ここで中までたどる。
 * webkitGetAsEntry はイベントの中で同期的に呼ばないと使えなくなるので、先に集めてから待つ。
 */
export function collectDroppedTree(dataTransfer: DataTransfer): Promise<AddedFile[]> {
  const items = Array.from(dataTransfer.items).filter((item) => item.kind === 'file')
  const entries = items.map((item) => ({ entry: item.webkitGetAsEntry?.() ?? null, file: item.getAsFile() }))
  if (entries.length === 0) {
    return Promise.resolve(Array.from(dataTransfer.files).map((file) => ({ file, path: file.name })))
  }
  return (async () => {
    const out: AddedFile[] = []
    for (const { entry, file } of entries) {
      if (entry) await walkEntry(entry, out)
      else if (file) out.push({ file, path: file.name })
    }
    return out
  })()
}

/** フォルダを選ばせて中のファイルを全部受け取る。webkitdirectory は主要なブラウザで使える */
export function pickFolder(): Promise<AddedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.webkitdirectory = true
    input.addEventListener('change', () => {
      resolve(
        Array.from(input.files ?? []).map((file) => ({ file, path: file.webkitRelativePath || file.name }))
      )
    })
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

import { downloadBlob } from '../../core/save'
import type { RenderedFile } from '../../media/types'

export type SavedFiles = { kind: 'folder'; folder: string; count: number } | { kind: 'download'; count: number }

/**
 * 分割した結果のように複数のファイルを保存する。
 * フォルダを選べるブラウザではそこへ書き、選べなければ 1 つずつダウンロードする。
 * フォルダの選択を中止したら AbortError のまま投げる（呼び出し側で黙って終える）。
 *
 * 共通の保存（src/core/save.ts）は 1 ファイルだけを扱うので、ここに置いている。
 */
export async function saveFiles(files: readonly RenderedFile[]): Promise<SavedFiles> {
  if (window.showDirectoryPicker) {
    const directory = await window.showDirectoryPicker({ mode: 'readwrite' })
    for (const { blob, filename } of files) {
      const name = await freeName(directory, filename)
      const handle = await directory.getFileHandle(name, { create: true })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
    }
    return { kind: 'folder', folder: directory.name, count: files.length }
  }
  for (const [index, { blob, filename }] of files.entries()) {
    // 続けざまに始めると、ブラウザが 2 つ目以降のダウンロードを落とすことがある
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 250))
    downloadBlob(blob, filename)
  }
  return { kind: 'download', count: files.length }
}

/** すでにあるファイルを黙って上書きしないよう、空いている名前（name-2.pdf …）を探す */
async function freeName(directory: FileSystemDirectoryHandle, filename: string): Promise<string> {
  const dot = filename.lastIndexOf('.')
  const stem = dot > 0 ? filename.slice(0, dot) : filename
  const extension = dot > 0 ? filename.slice(dot) : ''
  for (let attempt = 1; ; attempt++) {
    const candidate = attempt === 1 ? filename : `${stem}-${attempt}${extension}`
    try {
      await directory.getFileHandle(candidate)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return candidate
      throw error
    }
  }
}

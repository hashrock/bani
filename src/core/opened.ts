/**
 * 開いたファイル。ドロップやファイル選択でハンドルを受け取れたときは一緒に持ち、
 * 上書き保存に使う（Firefox・Safari や貼り付けではハンドルがない）。
 */
export interface OpenedFile {
  file: File
  handle: FileSystemFileHandle | null
  /**
   * フォルダごと受け取ったときの、落としたフォルダからの相対パス（`photos/2024/a.jpg`）。
   * 1 つずつ受け取ったファイルにはない
   */
  path?: string
}

export const openedFromFile = (file: File): OpenedFile => ({ file, handle: null })

/** <input type="file"> の accept と同じ書き方（`video/*,.srt` など） */
export type AcceptSpec = string

/**
 * ファイルを選ばせる。使えるなら showOpenFilePicker でハンドルごと受け取り、
 * 使えなければ見えない <input type="file"> に頼る。キャンセルされたら空配列。
 * directory なら、フォルダを選ばせて中のファイルを（相対パス付きで）全部受け取る。
 */
export async function pickFiles(options: {
  multiple?: boolean
  accept?: AcceptSpec
  directory?: boolean
}): Promise<OpenedFile[]> {
  const { multiple = false, accept, directory = false } = options
  // フォルダの中身はハンドルを使わない（上書き保存の先にはしない）ので、どのブラウザでも <input> で選ぶ
  if (directory) return pickWithInput(true, undefined, true)
  if (window.showOpenFilePicker) {
    try {
      const handles = await window.showOpenFilePicker({
        multiple,
        types: accept ? toPickerTypes(accept) : undefined,
      })
      return Promise.all(handles.map(async (handle) => ({ file: await handle.getFile(), handle })))
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return []
      // 種類の指定が受け付けられないなどの失敗は、昔ながらの方法でやり直す
      console.warn('showOpenFilePicker failed, falling back to <input>:', err)
    }
  }
  return pickWithInput(multiple, accept)
}

function pickWithInput(multiple: boolean, accept?: AcceptSpec, directory = false): Promise<OpenedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    input.webkitdirectory = directory
    if (accept) input.accept = accept
    input.addEventListener('change', () => {
      resolve(
        Array.from(input.files ?? []).map((file) =>
          directory && file.webkitRelativePath
            ? { file, handle: null, path: file.webkitRelativePath }
            : openedFromFile(file)
        )
      )
    })
    input.addEventListener('cancel', () => resolve([]))
    input.click()
  })
}

/**
 * accept の書き方を showOpenFilePicker の types に直す。
 * MIME の指定（`video/*`）と拡張子（`.srt`）が混ざっていてもよい
 */
export function toPickerTypes(accept: AcceptSpec): FilePickerAcceptType[] | undefined {
  const parts = accept
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  const mimes = parts.filter((part) => part.includes('/'))
  const extensions = parts.filter((part) => part.startsWith('.'))
  if (mimes.length === 0 && extensions.length === 0) return undefined

  const record: Record<string, string[]> = {}
  for (const mime of mimes) record[mime] = []
  // 拡張子だけの指定は、どの MIME にも当てはまる扱いで足す
  if (extensions.length > 0) {
    const key = mimes[0] ?? 'application/octet-stream'
    record[key] = [...(record[key] ?? []), ...extensions]
  }
  return [{ accept: record }]
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

/** フォルダの中をたどってファイルを集める。path は落としたものからの相対パス */
async function walkEntry(entry: FileSystemEntry, out: OpenedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
    out.push({ file, handle: null, path: entry.fullPath.replace(/^\/+/, '') })
    return
  }
  if (entry.isDirectory) {
    const children = await readAllEntries((entry as FileSystemDirectoryEntry).createReader())
    for (const child of children) await walkEntry(child, out)
  }
}

/**
 * ドロップされたものを、ハンドルも含めて取り出す。フォルダは中までたどり、相対パスを付ける。
 * getAsFileSystemHandle・webkitGetAsEntry はイベントの中で同期的に呼ばないと使えなくなるので、
 * 先に Promise と入口を集めてから待つ。
 */
export function collectDropped(dataTransfer: DataTransfer): Promise<OpenedFile[]> {
  const items = Array.from(dataTransfer.items).filter((item) => item.kind === 'file')
  if (items.length === 0) {
    return Promise.resolve(Array.from(dataTransfer.files).map(openedFromFile))
  }
  const entries = items.map((item) => ({
    file: item.getAsFile(),
    entry: item.webkitGetAsEntry?.() ?? null,
    handle: item.getAsFileSystemHandle?.().catch(() => null) ?? Promise.resolve(null),
  }))
  return (async () => {
    const out: OpenedFile[] = []
    for (const { file, entry, handle } of entries) {
      const resolved = await handle
      if (entry?.isDirectory || resolved?.kind === 'directory') {
        if (entry) await walkEntry(entry, out)
        continue
      }
      if (!file) continue
      out.push({ file, handle: resolved?.kind === 'file' ? (resolved as FileSystemFileHandle) : null })
    }
    return out
  })()
}

/** 貼り付けられたものをファイルにする。ファイルがなければテキストを .txt として扱う */
export function collectPasted(clipboard: DataTransfer): OpenedFile[] {
  const files = Array.from(clipboard.files)
  if (files.length > 0) {
    return files.map((file) =>
      openedFromFile(
        // スクリーンショットなどは名前が image.png 固定なので、取り違えないよう付け直す
        file.name === 'image.png'
          ? new File([file], `clipboard-${timestamp()}.png`, { type: file.type })
          : file
      )
    )
  }
  const text = clipboard.getData('text/plain')
  if (text === '') return []
  return [
    openedFromFile(new File([text], `clipboard-${timestamp()}.txt`, { type: 'text/plain' })),
  ]
}

function timestamp(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

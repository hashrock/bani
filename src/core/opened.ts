/**
 * 開いたファイル。ドロップやファイル選択でハンドルを受け取れたときは一緒に持ち、
 * 上書き保存に使う（Firefox・Safari や貼り付けではハンドルがない）。
 */
export interface OpenedFile {
  file: File
  handle: FileSystemFileHandle | null
}

export const openedFromFile = (file: File): OpenedFile => ({ file, handle: null })

/** <input type="file"> の accept と同じ書き方（`video/*,.srt` など） */
export type AcceptSpec = string

/**
 * ファイルを選ばせる。使えるなら showOpenFilePicker でハンドルごと受け取り、
 * 使えなければ見えない <input type="file"> に頼る。キャンセルされたら空配列。
 */
export async function pickFiles(options: {
  multiple?: boolean
  accept?: AcceptSpec
}): Promise<OpenedFile[]> {
  const { multiple = false, accept } = options
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

function pickWithInput(multiple: boolean, accept?: AcceptSpec): Promise<OpenedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    if (accept) input.accept = accept
    input.addEventListener('change', () => {
      resolve(Array.from(input.files ?? []).map(openedFromFile))
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

/**
 * ドロップされたものを、ハンドルも含めて取り出す。
 * getAsFileSystemHandle はイベントの中で同期的に呼ばないと使えなくなるので、
 * 先に Promise を集めてから待つ。フォルダは（まだ）扱わないので外す。
 */
export function collectDropped(dataTransfer: DataTransfer): Promise<OpenedFile[]> {
  const items = Array.from(dataTransfer.items).filter((item) => item.kind === 'file')
  if (items.length === 0) {
    return Promise.resolve(Array.from(dataTransfer.files).map(openedFromFile))
  }
  const entries = items.map((item) => ({
    file: item.getAsFile(),
    handle: item.getAsFileSystemHandle?.().catch(() => null) ?? Promise.resolve(null),
  }))
  return Promise.all(
    entries.map(async ({ file, handle }) => {
      const resolved = await handle
      if (resolved?.kind === 'directory') return null
      if (!file) return null
      return {
        file,
        handle: resolved?.kind === 'file' ? (resolved as FileSystemFileHandle) : null,
      }
    })
  ).then((opened) => opened.filter((item): item is OpenedFile => item !== null))
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

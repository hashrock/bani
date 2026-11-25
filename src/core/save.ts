import { basename, numberedName, pathKey } from '../media/archive/names'
import type { RenderedFile } from '../media/types'
import { isAbortError } from '../utils/abort'

/**
 * 保存の方針（ROADMAP.md「共通の操作モデル」の「保存」）。
 *
 * 保存ボタンは 1 つで、右のドロップダウンにほかの方法を出す。
 * - 保存し直しても劣化しない（テキスト・可逆な形式で、形式も変えない）なら上書き保存が主
 * - それ以外（非可逆・形式を変える変換）は別名で保存が主で、上書きはドロップダウンに置く
 * 上書きは開いたときにハンドルを受け取れたときだけ出す。
 */
export type SaveMethod = 'overwrite' | 'saveAs' | 'copyToClipboard'

export interface SavePolicyInput {
  /** 書き出す形式が可逆か（テキスト・PNG・WAV・FLAC・ZIP・PDF のページ編集など） */
  lossless: boolean
  /** 元と同じ形式で書き出すか */
  sameFormat: boolean
  /** 上書きに使えるハンドルがあるか */
  canOverwrite: boolean
  /** 結果をクリップボードに入れられるか（画像・テキスト） */
  canCopy: boolean
}

export interface SavePlan {
  primary: SaveMethod
  /** ドロップダウンに並べる残りの方法（表示順） */
  others: SaveMethod[]
}

export function planSave(input: SavePolicyInput): SavePlan {
  const overwriteFirst = input.canOverwrite && input.lossless && input.sameFormat
  const methods: SaveMethod[] = overwriteFirst ? ['overwrite', 'saveAs'] : ['saveAs']
  if (!overwriteFirst && input.canOverwrite) methods.push('overwrite')
  if (input.canCopy) methods.push('copyToClipboard')
  const [primary, ...others] = methods
  return { primary, others }
}

/** 上書きしてよいかをブラウザに確かめてから書き込む */
export async function overwriteFile(handle: FileSystemFileHandle, blob: Blob): Promise<void> {
  if (handle.requestPermission) {
    const permission = await handle.requestPermission({ mode: 'readwrite' })
    if (permission !== 'granted') {
      throw new DOMException('Write permission was not granted', 'NotAllowedError')
    }
  }
  const writable = await handle.createWritable()
  await writable.write(blob)
  await writable.close()
}

/**
 * 別名で保存する。保存先を選べるブラウザではハンドルを返し、以後の上書きに使える。
 * 選べなければダウンロードにして null を返す。キャンセルは AbortError のまま投げる。
 */
export async function saveFileAs(
  blob: Blob,
  suggestedName: string
): Promise<FileSystemFileHandle | null> {
  if (window.showSaveFilePicker) {
    let handle: FileSystemFileHandle
    try {
      handle = await window.showSaveFilePicker({ suggestedName })
    } catch (err) {
      if (isAbortError(err)) throw err
      // 拡張子などが原因で開けないときはダウンロードで済ませる
      console.warn('showSaveFilePicker failed, falling back to download:', err)
      downloadBlob(blob, suggestedName)
      return null
    }
    await overwriteFile(handle, blob)
    return handle
  }
  downloadBlob(blob, suggestedName)
  return null
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // クリック直後に破棄すると一部のブラウザでダウンロードが始まらない
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** クリップボードに入れられる中身か。画像は PNG に限る（ブラウザが受け付ける画像形式が PNG だけのため） */
export function canCopyBlob(type: string): boolean {
  return type === 'image/png' || type.startsWith('text/') || type === 'application/json'
}

/**
 * クリップボードに入れるもの。テキストは文字列のまま渡す
 * （Shift_JIS などで書き出した Blob を UTF-8 として読み直すと化けるため）
 */
export type ClipboardPayload = { text: string } | { blob: Blob }

export async function copyToClipboard(payload: ClipboardPayload): Promise<void> {
  if ('text' in payload) {
    await navigator.clipboard.writeText(payload.text)
    return
  }
  const { blob } = payload
  if (blob.type === 'image/png') {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return
  }
  await navigator.clipboard.writeText(await blob.text())
}

export const copyBlobToClipboard = (blob: Blob) => copyToClipboard({ blob })

/*
 * 複数のファイルの保存（一括変換の結果、PDF の分割、圧縮ファイルの展開）。
 * フォルダを選べるブラウザではフォルダが主で、ほかに 1 つの ZIP にまとめる・1 つずつダウンロードを選べる。
 */
export type SaveManyMethod = 'folder' | 'zip' | 'each'

export interface SaveManyPlan {
  primary: SaveManyMethod
  others: SaveManyMethod[]
}

/** 複数のファイルの保存方法。1 つだけなら ZIP にはまとめない */
export function planSaveMany(input: { canPickFolder: boolean; count: number }): SaveManyPlan {
  const methods: SaveManyMethod[] = []
  if (input.canPickFolder) methods.push('folder')
  if (input.count !== 1) methods.push('zip')
  methods.push('each')
  const [primary, ...others] = methods
  return { primary, others }
}

export const canPickFolder = (): boolean =>
  typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'

/** 保存先のフォルダを選ばせ、書き込み権限まで確保して返す。中止は AbortError のまま投げる */
export async function pickSaveFolder(): Promise<FileSystemDirectoryHandle> {
  if (!window.showDirectoryPicker) {
    throw new Error('This browser cannot choose a folder. Save as a ZIP instead.')
  }
  const directory = await window.showDirectoryPicker({ mode: 'readwrite' })
  // requestPermission を持たないブラウザもあるため、あるときだけ事前に確認する
  if (directory.requestPermission) {
    const permission = await directory.requestPermission({ mode: 'readwrite' })
    if (permission !== 'granted') {
      throw new DOMException('Write permission was not granted', 'NotAllowedError')
    }
  }
  return directory
}

async function entryExists(directory: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  for (const get of [
    () => directory.getFileHandle(name),
    () => directory.getDirectoryHandle(name),
  ]) {
    try {
      await get()
      return true
    } catch (error) {
      // 同名の別の種類（ファイルとフォルダ）は TypeMismatchError になる。どちらにせよ使えない名前
      if (error instanceof DOMException && error.name === 'TypeMismatchError') return true
    }
  }
  return false
}

export interface FolderWriter {
  /** 1 つ書く。filename に / があれば下のフォルダも作る。書いた先の、いちばん上の段の名前を返す */
  write(file: RenderedFile): Promise<string>
}

/**
 * フォルダへ書き込む口。すでにあるものを黙って上書きしないよう、いちばん上の段（ファイルかフォルダ）
 * だけ空いている名前（「名前 (2).拡張子」）にずらす。同じ書き込みの中で作ったフォルダには続けて書く。
 * 変換しながら 1 件ずつ書けるよう、まとめてではなく 1 つずつ受け取る。
 */
export function createFolderWriter(directory: FileSystemDirectoryHandle): FolderWriter {
  // いちばん上の段の名前 → 実際に使った名前（このあいだに作ったものは同じところへ書く）
  const tops = new Map<string, string>()
  const folders = new Map<string, FileSystemDirectoryHandle>([['', directory]])

  const claimTop = async (name: string, isFolder: boolean): Promise<string> => {
    const key = `${isFolder ? 'd' : 'f'}:${pathKey(name)}`
    const claimed = tops.get(key)
    if (claimed !== undefined && isFolder) return claimed
    let candidate = name
    for (let n = 2; ; n++) {
      const used = [...tops.values()].some((value) => pathKey(value) === pathKey(candidate))
      if (!used && !(await entryExists(directory, candidate))) break
      candidate = numberedName(name, n, isFolder)
    }
    tops.set(key, candidate)
    return candidate
  }

  const folderFor = async (path: string): Promise<FileSystemDirectoryHandle> => {
    const cached = folders.get(path)
    if (cached) return cached
    const slash = path.lastIndexOf('/')
    const parent = await folderFor(slash < 0 ? '' : path.slice(0, slash))
    const handle = await parent.getDirectoryHandle(path.slice(slash + 1), { create: true })
    folders.set(path, handle)
    return handle
  }

  return {
    async write({ blob, filename }) {
      const segments = filename.split('/').filter((segment) => segment !== '')
      const top = await claimTop(segments[0], segments.length > 1)
      const path = [top, ...segments.slice(1)]
      const folder = await folderFor(path.slice(0, -1).join('/'))
      const handle = await folder.getFileHandle(path[path.length - 1], { create: true })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return top
    },
  }
}

/**
 * 1 つずつダウンロードするときの名前。ダウンロードではフォルダを作れないので名前だけにし、
 * 重なったものには番号を振る（ブラウザに任せると黙って上書きや改名をされる）。
 */
export function downloadNames(paths: readonly string[]): string[] {
  const used = new Set<string>()
  return paths.map((path) => {
    const name = basename(path)
    let candidate = name
    for (let n = 2; used.has(pathKey(candidate)); n++) candidate = numberedName(name, n)
    used.add(pathKey(candidate))
    return candidate
  })
}

/** 続けざまのダウンロードはブラウザに間引かれることがあるので、少し間を空けて 1 つずつ落とす */
export async function downloadFiles(files: readonly RenderedFile[]): Promise<void> {
  const names = downloadNames(files.map((file) => file.filename))
  for (const [index, file] of files.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, 250))
    downloadBlob(file.blob, names[index])
  }
}

/** 1 つの ZIP にまとめる。ZIP の作り方（fflate）は使うときだけ読み込む */
export async function zipFiles(files: readonly RenderedFile[], name: string): Promise<RenderedFile> {
  const { zipRenderedFiles } = await import('../media/archive')
  return zipRenderedFiles(files, name)
}

export interface SavedFiles {
  method: SaveManyMethod
  count: number
  /** 保存した先の名前（フォルダ名・ZIP のファイル名）。1 つずつダウンロードしたときは null */
  target: string | null
  /** 保存先を選べず、ダウンロードになった */
  downloaded: boolean
}

/**
 * 複数のファイルを、えらんだ方法で保存する。
 * フォルダ・ZIP の保存先を選ぶ画面を中止したら AbortError のまま投げる（呼び出し側で黙って終える）。
 * folder を渡せば、選び直さずにそこへ書く（重い処理の前に先に選ばせたいとき）。
 */
export async function saveFiles(
  files: readonly RenderedFile[],
  method: SaveManyMethod,
  options: { zipName: string; folder?: FileSystemDirectoryHandle }
): Promise<SavedFiles> {
  const count = files.length
  switch (method) {
    case 'folder': {
      const directory = options.folder ?? (await pickSaveFolder())
      const writer = createFolderWriter(directory)
      for (const file of files) await writer.write(file)
      return { method, count, target: directory.name, downloaded: false }
    }
    case 'zip': {
      const zip = await zipFiles(files, options.zipName)
      const handle = await saveFileAs(zip.blob, zip.filename)
      return { method, count, target: handle?.name ?? zip.filename, downloaded: !handle }
    }
    case 'each':
      await downloadFiles(files)
      return { method, count, target: null, downloaded: true }
  }
}

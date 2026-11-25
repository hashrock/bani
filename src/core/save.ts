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

export async function copyBlobToClipboard(blob: Blob): Promise<void> {
  if (blob.type === 'image/png') {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return
  }
  await navigator.clipboard.writeText(await blob.text())
}

export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

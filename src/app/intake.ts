import type { MediaKind, Route } from './routes'

/** ファイルの拡張子から種類を引く表。MIME が空のとき（OS や取り込み元による）に使う */
const EXTENSIONS: Record<string, MediaKind> = {
  mp4: 'video',
  m4v: 'video',
  mov: 'video',
  webm: 'video',
  mkv: 'video',
  avi: 'video',
  ts: 'video',
  mp3: 'audio',
  m4a: 'audio',
  aac: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio',
  opus: 'audio',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  avif: 'image',
  heic: 'image',
  bmp: 'image',
  svg: 'image',
  pdf: 'pdf',
  txt: 'text',
  md: 'text',
  csv: 'text',
  tsv: 'text',
  json: 'text',
  srt: 'text',
  vtt: 'text',
}

/** MIME → 拡張子 の順に種類を判定する。わからなければ null */
export function detectKind(file: { name: string; type: string }): MediaKind | null {
  const mime = file.type.toLowerCase()
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime.startsWith('image/')) return 'image'
  if (mime === 'application/pdf') return 'pdf'
  if (mime.startsWith('text/')) return 'text'

  const dot = file.name.lastIndexOf('.')
  if (dot < 0) return null
  return EXTENSIONS[file.name.slice(dot + 1).toLowerCase()] ?? null
}

/** いま実装済みの画面が受け付ける種類 */
export interface Capabilities {
  edit: readonly MediaKind[]
  convert: readonly MediaKind[]
}

export interface Intake {
  route: Route
  /** 移動先の画面へ渡すファイルの位置（入力順） */
  accepted: number[]
  /** 受け付けなかったファイルの位置 */
  rejected: number[]
}

/**
 * ドロップされたファイルの種類から、開く画面と渡すファイルを決める。
 * 1 ファイルで編集できる種類なら単体編集、それ以外は変換できるものだけを一括変換へ回す。
 * どれも扱えなければ null。
 */
export function planIntake(
  kinds: readonly (MediaKind | null)[],
  capabilities: Capabilities
): Intake | null {
  if (kinds.length === 1) {
    const kind = kinds[0]
    if (kind && capabilities.edit.includes(kind)) {
      return { route: { name: 'edit', kind }, accepted: [0], rejected: [] }
    }
  }

  const accepted: number[] = []
  const rejected: number[] = []
  kinds.forEach((kind, index) => {
    if (kind && capabilities.convert.includes(kind)) accepted.push(index)
    else rejected.push(index)
  })
  if (accepted.length === 0) return null
  return { route: { name: 'convert' }, accepted, rejected }
}

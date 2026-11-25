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
  // テキスト・コード（エディタとして開く）
  txt: 'text',
  md: 'text',
  markdown: 'text',
  csv: 'text',
  tsv: 'text',
  json: 'text',
  jsonc: 'text',
  srt: 'text',
  vtt: 'text',
  html: 'text',
  htm: 'text',
  css: 'text',
  scss: 'text',
  js: 'text',
  mjs: 'text',
  cjs: 'text',
  jsx: 'text',
  tsx: 'text',
  xml: 'text',
  yaml: 'text',
  yml: 'text',
  toml: 'text',
  ini: 'text',
  log: 'text',
  sh: 'text',
  py: 'text',
  rb: 'text',
  go: 'text',
  rs: 'text',
  java: 'text',
  c: 'text',
  h: 'text',
  cpp: 'text',
  sql: 'text',
  // 圧縮ファイル
  zip: 'archive',
  gz: 'archive',
  tgz: 'archive',
  tar: 'archive',
  '7z': 'archive',
  rar: 'archive',
}

/** text/ 以外でテキストとして扱う MIME（JSON や JS は application/ で来る） */
const TEXT_MIMES = new Set([
  'application/json',
  'application/javascript',
  'application/x-javascript',
  'application/xml',
  'application/x-yaml',
  'application/yaml',
  'application/toml',
  'application/x-sh',
  'application/sql',
  'image/svg+xml',
])

const ARCHIVE_MIMES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-gzip',
  'application/x-tar',
  'application/x-7z-compressed',
  'application/vnd.rar',
  'application/x-rar-compressed',
])

/** MIME → 拡張子 の順に種類を判定する。わからなければ null */
export function detectKind(file: { name: string; type: string }): MediaKind | null {
  const mime = file.type.toLowerCase()
  // SVG は画像だがテキストとして編集するほうが役に立つ。拡張子 ts は動画（MPEG-TS）と取り合うので MIME を優先する
  if (TEXT_MIMES.has(mime)) return 'text'
  if (ARCHIVE_MIMES.has(mime)) return 'archive'
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

/** 拡張子 .ts / .mts は TypeScript と MPEG-TS（動画）で取り合う */
const AMBIGUOUS_TS = /\.(ts|mts|cts)$/i
/** MPEG-TS のパケットは必ずこの同期バイトで始まる */
const MPEG_TS_SYNC = 0x47

/** 先頭バイトから .ts の正体を決める。それ以外のファイルは detectKind のまま */
export function refineKind(kind: MediaKind | null, name: string, head: Uint8Array): MediaKind | null {
  if (!AMBIGUOUS_TS.test(name)) return kind
  return head[0] === MPEG_TS_SYNC ? 'video' : 'text'
}

/** detectKind に、読まないと決められないもの（.ts）の判定を足す */
export async function detectKindAsync(file: File): Promise<MediaKind | null> {
  const kind = detectKind(file)
  if (!AMBIGUOUS_TS.test(file.name)) return kind
  const head = new Uint8Array(await file.slice(0, 1).arrayBuffer())
  return refineKind(kind, file.name, head)
}

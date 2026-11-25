/**
 * 拡張子から MIME タイプを推す。中のファイルを Bani の各画面で開くとき、
 * 画面の振り分けとブラウザでの再生・表示が type に頼るので、主なものだけ持つ。
 */
const MIME_BY_EXTENSION: Record<string, string> = {
  // 画像
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  heic: 'image/heic',
  heif: 'image/heif',
  // 動画
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  // 音声
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  flac: 'audio/flac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  // 文書・テキスト
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  srt: 'application/x-subrip',
  vtt: 'text/vtt',
  // 圧縮ファイル（中に入れ子になっていることがある）
  zip: 'application/zip',
  gz: 'application/gzip',
  tgz: 'application/gzip',
  tar: 'application/x-tar',
  '7z': 'application/x-7z-compressed',
  rar: 'application/vnd.rar',
}

function extensionOf(path: string): string | null {
  const dot = path.lastIndexOf('.')
  if (dot < 0 || dot < path.lastIndexOf('/')) return null
  return path.slice(dot + 1).toLowerCase()
}

export function guessMimeType(path: string): string {
  const extension = extensionOf(path)
  return (extension && MIME_BY_EXTENSION[extension]) || 'application/octet-stream'
}

/** すでに縮められている形式。deflate をかけてもほぼ縮まず時間だけかかるので、作成時は無圧縮で入れる */
const ALREADY_COMPRESSED = new Set([
  ...['jpg', 'jpeg', 'jfif', 'png', 'gif', 'webp', 'avif', 'heic', 'heif'],
  ...['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi'],
  ...['mp3', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac'],
  ...['zip', 'gz', 'tgz', 'bz2', 'xz', 'zst', '7z', 'rar'],
  ...['docx', 'xlsx', 'pptx', 'odt', 'ods', 'odp', 'epub', 'woff', 'woff2'],
])

export function isAlreadyCompressed(path: string): boolean {
  const extension = extensionOf(path)
  return extension !== null && ALREADY_COMPRESSED.has(extension)
}

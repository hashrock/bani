/**
 * ファイルの種類からエディタの言語を決める。読み込み（languageLoader.ts）と分けておき、
 * ここは CodeMirror を読まない純粋な判定だけにする（テストで重い依存を引かないため）
 */

export type LanguageId =
  | 'plain'
  | 'json'
  | 'html'
  | 'css'
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  | 'markdown'
  | 'xml'
  | 'yaml'
  | 'python'
  | 'sql'

/** 言語の選択肢に並べる順 */
export const LANGUAGES: readonly LanguageId[] = [
  'plain',
  'json',
  'html',
  'css',
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'markdown',
  'xml',
  'yaml',
  'python',
  'sql',
]

/** 表示名。形式の名前なので訳さない（plain だけは画面の文言で出す） */
export const LANGUAGE_LABELS: Record<LanguageId, string> = {
  plain: 'Plain text',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  markdown: 'Markdown',
  xml: 'XML',
  yaml: 'YAML',
  python: 'Python',
  sql: 'SQL',
}

/** 新規の文書を保存するときの拡張子 */
export const LANGUAGE_EXTENSIONS: Record<LanguageId, string> = {
  plain: 'txt',
  json: 'json',
  html: 'html',
  css: 'css',
  javascript: 'js',
  typescript: 'ts',
  jsx: 'jsx',
  tsx: 'tsx',
  markdown: 'md',
  xml: 'xml',
  yaml: 'yaml',
  python: 'py',
  sql: 'sql',
}

const BY_EXTENSION: Record<string, LanguageId> = {
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  geojson: 'json',
  webmanifest: 'json',
  map: 'json',
  html: 'html',
  htm: 'html',
  xhtml: 'html',
  vue: 'html',
  svelte: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  md: 'markdown',
  markdown: 'markdown',
  mdx: 'markdown',
  xml: 'xml',
  svg: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  plist: 'xml',
  rss: 'xml',
  atom: 'xml',
  kml: 'xml',
  gpx: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  py: 'python',
  pyw: 'python',
  pyi: 'python',
  sql: 'sql',
}

/** 拡張子でわからないとき（貼り付けや拡張子なし）に MIME で引く */
const BY_MIME: Record<string, LanguageId> = {
  'application/json': 'json',
  'application/ld+json': 'json',
  'application/manifest+json': 'json',
  'text/html': 'html',
  'application/xhtml+xml': 'html',
  'text/css': 'css',
  'text/javascript': 'javascript',
  'application/javascript': 'javascript',
  'application/x-javascript': 'javascript',
  'text/typescript': 'typescript',
  'application/typescript': 'typescript',
  'text/markdown': 'markdown',
  'text/x-markdown': 'markdown',
  'application/xml': 'xml',
  'text/xml': 'xml',
  'image/svg+xml': 'xml',
  'application/x-yaml': 'yaml',
  'application/yaml': 'yaml',
  'text/yaml': 'yaml',
  'text/x-python': 'python',
  'application/x-python': 'python',
  'application/sql': 'sql',
  'text/x-sql': 'sql',
}

const baseMime = (type: string) => type.split(';')[0].trim().toLowerCase()

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  // 先頭のドットは隠しファイルの印で、拡張子ではない（.gitignore など）
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/**
 * 拡張子 → MIME の順に言語を決める。拡張子を先に見るのは、OS が .ts を video/mp2t、
 * .md を空の MIME にするなど、MIME のほうが当てにならないため
 */
export function detectLanguage(file: { name: string; type: string }): LanguageId {
  const byExtension = BY_EXTENSION[extensionOf(file.name)]
  if (byExtension) return byExtension
  return BY_MIME[baseMime(file.type)] ?? 'plain'
}

export type SubtitleKind = 'srt' | 'vtt'

/** 字幕なら形式を返す。字幕の道具（ずらし・形式変換）を出すかどうかに使う */
export function detectSubtitle(file: { name: string; type: string }): SubtitleKind | null {
  const extension = extensionOf(file.name)
  if (extension === 'srt') return 'srt'
  if (extension === 'vtt') return 'vtt'
  const mime = baseMime(file.type)
  if (mime === 'text/vtt') return 'vtt'
  if (mime === 'application/x-subrip' || mime === 'text/srt') return 'srt'
  return null
}

/** 拡張子を付け替える。拡張子がなければ足す */
export function withExtension(name: string, extension: string): string {
  const dot = name.lastIndexOf('.')
  const base = dot <= 0 ? name : name.slice(0, dot)
  return `${base}.${extension}`
}

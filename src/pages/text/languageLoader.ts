import type { Extension } from '@codemirror/state'
import type { LanguageId } from './language'

/**
 * 言語ごとの CodeMirror の拡張。開いたファイルに必要なときだけ読む（それぞれ別の chunk になる）。
 * 一度読んだものは覚えておき、言語を切り替え直しても読み直さない
 */
const LOADERS: Record<Exclude<LanguageId, 'plain'>, () => Promise<Extension>> = {
  json: () => import('@codemirror/lang-json').then((m) => m.json()),
  html: () => import('@codemirror/lang-html').then((m) => m.html()),
  css: () => import('@codemirror/lang-css').then((m) => m.css()),
  javascript: () => import('@codemirror/lang-javascript').then((m) => m.javascript()),
  typescript: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true })),
  jsx: () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true })),
  tsx: () =>
    import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true, typescript: true })),
  markdown: () => import('@codemirror/lang-markdown').then((m) => m.markdown()),
  xml: () => import('@codemirror/lang-xml').then((m) => m.xml()),
  yaml: () => import('@codemirror/lang-yaml').then((m) => m.yaml()),
  python: () => import('@codemirror/lang-python').then((m) => m.python()),
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
}

const cache = new Map<LanguageId, Promise<Extension>>()

export function loadLanguage(id: LanguageId): Promise<Extension> {
  if (id === 'plain') return Promise.resolve([])
  let pending = cache.get(id)
  if (!pending) {
    // 失敗（オフラインで chunk を取れないなど）は覚えずに、次の機会に読み直す
    pending = LOADERS[id]().catch((error: unknown) => {
      cache.delete(id)
      throw error
    })
    cache.set(id, pending)
  }
  return pending
}

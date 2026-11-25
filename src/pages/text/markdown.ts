/**
 * Markdown の下見用の小さな解析器。CommonMark を完全には追わず、よく使う書き方
 * （見出し・段落・リスト・引用・コード・区切り線・表・強調・リンク）だけを木にする。
 * HTML 文字列を作らずに木を返し、React に描かせることで、本文中の HTML やスクリプトが
 * そのまま動く余地をなくす。画像も読み込まない（オフライン・外部への通信をしないため）
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'del'; children: Inline[] }
  | { type: 'link'; href: string | null; children: Inline[] }
  | { type: 'image'; alt: string; src: string }
  | { type: 'break' }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'code'; lang: string; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'hr' }
  | { type: 'table'; align: TableAlign[]; head: Inline[][]; rows: Inline[][][] }

export interface ListItem {
  /** `- [ ]` / `- [x]` のときだけ持つ */
  checked: boolean | null
  children: Block[]
}

export type TableAlign = 'left' | 'center' | 'right' | null

/** リンク先として通すもの。javascript: などは無効なリンクにする */
export function safeHref(href: string): string | null {
  const trimmed = href.trim()
  if (/^(https?:|mailto:|#)/i.test(trimmed)) return trimmed
  // スキームを持たない相対パスは通す（コロンが / や ? より前にあればスキームとみなす）
  return /^[^/?#]*:/.test(trimmed) ? null : trimmed
}

// ---- インライン ----

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~<>]/

/** 区切り記号（* _ ~）で囲まれた範囲を探す。中身が空白で始まる・終わるものは強調にしない */
function findClosing(text: string, from: number, marker: string): number {
  let i = from
  while (i < text.length) {
    const found = text.indexOf(marker, i)
    if (found < 0) return -1
    if (found > from && text[found - 1] !== ' ' && text[found - 1] !== '\\') return found
    i = found + 1
  }
  return -1
}

/** `[text](href)` の閉じ括弧を、入れ子の括弧を数えながら探す */
function matchBracket(text: string, from: number, open: string, close: string): number {
  let depth = 0
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === open) depth++
    else if (c === close && --depth === 0) return i
  }
  return -1
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let buffer = ''
  const flush = () => {
    if (buffer !== '') out.push({ type: 'text', text: buffer })
    buffer = ''
  }

  let i = 0
  while (i < text.length) {
    const c = text[i]
    const rest = text.slice(i)

    if (c === '\\' && i + 1 < text.length) {
      if (text[i + 1] === '\n') {
        flush()
        out.push({ type: 'break' })
        i += 2
        continue
      }
      if (ESCAPABLE.test(text[i + 1])) {
        buffer += text[i + 1]
        i += 2
        continue
      }
    }

    if (c === '\n') {
      // 行末に空白 2 つは改行、それ以外は空白 1 つ
      if (buffer.endsWith('  ')) {
        buffer = buffer.replace(/ +$/, '')
        flush()
        out.push({ type: 'break' })
      } else buffer = buffer.replace(/ +$/, '') + ' '
      i++
      continue
    }

    if (c === '`') {
      const ticks = /^`+/.exec(rest)![0]
      const end = text.indexOf(ticks, i + ticks.length)
      if (end > 0) {
        flush()
        const inner = text.slice(i + ticks.length, end)
        // 両端の空白 1 つは ` を含むコードを書くための余白なので落とす
        out.push({ type: 'code', text: /^ .* $/.test(inner) ? inner.slice(1, -1) : inner })
        i = end + ticks.length
        continue
      }
    }

    if (c === '!' && text[i + 1] === '[') {
      const close = matchBracket(text, i + 1, '[', ']')
      if (close > 0 && text[close + 1] === '(') {
        const end = matchBracket(text, close + 1, '(', ')')
        if (end > 0) {
          flush()
          out.push({ type: 'image', alt: text.slice(i + 2, close), src: text.slice(close + 2, end).trim() })
          i = end + 1
          continue
        }
      }
    }

    if (c === '[') {
      const close = matchBracket(text, i, '[', ']')
      if (close > 0 && text[close + 1] === '(') {
        const end = matchBracket(text, close + 1, '(', ')')
        if (end > 0) {
          flush()
          // リンク先の後ろの "title" は使わないので落とす
          const href = text.slice(close + 2, end).trim().replace(/\s+".*"$/, '')
          out.push({ type: 'link', href: safeHref(href), children: parseInline(text.slice(i + 1, close)) })
          i = end + 1
          continue
        }
      }
    }

    if (c === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/i.exec(rest)
      if (auto) {
        flush()
        out.push({ type: 'link', href: safeHref(auto[1]), children: [{ type: 'text', text: auto[1] }] })
        i += auto[0].length
        continue
      }
    }

    if (c === '~' && text[i + 1] === '~') {
      const end = findClosing(text, i + 2, '~~')
      if (end > i + 2) {
        flush()
        out.push({ type: 'del', children: parseInline(text.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }

    if (c === '*' || c === '_') {
      const double = text[i + 1] === c
      const marker = double ? c + c : c
      const start = i + marker.length
      // 単語の途中の _（snake_case）は強調にしない
      const intraword = c === '_' && /\w/.test(text[i - 1] ?? '')
      if (!intraword && text[start] !== undefined && text[start] !== ' ') {
        const end = findClosing(text, start, marker)
        if (end > start && !(c === '_' && /\w/.test(text[end + marker.length] ?? ''))) {
          flush()
          const children = parseInline(text.slice(start, end))
          out.push(double ? { type: 'strong', children } : { type: 'em', children })
          i = end + marker.length
          continue
        }
      }
    }

    buffer += c
    i++
  }
  flush()
  return out
}

// ---- ブロック ----

const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^`\s]*)/
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
const QUOTE = /^ {0,3}> ?/
const BULLET = /^( {0,3})([-*+])([ \t]+|$)/
const ORDERED = /^( {0,3})(\d{1,9})([.)])([ \t]+|$)/
const TABLE_DIVIDER = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/

const isBlank = (line: string) => line.trim() === ''

function splitRow(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1)
  const cells: string[] = []
  let cell = ''
  for (let i = 0; i < row.length; i++) {
    if (row[i] === '\\' && row[i + 1] === '|') {
      cell += '|'
      i++
    } else if (row[i] === '|') {
      cells.push(cell.trim())
      cell = ''
    } else cell += row[i]
  }
  cells.push(cell.trim())
  return cells
}

/** 段落を打ち切る行。段落の続きにせず、新しいブロックとして読む */
function interrupts(line: string): boolean {
  return HEADING.test(line) || FENCE.test(line) || HR.test(line) || QUOTE.test(line) || BULLET.test(line) ||
    /^ {0,3}1[.)]( |$)/.test(line)
}

function parseLines(lines: string[]): Block[] {
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (isBlank(line)) {
      i++
      continue
    }

    const fence = FENCE.exec(line)
    if (fence) {
      const marker = fence[1]
      const body: string[] = []
      i++
      while (i < lines.length && !new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`).test(lines[i])) {
        body.push(lines[i])
        i++
      }
      i++ // 閉じの行（なければ末尾まで）
      blocks.push({ type: 'code', lang: fence[2], text: body.join('\n') })
      continue
    }

    // 4 つ以上の字下げはコード
    if (/^( {4}|\t)/.test(line)) {
      const body: string[] = []
      while (i < lines.length && (/^( {4}|\t)/.test(lines[i]) || isBlank(lines[i]))) {
        body.push(lines[i].replace(/^( {4}|\t)/, ''))
        i++
      }
      while (body.length > 0 && isBlank(body[body.length - 1])) body.pop()
      blocks.push({ type: 'code', lang: '', text: body.join('\n') })
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3 | 4 | 5 | 6,
        children: parseInline(heading[2] ?? ''),
      })
      i++
      continue
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    if (QUOTE.test(line)) {
      const body: string[] = []
      while (i < lines.length && !isBlank(lines[i])) {
        // > のない続きの行も、段落の続きとして引用に含める
        if (!QUOTE.test(lines[i]) && interrupts(lines[i])) break
        body.push(lines[i].replace(QUOTE, ''))
        i++
      }
      blocks.push({ type: 'quote', children: parseLines(body) })
      continue
    }

    const bullet = BULLET.exec(line)
    const ordered = ORDERED.exec(line)
    if (bullet || ordered) {
      const consumed = parseList(lines, i, !!ordered)
      blocks.push(consumed.block)
      i = consumed.next
      continue
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_DIVIDER.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const head = splitRow(line)
      const align = splitRow(lines[i + 1]).map((cell): TableAlign => {
        const left = cell.startsWith(':')
        const right = cell.endsWith(':')
        return left && right ? 'center' : right ? 'right' : left ? 'left' : null
      })
      i += 2
      const rows: Inline[][][] = []
      while (i < lines.length && !isBlank(lines[i]) && lines[i].includes('|')) {
        const cells = splitRow(lines[i])
        rows.push(head.map((_, c) => parseInline(cells[c] ?? '')))
        i++
      }
      blocks.push({ type: 'table', align: head.map((_, c) => align[c] ?? null), head: head.map((h) => parseInline(h)), rows })
      continue
    }

    // 段落。下線（=== / ---）があれば見出し
    const body: string[] = [line]
    i++
    let setextLevel: 1 | 2 | null = null
    while (i < lines.length && !isBlank(lines[i])) {
      const setext = SETEXT.exec(lines[i])
      if (setext) {
        setextLevel = setext[1][0] === '=' ? 1 : 2
        i++
        break
      }
      if (interrupts(lines[i])) break
      body.push(lines[i])
      i++
    }
    const children = parseInline(body.map((l) => l.replace(/^ {0,3}/, '')).join('\n'))
    blocks.push(setextLevel ? { type: 'heading', level: setextLevel, children } : { type: 'paragraph', children })
  }
  return blocks
}

/** リストを読む。項目の続きは「記号の後ろの位置」まで字下げされた行として扱う */
function parseList(lines: string[], from: number, ordered: boolean): { block: Block; next: number } {
  const pattern = ordered ? ORDERED : BULLET
  const first = pattern.exec(lines[from])!
  const start = ordered ? Number(first[2]) : 1
  const items: ListItem[] = []
  let i = from

  while (i < lines.length) {
    const marker = pattern.exec(lines[i])
    if (!marker) break
    // 記号の種類が変わったら別のリスト
    if (!ordered && marker[2] !== first[2]) break
    if (ordered && marker[3] !== first[3]) break
    const contentIndent = marker[0].length
    const body: string[] = [lines[i].slice(marker[0].length)]
    i++
    while (i < lines.length) {
      const next = lines[i]
      if (isBlank(next)) {
        // 空行のあとも字下げが続くなら同じ項目
        if (i + 1 < lines.length && /^\s+/.test(lines[i + 1]) && leadingSpaces(lines[i + 1]) >= contentIndent) {
          body.push('')
          i++
          continue
        }
        break
      }
      if (leadingSpaces(next) >= Math.min(contentIndent, 4) && leadingSpaces(next) > 0) {
        body.push(next.slice(Math.min(leadingSpaces(next), contentIndent)))
        i++
        continue
      }
      if (pattern.test(next) || interrupts(next)) break
      // 字下げのない続きの行は、段落の続き
      body.push(next)
      i++
    }
    let checked: boolean | null = null
    const task = /^\[([ xX])\][ \t]+/.exec(body[0])
    if (task) {
      checked = task[1] !== ' '
      body[0] = body[0].slice(task[0].length)
    }
    items.push({ checked, children: parseLines(body) })
    // 項目の間の空行を 1 つまで許す
    if (i < lines.length && isBlank(lines[i]) && i + 1 < lines.length && pattern.test(lines[i + 1])) i++
  }
  return { block: { type: 'list', ordered, start, items }, next: i }
}

function leadingSpaces(line: string): number {
  let n = 0
  for (const c of line) {
    if (c === ' ') n++
    else if (c === '\t') n += 4
    else break
  }
  return n
}

export function parseMarkdown(text: string): Block[] {
  // 先頭の YAML の前付け（--- で囲まれた部分）は本文ではないので見せない
  const body = text.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '')
  return parseLines(body.split(/\r\n|\r|\n/))
}

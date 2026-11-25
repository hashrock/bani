/**
 * SVG を画像として書き出す前の下ごしらえ（寸法の読み取りと、描く前の消毒）。
 * DOM を使わない純粋な処理なので、vitest（node）で確かめている。描くのは svgRaster.ts。
 *
 * 消毒の考え方: SVG を <img> として描くとき、ブラウザはスクリプトを動かさず外部も読みに行かない。
 * それでもブラウザの実装だけに頼らず、こちらでも外部への参照とスクリプトを取り除いてから渡す。
 * 自前の字句解析で読んだ内容を、必ずエスケープし直して書き出す（解釈した通りのものだけがブラウザに届く）。
 * 読めない形（閉じていないタグなど）は推測で直さず、エラーにする。
 */

export interface SvgSize {
  width: number
  height: number
}

/** 書き出しの大きさの指定。width > dpi > scale の順に優先する。何もなければ元の大きさ（1 倍） */
export interface SvgRasterOptions {
  /** 元の大きさに対する倍率 */
  scale?: number
  /** 出力の幅（px）。高さは縦横比から決める */
  width?: number
  /** 解像度。SVG の 1px を 1/96 インチとみなし、dpi / 96 倍にする */
  dpi?: number
}

/** 取り除いたものの種類 */
export type SvgRemovalKind = 'script' | 'eventHandler' | 'externalReference' | 'embeddedContent'

export type SvgRemovals = Record<SvgRemovalKind, number>

export interface SanitizedSvg {
  /** 描いてよい SVG の文字列 */
  markup: string
  /** SVG が持っている大きさ（px） */
  intrinsic: SvgSize
  /** markup のルートに書き込んだ大きさ（px、整数） */
  size: SvgSize
  removed: SvgRemovals
}

export class SvgParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SvgParseError'
  }
}

/** 大きさがわからない SVG の既定。CSS の置換要素の既定と同じ */
export const DEFAULT_SVG_SIZE: SvgSize = { width: 300, height: 150 }

// --- 寸法 ---

/** 単位 → px。em / ex / ch は文脈がないので、ブラウザの既定の文字の大きさ（16px）で見積もる */
const UNIT_PX: Record<string, number> = {
  '': 1,
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  em: 16,
  rem: 16,
  ex: 8,
  ch: 8,
}

/** 長さ（"12.5mm" など）を px にする。% や auto のように決まらないもの、0 以下は null */
export function parseSvgLength(value: string | null | undefined): number | null {
  if (value == null) return null
  const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*|%)\s*$/i.exec(value)
  if (!match) return null
  const unit = match[2].toLowerCase()
  if (!Object.hasOwn(UNIT_PX, unit)) return null
  const factor = UNIT_PX[unit]
  const px = Number(match[1]) * factor
  return Number.isFinite(px) && px > 0 ? px : null
}

/** viewBox="minX minY width height"。幅か高さが 0 以下なら（描かれないので）null */
export function parseViewBox(value: string | null | undefined): { x: number; y: number; width: number; height: number } | null {
  if (value == null) return null
  const parts = value.trim().split(/[\s,]+/)
  if (parts.length !== 4) return null
  const numbers = parts.map(Number)
  if (!numbers.every(Number.isFinite)) return null
  const [x, y, width, height] = numbers
  return width > 0 && height > 0 ? { x, y, width, height } : null
}

/**
 * ルートの width / height / viewBox から、SVG の大きさ（px）を決める。
 * 片方だけなら viewBox の縦横比で補い、どちらもなければ viewBox の大きさ、それもなければ 300×150
 */
export function intrinsicSvgSize(attrs: { width?: string | null; height?: string | null; viewBox?: string | null }): SvgSize {
  const width = parseSvgLength(attrs.width)
  const height = parseSvgLength(attrs.height)
  if (width !== null && height !== null) return { width, height }
  const box = parseViewBox(attrs.viewBox)
  if (box) {
    const ratio = box.width / box.height
    // 片方が極端に大きいと比で割り戻した側が無限大や 0 に振り切れるので、有限の正の範囲に収める
    if (width !== null) return { width, height: finitePositive(width / ratio) }
    if (height !== null) return { width: finitePositive(height * ratio), height }
    return { width: box.width, height: box.height }
  }
  return { width: width ?? DEFAULT_SVG_SIZE.width, height: height ?? DEFAULT_SVG_SIZE.height }
}

const finitePositive = (n: number) => Math.min(Math.max(n, Number.MIN_VALUE), Number.MAX_VALUE)

/** 寸法の計算が無限大にならないための頭打ち。実際の上限（MAX_DIMENSION）は呼び出し側で確かめる */
const SIZE_CAP = 1e9
const toPixels = (n: number) => Math.max(1, Math.round(Math.min(n, SIZE_CAP)))

/** 書き出す画素数（整数、1 以上）。上限は呼び出し側で確かめる */
export function svgRasterSize(intrinsic: SvgSize, options: SvgRasterOptions = {}): SvgSize {
  const positive = (n: number | undefined) => (n !== undefined && Number.isFinite(n) && n > 0 ? n : null)
  const width = positive(options.width)
  if (width !== null) {
    return { width: toPixels(width), height: toPixels((Math.min(width, SIZE_CAP) * intrinsic.height) / intrinsic.width) }
  }
  const dpi = positive(options.dpi)
  const scale = dpi !== null ? dpi / 96 : (positive(options.scale) ?? 1)
  return { width: toPixels(intrinsic.width * scale), height: toPixels(intrinsic.height * scale) }
}

// --- 判定 ---

/** ファイル名か MIME から SVG らしいか（中身は見ない） */
export function isSvgFile(file: { name: string; type: string }): boolean {
  return file.type.toLowerCase() === 'image/svg+xml' || /\.svgz?$/i.test(file.name)
}

/**
 * 文字列の先頭が SVG の文書か。XML 宣言・コメント・DOCTYPE を飛ばし、最初の要素が svg かを見る。
 * テキストの画面で「画像として書き出す」を出すかどうかに使う（先頭だけを見るので長い文書でも軽い）
 */
export function sniffSvg(text: string): boolean {
  const head = text.slice(0, 4096)
  return /^\uFEFF?\s*(?:<\?[\s\S]*?\?>\s*|<!--[\s\S]*?-->\s*|<!DOCTYPE[^[>]*(?:\[[\s\S]*?\])?\s*>\s*)*<(?:[\w.-]+:)?svg[\s/>]/i.test(head)
}

// --- XML の字句解析 ---

interface Attribute {
  name: string
  /** 文字参照を解いた値 */
  value: string
}

type Token =
  | { type: 'start'; name: string; attrs: Attribute[]; selfClosing: boolean }
  | { type: 'end'; name: string }
  | { type: 'text'; text: string }
  | { type: 'decl'; attrs: string }
  | { type: 'skip' }

const NAME = /[^\s/>=<"'!?]+/y
const SPACE = /\s*/y

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

/**
 * 文字参照を解く。DOCTYPE は捨てるので、そこで定義された名前付きの参照は解けない。
 * 解けないものは文字のまま残す（書き出すときに &amp; になり、ただの文字として表示される）
 */
export function decodeXmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z_][\w.-]*);/gi, (whole, body: string) => {
    if (body[0] !== '#') return Object.hasOwn(PREDEFINED, body) ? PREDEFINED[body] : whole
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)
    return valid ? String.fromCodePoint(code) : '�'
  })
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  const fail = (what: string): never => {
    throw new SvgParseError(`${what} (at ${i})`)
  }
  const until = (marker: string, from: number) => {
    const end = source.indexOf(marker, from)
    if (end < 0) fail(`Unterminated ${marker}`)
    return end
  }
  const readName = () => {
    NAME.lastIndex = i
    const match = NAME.exec(source)
    if (!match) fail('Expected a name')
    i = NAME.lastIndex
    return match![0]
  }
  const skipSpace = () => {
    SPACE.lastIndex = i
    SPACE.exec(source)
    i = SPACE.lastIndex
  }

  while (i < source.length) {
    const lt = source.indexOf('<', i)
    if (lt !== i) {
      const end = lt < 0 ? source.length : lt
      tokens.push({ type: 'text', text: decodeXmlEntities(source.slice(i, end)) })
      i = end
      continue
    }
    if (source.startsWith('<!--', i)) {
      i = until('-->', i + 4) + 3
      tokens.push({ type: 'skip' })
    } else if (source.startsWith('<![CDATA[', i)) {
      const end = until(']]>', i + 9)
      tokens.push({ type: 'text', text: source.slice(i + 9, end) })
      i = end + 3
    } else if (source.startsWith('<!', i)) {
      // DOCTYPE。内部サブセット（[ ... ]）の中の > や引用符も飛ばす
      let depth = 0
      let quote: string | null = null
      let j = i + 2
      for (; j < source.length; j++) {
        const c = source[j]
        if (quote) {
          if (c === quote) quote = null
        } else if (c === '"' || c === "'") quote = c
        else if (c === '[') depth++
        else if (c === ']') depth--
        else if (c === '>' && depth <= 0) break
      }
      if (j >= source.length) fail('Unterminated <!')
      i = j + 1
      tokens.push({ type: 'skip' })
    } else if (source.startsWith('<?', i)) {
      const end = until('?>', i + 2)
      const body = source.slice(i + 2, end)
      // XML 宣言だけを残す（xml-stylesheet などの処理命令は外部を読みに行けるので捨てる）
      const decl = /^xml(\s[\s\S]*)?$/.exec(body)
      tokens.push(decl && i === source.search(/\S/) ? { type: 'decl', attrs: decl[1] ?? '' } : { type: 'skip' })
      i = end + 2
    } else if (source[i + 1] === '/') {
      i += 2
      const name = readName()
      skipSpace()
      if (source[i] !== '>') fail('Expected >')
      i++
      tokens.push({ type: 'end', name })
    } else {
      i++
      const name = readName()
      const attrs: Attribute[] = []
      let selfClosing = false
      for (;;) {
        skipSpace()
        if (source.startsWith('/>', i)) {
          selfClosing = true
          i += 2
          break
        }
        if (source[i] === '>') {
          i++
          break
        }
        if (i >= source.length) fail('Unterminated tag')
        const attrName = readName()
        skipSpace()
        if (source[i] !== '=') fail('Expected =')
        i++
        skipSpace()
        const quote = source[i]
        if (quote !== '"' && quote !== "'") fail('Expected a quoted value')
        const end = until(quote, i + 1)
        attrs.push({ name: attrName, value: decodeXmlEntities(source.slice(i + 1, end)) })
        i = end + 1
      }
      tokens.push({ type: 'start', name, attrs, selfClosing })
    }
  }
  return tokens
}

// --- 消毒 ---

const localName = (name: string) => name.slice(name.lastIndexOf(':') + 1).toLowerCase()

/** 中身ごと取り除く要素 → 数える種類 */
const DROPPED_ELEMENTS: Record<string, SvgRemovalKind> = {
  script: 'script',
  handler: 'script',
  listener: 'script',
  foreignobject: 'embeddedContent',
  iframe: 'embeddedContent',
  object: 'embeddedContent',
  embed: 'embeddedContent',
  audio: 'embeddedContent',
  video: 'embeddedContent',
  canvas: 'embeddedContent',
  link: 'externalReference',
  include: 'externalReference',
}

const ANIMATIONS = new Set(['set', 'animate', 'animatemotion', 'animatetransform', 'animatecolor'])
/** data: で埋め込んだ画像を参照してよい要素 */
const IMAGE_ELEMENTS = new Set(['image', 'feimage'])
const LINK_ATTRIBUTES = new Set(['href', 'src', 'srcset'])

const isLocalRef = (value: string) => value.trim().startsWith('#')
const isDataImage = (value: string) => /^\s*data:image\//i.test(value)

/**
 * CSS の中の外部への参照を無効にする。url() は「#」か data: でなければ none に、
 * @import は知らない at-rule に、文字列で画像を指せる関数（image-set など）は知らない関数に書き換える
 * （ブラウザはどちらも読み飛ばす）。数を返す。
 */
export function sanitizeCss(input: string): { css: string; removed: number } {
  let removed = 0
  // 識別子の中のエスケープ（\75 rl( や \u）で url や @import を隠せないよう、英数字に戻せるものは戻す
  let css = input
    .replace(/\\([0-9a-f]{1,6})[ \t\n\r\f]?/gi, (whole, hex: string) => {
      const char = String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd)
      return /^[\w-]$/.test(char) ? char : whole
    })
    .replace(/\\([g-z_-])/gi, '$1')

  css = css.replace(/@import\b/gi, () => {
    removed++
    return '@x-removed-import'
  })
  css = css.replace(/(^|[^\w-])((?:-webkit-)?(?:image-set|cross-fade)|src|element)\(/gi, (_whole, before: string) => {
    removed++
    return `${before}x-removed(`
  })

  let out = ''
  let at = 0
  const pattern = /url\(/gi
  for (let match = pattern.exec(css); match; match = pattern.exec(css)) {
    const start = match.index
    // url の前が識別子の一部（foourl( など）なら別の関数
    if (start > 0 && /[\w-]/.test(css[start - 1])) continue
    let j = start + 4
    while (j < css.length && /\s/.test(css[j])) j++
    let target: string
    let end: number
    if (css[j] === '"' || css[j] === "'") {
      const quote = css[j]
      let k = j + 1
      while (k < css.length && css[k] !== quote) k += css[k] === '\\' ? 2 : 1
      target = css.slice(j + 1, k)
      const close = css.indexOf(')', k)
      end = close < 0 ? css.length : close + 1
    } else {
      const close = css.indexOf(')', j)
      end = close < 0 ? css.length : close + 1
      target = css.slice(j, close < 0 ? css.length : close).trim()
    }
    // @namespace url(...) は名前空間の名前で、読みに行かない
    const namespace = /@namespace\s+(?:[\w-]+\s+)?$/i.test(css.slice(Math.max(0, start - 80), start))
    const allowed = namespace || isLocalRef(target) || /^\s*data:/i.test(target)
    if (!allowed) {
      out += css.slice(at, start) + 'none'
      at = end
      removed++
    }
    pattern.lastIndex = end
  }
  out += css.slice(at)
  return { css: removed > 0 ? out : input, removed }
}

const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const escapeAttr = (text: string) =>
  escapeText(text).replace(/"/g, '&quot;').replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;')

const formatNumber = (n: number) => String(Math.round(n * 1000) / 1000)

/**
 * SVG を消毒し、描く大きさをルートに書き込む。
 * size を渡さなければ元の大きさ（整数に丸める）。ルートが svg でなければ SvgParseError
 */
export function sanitizeSvg(source: string, options: SvgRasterOptions = {}): SanitizedSvg {
  const tokens = tokenize(source)
  const removed: SvgRemovals = { script: 0, eventHandler: 0, externalReference: 0, embeddedContent: 0 }
  let out = ''
  let intrinsic: SvgSize | null = null
  let size: SvgSize | null = null
  let skipDepth = 0
  /** style 要素の中。子要素は捨て、文字をまとめて CSS として消毒する */
  let style: { depth: number; text: string } | null = null
  let depth = 0

  const cleanAttributes = (element: string, attrs: Attribute[]): Attribute[] => {
    const kept: Attribute[] = []
    for (const attr of attrs) {
      const name = localName(attr.name)
      if (name.startsWith('on')) {
        removed.eventHandler++
        continue
      }
      if (attr.name.toLowerCase() === 'xml:base') continue
      if (LINK_ATTRIBUTES.has(name)) {
        if (attr.value.trim() === '') continue
        const ok =
          name !== 'srcset' && element !== 'a' && (isLocalRef(attr.value) || (IMAGE_ELEMENTS.has(element) && isDataImage(attr.value)))
        if (ok) kept.push(attr)
        else if (element !== 'a') removed.externalReference++
        continue
      }
      const cleaned = sanitizeCss(attr.value)
      removed.externalReference += cleaned.removed
      kept.push({ name: attr.name, value: cleaned.css })
    }
    return kept
  }

  /** href を外部へ向けるアニメーションか（ほかの属性への url() は属性の消毒で消える） */
  const animatesLink = (attrs: Attribute[]) => {
    const target = attrs.find((attr) => attr.name === 'attributeName')?.value.trim() ?? ''
    const name = localName(target)
    if (name.startsWith('on')) return 'script' as const
    if (!LINK_ATTRIBUTES.has(name)) return null
    const values = attrs
      .filter((attr) => ['from', 'to', 'by', 'values'].includes(attr.name))
      .flatMap((attr) => attr.value.split(';'))
      .filter((value) => value.trim() !== '')
    return values.every(isLocalRef) ? null : ('externalReference' as const)
  }

  for (const token of tokens) {
    if (skipDepth > 0) {
      if (token.type === 'start' && !token.selfClosing) skipDepth++
      else if (token.type === 'end') skipDepth--
      continue
    }
    if (style) {
      if (token.type === 'text') style.text += token.text
      else if (token.type === 'start' && !token.selfClosing) style.depth++
      else if (token.type === 'end' && --style.depth === 0) {
        const cleaned = sanitizeCss(style.text)
        removed.externalReference += cleaned.removed
        out += `${escapeText(cleaned.css)}</${token.name}>`
        style = null
        depth--
      }
      continue
    }
    switch (token.type) {
      case 'skip':
        break
      case 'decl':
        out += `<?xml${token.attrs}?>`
        break
      case 'text':
        // ルートの外の文字（空白以外）は XML として誤りなので書き出さない
        if (depth > 0) out += escapeText(token.text)
        break
      case 'end':
        out += `</${token.name}>`
        depth--
        break
      case 'start': {
        const name = localName(token.name)
        const isRoot = intrinsic === null
        if (!isRoot && depth === 0) throw new SvgParseError('Content after the root element')
        if (isRoot && name !== 'svg') throw new SvgParseError('The root element is not <svg>')
        const dropped = Object.hasOwn(DROPPED_ELEMENTS, name)
          ? DROPPED_ELEMENTS[name]
          : ANIMATIONS.has(name)
            ? animatesLink(token.attrs)
            : null
        if (dropped) {
          removed[dropped]++
          if (!token.selfClosing) skipDepth = 1
          break
        }
        let attrs = cleanAttributes(name, token.attrs)
        if (isRoot) {
          const get = (key: string) => attrs.find((attr) => attr.name === key)?.value ?? null
          intrinsic = intrinsicSvgSize({ width: get('width'), height: get('height'), viewBox: get('viewBox') })
          size = svgRasterSize(intrinsic, options)
          // 中身の座標は viewBox に、描く大きさは width / height に。viewBox がなければ元の大きさを座標にする
          const box = parseViewBox(get('viewBox'))
          attrs = attrs.filter((attr) => attr.name !== 'width' && attr.name !== 'height' && (box || attr.name !== 'viewBox'))
          attrs.push({ name: 'width', value: String(size.width) }, { name: 'height', value: String(size.height) })
          if (!box) {
            attrs.push({ name: 'viewBox', value: `0 0 ${formatNumber(intrinsic.width)} ${formatNumber(intrinsic.height)}` })
          }
        }
        const rendered = attrs.map((attr) => ` ${attr.name}="${escapeAttr(attr.value)}"`).join('')
        out += `<${token.name}${rendered}${token.selfClosing ? '/>' : '>'}`
        if (!token.selfClosing) {
          depth++
          if (name === 'style') style = { depth: 1, text: '' }
        }
        break
      }
    }
  }
  if (intrinsic === null || size === null) throw new SvgParseError('No <svg> element')
  if (depth !== 0 || style || skipDepth > 0) throw new SvgParseError('Unclosed element')
  return { markup: out, intrinsic, size, removed }
}

/** 取り除いた数の合計 */
export const countRemovals = (removed: SvgRemovals) =>
  removed.script + removed.eventHandler + removed.externalReference + removed.embeddedContent

/**
 * 圧縮ファイルの中のファイル名を扱う純粋な関数。
 * 文字コードの判定・危ないパスの無害化・重複の解消をここに集め、読み書きの両方で同じ規則を使う。
 */

export type NameEncoding = 'utf-8' | 'shift_jis' | 'cp437'

// 名前の先頭の BOM も名前の一部として残す（黙って落とすと別の名前と衝突しうる）
const strictUtf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
const looseUtf8 = new TextDecoder('utf-8', { ignoreBOM: true })
// WHATWG の shift_jis は実際には Windows-31J（CP932）なので、Windows の ZIP にそのまま合う
const strictShiftJis = new TextDecoder('shift_jis', { fatal: true })

/** ZIP の既定の文字コード。UTF-8 でも Shift_JIS でも読めなかったときの最後の頼り */
const CP437_HIGH =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ '

function decodeCp437(bytes: Uint8Array): string {
  let text = ''
  for (const byte of bytes) text += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80]
  return text
}

/**
 * 中のファイル名のバイト列を文字列にする。
 * UTF-8 の印（ZIP の汎用ビット 11）があれば UTF-8。なければ Windows で作られた ZIP の
 * Shift_JIS が多いので、まず UTF-8 として厳密に読み、だめなら Shift_JIS、それもだめなら CP437。
 * 日本語の Shift_JIS 名がたまたま正しい UTF-8 になることはまずないので、この順で取り違えない。
 */
export function decodeEntryName(bytes: Uint8Array, utf8Flag: boolean): { name: string; encoding: NameEncoding } {
  if (utf8Flag) return { name: looseUtf8.decode(bytes), encoding: 'utf-8' }
  try {
    return { name: strictUtf8.decode(bytes), encoding: 'utf-8' }
  } catch {
    // UTF-8 ではない。次を試す
  }
  try {
    return { name: strictShiftJis.decode(bytes), encoding: 'shift_jis' }
  } catch {
    return { name: decodeCp437(bytes), encoding: 'cp437' }
  }
}

/** Windows が名前に使えない文字と制御文字。展開先がどの OS でも書けるように置き換える */
// eslint-disable-next-line no-control-regex
const UNSAFE_CHARS = /[\u0000-\u001f\u007f<>:"|?*]/g
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i

/**
 * 1 つの名前（フォルダ名・ファイル名）を書き出せる形にする。
 * 末尾の空白と点は Windows が黙って消して別名と衝突させるので、先に落としておく。
 * 結果が空なら '' を返し、呼び出し側で捨てるか代わりの名前を付ける。
 */
export function sanitizeSegment(segment: string): string {
  const cleaned = segment.replace(/[/\\]/g, '_').replace(UNSAFE_CHARS, '_').replace(/[ .]+$/, '')
  if (cleaned === '') return ''
  return RESERVED_WINDOWS_NAME.test(cleaned) ? `_${cleaned}` : cleaned
}

/**
 * 中のパスを、展開先のフォルダの外へ出られない相対パスにする（zip-slip 対策）。
 * 区切りは '/' にそろえ、先頭の '/' やドライブ名は落とし、'..' は根より上へは戻さない。
 * 末尾の '/'（フォルダの印）も落ちるので、フォルダかどうかは呼び出し側が別に持つ。
 */
export function sanitizePath(raw: string): string {
  const segments: string[] = []
  // バックスラッシュは Windows のツールが区切りとして書くことがある。
  // Shift_JIS の 2 バイト目の 0x5C はこの時点で文字に読み終えているので巻き込まない
  const unified = raw.replace(/\\/g, '/').replace(/^[a-zA-Z]:/, '')
  for (const part of unified.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      segments.pop()
      continue
    }
    const segment = sanitizeSegment(part)
    if (segment !== '') segments.push(segment)
  }
  return segments.join('/')
}

export function basename(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? path : path.slice(slash + 1)
}

/** 親フォルダのパス。根にあるものは '' */
export function dirname(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

export function joinPath(folder: string, name: string): string {
  return folder === '' ? name : `${folder}/${name}`
}

/**
 * 「名前 (2).拡張子」の形にする。.tar.gz のような二重の拡張子は一体で扱い、
 * 先頭の点だけの名前（.gitignore）は拡張子なしとみなす。フォルダ名は拡張子を割らない。
 */
export function numberedName(name: string, n: number, isFolder = false): string {
  if (isFolder) return `${name} (${n})`
  const match = /(\.tar)?\.[^.]+$/i.exec(name)
  if (!match || match.index === 0) return `${name} (${n})`
  return `${name.slice(0, match.index)} (${n})${name.slice(match.index)}`
}

/**
 * 大文字小文字だけ違う名前は Windows・macOS の既定で同じファイルになるので、
 * 同じ名前とみなして衝突させる。合成済み・分解済みの表記ゆれ（macOS の濁点）も寄せる。
 */
export const pathKey = (path: string) => path.normalize('NFC').toLowerCase()

/**
 * すでに使われているパスを覚え、新しいパスを重ならないように割り当てる。
 * 割り当ては呼んだ順だけで決まる（同じ順に同じ入力を渡せば同じ結果になる）。
 */
export interface PathRegistry {
  /** ファイルのパスを確保する。ほかのファイル・フォルダと重なれば番号を付ける */
  claimFile(path: string): string
  /** フォルダのパスを確保する。同名のフォルダはまとめ、同名のファイルとは番号で分ける */
  claimFolder(path: string): string
}

export function createPathRegistry(): PathRegistry {
  const files = new Set<string>()
  // キー → 最初に現れた表記。大文字小文字だけ違うフォルダは最初の表記へまとめる
  const folders = new Map<string, string>()

  const resolveFolder = (path: string): string => {
    let resolved = ''
    for (const segment of path === '' ? [] : path.split('/')) {
      let candidate = joinPath(resolved, segment)
      // フォルダ名がファイル名とぶつかると展開できないので、フォルダ側をずらす
      for (let n = 2; files.has(pathKey(candidate)); n++) {
        candidate = joinPath(resolved, numberedName(segment, n, true))
      }
      const key = pathKey(candidate)
      const existing = folders.get(key)
      if (existing === undefined) folders.set(key, candidate)
      resolved = existing ?? candidate
    }
    return resolved
  }

  return {
    claimFile(path) {
      const folder = resolveFolder(dirname(path))
      // 名前が空になるパスは呼び出し側で防ぐが、念のため空のファイル名は作らない
      const name = basename(path) || 'untitled'
      let candidate = joinPath(folder, name)
      for (let n = 2; files.has(pathKey(candidate)) || folders.has(pathKey(candidate)); n++) {
        candidate = joinPath(folder, numberedName(name, n))
      }
      files.add(pathKey(candidate))
      return candidate
    },
    claimFolder: resolveFolder,
  }
}

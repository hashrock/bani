import type { DetectedFormat } from './types'

/** 判定に要る先頭の長さ。tar の識別子が 257 バイト目にあるので 1 ブロック分読む */
export const SNIFF_LENGTH = 512

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte)

/**
 * tar のヘッダーブロックとして正しいか。識別子 "ustar" のない古い tar もあるので、
 * チェックサム（識別子の有無にかかわらず必ずある）で確かめる。
 */
export function isTarHeader(block: Uint8Array): boolean {
  if (block.length < 512) return false
  const stored = parseOctal(block.subarray(148, 156))
  if (stored === null) return false
  let sum = 0
  // チェックサム欄そのものは空白 8 つとして数える決まり
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 0x20 : block[i]
  // 全部 0 のブロックは終端の印で、ヘッダーではない
  return sum !== 0x20 * 8 && sum === stored
}

/** tar の 8 進数の欄。空白や NUL で埋まっていることがある */
export function parseOctal(field: Uint8Array): number | null {
  let text = ''
  for (const byte of field) {
    if (byte === 0) break
    text += String.fromCharCode(byte)
  }
  text = text.trim()
  if (!/^[0-7]+$/.test(text)) return null
  return parseInt(text, 8)
}

/**
 * 先頭のバイト列から形式を決める。gzip の中身が tar かどうかは展開してみないと分からないので
 * ここでは 'gzip' とだけ返し、probe 側で確かめる。
 */
export function detectArchiveFormat(head: Uint8Array): DetectedFormat {
  // 中身のない ZIP は終端レコード（PK\x05\x06）から始まる
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) return 'zip'
  if (startsWith(head, [0x1f, 0x8b])) return 'gzip'
  if (startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return '7z'
  if (startsWith(head, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return 'rar'
  if (startsWith(head, [0x42, 0x5a, 0x68])) return 'bzip2'
  if (startsWith(head, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])) return 'xz'
  if (startsWith(head, [0x28, 0xb5, 0x2f, 0xfd])) return 'zstd'
  if (isTarHeader(head.subarray(0, 512))) return 'tar'
  return 'unknown'
}

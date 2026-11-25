import { crc32 } from './crc32'

/**
 * テスト専用: 名前のバイト列や印を好きに決めた無圧縮 ZIP を組み立てる。
 * Shift_JIS 名・暗号化の印・zip-slip のような、fflate では作れない ZIP を再現するのに使う。
 */
export interface FixtureEntry {
  name: Uint8Array | string
  data?: Uint8Array | string
  /** 汎用ビットフラグ（bit 0 = 暗号化、bit 11 = UTF-8） */
  flags?: number
  method?: number
  /** 書く CRC を差し替える（壊れた ZIP の再現） */
  crc?: number
}

const encoder = new TextEncoder()
const bytesOf = (value: Uint8Array | string | undefined) =>
  value === undefined ? new Uint8Array(0) : typeof value === 'string' ? encoder.encode(value) : value

export function buildZip(entries: readonly FixtureEntry[]): Uint8Array<ArrayBuffer> {
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = bytesOf(entry.name)
    const data = bytesOf(entry.data)
    const crc = entry.crc ?? crc32(data)
    const flags = entry.flags ?? 0
    const method = entry.method ?? 0
    // 2024-01-02 03:04:06（ローカル時刻）
    const time = (3 << 11) | (4 << 5) | 3
    const date = ((2024 - 1980) << 9) | (1 << 5) | 2

    const local = new Uint8Array(30 + name.length + data.length)
    const l = new DataView(local.buffer)
    l.setUint32(0, 0x04034b50, true)
    l.setUint16(4, 20, true)
    l.setUint16(6, flags, true)
    l.setUint16(8, method, true)
    l.setUint16(10, time, true)
    l.setUint16(12, date, true)
    l.setUint32(14, crc, true)
    l.setUint32(18, data.length, true)
    l.setUint32(22, data.length, true)
    l.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)
    locals.push(local)

    const central = new Uint8Array(46 + name.length)
    const c = new DataView(central.buffer)
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, flags, true)
    c.setUint16(10, method, true)
    c.setUint16(12, time, true)
    c.setUint16(14, date, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, data.length, true)
    c.setUint32(24, data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    offset += local.length
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const e = new DataView(end.buffer)
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, entries.length, true)
  e.setUint16(10, entries.length, true)
  e.setUint32(12, centralSize, true)
  e.setUint32(16, offset, true)

  const parts = [...locals, ...centrals, end]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let p = 0
  for (const part of parts) {
    out.set(part, p)
    p += part.length
  }
  return out
}

export const blobText = async (blob: Blob) => new TextDecoder().decode(await blob.arrayBuffer())

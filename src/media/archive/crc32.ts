/** ZIP・gzip の CRC-32。展開した中身が壊れていないかの確かめに使う */
const TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

/** 少しずつ足していける CRC。value() は何度呼んでもよい */
export function createCrc32() {
  let crc = 0xffffffff
  return {
    update(bytes: Uint8Array) {
      for (let i = 0; i < bytes.length; i++) crc = TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
    },
    value: () => (crc ^ 0xffffffff) >>> 0,
  }
}

export function crc32(bytes: Uint8Array): number {
  const crc = createCrc32()
  crc.update(bytes)
  return crc.value()
}

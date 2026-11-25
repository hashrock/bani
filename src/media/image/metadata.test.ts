import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import { parseExifTiff, parseImageHeader, sniffImageMime } from './metadata'
import type { ExifOrientation } from './metadata'
import { imageInfoFromHeader } from './probe'

// --- 手組みのバイト列。各形式の、読み取りに効く最小限の構造だけを持つ ---

class Bytes {
  private readonly out: number[] = []
  u8(...values: number[]) {
    this.out.push(...values.map((v) => v & 0xff))
    return this
  }
  u16(v: number, little: boolean) {
    return little ? this.u8(v, v >> 8) : this.u8(v >> 8, v)
  }
  u24le(v: number) {
    return this.u8(v, v >> 8, v >> 16)
  }
  u32(v: number, little: boolean) {
    const b = [v >>> 24, v >>> 16, v >>> 8, v]
    return this.u8(...(little ? b.reverse() : b))
  }
  ascii(s: string) {
    return this.u8(...[...s].map((c) => c.charCodeAt(0)))
  }
  raw(bytes: ArrayLike<number>) {
    return this.u8(...Array.from(bytes))
  }
  get length() {
    return this.out.length
  }
  build() {
    return Uint8Array.from(this.out)
  }
}

interface TiffSpec {
  little: boolean
  orientation?: ExifOrientation
  /** coords: 緯度経度あり、versionOnly: GPS IFD はあるが版番号だけ */
  gps?: 'coords' | 'versionOnly'
}

function buildTiff({ little, orientation, gps }: TiffSpec): Uint8Array {
  const ifd0: [number, number, number, (b: Bytes) => void][] = []
  if (orientation) ifd0.push([0x0112, 3, 1, (b) => b.u16(orientation, little).u16(0, little)])
  const ifd0Size = 2 + (ifd0.length + (gps ? 1 : 0)) * 12 + 4
  const gpsOffset = 8 + ifd0Size
  if (gps) ifd0.push([0x8825, 4, 1, (b) => b.u32(gpsOffset, little)])

  const b = new Bytes().ascii(little ? 'II' : 'MM').u16(42, little).u32(8, little)
  b.u16(ifd0.length, little)
  for (const [tag, type, count, value] of ifd0) {
    b.u16(tag, little).u16(type, little).u32(count, little)
    value(b)
  }
  b.u32(0, little)
  if (gps) {
    const entries: [number, number, number, number][] = [[0x0000, 1, 4, 0x02030000]]
    if (gps === 'coords') {
      // 有理数の実体は読まないので、指し先はでたらめでよい
      entries.push([0x0001, 2, 2, 0x4e000000], [0x0002, 5, 3, 0x1000], [0x0004, 5, 3, 0x1000])
    }
    b.u16(entries.length, little)
    for (const [tag, type, count, value] of entries) {
      b.u16(tag, little).u16(type, little).u32(count, little).u32(value, false)
    }
    b.u32(0, little)
  }
  return b.build()
}

interface MetaSpec {
  exif?: TiffSpec
  xmp?: boolean
  other?: boolean
}

function buildJpeg(width: number, height: number, meta: MetaSpec = {}, sof = 0xc0): Uint8Array {
  const b = new Bytes().u8(0xff, 0xd8)
  const segment = (marker: number, payload: Uint8Array) =>
    b.u8(0xff, marker).u16(payload.length + 2, false).raw(payload)
  segment(0xe0, new Bytes().ascii('JFIF\0').u8(1, 1, 0, 0, 1, 0, 1, 0, 0).build())
  if (meta.exif) segment(0xe1, new Bytes().ascii('Exif\0\0').raw(buildTiff(meta.exif)).build())
  if (meta.xmp) segment(0xe1, new Bytes().ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>').build())
  if (meta.other) segment(0xfe, new Bytes().ascii('comment').build())
  // DHT はマーカーの範囲が SOF と重なるので、紛れ込ませて誤読しないことを確かめる
  segment(0xc4, new Bytes().u8(0, ...new Array(16).fill(0)).build())
  b.u8(0xff) // マーカー前の詰め物
  segment(sof, new Bytes().u8(8).u16(height, false).u16(width, false).u8(3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1).build())
  segment(0xda, new Bytes().u8(3, 1, 0, 2, 0x11, 3, 0x11, 0, 0x3f, 0).build())
  return b.u8(0x12, 0x34, 0xff, 0xd9).build()
}

function buildPng(width: number, height: number, meta: MetaSpec = {}): Uint8Array {
  const b = new Bytes().u8(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
  const chunk = (type: string, data: Uint8Array) => b.u32(data.length, false).ascii(type).raw(data).u32(0, false)
  chunk('IHDR', new Bytes().u32(width, false).u32(height, false).u8(8, 6, 0, 0, 0).build())
  if (meta.exif) chunk('eXIf', buildTiff(meta.exif))
  if (meta.xmp) chunk('iTXt', new Bytes().ascii('XML:com.adobe.xmp\0\0\0\0\0<x/>').build())
  if (meta.other) chunk('tEXt', new Bytes().ascii('Software\0hand').build())
  chunk('IDAT', Uint8Array.of(0x78, 0x9c, 1))
  chunk('IEND', new Uint8Array())
  return b.build()
}

type WebpKind = 'VP8' | 'VP8L' | 'VP8X'

function buildWebp(kind: WebpKind, width: number, height: number, meta: MetaSpec = {}): Uint8Array {
  const body = new Bytes().ascii('WEBP')
  const chunk = (type: string, data: Uint8Array) => {
    body.ascii(type).u32(data.length, true).raw(data)
    if (data.length % 2) body.u8(0)
  }
  if (kind === 'VP8X') {
    const flags = (meta.exif ? 0x08 : 0) | (meta.xmp ? 0x04 : 0)
    chunk('VP8X', new Bytes().u8(flags, 0, 0, 0).u24le(width - 1).u24le(height - 1).build())
    // 本体は奇数長にして詰め物の読み飛ばしも通す
    chunk('VP8L', new Bytes().u8(0x2f).u32(0, true).u8(0).build())
    if (meta.exif) chunk('EXIF', buildTiff(meta.exif))
    if (meta.xmp) chunk('XMP ', new Bytes().ascii('<x/>').build())
  } else if (kind === 'VP8') {
    chunk('VP8 ', new Bytes().u8(0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a).u16(width, true).u16(height, true).u8(0, 0).build())
  } else {
    const bits = (width - 1) | ((height - 1) << 14)
    chunk('VP8L', new Bytes().u8(0x2f).u32(bits >>> 0, true).u8(0x10).build())
  }
  const data = body.build()
  return new Bytes().ascii('RIFF').u32(data.length, true).raw(data).build()
}

// --- 任意値 ---

const orientation = fc.integer({ min: 1, max: 8 }).map((v) => v as ExifOrientation)
const tiffSpec: fc.Arbitrary<TiffSpec> = fc.record(
  {
    little: fc.boolean(),
    orientation,
    gps: fc.constantFrom('coords' as const, 'versionOnly' as const),
  },
  { requiredKeys: ['little'] }
)
const metaSpec: fc.Arbitrary<MetaSpec> = fc.record(
  { exif: tiffSpec, xmp: fc.boolean(), other: fc.boolean() },
  { requiredKeys: [] }
)
/** VP8 は 14 ビットしかないので、すべての形式で共通に使える範囲に絞る */
const side = fc.integer({ min: 1, max: 0x3fff })

function expectedMetadata(meta: MetaSpec, supportsOther = true) {
  return {
    exif: meta.exif !== undefined,
    gps: meta.exif?.gps === 'coords',
    xmp: meta.xmp ?? false,
    other: supportsOther && (meta.other ?? false),
    orientation: meta.exif?.orientation ?? 1,
  }
}

describe('parseExifTiff', () => {
  test('向きと位置情報の有無を、バイト順によらず読む', () => {
    fc.assert(
      fc.property(tiffSpec, (spec) => {
        expect(parseExifTiff(buildTiff(spec))).toEqual({
          gps: spec.gps === 'coords',
          orientation: spec.orientation ?? 1,
        })
      })
    )
  })

  test('GPS IFD が版番号だけなら位置情報なしとみなす', () => {
    expect(parseExifTiff(buildTiff({ little: true, gps: 'versionOnly' })).gps).toBe(false)
    expect(parseExifTiff(buildTiff({ little: false, gps: 'coords' })).gps).toBe(true)
  })

  test('TIFF でなければ何もないものとして扱う', () => {
    expect(parseExifTiff(Uint8Array.of(1, 2, 3))).toEqual({ gps: false, orientation: 1 })
  })
})

describe('parseImageHeader', () => {
  test('JPEG: 寸法と付帯情報を読む。SOF の種類（ベースライン・プログレッシブ）を問わない', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 0xffff }),
        fc.integer({ min: 1, max: 0xffff }),
        metaSpec,
        fc.constantFrom(0xc0, 0xc1, 0xc2),
        (width, height, meta, sof) => {
          expect(parseImageHeader(buildJpeg(width, height, meta, sof))).toEqual({
            mime: 'image/jpeg',
            storedWidth: width,
            storedHeight: height,
            metadata: expectedMetadata(meta),
          })
        }
      )
    )
  })

  test('PNG: IHDR の寸法と eXIf・XMP・テキストチャンクを読む', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), fc.integer({ min: 1, max: 0x7fffffff }), metaSpec, (width, height, meta) => {
        expect(parseImageHeader(buildPng(width, height, meta))).toEqual({
          mime: 'image/png',
          storedWidth: width,
          storedHeight: height,
          metadata: expectedMetadata(meta),
        })
      })
    )
  })

  test('WebP: 3 種類のビットストリームそれぞれで寸法を読み、拡張形式では付帯情報も読む', () => {
    fc.assert(
      fc.property(fc.constantFrom<WebpKind>('VP8', 'VP8L', 'VP8X'), side, side, metaSpec, (kind, width, height, meta) => {
        const used = kind === 'VP8X' ? { exif: meta.exif, xmp: meta.xmp } : {}
        expect(parseImageHeader(buildWebp(kind, width, height, used))).toEqual({
          mime: 'image/webp',
          storedWidth: width,
          storedHeight: height,
          metadata: expectedMetadata(used, false),
        })
      })
    )
  })

  test('WebP: "Exif\\0\\0" を前置した EXIF チャンクも読む', () => {
    const tiff = buildTiff({ little: true, gps: 'coords', orientation: 6 })
    const withPrefix = new Bytes().ascii('Exif\0\0').raw(tiff).build()
    const body = new Bytes()
      .ascii('WEBP')
      .ascii('VP8X')
      .u32(10, true)
      .u8(0x08, 0, 0, 0)
      .u24le(9)
      .u24le(19)
      .ascii('EXIF')
      .u32(withPrefix.length, true)
      .raw(withPrefix)
      .build()
    const file = new Bytes().ascii('RIFF').u32(body.length, true).raw(body).build()
    expect(parseImageHeader(file)?.metadata).toMatchObject({ exif: true, gps: true, orientation: 6 })
  })

  test('GIF と BMP は寸法だけを読む', () => {
    const gif = new Bytes().ascii('GIF89a').u16(320, true).u16(240, true).u8(0, 0, 0).build()
    expect(parseImageHeader(gif)).toMatchObject({ mime: 'image/gif', storedWidth: 320, storedHeight: 240 })
    // 高さが負の BMP（上から下へ並ぶ形式）
    const bmp = new Bytes().ascii('BM').raw(new Array(16).fill(0)).u32(64, true).u32(-48 >>> 0, true).build()
    expect(parseImageHeader(bmp)).toMatchObject({ mime: 'image/bmp', storedWidth: 64, storedHeight: 48 })
  })

  test('AVIF・HEIC は形式だけ分かり、寸法は読まない', () => {
    const ftyp = (brand: string) => new Bytes().u32(24, false).ascii('ftyp').ascii(brand).u32(0, false).build()
    expect(sniffImageMime(ftyp('avif'))).toBe('image/avif')
    expect(sniffImageMime(ftyp('heic'))).toBe('image/heic')
    expect(parseImageHeader(ftyp('avif'))).toBeNull()
  })

  test('でたらめなバイト列でも例外を投げない', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 256 }), (bytes) => {
        expect(() => parseImageHeader(bytes)).not.toThrow()
      })
    )
  })

  test('正しいファイルを途中で切っても例外を投げず、読めた寸法は元と一致する', () => {
    const fixture = fc.oneof(
      fc.tuple(side, side, metaSpec).map(([w, h, m]) => ({ w, h, bytes: buildJpeg(w, h, m) })),
      fc.tuple(side, side, metaSpec).map(([w, h, m]) => ({ w, h, bytes: buildPng(w, h, m) })),
      fc.tuple(side, side, metaSpec).map(([w, h, m]) => ({ w, h, bytes: buildWebp('VP8X', w, h, m) }))
    )
    fc.assert(
      fc.property(fixture, fc.double({ min: 0, max: 1, noNaN: true }), ({ w, h, bytes }, ratio) => {
        const header = parseImageHeader(bytes.subarray(0, Math.floor(bytes.length * ratio)))
        if (header) expect([header.storedWidth, header.storedHeight]).toEqual([w, h])
      })
    )
  })

  test('壊れたバイトを 1 つ混ぜても例外を投げない', () => {
    fc.assert(
      fc.property(side, side, metaSpec, fc.nat(), fc.integer({ min: 0, max: 255 }), (w, h, m, at, value) => {
        const bytes = buildJpeg(w, h, m)
        bytes[at % bytes.length] = value
        expect(() => parseImageHeader(bytes)).not.toThrow()
      })
    )
  })
})

describe('imageInfoFromHeader', () => {
  test('向き 5〜8 では見た目の幅と高さが入れ替わり、1〜4 ではそのまま', () => {
    fc.assert(
      fc.property(side, side, orientation, (w, h, o) => {
        const header = parseImageHeader(buildJpeg(w, h, { exif: { little: true, orientation: o } }))
        expect(header).not.toBeNull()
        const info = imageInfoFromHeader(header!, 123)
        expect([info.width, info.height]).toEqual(o >= 5 ? [h, w] : [w, h])
        expect(info.metadataKnown).toBe(true)
      })
    )
  })
})

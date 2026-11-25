import { describe, expect, test } from 'vitest'
import fc from 'fast-check'
import {
  SvgParseError,
  countRemovals,
  decodeXmlEntities,
  intrinsicSvgSize,
  isSvgFile,
  parseSvgLength,
  parseViewBox,
  sanitizeCss,
  sanitizeSvg,
  sniffSvg,
  svgRasterSize,
} from './svg'

const NS = 'xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"'
const svg = (body: string, attrs = 'width="10" height="10"') => `<svg ${NS} ${attrs}>${body}</svg>`

/**
 * 消毒した結果のうち、ブラウザが読み取りに使う部分（タグと style の中身）に、外へ出ていける文字列が残っていないか。
 * ふつうの文字（<text> の中身）と名前空間の宣言は、読みに行かないので見ない
 */
function expectNoExternal(output: string) {
  const withoutNamespaces = output.replace(/\sxmlns(:[\w-]+)?="[^"]*"/g, '')
  const tags = (withoutNamespaces.match(/<[^>]*>/g) ?? []).join('\n')
  expect(tags).not.toMatch(/https?:|\/\/evil|evil\.example|javascript:/i)
  expect(tags).not.toMatch(/<(\w+:)?script/i)
  expect(tags).not.toMatch(/\son\w+=/i)
  expect(tags).not.toMatch(/foreignObject/i)
  // CSS では読みに行く書き方（@import と、# や data: 以外への url()）だけを見る。知らない at-rule の文字列は読まれない
  const styles = [...withoutNamespaces.matchAll(/<(?:[\w-]+:)?style\b[^>]*>([^<]*)</g)].map((match) => match[1]).join('\n')
  for (const css of [tags, styles]) {
    expect(css).not.toMatch(/@import/i)
    expect(css).not.toMatch(/url\(\s*(?!['"]?\s*(?:#|data:))/i)
  }
}

describe('parseSvgLength', () => {
  test.each([
    ['100', 100],
    ['100px', 100],
    [' 12.5px ', 12.5],
    ['.5', 0.5],
    ['1e2', 100],
    ['1in', 96],
    ['72pt', 96],
    ['1pc', 16],
    ['25.4mm', 96],
    ['2.54cm', 96],
    ['101.6Q', 96],
    ['2em', 32],
    ['1rem', 16],
    ['2ex', 16],
    ['10PX', 10],
  ])('%s → %d px', (value, px) => {
    expect(parseSvgLength(value)).toBeCloseTo(px, 6)
  })

  test.each(['', 'auto', '100%', '0', '-5', 'px', '10 px x', '1vw', 'constructor', null, undefined])(
    '%s は決まらない',
    (value) => {
      expect(parseSvgLength(value)).toBeNull()
    }
  )

  test('px の数値はそのまま返る', () => {
    fc.assert(
      fc.property(fc.double({ min: 0.001, max: 1e6, noNaN: true }), (n) => {
        expect(parseSvgLength(`${n}px`)).toBeCloseTo(n, 6)
      })
    )
  })
})

describe('parseViewBox', () => {
  test('空白・カンマ区切り', () => {
    expect(parseViewBox('0 0 100 50')).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    expect(parseViewBox('-10,-5, 20 ,10')).toEqual({ x: -10, y: -5, width: 20, height: 10 })
  })
  test.each(['0 0 0 10', '0 0 10', '0 0 a 10', '0 0 10 -1', ''])('%s は無効', (value) => {
    expect(parseViewBox(value)).toBeNull()
  })
})

describe('intrinsicSvgSize', () => {
  it('極端に大きい幅でも、比から割り戻した高さが無限大にならない（PBT で見つかった反例）', () => {
    const size = intrinsicSvgSize({ width: '1.348269851146737e+308', height: null, viewBox: '0 0 3 4' })
    expect(Number.isFinite(size.height) && size.height > 0).toBe(true)
  })

  test('width と height があればそれ', () => {
    expect(intrinsicSvgSize({ width: '2in', height: '1in', viewBox: '0 0 1 1' })).toEqual({ width: 192, height: 96 })
  })
  test('片方だけなら viewBox の縦横比で補う', () => {
    expect(intrinsicSvgSize({ width: '200', viewBox: '0 0 100 50' })).toEqual({ width: 200, height: 100 })
    expect(intrinsicSvgSize({ height: '200', viewBox: '0 0 100 50' })).toEqual({ width: 400, height: 200 })
  })
  test('% の width は viewBox に従う', () => {
    expect(intrinsicSvgSize({ width: '100%', height: '100%', viewBox: '0 0 64 32' })).toEqual({ width: 64, height: 32 })
  })
  test('何もなければ 300×150', () => {
    expect(intrinsicSvgSize({})).toEqual({ width: 300, height: 150 })
    expect(intrinsicSvgSize({ width: '40' })).toEqual({ width: 40, height: 150 })
  })
  test('結果はいつも正の有限の数', () => {
    const attr = fc.option(fc.oneof(fc.string(), fc.double().map(String), fc.constantFrom('10mm', '5%', '0 0 3 4')))
    fc.assert(
      fc.property(attr, attr, attr, (width, height, viewBox) => {
        const size = intrinsicSvgSize({ width, height, viewBox })
        for (const n of [size.width, size.height]) {
          expect(Number.isFinite(n)).toBe(true)
          expect(n).toBeGreaterThan(0)
        }
      })
    )
  })
})

describe('svgRasterSize', () => {
  const base = { width: 100, height: 50 }
  test('倍率・幅・DPI', () => {
    expect(svgRasterSize(base)).toEqual({ width: 100, height: 50 })
    expect(svgRasterSize(base, { scale: 2 })).toEqual({ width: 200, height: 100 })
    expect(svgRasterSize(base, { width: 640 })).toEqual({ width: 640, height: 320 })
    expect(svgRasterSize(base, { dpi: 192 })).toEqual({ width: 200, height: 100 })
    expect(svgRasterSize(base, { width: 30, scale: 4 })).toEqual({ width: 30, height: 15 })
  })
  test('読めない指定は 1 倍、結果は 1px 以上の整数', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.01, max: 5000, noNaN: true }),
        fc.double({ min: 0.01, max: 5000, noNaN: true }),
        fc.record({ scale: fc.option(fc.double(), { nil: undefined }), width: fc.option(fc.double(), { nil: undefined }) }),
        (width, height, options) => {
          const size = svgRasterSize({ width, height }, options)
          for (const n of [size.width, size.height]) {
            expect(Number.isInteger(n)).toBe(true)
            expect(n).toBeGreaterThanOrEqual(1)
          }
        }
      )
    )
  })
})

describe('isSvgFile / sniffSvg', () => {
  test('名前か MIME', () => {
    expect(isSvgFile({ name: 'a.SVG', type: '' })).toBe(true)
    expect(isSvgFile({ name: 'a', type: 'image/svg+xml' })).toBe(true)
    expect(isSvgFile({ name: 'a.xml', type: 'text/xml' })).toBe(false)
  })
  test('先頭の宣言・コメント・DOCTYPE を飛ばして svg を見る', () => {
    expect(sniffSvg('<svg/>')).toBe(true)
    expect(sniffSvg('\uFEFF<?xml version="1.0"?>\n<!-- x -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x">\n<svg:svg>')).toBe(true)
    expect(sniffSvg('<html><svg></svg></html>')).toBe(false)
    expect(sniffSvg('<svgfoo/>')).toBe(false)
    expect(sniffSvg('hello')).toBe(false)
  })
})

describe('decodeXmlEntities', () => {
  test('定義済みと数値の参照を解き、知らない名前は残す', () => {
    expect(decodeXmlEntities('&lt;&#104;&#x74;&amp;&custom;&constructor;&#0;')).toBe('<ht&&custom;&constructor;�')
  })
})

describe('sanitizeCss', () => {
  test.each([
    ['fill: url(http://evil.example/a.svg#g)', 'fill: none'],
    ["background: url('//evil.example/x.png')", 'background: none'],
    ['background: URL( "https://evil.example/x" )', 'background: none'],
    ['src: url(font.woff)', 'src: none'],
  ])('外部の url() を none にする: %s', (input, expected) => {
    expect(sanitizeCss(input)).toEqual({ css: expected, removed: 1 })
  })

  test('# と data: の url() は残す', () => {
    const css = 'fill: url(#grad); src: url("data:font/woff2;base64,AAAA")'
    expect(sanitizeCss(css)).toEqual({ css, removed: 0 })
  })

  test('@import は知らない at-rule にする', () => {
    const { css, removed } = sanitizeCss('@import "http://evil.example/a.css"; @IMPORT url(x.css);')
    expect(removed).toBeGreaterThanOrEqual(2)
    expect(css).not.toMatch(/@import/i)
    expect(css).not.toMatch(/x\.css/)
  })

  test('エスケープで隠した url( と @import も見つける', () => {
    const { css } = sanitizeCss('a{fill:\\75 rl(http://evil.example/)} @\\69mport "http://evil.example/b.css";')
    expect(css).not.toMatch(/url\(http/i)
    expect(css).not.toMatch(/@import/i)
  })

  test('image-set などの文字列で画像を指す関数を無効にする', () => {
    const { css, removed } = sanitizeCss('background: image-set("http://evil.example/a.png" 1x); b: -webkit-image-set("x" 1x)')
    expect(removed).toBe(2)
    expect(css).not.toMatch(/image-set\(/i)
  })

  test('@namespace の url() は読みに行かないので残す', () => {
    const css = '@namespace svg url(http://www.w3.org/2000/svg);'
    expect(sanitizeCss(css).removed).toBe(0)
  })
})

describe('sanitizeSvg', () => {
  test('ふつうの SVG はそのまま描ける形で返る', () => {
    const source = `<?xml version="1.0" encoding="UTF-8"?>\n${svg('<rect width="10" height="10" fill="url(#g)"/><text>a &amp; b &lt; c</text>', 'width="10mm" height="5mm"')}`
    const result = sanitizeSvg(source)
    expect(countRemovals(result.removed)).toBe(0)
    expect(result.intrinsic.width).toBeCloseTo(37.795, 3)
    expect(result.size).toEqual({ width: 38, height: 19 })
    expect(result.markup).toContain('<?xml version="1.0" encoding="UTF-8"?>')
    expect(result.markup).toContain('width="38" height="19" viewBox="0 0 37.795 18.898"')
    expect(result.markup).toContain('fill="url(#g)"')
    expect(result.markup).toContain('a &amp; b &lt; c')
  })

  test('viewBox があれば残し、大きさを書き換える', () => {
    const result = sanitizeSvg(svg('', 'viewBox="0 0 20 10"'), { scale: 3 })
    expect(result.size).toEqual({ width: 60, height: 30 })
    expect(result.markup).toMatch(/viewBox="0 0 20 10" width="60" height="30"/)
  })

  test('外部の画像を取り除き、data: の画像は残す', () => {
    const result = sanitizeSvg(
      svg('<image href="http://evil.example/a.png"/><image xlink:href="data:image/png;base64,AAAA"/><feImage href="//evil.example/b"/>')
    )
    expect(result.removed.externalReference).toBe(2)
    expect(result.markup).toContain('xlink:href="data:image/png;base64,AAAA"')
    expectNoExternal(result.markup)
  })

  test('スクリプトとイベントハンドラを取り除く', () => {
    const result = sanitizeSvg(
      svg('<script>fetch("http://evil.example")</script><svg:script xmlns:svg="http://www.w3.org/2000/svg"><![CDATA[alert(1)]]></svg:script><rect onclick="x()" ONLOAD="y()"/>', 'onload="fetch(\'http://evil.example\')" width="1" height="1"')
    )
    expect(result.removed.script).toBe(2)
    expect(result.removed.eventHandler).toBe(3)
    expect(result.markup).not.toMatch(/alert|fetch/)
    expectNoExternal(result.markup)
  })

  test('CSS の @import と外部の url() を無効にする（style 要素・style 属性・表示属性）', () => {
    const result = sanitizeSvg(
      svg(
        '<style>@import url(http://evil.example/a.css); @font-face { font-family: x; src: url("https://evil.example/f.woff") } rect { fill: url(#ok) }</style>' +
          '<rect style="background:url(http://evil.example/bg.png)" fill="url(http://evil.example/p.svg#g)"/>'
      )
    )
    // @import url(...) は @import と url() で 2 つに数える
    expect(result.removed.externalReference).toBe(5)
    expect(result.markup).toContain('fill: url(#ok)')
    expectNoExternal(result.markup)
  })

  test('style の中を CDATA・コメント・子要素で分けても、まとめて消毒する', () => {
    const result = sanitizeSvg(
      svg('<style>a { fill: url(<![CDATA[http://evil.example/x]]>) } b { fill: url(<!-- -->http://evil.example/y) } c { fill: url(<x/>http://evil.example/z) }</style>')
    )
    expect(result.removed.externalReference).toBe(3)
    expectNoExternal(result.markup)
  })

  test('外部を指す <use> を、入れ子でも取り除く', () => {
    const result = sanitizeSvg(
      svg('<defs><g id="a"><use href="http://evil.example/sprite.svg#icon"/></g></defs><use xlink:href="#a"/><g><g><use x:href="//evil.example/s.svg#i" xmlns:x="http://www.w3.org/1999/xlink"/></g></g>')
    )
    expect(result.removed.externalReference).toBe(2)
    expect(result.markup).toContain('xlink:href="#a"')
    expectNoExternal(result.markup)
  })

  test('foreignObject・iframe などの埋め込みを中身ごと取り除く', () => {
    const result = sanitizeSvg(
      svg('<foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><img src="http://evil.example/a.png"/></div></foreignObject><iframe src="http://evil.example"/>')
    )
    expect(result.removed.embeddedContent).toBe(2)
    expectNoExternal(result.markup)
  })

  test('href を外部へ書き換えるアニメーションを取り除く', () => {
    const result = sanitizeSvg(
      svg('<image><set attributeName="href" to="http://evil.example/a.png"/></image><use><animate attributeName="xlink:href" values="#a;#b"/></use><set attributeName="onclick" to="x()"/>')
    )
    expect(result.removed.externalReference).toBe(1)
    expect(result.removed.script).toBe(1)
    expect(result.markup).toContain('values="#a;#b"')
    expectNoExternal(result.markup)
  })

  test('DOCTYPE の実体と xml-stylesheet を捨てる', () => {
    const source = `<?xml version="1.0"?><?xml-stylesheet href="http://evil.example/a.css"?><!DOCTYPE svg [<!ENTITY x SYSTEM "http://evil.example/e"> <!ENTITY y "z>">]>${svg('<text>&x;</text>')}`
    const result = sanitizeSvg(source)
    expect(result.markup).not.toMatch(/DOCTYPE|ENTITY|stylesheet/)
    expect(result.markup).toContain('&amp;x;')
    expectNoExternal(result.markup)
  })

  test('リンクの href と xml:base は数えずに落とす', () => {
    const result = sanitizeSvg(svg('<a href="http://example.com" xml:base="http://evil.example/"><rect/></a>'))
    expect(countRemovals(result.removed)).toBe(0)
    expectNoExternal(result.markup)
  })

  test('文字参照で隠した外部の参照も見つける', () => {
    const result = sanitizeSvg(svg('<image href="&#104;ttp://evil.example/a.png"/><rect fill="&#x75;rl(http://evil.example/p)"/>'))
    expect(result.removed.externalReference).toBe(2)
    expectNoExternal(result.markup)
  })

  test('属性値の引用符や改行はエスケープし直す', () => {
    const result = sanitizeSvg(svg(`<text data-x='a"b&lt;c'>x</text>`))
    expect(result.markup).toContain('data-x="a&quot;b&lt;c"')
  })

  test.each([
    ['<html/>', 'root'],
    ['<svg><rect></svg', 'unterminated'],
    ['<svg width=10></svg>', 'unquoted'],
    ['<svg><g></svg>', 'unclosed'],
    ['<svg></svg><svg></svg>', 'two roots'],
    ['hello', 'no element'],
  ])('読めない形はエラーにする: %s (%s)', (source) => {
    expect(() => sanitizeSvg(source)).toThrow(SvgParseError)
  })

  test('どんな文字列でも、例外は SvgParseError だけで、通ったものは外へ出ない', () => {
    const pieces = fc.constantFrom(
      '<svg>',
      '</svg>',
      '<image href="http://evil.example/a"/>',
      '<script>',
      '</script>',
      '<style>',
      '</style>',
      'url(http://evil.example)',
      '@import "http://evil.example";',
      '<![CDATA[',
      ']]>',
      '<!--',
      '-->',
      '<g onload="x()">',
      '</g>',
      '<use href="#a"/>',
      'text',
      '&amp;',
      '"',
      '>'
    )
    fc.assert(
      fc.property(fc.array(pieces, { maxLength: 30 }), (parts) => {
        const source = parts.join('')
        try {
          const result = sanitizeSvg(source)
          expectNoExternal(result.markup)
          // 書き出したものは、もう一度通しても何も取り除かれない（解釈が一定）
          expect(countRemovals(sanitizeSvg(result.markup).removed)).toBe(0)
        } catch (error) {
          expect(error).toBeInstanceOf(SvgParseError)
        }
      }),
      { numRuns: 500 }
    )
  })
})

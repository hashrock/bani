import type { CropRect, ImageSize, Rotation } from '../../media/image'

/**
 * 切り抜き範囲をプレビューの上でドラッグするための座標計算。
 *
 * 利用者が見ているのは「回転・反転したあとの元画像」（以下、見た目の座標）だが、
 * レシピの crop は回転前の元画像の座標で持つ。ここで両者を行き来する。
 * ドラッグ中は小数のまま扱い、整数への丸めと範囲の制限は applyImageEdit に任せる。
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** レシピのうち、見た目の向きを決める部分 */
export interface Orientation {
  rotation: Rotation
  flipH: boolean
  flipV: boolean
}

/** 辺（n/s/e/w）と角（ne/nw/se/sw）のつまみ */
export type CropHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const CORNER_HANDLES: readonly CropHandle[] = ['nw', 'ne', 'se', 'sw']
export const EDGE_HANDLES: readonly CropHandle[] = ['n', 'e', 's', 'w']

/** 回転後の見た目の寸法 */
export function viewSize(info: ImageSize, rotation: Rotation): ImageSize {
  return rotation % 180 === 0 ? info : { width: info.height, height: info.width }
}

/**
 * 元画像の点を見た目の点へ。renderImage と同じく「時計回りに回してから反転」の順。
 * （Canvas の rotate は y 軸が下向きなので、正の角度が時計回りになる）
 */
export function sourcePointToView(p: Point, info: ImageSize, o: Orientation): Point {
  const { width: w, height: h } = info
  let q: Point
  switch (o.rotation) {
    case 0:
      q = p
      break
    case 90:
      q = { x: h - p.y, y: p.x }
      break
    case 180:
      q = { x: w - p.x, y: h - p.y }
      break
    case 270:
      q = { x: p.y, y: w - p.x }
      break
  }
  const view = viewSize(info, o.rotation)
  return { x: o.flipH ? view.width - q.x : q.x, y: o.flipV ? view.height - q.y : q.y }
}

/** 見た目の点を元画像の点へ（sourcePointToView の逆） */
export function viewPointToSource(p: Point, info: ImageSize, o: Orientation): Point {
  const { width: w, height: h } = info
  const view = viewSize(info, o.rotation)
  const q = { x: o.flipH ? view.width - p.x : p.x, y: o.flipV ? view.height - p.y : p.y }
  switch (o.rotation) {
    case 0:
      return q
    case 90:
      return { x: q.y, y: h - q.x }
    case 180:
      return { x: w - q.x, y: h - q.y }
    case 270:
      return { x: w - q.y, y: q.x }
  }
}

/** 回転・反転は 90 度単位なので、矩形は対角の 2 点を写せば矩形のまま移る */
function mapRect(rect: Rect, map: (p: Point) => Point): Rect {
  const a = map({ x: rect.x, y: rect.y })
  const b = map({ x: rect.x + rect.width, y: rect.y + rect.height })
  return normalize(a, b)
}

export function sourceRectToView(rect: CropRect, info: ImageSize, o: Orientation): Rect {
  return mapRect(rect, (p) => sourcePointToView(p, info, o))
}

export function viewRectToSource(rect: Rect, info: ImageSize, o: Orientation): Rect {
  return mapRect(rect, (p) => viewPointToSource(p, info, o))
}

/** 枠の内側に収まるように平行移動する（大きさは変えない） */
export function moveRect(rect: Rect, dx: number, dy: number, bounds: ImageSize): Rect {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, Math.max(0, bounds.width - rect.width)),
    y: clamp(rect.y + dy, 0, Math.max(0, bounds.height - rect.height)),
  }
}

/**
 * anchor を固定して point まで広げた矩形。point が anchor を越えれば向きが反転する。
 * aspect（幅 / 高さ）を指定すると、ポインタに近いほうの辺に合わせてもう一方を決める。
 * どの場合も bounds の内側に収まり、幅・高さは minSize 以上（bounds が許す限り）。
 */
export function spanRect(
  anchor: Point,
  point: Point,
  bounds: ImageSize,
  aspect: number | null,
  minSize = 1
): Rect {
  const ax = clamp(anchor.x, 0, bounds.width)
  const ay = clamp(anchor.y, 0, bounds.height)
  // 広げる向き。端に張り付いた anchor からは内側にしか広げられない
  let dirX = point.x >= ax ? 1 : -1
  let dirY = point.y >= ay ? 1 : -1
  if (room(ax, dirX, bounds.width) < minSize) dirX = -dirX
  if (room(ay, dirY, bounds.height) < minSize) dirY = -dirY
  const maxW = room(ax, dirX, bounds.width)
  const maxH = room(ay, dirY, bounds.height)

  let w = clamp(Math.abs(point.x - ax), Math.min(minSize, maxW), maxW)
  let h = clamp(Math.abs(point.y - ay), Math.min(minSize, maxH), maxH)
  if (aspect !== null && aspect > 0) {
    // ポインタが遠いほうの辺を優先し、そのあと枠からはみ出す辺に合わせて縮める
    if (w / aspect >= h) h = w / aspect
    else w = h * aspect
    if (w > maxW) {
      w = maxW
      h = w / aspect
    }
    if (h > maxH) {
      h = maxH
      w = h * aspect
    }
  }
  return {
    x: dirX > 0 ? ax : ax - w,
    y: dirY > 0 ? ay : ay - h,
    width: w,
    height: h,
  }
}

/**
 * つまみを (dx, dy) だけ動かしたあとの矩形。
 * 角は対角を固定して spanRect で広げる。辺は縦横比を保てないので、aspect の指定があれば動かさない
 * （画面でも縦横比を固定しているあいだは辺のつまみを出さない）。
 */
export function resizeRect(
  start: Rect,
  handle: CropHandle,
  dx: number,
  dy: number,
  bounds: ImageSize,
  aspect: number | null,
  minSize = 1
): Rect {
  const left = start.x
  const top = start.y
  const right = start.x + start.width
  const bottom = start.y + start.height
  const movesW = handle.includes('w')
  const movesE = handle.includes('e')
  const movesN = handle.includes('n')

  if (handle.length === 2) {
    const anchor = { x: movesW ? right : left, y: movesN ? bottom : top }
    const corner = { x: (movesW ? left : right) + dx, y: (movesN ? top : bottom) + dy }
    return spanRect(anchor, corner, bounds, aspect, minSize)
  }
  if (aspect !== null) return start

  if (movesW || movesE) {
    const fixed = movesW ? right : left
    const moved = clamp((movesW ? left : right) + dx, 0, bounds.width)
    const [x0, x1] = spanAxis(fixed, moved, bounds.width, minSize)
    return { ...start, x: x0, width: x1 - x0 }
  }
  const fixed = movesN ? bottom : top
  const moved = clamp((movesN ? top : bottom) + dy, 0, bounds.height)
  const [y0, y1] = spanAxis(fixed, moved, bounds.height, minSize)
  return { ...start, y: y0, height: y1 - y0 }
}

/** 枠の中央に置ける、指定の縦横比で最大の矩形 */
export function largestCenteredRect(bounds: ImageSize, aspect: number): Rect {
  const width = bounds.width / bounds.height > aspect ? bounds.height * aspect : bounds.width
  const height = width / aspect
  return { x: (bounds.width - width) / 2, y: (bounds.height - height) / 2, width, height }
}

/**
 * いまの矩形を、中心を保ったまま指定の縦横比に直す。収まらなければ枠いっぱいの最大に縮める。
 * 縦横比のプリセットを選んだときに、利用者が選んだ範囲からなるべく離れないようにするため
 */
export function fitAspect(rect: Rect, bounds: ImageSize, aspect: number): Rect {
  const area = rect.width * rect.height
  let width = Math.sqrt(area * aspect)
  let height = width / aspect
  const max = largestCenteredRect(bounds, aspect)
  if (width > max.width || height > max.height) {
    width = max.width
    height = max.height
  }
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  return moveRect({ x: cx - width / 2, y: cy - height / 2, width, height }, 0, 0, bounds)
}

// --- 内部 ---

function room(from: number, dir: number, limit: number): number {
  return dir > 0 ? limit - from : from
}

/** 1 軸の [始点, 終点]。動かした端が固定側を越えたら入れ替え、minSize は残す */
function spanAxis(fixed: number, moved: number, limit: number, minSize: number): [number, number] {
  if (moved >= fixed) {
    const end = Math.max(moved, Math.min(fixed + minSize, limit))
    return [Math.min(fixed, end - minSize), end]
  }
  const start = Math.min(moved, Math.max(fixed - minSize, 0))
  return [start, Math.max(fixed, start + minSize)]
}

function normalize(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

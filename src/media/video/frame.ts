import type { FrameDrawPlan } from './output'
import { computeFrameDrawPlan } from './output'
import type { VideoRecipe } from './types'

/**
 * 1 フレームを Canvas に描く（computeFrameDrawPlan の手順どおり）。
 * 両方の辺を指定して枠に余りが出るときは黒で埋め、MP4 / WebM（fit: 'contain'）と見た目を揃える。
 */
export function drawFrame(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  plan: FrameDrawPlan
): void {
  context.save()
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.fillStyle = '#000'
  context.fillRect(0, 0, plan.canvasWidth, plan.canvasHeight)
  context.translate(plan.canvasWidth / 2, plan.canvasHeight / 2)
  context.scale(plan.scaleX, plan.scaleY)
  context.rotate((plan.rotation * Math.PI) / 180)
  const { x, y, width, height } = plan.source
  context.drawImage(
    source,
    x,
    y,
    width,
    height,
    -plan.drawWidth / 2,
    -plan.drawHeight / 2,
    plan.drawWidth,
    plan.drawHeight
  )
  context.restore()
}


/**
 * いま <video> に映っているフレームを、切り抜き・回転・反転を掛けた PNG にする。
 * 拡大縮小はしない（切り抜き・回転後の原寸）。寸法は要素が実際にデコードした映像から取る。
 */
export async function captureFrame(video: HTMLVideoElement, recipe: VideoRecipe): Promise<Blob> {
  const plan = computeFrameDrawPlan(
    { dimensions: { width: video.videoWidth, height: video.videoHeight } },
    recipe,
    null
  )
  if (!plan) throw new Error('The video has no frame to capture')
  const canvas = document.createElement('canvas')
  canvas.width = plan.canvasWidth
  canvas.height = plan.canvasHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Failed to create a 2D canvas context')
  drawFrame(context, video, plan)
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode the frame as PNG'))),
      'image/png'
    )
  )
}

/** 静止画のファイル名。どの時点のフレームかを名前に残す（例: clip-00m03s250.png） */
export function frameFilename(name: string, time: number): string {
  const dot = name.lastIndexOf('.')
  const base = (dot > 0 ? name.slice(0, dot) : name) || 'frame'
  const safe = Number.isFinite(time) && time > 0 ? time : 0
  const minutes = Math.floor(safe / 60)
  const seconds = Math.floor(safe % 60)
  const millis = Math.floor((safe * 1000) % 1000)
  const pad = (value: number, length: number) => String(value).padStart(length, '0')
  return `${base}-${pad(minutes, 2)}m${pad(seconds, 2)}s${pad(millis, 3)}.png`
}

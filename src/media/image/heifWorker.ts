/**
 * HEIC / HEIF を libheif（WASM）で読む Worker。12MP の写真で約 1 秒かかるデコードを画面のスレッドから外す。
 * libheif はこの Worker の中でだけ読み込み、一度読めば Worker が止まるまで使い回す。
 * デコードした画素は Worker の中で ImageBitmap にし、写さずに渡す。やりとりの形は decode.ts を参照。
 */
import { serveWorkerRequests } from '../workerClient'
import { decodeHeifToImageData, probeHeif } from './heifLoader'
import type { HeifWorkerRequest, HeifWorkerResult } from './decode'

serveWorkerRequests<HeifWorkerRequest, HeifWorkerResult>(async (request) => {
  const bytes = new Uint8Array(await request.file.arrayBuffer())
  if (request.type === 'probe') return { value: await probeHeif(bytes) }
  const bitmap = await createImageBitmap(await decodeHeifToImageData(bytes))
  return { value: bitmap, transfer: [bitmap] }
})

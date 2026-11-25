/**
 * ZIP・tar.gz を作るときに、中身を読んで CRC を数え、縮める Worker。やりとりの形は compress.ts を参照。
 * 縮めた結果は Blob で返す（構造化複製しても中身は写されない）。
 */
import { serveWorkerRequests } from '../workerClient'
import { compressBlob, type CompressRequest, type CompressResult } from './compress'

/** 進み具合を送る間隔（バイト）。チャンクごとに送ると返事が多すぎて、受け取る側の手間になる */
const REPORT_EVERY = 1024 * 1024

serveWorkerRequests<CompressRequest, CompressResult>(async (request, report) => {
  let unreported = 0
  const value = await compressBlob(request, (bytes) => {
    unreported += bytes
    if (unreported >= REPORT_EVERY) {
      report(unreported)
      unreported = 0
    }
  })
  if (unreported > 0) report(unreported)
  return { value }
})

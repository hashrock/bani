/**
 * 7z・RAR を読む Worker。libarchive（WASM）はここでだけ読み込む。
 * 展開は同期的に CPU を使い切るので画面を止めないように Worker で動かし、中断は Worker ごと止めて行う。
 * やりとりの形は wasmArchive.ts を参照。
 */
import createLibarchive from 'libarchive.js/src/webworker/wasm-gen/libarchive.js'
import { ArchiveError } from './errors'
import { LibarchiveReader, type LibarchiveModule } from './libarchive'
import type { WorkerReply, WorkerRequest } from './wasmArchive'

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null
  postMessage(message: WorkerReply, transfer?: Transferable[]): void
}

let reader: LibarchiveReader | null = null

function replyError(error: unknown) {
  if (error instanceof ArchiveError) {
    scope.postMessage({ type: 'error', code: error.code, message: error.message, path: error.path })
  } else {
    scope.postMessage({ type: 'error', code: null, message: error instanceof Error ? error.message : String(error) })
  }
}

scope.onmessage = async ({ data: request }) => {
  try {
    switch (request.type) {
      case 'open': {
        let module: LibarchiveModule
        try {
          module = (await createLibarchive({ print() {}, printErr() {} })) as LibarchiveModule
        } catch (error) {
          throw new ArchiveError('engine-unavailable', `libarchive を読み込めませんでした: ${String(error)}`)
        }
        reader = new LibarchiveReader(module, new Uint8Array(await request.file.arrayBuffer()))
        scope.postMessage({ type: 'opened' })
        break
      }
      case 'list':
        scope.postMessage({ type: 'list', entries: reader!.list() })
        break
      case 'extract':
        reader!.extract(new Set(request.indices), (index, data) => {
          scope.postMessage({ type: 'data', index, data }, [data.buffer])
        })
        scope.postMessage({ type: 'done' })
        break
    }
  } catch (error) {
    replyError(error)
  }
}

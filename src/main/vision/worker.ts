/**
 * The vision utility process: `local-worker.ts` behind Electron's parent port.
 *
 * Its own process for three reasons, each measured or observable: the loaded model holds ~1 GB
 * that the editor should get back when search is idle (the host ends this process after two idle
 * minutes); a native fault in onnxruntime ends this process, not the editor; and main lowers its
 * priority (`os.setPriority`, inherited by the ffmpeg it spawns) so indexing yields to playback.
 *
 * The configuration arrives as the first argument, JSON: `{ modelDir, ffmpeg, ffprobe }`.
 */

import { localWorker, type IndexRequest, type WorkerConfig } from './local-worker'
import type { VisionWorkerReply, VisionWorkerRequest } from './protocol'

const config = JSON.parse(process.argv[2] ?? '{}') as WorkerConfig
const worker = localWorker(config)
const controllers = new Map<number, AbortController>()
const port = process.parentPort

function reply(message: VisionWorkerReply): void {
  port.postMessage(message)
}

async function handle(message: VisionWorkerRequest): Promise<void> {
  if (message.type === 'cancel') {
    controllers.get(message.id)?.abort()
    return
  }
  try {
    if (message.type === 'embedText') {
      const vectors = await worker.embedText(message.texts)
      reply({ type: 'result', id: message.id, ok: true, value: vectors.map((v) => Array.from(v)) })
      return
    }
    const controller = new AbortController()
    controllers.set(message.id, controller)
    try {
      const request: IndexRequest = message.request
      const frames = await worker.indexFile(request, (done) => reply({ type: 'frames', id: message.id, frames: done }), controller.signal)
      reply({ type: 'result', id: message.id, ok: true, value: frames })
    } finally {
      controllers.delete(message.id)
    }
  } catch (error) {
    reply({ type: 'result', id: message.id, ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

port.on('message', (event) => {
  void handle(event.data as VisionWorkerRequest)
})

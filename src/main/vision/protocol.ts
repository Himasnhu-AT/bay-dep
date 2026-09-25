/** The messages between main and the vision utility process (`worker.ts`, `host.ts`). */

import type { IndexRequest } from './local-worker'

export type VisionWorkerRequest =
  | { type: 'embedText'; id: number; texts: string[] }
  | { type: 'index'; id: number; request: IndexRequest }
  | { type: 'cancel'; id: number }

export type VisionWorkerReply =
  | { type: 'result'; id: number; ok: true; value: unknown }
  | { type: 'result'; id: number; ok: false; error: string }
  | { type: 'frames'; id: number; frames: number }

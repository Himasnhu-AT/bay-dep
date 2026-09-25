/**
 * Visual search over the user's own footage: "the shot with a dog on a beach".
 *
 * A SigLIP image/text encoder (Google's `siglip-base-patch16-224`, as ONNX from
 * `Xenova/siglip-base-patch16-224`) puts a frame and a sentence in one space, so a phrase can be
 * scored against what is *in* a frame. It runs on this Mac (`src/main/vision/`); frames, embeddings
 * and queries never leave it. The model is the only thing fetched, from Hugging Face, when the user
 * clicks Download in Preferences › Visual search or when indexing finds no model and "Download models
 * when needed" is on — the same exception, and the same verified download, as whisper's models.
 *
 * One module for both processes: main needs the URLs, sizes and hashes; the renderer needs the
 * label and size for Settings and the sentences the tools answer with. No Node, no DOM.
 *
 * Measured on an M5 Pro (onnxruntime-node 1.30.0, CPU, the scratch runs recorded in the W9
 * report), which is why these are the files:
 *
 * - **fp16, not int8.** The int8 vision tower downloads 99 MB instead of 186 MB and was barely
 *   faster (23.9 vs 26.9 ms/frame) — and its image embeddings fell to a mean cosine of 0.943
 *   against fp32 (min 0.891), agreeing on the top hit for only 5 of 12 queries over 45 real
 *   frames. fp16 embeddings match fp32 to a cosine of 1.0000 with the top five identical for
 *   every query. The int8 *text* tower was closer (min 0.994) and still moved 3 of 12 top hits.
 * - **fp16 over fp32**: half the download (407 MB against 813 MB), same answers, ~30 ms/frame.
 */

// -- the model --------------------------------------------------------------------------------

export interface VisionModelFile {
  /** The file's name in bay's model folder. */
  name: string
  /** Its path in the Hugging Face repository. */
  repoPath: string
  bytes: number
  /**
   * Pinned: the download must match, so a republished (or tampered) file is refused rather than
   * handed to onnxruntime's native parser. The two ONNX hashes are Hugging Face's own
   * `x-linked-etag` (LFS); all four were confirmed with `shasum -a 256` of real downloads.
   */
  sha256: string
}

export interface VisionModelSpec {
  /** Also the model folder's name, and part of every cache key: a new model is a new index. */
  id: string
  label: string
  repo: string
  /** A commit, never a branch: `main` can move under a pinned hash and fail every download. */
  revision: string
  files: readonly VisionModelFile[]
}

export const VISION_MODEL: VisionModelSpec = {
  id: 'siglip-base-patch16-224-fp16',
  label: 'SigLIP base',
  repo: 'Xenova/siglip-base-patch16-224',
  revision: '4649052661e53c7000355844105f8a1792088239',
  files: [
    { name: 'vision_model_fp16.onnx', repoPath: 'onnx/vision_model_fp16.onnx', bytes: 186_142_673, sha256: '7287a8e9cbf4f2eedd66e8dc5cf584be03108f4e4a24331879ac6ef7ac7c878f' },
    { name: 'text_model_fp16.onnx', repoPath: 'onnx/text_model_fp16.onnx', bytes: 220_867_426, sha256: 'ebffbfd71ae11b3f9df5233095815953f44b02ca241c317722edd8c49a9de0f6' },
    { name: 'tokenizer.json', repoPath: 'tokenizer.json', bytes: 2_398_744, sha256: '4a17c975210be5ab4c36b47d8dae4eefb866dbfb1e676e394aad85dc30a3ae08' },
    { name: 'preprocessor_config.json', repoPath: 'preprocessor_config.json', bytes: 368, sha256: '21ee046a8a52a65e5f9c177bf840bfb39ea66c9c54cf2760630efd58e0a3ec80' }
  ]
}

export const VISION_MODEL_BYTES = VISION_MODEL.files.reduce((sum, file) => sum + file.bytes, 0)

export function visionFileUrl(file: VisionModelFile, model: VisionModelSpec = VISION_MODEL): string {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file.repoPath}`
}

// -- preprocessing ----------------------------------------------------------------------------
//
// Every number is the checkpoint's own `preprocessor_config.json`, and none is a choice: squash
// (not crop) to 224×224 with bicubic, rescale by 1/255, normalise with mean 0.5 and std 0.5. A
// wrong one does not fail — it returns embeddings that are subtly worse. The encoder compares
// these with the downloaded config before it runs (`checkPreprocessorConfig`), so a model whose
// config disagrees is refused rather than fed the wrong pixels.

export const IMAGE_SIZE = 224
export const RESCALE_FACTOR = 1 / 255
export const IMAGE_MEAN = [0.5, 0.5, 0.5] as const
export const IMAGE_STD = [0.5, 0.5, 0.5] as const

/**
 * Null when `config` (the parsed `preprocessor_config.json`) asks for exactly what bay does;
 * otherwise what differs, in words.
 */
export function checkPreprocessorConfig(config: unknown): string | null {
  const c = (config ?? {}) as Record<string, unknown>
  const size = (c['size'] ?? {}) as Record<string, unknown>
  const near = (a: unknown, b: number): boolean => typeof a === 'number' && Math.abs(a - b) < 1e-9
  const triple = (value: unknown, expected: readonly number[]): boolean =>
    Array.isArray(value) && value.length === 3 && value.every((v, i) => near(v, expected[i]!))
  const problems: string[] = []
  if (!near(size['width'], IMAGE_SIZE) || !near(size['height'], IMAGE_SIZE)) problems.push(`size ${JSON.stringify(c['size'])}, not ${IMAGE_SIZE}×${IMAGE_SIZE}`)
  if (c['do_resize'] !== true) problems.push('no resize')
  // PIL's 3 is BICUBIC, which ffmpeg's `flags=bicubic` stands in for.
  if (c['resample'] !== 3) problems.push(`resample ${String(c['resample'])}, not bicubic (3)`)
  if (c['do_rescale'] !== true || !near(c['rescale_factor'], RESCALE_FACTOR)) problems.push(`rescale ${String(c['rescale_factor'])}, not 1/255`)
  if (c['do_normalize'] !== true || !triple(c['image_mean'], IMAGE_MEAN) || !triple(c['image_std'], IMAGE_STD)) {
    problems.push(`normalisation mean ${JSON.stringify(c['image_mean'])} std ${JSON.stringify(c['image_std'])}, not 0.5/0.5`)
  }
  return problems.length === 0 ? null : `The visual search model's preprocessing is not what bay implements: ${problems.join('; ')}.`
}

/**
 * RGB24 bytes of one 224×224 frame (what ffmpeg writes) → the CHW float planes the vision tower
 * takes: `(v · rescale − mean) / std`, per channel.
 */
export function rgbToPlanes(rgb: Uint8Array, out: Float32Array = new Float32Array(3 * IMAGE_SIZE * IMAGE_SIZE), offset = 0): Float32Array {
  const plane = IMAGE_SIZE * IMAGE_SIZE
  if (rgb.length < plane * 3) throw new Error(`A frame is ${plane * 3} bytes; this one is ${rgb.length}.`)
  for (let c = 0; c < 3; c++) {
    const scale = RESCALE_FACTOR / IMAGE_STD[c]!
    const shift = -IMAGE_MEAN[c]! / IMAGE_STD[c]!
    const base = offset + c * plane
    for (let i = 0; i < plane; i++) out[base + i] = rgb[i * 3 + c]! * scale + shift
  }
  return out
}

// -- sampling ---------------------------------------------------------------------------------

/** One frame every two seconds of video: a shot shorter than that is rarely the one asked for. */
export const SAMPLE_INTERVAL_US = 2_000_000

/**
 * How many frames indexing a file of this length takes: an image (or a file with no length) is
 * one, a video one per interval from its first frame.
 */
export function expectedSamples(durationUs: number, intervalUs: number = SAMPLE_INTERVAL_US): number {
  if (!Number.isFinite(durationUs) || durationUs <= 0) return 1
  return Math.max(1, Math.ceil(durationUs / intervalUs))
}

/**
 * Whether frames sampled from keyframes alone left a hole wider than two intervals — then the
 * file is sampled again by decoding every frame. Keyframe-only decoding is ~8× cheaper (measured:
 * 0.78 s against 6.47 s for five minutes of 1080p H.264 with a 2 s GOP), but a long-GOP file (a
 * screen recording with a keyframe every ten seconds) would otherwise be indexed at one frame per
 * GOP and miss what happens between.
 */
export function needsFullDecode(timesUs: readonly number[], durationUs: number, intervalUs: number = SAMPLE_INTERVAL_US): boolean {
  if (!Number.isFinite(durationUs) || durationUs <= intervalUs) return timesUs.length === 0
  if (timesUs.length === 0) return true
  const limit = 2 * intervalUs
  let previous = 0
  for (const t of [...timesUs].sort((a, b) => a - b)) {
    if (t - previous > limit) return true
    previous = t
  }
  return durationUs - previous > limit
}

/**
 * The frames an index pass keeps: the first, then each frame at least one interval after the last
 * kept. Its filter names are asked of the vendored ffmpeg by `capabilities.test.ts`; `showinfo`
 * prints each kept frame's time, and comes before the scale so the time is the source's.
 */
export function sampleFilter(intervalUs: number = SAMPLE_INTERVAL_US): string {
  const seconds = intervalUs / 1_000_000
  return (
    `select='isnan(prev_selected_t)+gte(t-prev_selected_t\\,${seconds})',showinfo,` +
    `scale=${IMAGE_SIZE}:${IMAGE_SIZE}:flags=bicubic+accurate_rnd+full_chroma_int,format=rgb24`
  )
}

// -- ranking ----------------------------------------------------------------------------------

/**
 * Cosine similarity of two unit vectors, which is their dot product. Lengths that disagree score
 * 0 — an embedding from another model is a caller bug that should read as "nothing matched", not
 * crash a search.
 */
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length) return 0
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!
  return Number.isFinite(sum) ? sum : -Infinity
}

/** L2-normalised copy. A zero vector stays zero (it then scores 0 against everything). */
export function normalise(values: ArrayLike<number>): Float32Array {
  let norm = 0
  for (let i = 0; i < values.length; i++) norm += values[i]! * values[i]!
  norm = Math.sqrt(norm)
  const out = new Float32Array(values.length)
  for (let i = 0; i < values.length; i++) out[i] = norm > 1e-12 ? values[i]! / norm : 0
  return out
}

export interface FrameCandidate {
  key: string
  us: number
  vector: ArrayLike<number>
}

export interface RankedFrame {
  key: string
  us: number
  score: number
}

/**
 * Two hits closer than this in one file are one moment: the second is the same shot again.
 * Without it, a ten-second shot of the dog fills the top five with itself.
 */
export const SAME_MOMENT_US = 4_000_000

export interface Ranking {
  hits: RankedFrame[]
  /**
   * Top score minus the median over every frame searched. SigLIP's scores are not calibrated —
   * 0.05 can be exactly right — so the useful signal is whether the winner stands apart. Near
   * zero means everything is equally unrelated to the query.
   */
  separation: number
  searched: number
}

/**
 * Score every frame against `query` and keep the best `limit`, at most one per moment of each
 * file (`SAME_MOMENT_US`). A non-finite score sorts last rather than scrambling the order.
 */
export function rankFrames(query: ArrayLike<number>, candidates: readonly FrameCandidate[], limit: number, exclude?: (c: FrameCandidate) => boolean): Ranking {
  const scored = candidates
    .filter((c) => !exclude?.(c))
    .map((c) => ({ key: c.key, us: c.us, score: cosine(query, c.vector) }))
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key) || a.us - b.us)
  const hits: RankedFrame[] = []
  for (const hit of scored) {
    if (hits.length >= limit) break
    if (!Number.isFinite(hit.score)) break
    if (hits.some((h) => h.key === hit.key && Math.abs(h.us - hit.us) < SAME_MOMENT_US)) continue
    hits.push({ ...hit, score: Math.round(hit.score * 10_000) / 10_000 })
  }
  const median = scored.length > 0 ? scored[Math.floor(scored.length / 2)]!.score : 0
  const top = scored[0]?.score ?? 0
  const separation = scored.length > 0 && Number.isFinite(top) && Number.isFinite(median) ? Math.round((top - median) * 10_000) / 10_000 : 0
  return { hits, separation, searched: scored.length }
}

// -- what the tools and Settings say ----------------------------------------------------------

export function formatModelBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  return `${Math.round(bytes / 1e6)} MB`
}

/** Why visual search cannot run yet, and how to make it: one sentence, built in one place. */
export const VISION_NOT_INSTALLED =
  `Visual search needs its model (${VISION_MODEL.label}, ${formatModelBytes(VISION_MODEL_BYTES)}), which is not downloaded yet. ` +
  'Open Settings (⌘,) → Visual search and click Download, or turn on "Download models when needed" there, then try again.'

/**
 * The cost of one sampled frame, decode and embed together, for an estimate. Measured end to end
 * through `VisionService` on an M5 Pro, five minutes of 1080p H.264 plus a 24 s clip (162 frames,
 * model load included): 46.4 ms/frame when keyframes suffice (2 s GOP), 67.2 ms/frame when every
 * frame must be decoded (10 s GOP). 60 is between, leaning to the slow side.
 */
export const ESTIMATED_MS_PER_FRAME = 60

/** "about 3 minutes" — an estimate reads as one, never as a promise to the second. */
export function describeDuration(seconds: number): string {
  if (seconds < 60) {
    const whole = Math.max(1, Math.round(seconds))
    return `about ${whole} second${whole === 1 ? '' : 's'}`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? '' : 's'}`
  return `about ${(seconds / 3600).toFixed(1)} hours`
}

// -- the contract between the renderer and main -----------------------------------------------

/** A file the renderer asks main to index or search: the project's asset, by path. */
export interface VisionAssetRef {
  assetId: string
  name: string
  path: string
  kind: 'video' | 'image'
  /** The file's length; 0 for an image. */
  durationUs: number
}

/**
 * The model download, as the sentence Settings shows for it:
 * downloading → "SigLIP base — 42 MB of 409 MB"; verifying → "Checking the download…";
 * done → "Downloaded"; failed → "Download failed: <error>"; cancelled → "Download cancelled".
 */
export interface VisionDownload {
  state: 'downloading' | 'verifying' | 'done' | 'failed' | 'cancelled'
  receivedBytes: number
  totalBytes: number
  error?: string
  reason: 'user' | 'index'
}

/**
 * The indexing job. Sentences:
 * running, download → "Waiting for the visual search model to download before indexing 12 files.";
 * running, planning → "Checking which files need indexing: 5 of 12 checked, 3 to index, 2 already indexed.";
 * running, indexing → "Indexing Beach.mov — 3 of 12 files, 140 frames so far; 2 already indexed.";
 * done → "12 of 12 files indexed (600 frames)." or "All 12 files were already indexed.";
 * cancelled → "Indexing stopped after 3 of 12 files."; failed → "Indexing did not start: <why>".
 * Files that could not be read — missing, not a file, or refused by ffmpeg or the model — are
 * listed by name with their own words, and count among `filesTotal`/`filesDone`.
 *
 * The job answers at once and does its slow parts itself: the model download (409 MB) and the
 * check of which files are already indexed (a hash of three MiB per file) both happen inside it,
 * so `index_footage` never waits on either.
 */
export interface VisionIndexJob {
  state: 'running' | 'done' | 'cancelled' | 'failed'
  /** What a running job is doing: waiting for the model, checking files, or indexing them. */
  phase: 'download' | 'planning' | 'indexing'
  /** Files asked for and not yet checked. */
  checking: number
  /** Files checked and found indexed already: nothing to do for them. */
  alreadyIndexed: number
  /** Files checked and to be indexed (or found unreadable). Grows while files are checked. */
  filesTotal: number
  filesDone: number
  framesDone: number
  current: string | null
  failed: { assetId: string; name: string; error: string }[]
  /** Why a `failed` job never started (the model download failed). */
  error?: string
  startedAt: number
  finishedAt: number | null
}

const files = (n: number): string => `${n} file${n === 1 ? '' : 's'}`

/** One line for the job, the sentence `VisionIndexJob` was written from. */
export function describeJob(job: VisionIndexJob): string {
  const failed = job.failed.length > 0 ? ` ${job.failed.length} could not be read: ${job.failed.map((f) => `${f.name} (${f.error})`).join('; ')}.` : ''
  const already = job.alreadyIndexed > 0 ? `; ${job.alreadyIndexed} already indexed` : ''
  switch (job.state) {
    case 'running':
      if (job.phase === 'download') return `Waiting for the visual search model to download before indexing ${files(job.checking + job.filesTotal)}.`
      if (job.phase === 'planning') {
        const checked = job.alreadyIndexed + job.filesTotal
        return `Checking which files need indexing: ${checked} of ${checked + job.checking} checked, ${job.filesTotal - job.failed.length} to index${already}.${failed}`
      }
      return `Indexing${job.current ? ` ${job.current}` : ''} — ${job.filesDone} of ${files(job.filesTotal)}, ${job.framesDone} frames so far${already}.${failed}`
    case 'cancelled':
      return `Indexing stopped after ${job.filesDone} of ${files(job.filesTotal)}${already}.${failed}`
    case 'failed':
      return `Indexing did not start: ${job.error ?? 'unknown error'}`
    case 'done':
      if (job.filesTotal === 0) return job.alreadyIndexed > 0 ? `All ${files(job.alreadyIndexed)} ${job.alreadyIndexed === 1 ? 'was' : 'were'} already indexed.` : 'There was nothing to index.'
      return `${job.filesDone - job.failed.length} of ${files(job.filesTotal)} indexed (${job.framesDone} frames)${already}.${failed}`
  }
}

export interface VisionStatus {
  installed: boolean
  /** Where the model lives (or will), for Settings to show. */
  modelDir: string
  bytesOnDisk: number
  download: VisionDownload | null
  index: VisionIndexJob | null
}

export interface VisionIndexPlan {
  /** Files asked about. */
  files: number
  /** Already indexed for this model: nothing to do. */
  indexed: number
  toIndex: number
  /** Frames the files still to index will take, and roughly how long. */
  frames: number
  estimatedSeconds: number
  /** Files that cannot be indexed (missing on disk), by asset id, with why. */
  unavailable: { assetId: string; name: string; error: string }[]
}

/**
 * A dry run answers with the plan (it hashes the files, so it is the one slow answer); a real
 * request answers at once with the job, which plans and — when `downloading` — waits for the
 * model itself.
 */
export type VisionIndexAnswer =
  | { ok: true; started: false; plan: VisionIndexPlan; job: VisionIndexJob | null }
  | { ok: true; started: true; downloading: boolean; job: VisionIndexJob }
  | { ok: false; error: string }

export interface VisionSearchRequest {
  assets: VisionAssetRef[]
  /** A description; or… */
  query?: string
  /** …a frame of an indexed file to find others like. */
  similarTo?: { assetId: string; us: number }
  limit: number
}

export interface VisionHit {
  assetId: string
  us: number
  score: number
}

export type VisionSearchAnswer =
  | {
      ok: true
      hits: VisionHit[]
      separation: number
      framesSearched: number
      /** Asked about but not indexed yet (or indexed by another model): not searched. */
      unindexed: string[]
      /** For `similarTo`: the indexed frame actually used, which is the nearest to the time asked. */
      reference?: { assetId: string; us: number }
    }
  | { ok: false; error: string }

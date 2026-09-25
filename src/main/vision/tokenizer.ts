/**
 * SigLIP's text tokenizer: canonicalise, Metaspace, SentencePiece Unigram, `</s>`, pad to 64.
 *
 * Written here rather than taken from `@huggingface/transformers`, whose tokenizer is the only
 * part of that package bay would use and which brings `sharp` (a second native module) and
 * onnxruntime-web with it. The reference it was checked against *is* that tokenizer, over the
 * canonicalised text: identical ids for every string in the differential run recorded in
 * `tokenizer.test.ts` (which repeats it whenever the real `tokenizer.json` is on this machine).
 *
 * Two rules that are easy to get wrong and fail silently:
 *
 * - **Canonicalise first.** The reference Python `SiglipTokenizer` lowercases and strips
 *   punctuation before SentencePiece sees the text; the exported `tokenizer.json` (and so
 *   transformers.js) does neither. The checkpoint was trained on canonical text, never a capital
 *   letter, so "A Dog" and "a dog" must be the same ids.
 * - **Pad to exactly 64 with `</s>` (id 1).** The text tower reads the hidden state at the *last*
 *   position; a different length reads a different position, and the embedding is quietly wrong
 *   rather than obviously broken (measured in the Rust engine, `rust-engine-final`).
 *
 * No Electron import.
 */

export const TEXT_TOKENS = 64
export const EOS_ID = 1
export const PAD_ID = 1
const UNK_PENALTY = 10

/**
 * What the reference SiglipTokenizer does to a string before tokenising: lowercase, drop
 * punctuation without leaving a space ("state-owned" → "stateowned"), collapse whitespace.
 * The same rule as the Rust engine's `canonicalize`, which was checked against the Python one.
 */
export function canonicalize(text: string): string {
  let out = ''
  let pendingSpace = false
  for (const ch of text.normalize('NFKC')) {
    if (/\s/u.test(ch)) {
      pendingSpace = out.length > 0
    } else if (/[\p{L}\p{N}]/u.test(ch)) {
      if (pendingSpace) {
        out += ' '
        pendingSpace = false
      }
      out += ch.toLowerCase()
    }
  }
  return out
}

interface TokenizerJson {
  model?: { type?: string; unk_id?: number; vocab?: [string, number][] }
}

export interface Tokenizer {
  /** Ids for one string, canonicalised, ended with `</s>` and padded to `TEXT_TOKENS`. */
  encode(text: string): number[]
  /** The pieces before padding — for a test to read. */
  pieces(text: string): string[]
}

/** Read `tokenizer.json` (the Hugging Face tokenizers format). Throws in words when it is not a Unigram model. */
export function loadTokenizer(json: string | TokenizerJson): Tokenizer {
  const parsed: TokenizerJson = typeof json === 'string' ? (JSON.parse(json) as TokenizerJson) : json
  const model = parsed.model
  if (model?.type !== 'Unigram' || !Array.isArray(model.vocab) || model.vocab.length === 0) {
    throw new Error('The visual search tokenizer file is not a SentencePiece Unigram model. Delete the model in Settings › Visual search and download it again.')
  }
  const unkId = model.unk_id ?? 2
  const ids = new Map<string, number>()
  const scores: number[] = []
  let maxLength = 0
  let minScore = Infinity
  model.vocab.forEach(([piece, score], id) => {
    // The first occurrence wins, as in the reference trie.
    if (!ids.has(piece)) ids.set(piece, id)
    scores[id] = score
    if (score < minScore) minScore = score
    maxLength = Math.max(maxLength, [...piece].length)
  })
  const unkScore = minScore - UNK_PENALTY

  /** Viterbi over one pre-token: the segmentation with the highest total score. */
  function segment(word: string): { id: number; piece: string }[] {
    const chars = [...word]
    const n = chars.length
    const best = new Array<number>(n + 1).fill(-Infinity)
    const from = new Array<{ start: number; id: number }>(n + 1)
    best[0] = 0
    for (let end = 1; end <= n; end++) {
      for (let start = Math.max(0, end - maxLength); start < end; start++) {
        if (best[start] === -Infinity) continue
        const piece = chars.slice(start, end).join('')
        const id = ids.get(piece)
        if (id === undefined) continue
        const score = best[start]! + (scores[id] ?? 0)
        if (score > best[end]!) {
          best[end] = score
          from[end] = { start, id }
        }
      }
      // A character nothing covers becomes <unk>, at the reference's penalty.
      if (best[end] === -Infinity && best[end - 1] !== -Infinity) {
        best[end] = best[end - 1]! + unkScore
        from[end] = { start: end - 1, id: unkId }
      }
    }
    const out: { id: number; piece: string }[] = []
    for (let end = n; end > 0; ) {
      const step = from[end]!
      out.push({ id: step.id, piece: chars.slice(step.start, end).join('') })
      end = step.start
    }
    out.reverse()
    // Consecutive unknowns fuse into one, as the reference Unigram does.
    return out.filter((token, i) => !(token.id === unkId && out[i - 1]?.id === unkId))
  }

  function tokens(text: string): { id: number; piece: string }[] {
    const canonical = canonicalize(text)
    if (canonical === '') return []
    // Metaspace with prepend "always": every word becomes ▁word, and each is segmented alone.
    return canonical.split(' ').flatMap((word) => segment(`▁${word}`))
  }

  return {
    pieces: (text) => tokens(text).map((t) => t.piece),
    encode(text) {
      const body = tokens(text).map((t) => t.id).slice(0, TEXT_TOKENS - 1)
      const ids = [...body, EOS_ID]
      while (ids.length < TEXT_TOKENS) ids.push(PAD_ID)
      return ids
    }
  }
}

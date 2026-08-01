# Team Sync — Editor Codebase Audit (classic → vii)

**Context:** The scaffold was replaced with the real OpenCut editor codebase (cloned from
`opencut-classic`). This audit maps the *actual, working* editor so we can implement requested
features on solid ground. Coordination is file-system only, under `docs/audit/`.

**Started:** 2026-08-01

---

## Why this audit exists (feature goals it must inform)

The following features are queued for implementation; the audit must locate exactly where each
lives so implementation is grounded, not guesswork:

1. **Background color** — set a project/canvas background color.
2. **Audio extractor + keyframes** — extract audio from video; keyframeable.
3. **More text + effects** — extend text elements and the effects system.
4. **Save effects as motion graphics** — persist effect/animation presets ("motion graphics").
5. **Test coverage** for all of the above.
6. **Desktop version?** — determine what the `apps/desktop` target actually is here.

---

## Task Board

| # | Task | Owner | Output | Status |
|---|------|-------|--------|--------|
| 1 | State creation | Lead | `docs/audit/team_sync.md` | ✅ done |
| 2 | Repository exploration (structure, entry points, subsystems) | Explore | `docs/audit/repo_map.md` | ✅ done |
| 3 | Feature / data-flow / mechanics map (editor, timeline, effects, keyframes, storage, WASM) | Agent 1 | `docs/audit/features.md` | ✅ done |
| 4 | Limitations / bottlenecks / tech debt / test coverage | Agent 2 | `docs/audit/limitations.md` | ✅ done |
| 5 | Feature-implementation recon (where each of the 6 goals lands) | Agent 3 | `docs/audit/feature-hooks.md` | ✅ done |
| 6 | Synthesis → `ARCHITECTURE.md` (root) | Lead | `ARCHITECTURE.md` | ✅ done |

---

## ✅ Audit complete

Artifacts on disk: `repo_map.md`, `features.md`, `limitations.md`, `feature-hooks.md` →
synthesized into root `ARCHITECTURE.md`. Headline: features 1 (background color) & 2 (audio
extractor + volume keyframes) already ship end-to-end; 3 is additive TS (+ Rust for a new GPU
effect); 4 (motion-graphics presets) is greenfield. Blocking decision: test runner (bun vs vitest).

---

## Protocol

- Every agent reads `docs/audit/repo_map.md` first.
- Findings go to the agent's own discrete file — no cross-writes.
- **Do not overwrite the repo's existing `docs/` content** — audit artifacts live in `docs/audit/`.
- Lead synthesizes only from on-disk artifacts.

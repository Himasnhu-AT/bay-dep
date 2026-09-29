# r&d

Research and experiments on making bay's edits entertaining, and on proving it with public before/after
comparisons.

**Start with [`MEMORY.md`](MEMORY.md).** It holds the shared context, current state, decisions and the
handoff protocol.

| Path | What |
|---|---|
| `MEMORY.md` | Central memory: state, decisions, open questions, log. Read first, update last. |
| `plan.md` | Phases from research to a deployed `/compare` page, plus the first comparison set. |
| `research/` | Research docs: retention editing, golden ratio, GitHub repos, launch-film motion, Apple style, website/deploy plan. |
| `sources/sample-footage.md` | Where to get raw footage we may edit and publish, with licences verified. |
| `clips/<slug>/` | One folder per comparison: `SOURCE.md`, `brief.md`, `RESULT.md`. Media stays outside git. |
| `case-studies/` | Finished experiments with lessons (first: `redassay-attest/`). |
| `tools/` | CDP recording tools: screencast, long-take streaming, file drop, the cursor + 3D camera injector. |

**Rules:**
- The root `CLAUDE.md` applies here: stage explicit paths, never `git add -A`, and no Prettier.
- Keep media out of git.

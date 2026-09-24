# update.md — bring every dependency to its latest stable version

You are a fresh Claude instance. Your job: move every dependency in this repo to its **latest
stable** release, for performance and security, without breaking anything the gates can see and
without letting a gate go quietly blind. Read `CLAUDE.md` first. It is long, and every rule in it
applies to you, especially **never `git add -A`**, **no Prettier**, and **build before you probe**.

The inventory below was measured on 2026-09-23. **Re-measure before acting.** A version written
here is a claim about that day, not about today.

```bash
pnpm outdated                      # root app
pnpm audit
(cd website && pnpm outdated && pnpm audit)
pnpm view pnpm version             # the package manager itself
```

## Scope

There are exactly two manifests. Everything else named `package.json` is generated or someone
else's:

| Manifest | What it is | Lockfile |
|---|---|---|
| `package.json` | the Electron app | `pnpm-lock.yaml` |
| `website/package.json` | Next.js marketing site, independent of the app | `website/pnpm-lock.yaml` |

**Leave these alone:** `.claude/worktrees/*` (other agents' worktrees, not yours),
`website/.next/**` (build output), `node_modules`, `out/`, `release/`, `dist/`. `script/` and
`assets/` hold Python helpers with no requirements file, so there is nothing to bump there.

**Do not turn the repo into a pnpm workspace while you do this.** That was considered and
rejected on purpose; see "Why not a workspace" at the bottom.

## Inventory as of 2026-09-23

### Root app

| Package | Installed | Latest | Kind | Risk |
|---|---|---|---|---|
| electron | 41.10.7 (pinned exactly) | 44.4.3 | major ×3 | **highest.** Runtime, Chromium, bundled Node |
| typescript | 5.9.3 | 7.0.2 | major ×2 | **high.** TS 7 is the native (Go) compiler; config options were removed |
| vite | 7.3.6 | 8.3.0 | major | high. Bundler engine changed (Rolldown) |
| electron-vite | 4.0.1 | 5.0.0 | major | high. Must match the vite major |
| @vitejs/plugin-react | 5.2.0 | 6.1.1 | major | moves with vite 8 |
| lucide-react | 0.545.0 | 1.47.0 | major | icon renames and removals |
| @types/node | 24.13.4 | 26.6.2 | major | **read the rule below before touching** |
| tailwind-merge | 3.6.0 | 3.7.0 | minor | low |
| @anthropic-ai/claude-agent-sdk | 0.3.278 | 0.3.280 | patch, but 0.x | medium. The agent sandbox is pinned by tests |
| ffmpeg-ffprobe-static | 6.1.2-rc.1 | 6.1.2-rc.1 | none | see the ffmpeg section |
| @electron-toolkit/*, electron-builder | current | current | — | none |

`pnpm audit` at the root: **no known vulnerabilities.**

### website/

| Package | Installed | Latest | Note |
|---|---|---|---|
| next, eslint-config-next | 16.3.0 | 16.3.5 | **two CRITICAL advisories** (unauthenticated RCE: image optimisation, and a Windows-hosted serve). Fixed in ≥16.3.3 |
| react, react-dom | 19.2.8 | 19.3.0 | minor |
| @types/react, @types/react-dom | 19.2.x | 19.3.0 | minor |
| eslint | 9.39.5 | 10.11.0 | major. Flat-config changes; check `eslint.config.mjs` |
| typescript | 5.9.3 | 7.0.2 | major, same caveats as the root |
| @types/node | 20.19.43 | 26.6.2 | major |

Transitive **high** advisories in website/: `nanoid <3.3.18` (via postcss), `sharp <0.35.4`
(via next), `js-yaml <4.3.2` (via eslint). Bumping next/eslint may clear them. For any that
survive, add a `pnpm.overrides` entry and **re-run `pnpm audit` to prove it cleared**. An
override you did not verify is not a fix.

**Do website/ first.** It carries the only real security exposure, it is independent of the
app, and it is the cheapest win.

## Order of work (root app)

One group per commit. Stage explicit paths, run all gates between groups, and never batch two
risky majors into one commit, because a bisect has to be able to separate them.

1. **Trivial:** `tailwind-merge`, `@anthropic-ai/claude-agent-sdk`. Then run the gates.
2. **`lucide-react` 1.x.** Collect every imported icon name (the names inside the braces of each
   `import { … } from 'lucide-react'` under `src/renderer`) and confirm each is still exported.
   Some icons were renamed or removed in 1.x. Typecheck on the web project catches a missing
   export, but check the count of files it checked too (see the TypeScript section).
3. **vite 8 + electron-vite 5 + @vitejs/plugin-react 6**, together, since they are one unit.
   Watch `electron.vite.config.ts`: it has **two main entries** (app + the standalone MCP proxy
   at `out/main/mcp/index.js`) and **two preloads, emitted as CJS `.cjs`**, because the composition
   window is sandboxed. After building, verify those four files exist with those exact names and
   formats, and check that `out/preload/composition.cjs` really is CommonJS. A preload that
   silently turned into ESM fails only at runtime, only in a composition window.
4. **Electron 41 → 44.** Do this on its own. See the Electron section.
5. **TypeScript 7.** Do this last and on its own. See the TypeScript section. If TS 7 cannot
   typecheck this tree cleanly, **stop at the newest 5.x/6.x that can** and write down why. A
   green `tsc` from a compiler that silently skipped files is worse than an old compiler.

## The rules that will bite

### @types/node follows Electron's Node, not your shell's

Tests run under the system Node (v26.5.0 here), but the **main process runs on the Node inside
Electron**: `24.18.0` for Electron 41 (Chromium 146). `@types/node` describes the runtime the
shipped code calls, so it should match **Electron's** Node major. Measure it, don't guess it:

```bash
ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron -p 'process.versions.node + " " + process.versions.chrome'
```

Run that again *after* the Electron bump and set `@types/node` to that major. Bumping it to 26
because `pnpm outdated` says so would let main-process code typecheck against APIs the shipped
runtime does not have. `node:sqlite` (the project database, `src/main/project/db.ts`) is the API
most likely to differ between Node majors, so check its surface explicitly.

### Electron

- `package.json` pins `electron` **exactly** (`41.10.7`, no caret). Keep it exact at the new
  version, because a pinned Chromium is the point.
- Read the breaking-changes notes for 42, 43 and 44, and grep the tree for each removed or
  changed API, not just the ones you expect.
- `electron-builder.yml` flips fuses (`runAsNode: true` is load-bearing: the MCP proxy runs the
  binary as Node) and relies on `resetAdHocDarwinSignature`. Run `pnpm bundle` and **launch the
  bundled app**. An unsigned bundle that dies with exit 137 on Apple silicon is a signature/fuse
  problem, not a code problem.
- `asarUnpack` names `node_modules/ffmpeg-ffprobe-static/**` and
  `node_modules/@anthropic-ai/claude-agent-sdk-*/**`. After any bump, confirm those paths still
  exist in `release/*/…/app.asar.unpacked`. A packaging bug here shows up only in a packaged build.
- Composition windows are sandboxed with a request filter (`src/main/html/sandbox.ts`), and CDP
  probes use `--remote-debugging-port`. Both are exercised by the probes, so run them.

### TypeScript 7

- Both tsconfigs use `baseUrl` + `paths` (`@shared/*`, `@/*`). `baseUrl` was deprecated in 6.0
  and is expected to be gone in 7. `paths` resolves relative to the tsconfig without it. Remove it
  and **prove the aliases still resolve**: introduce a deliberate type error in a file imported
  through `@shared/...` and confirm `pnpm typecheck` reports it, then revert. Otherwise an alias
  that resolves to nothing can come out as `any` and pass.
- `@electron-toolkit/tsconfig` 2.0.0 is the base of both configs. Check that every option it sets
  still exists in TS 7.
- `pnpm typecheck` covers **only** `src/main/**`, `src/preload/**`, `src/shared/**` (node project)
  and `src/renderer/src/**` (web project). Record the file count each project checks before the
  bump (`tsc -p tsconfig.node.json --listFilesOnly | wc -l`, same for web) and compare after. If
  the count moved and you did not add files, a gate went blind.
- `erasableSyntaxOnly` is on because tests run through Node's native type stripping. Keep it.

### ffmpeg is a security surface, and the npm version says little about it

`ffmpeg-ffprobe-static@6.1.2-rc.1` has no newer npm release, but the **binary** inside is what
parses untrusted media. Report the actual `ffmpeg -version` it ships and whether that ffmpeg
release has known CVEs. If a maintained package ships a newer ffmpeg, propose it to the owner
rather than swapping it silently.

Any ffmpeg change must pass `src/main/media/local-only.test.ts`. It pins the property that ffmpeg
reaches no network, with a direct fetch as its positive control, and CLAUDE.md explains why bay
deliberately passes no `-protocol_whitelist`. It must also pass
`src/main/export/audio-render.test.ts`, which renders through the real ffmpeg.

### Claude Agent SDK / CLI

The in-app agent's sandbox is built from CLI flags (`--tools`, `--strict-mcp-config`,
`--setting-sources project`, `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1`). `src/main/agent/cli.test.ts`
and `sdk.test.ts` pin them. A new SDK/CLI can add a built-in tool. Re-check that the session's
tool list is still **exactly** bay's catalog plus `ListMcpResourcesTool`, `ReadMcpResourceTool`
and `Skill`, as CLAUDE.md describes. "Tests pass" does not prove this; a new tool appears only in
a real session.

### pnpm itself

`packageManager` is `pnpm@11.24.0` in both manifests, and the latest is 12.x. That is a major, so
treat it like one: lockfile format and `allowBuilds` semantics (`website/pnpm-workspace.yaml`) may
change. Bump both manifests together or neither.

## Gates, after every group

Read each gate's **exit status**, not the scrollback. CLAUDE.md records probes that reported
61/61 green against a bundle from before a failed build.

```bash
pnpm typecheck; echo "typecheck exit $?"
pnpm test > /tmp/t.log 2>&1; echo "test exit $?"; grep -E '^# (tests|pass|fail|cancelled|skipped)' /tmp/t.log
pnpm build; echo "build exit $?"
./run.sh            # rebuilds and restarts the single app instance; read its FIRST line
```

- **The test count must not drop.** Write down `# tests N` before you start. A dependency bump
  that makes a test file fail to *load* can show up as fewer tests, not as a failure.
  `cancelled` and `skipped` count as failures for this purpose.
- **Typecheck, test and build are three different claims.** CLAUDE.md has a case where
  typecheck passed and rollup refused the tree. Run all three.
- **Then the app.** Drive the running app with `agent-browser --session bay` (read
  `docs/testing.md` first) and run at least `test/app/mcp.mjs`, `export-vs-preview.mjs`,
  `compositions.mjs`, `playback-probe.mjs` and `transition-audio.mjs`. Undo what they did and
  don't save.
- After Electron and vite: `pnpm bundle`, launch the packaged app, open a project and export
  something. Packaging bugs are invisible in `pnpm dev`.
- `graft build` at the end so the graph matches.

For website/: `pnpm build && pnpm lint` inside `website/`, plus `pnpm audit` showing 0 critical
and 0 high.

## Commits and report

- One commit per group: `Deps: vite 8 + electron-vite 5`, and so on. The body gives the before and
  after versions, what broke, how you fixed it, and which gates ran. Stage explicit paths,
  including the lockfile.
- If a major cannot land cleanly, **don't force it.** Leave it at the newest version that passes
  every gate and write down the blocker. A partial upgrade with an honest note beats a complete
  one with a disabled check.
- End with a table: package, from, to, the gates that passed, and anything left behind and why.

## Why not a workspace (context, so you don't "helpfully" start one)

The owner asked whether to split this repo into pnpm workspace packages. The answer was **no**,
for reasons that matter while you bump dependencies:

- Node's native type stripping (what `pnpm test` runs on) refuses files under `node_modules`,
  which is where workspace packages live as symlinks. That forces either a built `dist/`, which
  brings back the stale-artifact false passes CLAUDE.md warns about, or path mappings copied by
  hand into four places.
- `committed-imports.test.ts` only sees relative imports, so cross-package imports would be
  invisible to it.
- The pain the split was meant to fix (merge conflicts in `shared/mcp.ts`, `renderer/mcp/index.ts`,
  `store/editor.ts`) sits inside those files. That is being handled separately with per-tool files
  and a checked-in generated registry.

So: one root manifest, one website manifest. Keep it that way.

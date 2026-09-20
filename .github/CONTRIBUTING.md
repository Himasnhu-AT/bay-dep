# Contributing

bay is an Electron app: React 19, Vite 7, Tailwind 4, TypeScript. One tree, at the repo root.

```bash
pnpm install
pnpm dev          # the editor, with HMR in the renderer
pnpm typecheck    # two tsconfig projects — see below
pnpm test         # 340 tests on node:test
pnpm build        # typecheck, then build main/preload/renderer into out/
```

## Before opening a PR

Run all three of `pnpm typecheck`, `pnpm test` and `pnpm build`. They make **three different
claims** and no one of them stands in for another:

- `pnpm test` runs under plain Node, so it cannot load any module that imports `electron`. For the
  main process proper, `pnpm typecheck` is the only gate there is. The suite once sat green over a
  type error that made the app unbuildable.
- `pnpm typecheck` is not a proxy for "it builds" either — an import can type-resolve and still be
  refused by the bundler, for instance a barrel that does not re-export what you asked for.
- `pnpm build` is what the CDP probes under `test/app/` measure. `electron .` compiles nothing, so a
  probe run against a stale `out/` describes the last build rather than your change — and it fails
  in the direction that does not announce itself, by passing.

## Conventions

The full working agreement is [`CLAUDE.md`](../CLAUDE.md), and it is worth reading before a first
change rather than after a review. The parts that come up most:

- **`src/shared/` is the contract, and it is written before the implementation.** `project.ts` is
  the model; `ipc.ts` is every call the renderer may make into main. If the preload bridge, a main
  handler and a component disagree, someone added a channel without adding it here.
- **Timeline time is frames**, at the timeline's own rate. Source offsets into media are
  microseconds, because a source has a frame rate we do not control. `project.ts` is the only place
  the two units meet.
- **Every project mutation goes through the store's `edit()`**, which snapshots for undo. That
  includes anything an agent does over MCP — a tool that mutates the project around the store is a
  change the user cannot undo and the interface may not notice.
- **The renderer never touches the filesystem.** Media reaches it over the `bay://` protocol, which
  serves only allowlisted paths and must honour HTTP Range requests; `<video>` seeking breaks
  without them.
- **Nothing reaches the network.** No telemetry, no analytics, no remote fonts. The CSP in
  `src/renderer/index.html` permits no remote origin, and loosening it is a product decision rather
  than a fix for a bug.
- **A control must do what it says.** A tile that sets a field no renderer reads is a dead control,
  discovered when an export comes back unchanged. The same rule runs backwards: a working feature
  left greyed out as "not yet" is the more expensive lie, because a disabled row is the one thing on
  a panel people trust without checking.

## Tests

- **A test must be proven to fail against the bug it guards.** Break the thing on purpose and watch
  the test go red before you trust it. A green test over the exact bug it guards is worse than no
  test, because it also claims the bug cannot happen.
- **Pair every refusal with the nearest legal call that must still succeed.** "The bad input was
  rejected" passes trivially against a surface that rejects everything.
- **Assert on an error's content, not its existence.** A refusal that names the candidates lets the
  next call succeed; one that says "not found" does not.
- Probes under `test/app/` drive the built app over CDP. [`test/app/README.md`](../test/app/README.md)
  collects the measurement traps — read it first; most of them have already produced a confident
  wrong answer here.

## Commits

Stage explicit paths — `git add src/main/foo.ts src/main/foo.test.ts` — never `-A` and never `.`.
Several people and agents work in this tree at once and their edits land between your `git status`
and your commit.

Write what the change *is for* rather than what it touched, and if you fixed something that was
subtly wrong, say what it was wrong about. The commit log here is the main record of why the code
looks the way it does.

# OpenCut (Legacy)

This is the original OpenCut codebase. It's archived and no longer maintained.

The rewrite is happening at [opencut-app/opencut](https://github.com/opencut-app/opencut).

## Sponsors

Thanks to [Vercel](https://vercel.com?utm_source=github-opencut&utm_campaign=oss) and [fal.ai](https://fal.ai?utm_source=github-opencut&utm_campaign=oss) for their support of open-source software.

<a href="https://vercel.com/oss">
  <img alt="Vercel OSS Program" src="https://vercel.com/oss/program-badge.svg" />
</a>

<a href="https://fal.ai">
  <img alt="Powered by fal.ai" src="https://img.shields.io/badge/Powered%20by-fal.ai-000000?style=flat&logo=data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTEyIDJMMTMuMDkgOC4yNkwyMCAxMEwxMy4wOSAxNS43NEwxMiAyMkwxMC45MSAxNS43NEw0IDEwTDEwLjkxIDguMjZMMTIgMloiIGZpbGw9IndoaXRlIi8+Cjwvc3ZnPgo=" />
</a>

## Why?

- **Privacy**: Your videos stay on your device
- **Free features**: Most basic CapCut features are now paywalled 
- **Simple**: People want editors that are easy to use - CapCut proved that

## Repository layout

The root holds the Rust workspace and the shell scripts that drive it. Everything belonging to
the legacy JS/web stack lives under `dep/`.

```
vii/
├── rust/          the Rust workspace — this is the product
│   ├── Cargo.toml     workspace root (run cargo from here, or use the scripts)
│   ├── desktop/       the GPUI desktop binary (`opencut`)
│   ├── crates/        engine, model, compositor, effects, masks, gpu, audio, text, ui
│   └── wasm/          wasm bindings consumed by the web app
├── dep/           the legacy JS/web stack (Next.js app + its whole toolchain)
│   ├── apps/web/      Next.js web application
│   ├── fixtures/      golden fixtures used by the web tests
│   └── package.json, pnpm-*, turbo.json, biome.json, eslint/, node_modules/, docker-compose.yml
├── docs/          architecture, subsystem and parity documentation
├── script/        Rust toolchain setup helpers
├── build.sh       release build of the desktop app
├── run.sh         launch the desktop app
└── test.sh        fmt + clippy + tests (STRICT=1 to fail on missing GPU/ffmpeg, WEB=1 to add web)
```

## Native desktop app (quick start)

```bash
./run.sh              # debug build, fastest to start
RELEASE=1 ./run.sh    # release build — much smoother playback
./test.sh             # fmt + clippy -D warnings + the full Rust suite
```

`ffmpeg` on `PATH` is required for video/audio decode, probing, waveforms and MP4 export
(`brew install ffmpeg`). Without it text and images still work and the rest degrades with a
message rather than failing silently.

Cargo commands run from `rust/`, not the repo root:

```bash
cd rust && cargo test --workspace
```

A hands-on walkthrough is in [`docs/native/try-it.md`](docs/native/try-it.md); current status and
known gaps are in [`docs/native/parity-status.md`](docs/native/parity-status.md).

## Getting Started (web app, in `dep/`)

> All commands in this section run from `dep/`, not the repo root.

### Prerequisites

- [Bun](https://bun.sh/docs/installation)
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)

> **Note:** Docker is optional but recommended for running the local database and Redis. If you only want to work on frontend features, you can skip it.

### Setup

1. Fork and clone the repository

2. Copy the environment file:

   ```bash
   # Unix/Linux/Mac
   cp dep/apps/web/.env.example dep/apps/web/.env.local

   # Windows PowerShell
   Copy-Item dep/apps/web/.env.example dep/apps/web/.env.local
   ```

3. Start the database and Redis:

   ```bash
   docker compose up -d db redis serverless-redis-http
   ```

4. Install dependencies and start the dev server:

   ```bash
   bun install
   bun dev:web
   ```

The application will be available at [http://localhost:3000](http://localhost:3000).

The `.env.example` has sensible defaults that match the Docker Compose config — it should work out of the box.

### Desktop setup

Desktop is opt-in. If you're only working on the web app, skip this entirely.

If you want to get ready for `rust/desktop`, see [`rust/desktop/README.md`](rust/desktop/README.md). It's a two-step setup: Rust toolchain first, then desktop native dependencies.

### Local WASM development

Only needed if you're editing `rust/wasm` and want the web app to use your local build instead of the published package.

**Prerequisites** — install these once before anything else:

```bash
# Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# build the WASM package
cargo install wasm-pack

# reruns the build on file changes, used by bun dev:wasm
cargo install cargo-watch
```

1. Build the package once from the repo root:

   ```bash
   bun run build:wasm
   ```

2. Register the generated package for linking:

   ```bash
   cd rust/wasm/pkg
   bun link
   ```

3. Link `dep/apps/web` to the local package:

   ```bash
   cd dep/apps/web
   bun link opencut-wasm
   ```

4. Rebuild on changes while you work:

   ```bash
   bun dev:wasm
   ```

To switch `dep/apps/web` back to the published package, run:

```bash
cd dep/apps/web
bun add opencut-wasm
```

### Self-Hosting with Docker

To run everything (including a production build of the app) in Docker:

```bash
docker compose up -d
```

The app will be available at [http://localhost:3100](http://localhost:3100).

## Contributing

We welcome contributions! While we're actively developing and refactoring certain areas, there are plenty of opportunities to contribute effectively.

**🎯 Focus areas:** Timeline functionality, project management, performance, bug fixes, and UI improvements outside the preview panel.

**⚠️ Avoid for now:** Preview panel enhancements (fonts, stickers, effects) and export functionality - we're refactoring these with a new binary rendering approach.

See our [Contributing Guide](.github/CONTRIBUTING.md) for detailed setup instructions, development guidelines, and complete focus area guidance.

**Quick start for contributors:**

- Fork the repo and clone locally
- Follow the setup instructions in CONTRIBUTING.md
- Working on `rust/desktop`? See [`rust/desktop/README.md`](rust/desktop/README.md) for setup
- Create a feature branch and submit a PR

## License

[MIT LICENSE](LICENSE)

---

![Star History Chart](https://api.star-history.com/svg?repos=opencut-app/opencut&type=Date)


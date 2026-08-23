# Platform support

## macOS

macOS is the shipping desktop platform. `bay-ui` uses GPUI, preview/export use wgpu with Metal,
and local transcription enables whisper.cpp's Metal backend. The release artifact is a universal
`bay.app`/DMG.

## Windows

The engine's MCP surface is compile-exercised for `x86_64-pc-windows-msvc` with:

```bash
cd rust
env -u CARGO_TARGET_DIR cargo xwin check --target x86_64-pc-windows-msvc \
  -p bay-paths -p bay-time -p bay-project -p bay-jobs -p bay-provision -p bay-mcp
```

`bay-mcp` pulls the editing engine, preview, audio, text, generation, vision, speech, and
transcription crates through its dependency graph. Whisper's Metal feature is enabled only on
macOS; Windows checks and builds its CPU backend.

This is a compile claim, not a runtime-support claim. It does not execute an MCP request,
composite a frame on D3D12, run ffmpeg, load Whisper, or render an MP4 on Windows.

The GPUI desktop shell is not cross-checkable from macOS: GPUI's build script generates HLSL only
when the build host itself is Windows, so `cargo-xwin` cannot produce its shader output. The
manual `.github/workflows/windows.yml` job runs on `windows-latest`, bundles `bay.exe`, checks the
PE GUI subsystem, and executes `--help` and `--agents`. A successful run of that workflow is
required before describing a specific commit as a working Windows desktop build.

The pull-request `workspace-check` workflow separately cross-checks the MCP/engine subset on
every Rust change. That catches target-specific Rust and native dependency regressions without
overstating what a compile on a Mac proves.

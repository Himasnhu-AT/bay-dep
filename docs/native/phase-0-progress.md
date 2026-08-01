# Phase 0 — progress & findings

[Plan](plan.md) · [Tasks](task.md) · [Phase 0](phase-0.md)

Living status of the Phase-0 de-risk spikes. Updated as tasks land.

## Status

| Task | State | Evidence |
|------|-------|----------|
| **P0-GPU-01** — Freeze workspace-wide wgpu | ✅ done | Single `wgpu = "=29.0.1"` in `[workspace.dependencies]`; whole native graph resolves to one wgpu (`cargo tree` shows only `wgpu v29.0.1`). |
| **P0-GPU-02** — Native RGBA upload + readback | ✅ done | `GpuContext::upload_rgba_texture` / `read_texture_rgba`; 2 headless tests pass on Metal. |
| **P0-GPU-03** — Compositor → native winit/wgpu window | ✅ built | `native-preview` bin drives the unmodified `Compositor::render_frame` to a window surface; compiles clean. On-screen present is user-runnable (`cargo run -p native-preview`). |
| P0-GPU-04 — GPUI↔wgpu interop GO/NO-GO | 🔜 reframed | See finding below — premise changed from wgpu-sharing to blade↔wgpu. |
| P0-GPU-05 — GPUI sourcing + Tauri fallback | 🔜 next | crates.io GPUI 0.2.2 already vendored in `apps/desktop`; blade backend confirmed. |
| P0-MED-* / P0-TXT-* / P0-ARCH-* | ⬜ not started | — |

## What landed

### Single-lock workspace (P0-GPU-01)
- The repo-root `Cargo.toml` already declared the workspace (`apps/desktop`, all `rust/crates/*`, `rust/wasm`). Added a `[workspace.dependencies]` block pinning **`wgpu = "=29.0.1"`** (plus `bytemuck`, `thiserror`, `serde`), and switched `gpu`, `effects`, `masks`, `compositor` to `{ workspace = true }`. One `=`-pinned constraint now single-sources the wgpu major so a stray `cargo update` can't split it, and any future GPU crate must align to it.
- `rust/wasm` (the published `opencut-wasm`) stays a member and still checks clean for `wasm32-unknown-unknown` against the frozen deps.

### Native texture I/O (P0-GPU-02)
`rust/crates/gpu/src/context.rs`, native-only (`cfg(not(wasm))`):
- `upload_rgba_texture(rgba, w, h, label)` — the native replacement for the browser's `import_offscreen_canvas_texture` Canvas path. Swizzles R↔B when the device format is `Bgra8Unorm`; writes at natural `w*4` row pitch (`write_texture` has no 256-alignment rule).
- `read_texture_rgba(texture, w, h)` — `copy_texture_to_buffer` into a **256-byte row-pitch-aligned** staging buffer, strips padding, reverses the swizzle. Blocks on `device.poll(Wait)`; for tests/export, not the hot path.
- Tests: `rust/crates/compositor/tests/native_gpu.rs`
  - `native_rgba_upload_readback_is_identity` — 8×8 gradient (32-byte rows padded to 256) upload→readback is byte-identical → proves swizzle + row-pitch end-to-end.
  - `native_render_frame_to_texture_fills_with_layer_color` — upload an opaque solid, composite one full-frame layer via the reused `render_frame_to_texture`, read back, assert center pixel matches (±1).

### Native preview window (P0-GPU-03)
`rust/crates/native-preview` — winit 0.30 `ApplicationHandler`; `instance.create_surface(Arc<Window>)` (rwh 0.6 aligns winit↔wgpu) → `Surface<'static>`; drives **`compositor::Compositor::render_frame`** with a 3-layer `FrameDescriptor` (opaque bg + accent + a half-transparent `Screen`-blended layer) each redraw. The engine crates are unchanged — same code that renders in wasm renders to a desktop surface. Run: `cargo run -p native-preview`.

## Findings

### 🔑 GPUI 0.2.2 renders on blade-graphics, not wgpu
`cargo tree -p opencut-desktop` shows GPUI 0.2.2 → **blade-graphics 0.7.1 + blade-util + naga 25 + metal 0.29**. It never depends on wgpu. Consequences:
- **De-risks P0-GPU-01**: freezing wgpu at 29 cannot collide with GPUI (different GPU stack entirely).
- **Reframes P0-GPU-04**: there is no shared wgpu `Device` to composite our texture into. The interop is **blade↔wgpu** — either alias the same native Metal/Vulkan image (IOSurface / external-memory, hard and per-platform), do one GPU→GPU copy per frame into a GPUI image (viable middle ground, not a full CPU readback), adopt a pinned Zed-monorepo GPUI *if* it moves to wgpu, or take the Tauri fallback. This is exactly the go/no-go P0-GPU-04 must decide before any Phase-3 UI is scheduled.

## Verify locally
```bash
# single wgpu across the native workspace
cargo tree -e no-dev | grep -i 'wgpu ' | sort -u        # → only wgpu v29.0.1

# native GPU proofs (headless, real device)
cargo test -p compositor --test native_gpu

# no engine regressions
cargo test -p gpu -p effects -p masks -p compositor -p time

# the preview window (needs a display)
cargo run -p native-preview
```

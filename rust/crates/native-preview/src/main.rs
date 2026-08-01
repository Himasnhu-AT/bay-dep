//! P0-GPU-03 — native compositor preview window.
//!
//! Opens a winit window, binds a `wgpu::Surface` to its native handle, and drives the
//! **unmodified** `compositor::Compositor::render_frame` each frame with a multi-layer
//! `FrameDescriptor`. This is the native equivalent of the browser's WebGPU/WebGL present
//! path: the same engine crate that renders in wasm here renders to a desktop surface with
//! zero engine changes — the core-first bet made visible.
//!
//! Run: `cargo run -p native-preview` (requires a display / window server).

use std::sync::Arc;

use compositor::{
    BlendMode, CanvasClearDescriptor, Compositor, FrameDescriptor, FrameItemDescriptor,
    LayerDescriptor, QuadTransformDescriptor, RenderFrameOptions,
};
use gpu::{GpuContext, wgpu};
use winit::application::ApplicationHandler;
use winit::dpi::LogicalSize;
use winit::event::WindowEvent;
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::window::{Window, WindowId};

/// The compositor's internal canvas resolution. Independent of the window size — the final
/// present pass blits (and stretches) this scene onto whatever the surface is configured to.
const CANVAS_W: u32 = 1280;
const CANVAS_H: u32 = 720;

/// A solid RGBA fill of `width * height` pixels.
fn solid_rgba(color: [u8; 4], width: u32, height: u32) -> Vec<u8> {
    std::iter::repeat_n(color, (width * height) as usize)
        .flatten()
        .collect()
}

struct Preview {
    ctx: GpuContext,
    compositor: Compositor,
    frame: FrameDescriptor,
    window: Option<Arc<Window>>,
    surface: Option<wgpu::Surface<'static>>,
    surface_size: (u32, u32),
}

impl Preview {
    fn new() -> Self {
        let ctx = pollster::block_on(GpuContext::new()).expect("no GPU adapter available");
        let mut compositor = Compositor::new(&ctx);

        // Three layers of different sizes/opacities/blends prove real multi-layer compositing,
        // not just a single blit: an opaque dark background, an opaque accent rectangle, and a
        // half-transparent Screen-blended rectangle overlapping it.
        let layers: [(&str, [u8; 4], u32, u32, f32, f32, f32, BlendMode); 3] = [
            (
                "bg",
                [24, 26, 32, 255],
                CANVAS_W,
                CANVAS_H,
                CANVAS_W as f32 / 2.0,
                CANVAS_H as f32 / 2.0,
                1.0,
                BlendMode::Normal,
            ),
            (
                "accent",
                [214, 90, 60, 255],
                520,
                360,
                CANVAS_W as f32 * 0.42,
                CANVAS_H as f32 * 0.52,
                1.0,
                BlendMode::Normal,
            ),
            (
                "glow",
                [70, 150, 235, 255],
                420,
                420,
                CANVAS_W as f32 * 0.6,
                CANVAS_H as f32 * 0.44,
                0.6,
                BlendMode::Screen,
            ),
        ];

        let mut items = Vec::new();
        for (id, color, w, h, cx, cy, opacity, blend) in layers {
            let texture = ctx.upload_rgba_texture(&solid_rgba(color, w, h), w, h, "preview-layer");
            compositor.upsert_texture(id.to_string(), texture);
            items.push(FrameItemDescriptor::Layer(LayerDescriptor {
                texture_id: id.to_string(),
                transform: QuadTransformDescriptor {
                    center_x: cx,
                    center_y: cy,
                    width: w as f32,
                    height: h as f32,
                    rotation_degrees: 0.0,
                    flip_x: false,
                    flip_y: false,
                },
                opacity,
                blend_mode: blend,
                effect_pass_groups: Vec::new(),
                mask: None,
            }));
        }

        let frame = FrameDescriptor {
            width: CANVAS_W,
            height: CANVAS_H,
            clear: CanvasClearDescriptor {
                color: [0.0, 0.0, 0.0, 1.0],
            },
            items,
        };

        Self {
            ctx,
            compositor,
            frame,
            window: None,
            surface: None,
            surface_size: (0, 0),
        }
    }

    fn configure(&mut self, width: u32, height: u32) {
        if width == 0 || height == 0 {
            return;
        }
        if let Some(surface) = &self.surface {
            self.ctx
                .configure_surface(surface, width, height)
                .expect("failed to configure surface");
            self.surface_size = (width, height);
        }
    }

    fn render(&mut self) {
        let Some(surface) = &self.surface else { return };
        if self.surface_size.0 == 0 {
            return;
        }
        if let Err(err) = self.compositor.render_frame(
            &self.ctx,
            RenderFrameOptions {
                frame: &self.frame,
                surface,
            },
        ) {
            eprintln!("render_frame error: {err}");
        }
    }
}

impl ApplicationHandler for Preview {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attributes = Window::default_attributes()
            .with_title("vii — native compositor preview")
            .with_inner_size(LogicalSize::new(CANVAS_W, CANVAS_H));
        let window = Arc::new(
            event_loop
                .create_window(attributes)
                .expect("failed to create window"),
        );
        let surface = self
            .ctx
            .instance()
            .create_surface(window.clone())
            .expect("failed to create surface from window handle");

        let size = window.inner_size();
        self.surface = Some(surface);
        self.window = Some(window);
        self.configure(size.width, size.height);
        if let Some(window) = &self.window {
            window.request_redraw();
        }
    }

    fn window_event(
        &mut self,
        event_loop: &ActiveEventLoop,
        _window_id: WindowId,
        event: WindowEvent,
    ) {
        match event {
            WindowEvent::CloseRequested => event_loop.exit(),
            WindowEvent::Resized(size) => {
                self.configure(size.width, size.height);
                if let Some(window) = &self.window {
                    window.request_redraw();
                }
            }
            WindowEvent::RedrawRequested => self.render(),
            _ => {}
        }
    }
}

fn main() {
    let event_loop = EventLoop::new().expect("failed to build event loop");
    // Redraw on demand (resize / OS invalidation) rather than spinning — this is a static
    // preview scene, not an animation loop.
    event_loop.set_control_flow(ControlFlow::Wait);

    let mut app = Preview::new();
    event_loop.run_app(&mut app).expect("event loop failed");
}

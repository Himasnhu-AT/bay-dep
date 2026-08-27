mod context;

use thiserror::Error;

pub use context::{GpuContext, PipelinedReadback, ReadbackPoll, ReadbackPool};
pub use wgpu;

pub const GPU_TEXTURE_FORMAT: wgpu::TextureFormat = wgpu::TextureFormat::Bgra8Unorm;
pub const FULLSCREEN_SHADER_SOURCE: &str = include_str!("shaders/fullscreen.wgsl");

#[derive(Debug, Error)]
pub enum GpuError {
    #[error("No WebGPU adapter is available")]
    AdapterUnavailable,
    #[error("Failed to request a WebGPU device: {0}")]
    RequestDevice(#[from] wgpu::RequestDeviceError),
    #[error("Failed to create a WebGPU surface: {0}")]
    CreateSurface(#[from] wgpu::CreateSurfaceError),
    #[error("The output surface does not support the required texture format")]
    UnsupportedSurfaceFormat,
    /// A caller handed us a pixel buffer whose length disagrees with the dimensions it claims.
    /// The render path must drop that layer, not abort the process — see `CLAUDE.md`.
    #[error("Pixel buffer is {actual} bytes, expected {width}x{height}x4 = {expected}")]
    BufferSizeMismatch {
        width: u32,
        height: u32,
        expected: usize,
        actual: usize,
    },
    /// Readback failed. Device loss is the realistic cause — a laptop that slept, an eGPU that
    /// was unplugged — and it must surface as a failed frame rather than a crash.
    #[error("Texture readback failed: {0}")]
    Readback(String),
}

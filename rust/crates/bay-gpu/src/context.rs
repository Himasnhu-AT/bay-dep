use wgpu::util::DeviceExt;

#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
use std::cell::RefCell;

#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
use wasm_bindgen::JsCast;

use crate::{FULLSCREEN_SHADER_SOURCE, GpuError};

#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
#[derive(Debug)]
struct WebDisplay;

#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
impl wgpu::rwh::HasDisplayHandle for WebDisplay {
    fn display_handle(&self) -> Result<wgpu::rwh::DisplayHandle<'_>, wgpu::rwh::HandleError> {
        let raw = wgpu::rwh::WebDisplayHandle::new();
        Ok(unsafe { wgpu::rwh::DisplayHandle::borrow_raw(raw.into()) })
    }
}

#[cfg(all(feature = "wasm", target_arch = "wasm32"))]
struct CachedCanvasSurface {
    surface: wgpu::Surface<'static>,
    size: (u32, u32),
}

const BLIT_SHADER_SOURCE: &str = include_str!("shaders/blit.wgsl");

const FULLSCREEN_QUAD_POSITIONS: [[f32; 2]; 6] = [
    [-1.0, -1.0],
    [1.0, -1.0],
    [-1.0, 1.0],
    [-1.0, 1.0],
    [1.0, -1.0],
    [1.0, 1.0],
];

/// A staging buffer reused across texture readbacks.
///
/// [`GpuContext::read_texture_native`] allocates and frees a `MAP_READ` buffer per call. That is
/// the right shape for a one-off — an export still, a test — and the wrong one for the live
/// preview, which reads back a fixed-size texture on every composited frame and so paid for a
/// GPU allocation and free sixty times a second. A caller on that path keeps one of these and
/// pays once.
///
/// Sized in bytes of *padded* rows, so it is indexed by the same arithmetic the copy uses.
#[derive(Default)]
pub struct ReadbackPool {
    buffer: Option<wgpu::Buffer>,
    capacity: u64,
}

impl ReadbackPool {
    pub fn new() -> Self {
        Self::default()
    }

    /// Drop the staging buffer. For when its mapping state is no longer known to be sound and
    /// the cheap way out is to let the next [`Self::acquire`] start over.
    fn reset(&mut self) {
        self.buffer = None;
        self.capacity = 0;
    }

    /// A buffer of at least `size` bytes, allocating only when the current one is too small.
    ///
    /// Grows but never shrinks: the preview holds one canvas size for its whole life, and a
    /// single larger read has no business forcing the next preview frame to reallocate.
    fn acquire(&mut self, device: &wgpu::Device, size: u64) -> &wgpu::Buffer {
        if self.capacity < size {
            self.buffer = Some(device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("gpu-readback-buffer"),
                size,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            }));
            self.capacity = size;
        }
        self.buffer
            .as_ref()
            .expect("buffer is allocated above whenever capacity is short")
    }
}

/// The outcome of polling a [`PipelinedReadback`].
pub enum ReadbackPoll {
    /// Nothing has been submitted since the last frame was taken.
    Idle,
    /// The GPU is still working. The caller should keep showing the previous frame and ask
    /// again — see `PreviewRenderer::has_pending_readback`.
    Pending,
    /// Tightly-packed pixels in the context's native texture order.
    Ready {
        width: u32,
        height: u32,
        pixels: Vec<u8>,
    },
    /// The copy or the mapping failed. Device loss is the realistic cause.
    Failed,
}

/// A readback that is submitted on one frame and collected on a later one.
///
/// [`GpuContext::read_texture_native`] blocks on `poll(wait_indefinitely())`, which serialises
/// the CPU against work it submitted microseconds earlier: the thread sits idle for the whole
/// composite. That is the correct trade for an export or a test, where the pixels are the only
/// product. On the interactive path it costs a stall every frame for a picture that could just
/// as well be collected on the next tick.
///
/// One buffer is enough because the pipeline is one deep: a new copy is only submitted after the
/// previous one has been collected and unmapped, so the buffer is never read and written at once.
#[derive(Default)]
pub struct PipelinedReadback {
    pool: ReadbackPool,
    in_flight: Option<InFlight>,
}

struct InFlight {
    width: u32,
    height: u32,
    padded_bytes_per_row: usize,
    needed: u64,
    /// Set by the `map_async` callback. `None` until the callback runs.
    mapped_ok: std::sync::Arc<std::sync::atomic::AtomicU8>,
}

/// `mapped_ok` states. `map_async`'s callback can report failure while `poll` reports success,
/// so "did it finish" and "did it work" are two different questions and need three states.
const MAP_PENDING: u8 = 0;
const MAP_OK: u8 = 1;
const MAP_FAILED: u8 = 2;

impl PipelinedReadback {
    pub fn new() -> Self {
        Self::default()
    }

    /// Whether a copy has been submitted whose pixels have not been collected yet.
    pub fn is_pending(&self) -> bool {
        self.in_flight.is_some()
    }
}

pub struct GpuContext {
    instance: wgpu::Instance,
    adapter: wgpu::Adapter,
    device: wgpu::Device,
    queue: wgpu::Queue,
    texture_format: wgpu::TextureFormat,
    fullscreen_quad: wgpu::Buffer,
    linear_sampler: wgpu::Sampler,
    nearest_sampler: wgpu::Sampler,
    texture_sampler_bind_group_layout: wgpu::BindGroupLayout,
    blit_pipeline: wgpu::RenderPipeline,
    supports_external_texture_copies: bool,
    /// The HTML canvas that the WebGL context is bound to. Only populated on the WebGL
    /// fallback path. Used by render_texture_via_gl_canvas to output frames on WebGL.
    #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
    gl_canvas: Option<web_sys::HtmlCanvasElement>,
    #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
    gl_surface: RefCell<Option<CachedCanvasSurface>>,
}

impl GpuContext {
    pub async fn new() -> Result<Self, GpuError> {
        #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
        let (instance, adapter, device, queue, gl_canvas) = Self::acquire_device().await?;
        #[cfg(not(all(feature = "wasm", target_arch = "wasm32")))]
        let (instance, adapter, device, queue) = Self::acquire_device().await?;
        let texture_format = if adapter.get_info().backend == wgpu::Backend::Gl {
            wgpu::TextureFormat::Rgba8Unorm
        } else {
            wgpu::TextureFormat::Bgra8Unorm
        };
        let fullscreen_quad = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("gpu-fullscreen-quad-buffer"),
            contents: bytemuck::cast_slice(&FULLSCREEN_QUAD_POSITIONS),
            usage: wgpu::BufferUsages::VERTEX,
        });
        let linear_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("gpu-linear-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });
        let nearest_sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("gpu-nearest-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Nearest,
            min_filter: wgpu::FilterMode::Nearest,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });
        let texture_sampler_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("gpu-texture-sampler-bind-group-layout"),
                entries: &[
                    wgpu::BindGroupLayoutEntry {
                        binding: 0,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Texture {
                            multisampled: false,
                            view_dimension: wgpu::TextureViewDimension::D2,
                            sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        },
                        count: None,
                    },
                    wgpu::BindGroupLayoutEntry {
                        binding: 1,
                        visibility: wgpu::ShaderStages::FRAGMENT,
                        ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                        count: None,
                    },
                ],
            });
        let vertex_shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("gpu-fullscreen-shader"),
            source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
        });
        let blit_shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("gpu-blit-shader"),
            source: wgpu::ShaderSource::Wgsl(BLIT_SHADER_SOURCE.into()),
        });
        let blit_pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("gpu-blit-pipeline-layout"),
            bind_group_layouts: &[Some(&texture_sampler_bind_group_layout)],
            immediate_size: 0,
        });
        let blit_pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("gpu-blit-pipeline"),
            layout: Some(&blit_pipeline_layout),
            vertex: wgpu::VertexState {
                module: &vertex_shader_module,
                entry_point: Some("vertex_main"),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<[f32; 2]>() as u64,
                    step_mode: wgpu::VertexStepMode::Vertex,
                    attributes: &[wgpu::VertexAttribute {
                        format: wgpu::VertexFormat::Float32x2,
                        offset: 0,
                        shader_location: 0,
                    }],
                }],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            },
            fragment: Some(wgpu::FragmentState {
                module: &blit_shader_module,
                entry_point: Some("fragment_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: texture_format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
                compilation_options: wgpu::PipelineCompilationOptions::default(),
            }),
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            multiview_mask: None,
            cache: None,
        });

        let supports_external_texture_copies = adapter
            .get_downlevel_capabilities()
            .flags
            .contains(wgpu::DownlevelFlags::UNRESTRICTED_EXTERNAL_TEXTURE_COPIES);

        Ok(Self {
            instance,
            adapter,
            device,
            queue,
            texture_format,
            fullscreen_quad,
            linear_sampler,
            nearest_sampler,
            texture_sampler_bind_group_layout,
            blit_pipeline,
            supports_external_texture_copies,
            #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
            gl_canvas,
            #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
            gl_surface: RefCell::new(None),
        })
    }

    #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
    async fn acquire_device() -> Result<
        (
            wgpu::Instance,
            wgpu::Adapter,
            wgpu::Device,
            wgpu::Queue,
            Option<web_sys::HtmlCanvasElement>,
        ),
        GpuError,
    > {
        let instance = wgpu::util::new_instance_with_webgpu_detection(
            wgpu::InstanceDescriptor::new_without_display_handle(),
        )
        .await;

        match Self::try_request_device(&instance, None).await {
            Ok((adapter, device, queue)) => return Ok((instance, adapter, device, queue, None)),
            Err(_) => {}
        }
        let (gl_instance, adapter, device, queue, canvas) = Self::try_gl_fallback().await?;
        Ok((gl_instance, adapter, device, queue, Some(canvas)))
    }

    #[cfg(not(all(feature = "wasm", target_arch = "wasm32")))]
    async fn acquire_device()
    -> Result<(wgpu::Instance, wgpu::Adapter, wgpu::Device, wgpu::Queue), GpuError> {
        let instance = wgpu::util::new_instance_with_webgpu_detection(
            wgpu::InstanceDescriptor::new_without_display_handle(),
        )
        .await;

        if let Ok((adapter, device, queue)) = Self::try_request_device(&instance, None).await {
            return Ok((instance, adapter, device, queue));
        }

        Self::try_gl_fallback().await
    }

    #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
    async fn try_gl_fallback() -> Result<
        (
            wgpu::Instance,
            wgpu::Adapter,
            wgpu::Device,
            wgpu::Queue,
            web_sys::HtmlCanvasElement,
        ),
        GpuError,
    > {
        let mut gl_desc = wgpu::InstanceDescriptor::new_without_display_handle();
        gl_desc.backends = wgpu::Backends::GL;
        gl_desc.display = Some(Box::new(WebDisplay));
        let gl_instance = wgpu::Instance::new(gl_desc);

        let document = web_sys::window()
            .and_then(|w| w.document())
            .ok_or(GpuError::AdapterUnavailable)?;
        let canvas: web_sys::HtmlCanvasElement = document
            .create_element("canvas")
            .map_err(|_| GpuError::AdapterUnavailable)?
            .unchecked_into();
        canvas.set_width(1);
        canvas.set_height(1);
        let surface = gl_instance.create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))?;

        let (adapter, device, queue) =
            Self::try_request_device(&gl_instance, Some(&surface)).await?;
        Ok((gl_instance, adapter, device, queue, canvas))
    }

    #[cfg(not(all(feature = "wasm", target_arch = "wasm32")))]
    async fn try_gl_fallback()
    -> Result<(wgpu::Instance, wgpu::Adapter, wgpu::Device, wgpu::Queue), GpuError> {
        Err(GpuError::AdapterUnavailable)
    }

    async fn try_request_device(
        instance: &wgpu::Instance,
        compatible_surface: Option<&wgpu::Surface<'_>>,
    ) -> Result<(wgpu::Adapter, wgpu::Device, wgpu::Queue), GpuError> {
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface,
                force_fallback_adapter: false,
            })
            .await
            .map_err(|_| GpuError::AdapterUnavailable)?;

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("gpu-device"),
                required_features: wgpu::Features::empty(),
                required_limits: wgpu::Limits::downlevel_webgl2_defaults()
                    .using_resolution(adapter.limits()),
                memory_hints: wgpu::MemoryHints::Performance,
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                trace: wgpu::Trace::Off,
            })
            .await?;

        Ok((adapter, device, queue))
    }

    pub fn create_render_texture(
        &self,
        width: u32,
        height: u32,
        label: &'static str,
    ) -> wgpu::Texture {
        self.device.create_texture(&wgpu::TextureDescriptor {
            label: Some(label),
            size: wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: self.texture_format,
            usage: wgpu::TextureUsages::TEXTURE_BINDING
                | wgpu::TextureUsages::COPY_DST
                | wgpu::TextureUsages::COPY_SRC
                | wgpu::TextureUsages::RENDER_ATTACHMENT,
            view_formats: &[],
        })
    }

    pub fn instance(&self) -> &wgpu::Instance {
        &self.instance
    }

    pub fn adapter(&self) -> &wgpu::Adapter {
        &self.adapter
    }

    pub fn device(&self) -> &wgpu::Device {
        &self.device
    }

    pub fn queue(&self) -> &wgpu::Queue {
        &self.queue
    }

    pub fn texture_format(&self) -> wgpu::TextureFormat {
        self.texture_format
    }

    pub fn fullscreen_quad(&self) -> &wgpu::Buffer {
        &self.fullscreen_quad
    }

    pub fn linear_sampler(&self) -> &wgpu::Sampler {
        &self.linear_sampler
    }

    pub fn nearest_sampler(&self) -> &wgpu::Sampler {
        &self.nearest_sampler
    }

    pub fn texture_sampler_bind_group_layout(&self) -> &wgpu::BindGroupLayout {
        &self.texture_sampler_bind_group_layout
    }

    pub fn blit_pipeline(&self) -> &wgpu::RenderPipeline {
        &self.blit_pipeline
    }

    /// Whether the GPU backend can render to arbitrary canvas surfaces.
    /// True for WebGPU, false for WebGL which can only surface-render to
    /// the specific canvas its GL context was originally created on.
    pub fn supports_surface_rendering(&self) -> bool {
        self.supports_external_texture_copies
    }

    /// The HTML canvas that owns the backing WebGL context, if running on the
    /// WebGL fallback. Callers on that path can mount this canvas directly
    /// instead of copying pixels out of it every frame.
    #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
    pub fn gl_canvas(&self) -> Option<&web_sys::HtmlCanvasElement> {
        self.gl_canvas.as_ref()
    }

    pub fn render_texture_to_surface(
        &self,
        texture: &wgpu::Texture,
        surface: &wgpu::Surface<'_>,
        width: u32,
        height: u32,
    ) -> Result<(), GpuError> {
        self.configure_surface(surface, width, height)?;
        self.present_texture_to_surface(texture, surface)
    }

    pub fn present_texture_to_surface(
        &self,
        texture: &wgpu::Texture,
        surface: &wgpu::Surface<'_>,
    ) -> Result<(), GpuError> {
        let surface_texture = self.acquire_surface_texture(surface)?;
        let target_view = surface_texture
            .texture
            .create_view(&wgpu::TextureViewDescriptor::default());
        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("gpu-surface-blit-encoder"),
            });
        self.encode_texture_blit_to_view(&mut encoder, texture, &target_view, "gpu-surface-blit");
        self.queue.submit([encoder.finish()]);
        surface_texture.present();
        Ok(())
    }

    pub fn configure_surface(
        &self,
        surface: &wgpu::Surface<'_>,
        width: u32,
        height: u32,
    ) -> Result<(), GpuError> {
        let config = self.build_surface_configuration(surface, width, height)?;
        surface.configure(&self.device, &config);
        Ok(())
    }

    fn build_surface_configuration(
        &self,
        surface: &wgpu::Surface<'_>,
        width: u32,
        height: u32,
    ) -> Result<wgpu::SurfaceConfiguration, GpuError> {
        let caps = surface.get_capabilities(&self.adapter);
        if !caps.formats.contains(&self.texture_format) {
            return Err(GpuError::UnsupportedSurfaceFormat);
        }

        Ok(wgpu::SurfaceConfiguration {
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
            format: self.texture_format,
            width,
            height,
            present_mode: wgpu::PresentMode::Fifo,
            alpha_mode: caps
                .alpha_modes
                .first()
                .copied()
                .unwrap_or(wgpu::CompositeAlphaMode::Auto),
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        })
    }

    pub fn acquire_surface_texture(
        &self,
        surface: &wgpu::Surface<'_>,
    ) -> Result<wgpu::SurfaceTexture, GpuError> {
        match surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(surface_texture)
            | wgpu::CurrentSurfaceTexture::Suboptimal(surface_texture) => Ok(surface_texture),
            wgpu::CurrentSurfaceTexture::Timeout
            | wgpu::CurrentSurfaceTexture::Occluded
            | wgpu::CurrentSurfaceTexture::Outdated
            | wgpu::CurrentSurfaceTexture::Lost
            | wgpu::CurrentSurfaceTexture::Validation => Err(GpuError::UnsupportedSurfaceFormat),
        }
    }

    pub fn encode_texture_blit_to_view(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        texture: &wgpu::Texture,
        target_view: &wgpu::TextureView,
        label: &'static str,
    ) {
        let source_view = texture.create_view(&wgpu::TextureViewDescriptor::default());
        let bind_group = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("gpu-blit-bind-group"),
            layout: &self.texture_sampler_bind_group_layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::TextureView(&source_view),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::Sampler(&self.linear_sampler),
                },
            ],
        });

        let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some(label),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target_view,
                resolve_target: None,
                depth_slice: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
            multiview_mask: None,
        });
        render_pass.set_pipeline(&self.blit_pipeline);
        render_pass.set_vertex_buffer(0, self.fullscreen_quad.slice(..));
        render_pass.set_bind_group(0, &bind_group, &[]);
        render_pass.draw(0..6, 0..1);
    }

    #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
    pub fn import_offscreen_canvas_texture(
        &self,
        canvas: &wgpu::web_sys::OffscreenCanvas,
        width: u32,
        height: u32,
        label: &'static str,
    ) -> wgpu::Texture {
        let texture = self.create_render_texture(width, height, label);

        if self.supports_external_texture_copies {
            self.queue.copy_external_image_to_texture(
                &wgpu::CopyExternalImageSourceInfo {
                    source: wgpu::ExternalImageSource::OffscreenCanvas(canvas.clone()),
                    origin: wgpu::Origin2d::ZERO,
                    flip_y: false,
                },
                wgpu::CopyExternalImageDestInfo {
                    texture: &texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                    color_space: wgpu::PredefinedColorSpace::Srgb,
                    premultiplied_alpha: false,
                },
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
            );
        } else {
            let ctx: web_sys::OffscreenCanvasRenderingContext2d = canvas
                .get_context("2d")
                .ok()
                .flatten()
                .expect("Failed to get 2d context for texture import")
                .unchecked_into();
            let image_data = ctx
                .get_image_data(0.0, 0.0, width as f64, height as f64)
                .expect("Failed to read pixel data from canvas");
            let rgba_bytes = image_data.data();

            let pixel_bytes = if self.texture_format == wgpu::TextureFormat::Bgra8Unorm {
                let mut bytes = rgba_bytes.to_vec();
                for pixel in bytes.chunks_exact_mut(4) {
                    pixel.swap(0, 2);
                }
                bytes
            } else {
                rgba_bytes.to_vec()
            };

            self.queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d::ZERO,
                    aspect: wgpu::TextureAspect::All,
                },
                &pixel_bytes,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(width * 4),
                    rows_per_image: Some(height),
                },
                wgpu::Extent3d {
                    width,
                    height,
                    depth_or_array_layers: 1,
                },
            );
        }

        texture
    }

    #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
    pub fn render_texture_to_offscreen_canvas(
        &self,
        texture: &wgpu::Texture,
        canvas: &wgpu::web_sys::OffscreenCanvas,
        width: u32,
        height: u32,
    ) -> Result<(), GpuError> {
        if self.supports_external_texture_copies {
            let surface = self
                .instance
                .create_surface(wgpu::SurfaceTarget::OffscreenCanvas(canvas.clone()))?;
            return self.render_texture_to_surface(texture, &surface, width, height);
        }

        self.render_texture_to_offscreen_canvas_via_gl_canvas(texture, canvas, width, height)
    }

    #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
    fn render_texture_to_offscreen_canvas_via_gl_canvas(
        &self,
        texture: &wgpu::Texture,
        canvas: &wgpu::web_sys::OffscreenCanvas,
        width: u32,
        height: u32,
    ) -> Result<(), GpuError> {
        let gl_canvas = self.render_texture_to_gl_canvas_surface(texture, width, height)?;

        let ctx: web_sys::OffscreenCanvasRenderingContext2d = canvas
            .get_context("2d")
            .ok()
            .flatten()
            .ok_or(GpuError::AdapterUnavailable)?
            .unchecked_into();
        ctx.clear_rect(0.0, 0.0, width as f64, height as f64);
        ctx.draw_image_with_html_canvas_element(gl_canvas, 0.0, 0.0)
            .map_err(|_| GpuError::AdapterUnavailable)?;

        Ok(())
    }

    #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
    pub fn render_texture_to_gl_canvas_surface(
        &self,
        texture: &wgpu::Texture,
        width: u32,
        height: u32,
    ) -> Result<&web_sys::HtmlCanvasElement, GpuError> {
        let gl_canvas = self
            .gl_canvas
            .as_ref()
            .ok_or(GpuError::AdapterUnavailable)?;

        gl_canvas.set_width(width);
        gl_canvas.set_height(height);

        let mut cached_surface = self.gl_surface.borrow_mut();
        let cached_surface = match cached_surface.as_mut() {
            Some(cached_surface) => cached_surface,
            None => {
                let surface = self
                    .instance
                    .create_surface(wgpu::SurfaceTarget::Canvas(gl_canvas.clone()))?;
                cached_surface.replace(CachedCanvasSurface {
                    surface,
                    size: (0, 0),
                });
                cached_surface
                    .as_mut()
                    .expect("gl_surface cache should exist after initialization")
            }
        };

        if cached_surface.size != (width, height) {
            self.configure_surface(&cached_surface.surface, width, height)?;
            cached_surface.size = (width, height);
        }

        self.present_texture_to_surface(texture, &cached_surface.surface)?;

        Ok(gl_canvas)
    }

    /// Renders a texture to an arbitrary HTML canvas on the WebGL backend.
    ///
    /// WebGL can only surface-render to the canvas its GL context was originally created on.
    /// This method renders the texture to the GL canvas, then uses drawImage to copy the
    /// result to the target canvas — avoiding the async buffer readback issue entirely.
    ///
    /// The HTML canvas default color space is sRGB, so the surface may report
    /// `Rgba8UnormSrgb` as its preferred format even though our render textures use
    /// `Rgba8Unorm`. We explicitly select `Rgba8Unorm` from the surface's supported
    /// format list (WebGL2 supports both) to avoid the format mismatch.
    #[cfg(all(feature = "wasm", target_arch = "wasm32"))]
    pub fn render_texture_via_gl_canvas(
        &self,
        texture: &wgpu::Texture,
        target_canvas: &web_sys::HtmlCanvasElement,
        width: u32,
        height: u32,
    ) -> Result<(), GpuError> {
        let gl_canvas = self.render_texture_to_gl_canvas_surface(texture, width, height)?;

        let ctx: web_sys::CanvasRenderingContext2d = target_canvas
            .get_context("2d")
            .ok()
            .flatten()
            .ok_or(GpuError::AdapterUnavailable)?
            .unchecked_into();
        ctx.draw_image_with_html_canvas_element(gl_canvas, 0.0, 0.0)
            .map_err(|_| GpuError::AdapterUnavailable)?;

        Ok(())
    }
}

/// Native (non-wasm) texture I/O.
///
/// On the browser, source frames enter the compositor via `import_offscreen_canvas_texture`
/// (a `copy_external_image_to_texture` from a Canvas). Native has no Canvas, so the decoder /
/// raster / test paths hand us a CPU-side tightly-packed RGBA8 buffer that we upload directly.
/// These two helpers are the native replacement for that Canvas path and the readback used by
/// the golden/parity harness.
#[cfg(not(all(feature = "wasm", target_arch = "wasm32")))]
impl GpuContext {
    /// Uploads a tightly-packed (`width * 4` byte-per-row) RGBA8 buffer into a fresh render
    /// texture, swizzling R↔B when the device's native format is `Bgra8Unorm` (Metal / most
    /// desktop backends) so the stored texels match the compositor's expectation.
    ///
    /// `queue.write_texture` imposes **no** 256-byte row-pitch alignment — that constraint is
    /// specific to buffer⇄texture copies — so rows are written at their natural pitch.
    ///
    /// Returns `None` rather than panicking when the buffer length disagrees with `width`/`height`
    /// or either dimension is zero. A mis-sized raster is bad input, and `CLAUDE.md` requires the
    /// render path to degrade on bad input: the caller drops that one layer and still produces a
    /// frame.
    pub fn upload_rgba_texture(
        &self,
        rgba: &[u8],
        width: u32,
        height: u32,
        label: &'static str,
    ) -> Option<wgpu::Texture> {
        if width == 0 || height == 0 {
            return None;
        }
        let expected = (width as usize) * (height as usize) * 4;
        if rgba.len() != expected {
            return None;
        }
        let texture = self.create_render_texture(width, height, label);
        let pixels = self.swizzle_for_native_format(rgba);
        self.queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            &pixels,
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(width * 4),
                rows_per_image: Some(height),
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        Some(texture)
    }

    /// Reads a texture back into a tightly-packed RGBA8 `Vec` (length `width * height * 4`).
    ///
    /// Read `texture` back to CPU in its **native channel order** (BGRA on Metal/DX12, RGBA on
    /// GL). `copy_texture_to_buffer` requires the staging buffer's row pitch to be a multiple of
    /// `COPY_BYTES_PER_ROW_ALIGNMENT` (256), so we copy into a padded buffer then strip the
    /// per-row padding. No channel swizzle — callers pick [`read_texture_rgba`] or
    /// [`read_texture_bgra`] for a specific order. Blocks on `device.poll(Wait)`.
    ///
    /// Returns `None` when the device is lost mid-readback. That is not bad input — it is a
    /// laptop that slept or an eGPU that was unplugged — and it must surface as a failed frame
    /// so the caller can hold its last good one, not as a crash.
    fn read_texture_native(
        &self,
        texture: &wgpu::Texture,
        width: u32,
        height: u32,
    ) -> Option<Vec<u8>> {
        self.read_texture_native_pooled(&mut ReadbackPool::new(), texture, width, height)
    }

    /// [`Self::read_texture_native`], reusing `pool`'s staging buffer instead of allocating one.
    fn read_texture_native_pooled(
        &self,
        pool: &mut ReadbackPool,
        texture: &wgpu::Texture,
        width: u32,
        height: u32,
    ) -> Option<Vec<u8>> {
        let unpadded_bytes_per_row = (width as usize) * 4;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize;
        let padded_bytes_per_row = unpadded_bytes_per_row.div_ceil(align) * align;
        let needed = (padded_bytes_per_row * height as usize) as u64;

        let buffer = pool.acquire(&self.device, needed).clone();

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("gpu-readback-encoder"),
            });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row as u32),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit([encoder.finish()]);

        // Bounded to what this read needs, not to the whole buffer: a pooled buffer is sized to
        // the largest read it has served, and mapping the tail would both stall on bytes nobody
        // wants and misalign the row indexing below.
        let slice = buffer.slice(..needed);
        // The mapping result has to be captured, not discarded. `poll` can return Ok while the
        // map itself failed, and `get_mapped_range` then panics — the exact abort-on-a-bad-frame
        // behaviour this signature exists to remove.
        let mapped_ok = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let reported = std::sync::Arc::clone(&mapped_ok);
        slice.map_async(wgpu::MapMode::Read, move |result| {
            reported.store(result.is_ok(), std::sync::atomic::Ordering::SeqCst);
        });
        if self
            .device
            .poll(wgpu::wgt::PollType::wait_indefinitely())
            .is_err()
        {
            return None;
        }
        if !mapped_ok.load(std::sync::atomic::Ordering::SeqCst) {
            return None;
        }

        let mapped = slice.get_mapped_range();
        let mut out = vec![0u8; unpadded_bytes_per_row * height as usize];
        for row in 0..height as usize {
            let src_start = row * padded_bytes_per_row;
            let dst_start = row * unpadded_bytes_per_row;
            out[dst_start..dst_start + unpadded_bytes_per_row]
                .copy_from_slice(&mapped[src_start..src_start + unpadded_bytes_per_row]);
        }
        drop(mapped);
        buffer.unmap();
        Some(out)
    }

    /// Read `texture` back as canonical **RGBA** (swizzles once on BGRA backends). For tests and
    /// offline export where downstream consumers (PNG, ffmpeg) expect RGBA.
    ///
    /// `None` means the readback failed — see [`Self::read_texture_native`].
    pub fn read_texture_rgba(
        &self,
        texture: &wgpu::Texture,
        width: u32,
        height: u32,
    ) -> Option<Vec<u8>> {
        let mut out = self.read_texture_native(texture, width, height)?;
        if self.texture_format == wgpu::TextureFormat::Bgra8Unorm {
            for texel in out.chunks_exact_mut(4) {
                texel.swap(0, 2);
            }
        }
        Some(out)
    }

    /// Read `texture` back as **BGRA** — the byte order GPUI's `RenderImage` wants. On Metal/DX12
    /// (native BGRA) this is the raw readback with *no* channel swizzle, so the live preview path
    /// avoids a full-buffer pass every frame; only GL backends swap once.
    ///
    /// `None` means the readback failed — see [`Self::read_texture_native`].
    pub fn read_texture_bgra(
        &self,
        texture: &wgpu::Texture,
        width: u32,
        height: u32,
    ) -> Option<Vec<u8>> {
        let mut out = self.read_texture_native(texture, width, height)?;
        self.swizzle_to_bgra(&mut out);
        Some(out)
    }

    /// [`Self::read_texture_bgra`], reusing `pool`'s staging buffer rather than allocating one
    /// per call. This is the live-preview entry point — see [`ReadbackPool`].
    ///
    /// `None` means the readback failed — see [`Self::read_texture_native`].
    pub fn read_texture_bgra_pooled(
        &self,
        pool: &mut ReadbackPool,
        texture: &wgpu::Texture,
        width: u32,
        height: u32,
    ) -> Option<Vec<u8>> {
        let mut out = self.read_texture_native_pooled(pool, texture, width, height)?;
        self.swizzle_to_bgra(&mut out);
        Some(out)
    }

    /// Copy `texture` into `readback`'s staging buffer and start mapping it, **without waiting**.
    ///
    /// Returns `false` and does nothing if a readback is already outstanding — the caller must
    /// collect that one first, which is what keeps the single buffer safe to reuse.
    pub fn begin_readback(
        &self,
        readback: &mut PipelinedReadback,
        texture: &wgpu::Texture,
        width: u32,
        height: u32,
    ) -> bool {
        if readback.in_flight.is_some() {
            return false;
        }

        let unpadded_bytes_per_row = (width as usize) * 4;
        let align = wgpu::COPY_BYTES_PER_ROW_ALIGNMENT as usize;
        let padded_bytes_per_row = unpadded_bytes_per_row.div_ceil(align) * align;
        let needed = (padded_bytes_per_row * height as usize) as u64;

        let buffer = readback.pool.acquire(&self.device, needed).clone();

        let mut encoder = self
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                label: Some("gpu-pipelined-readback-encoder"),
            });
        encoder.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo {
                texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(padded_bytes_per_row as u32),
                    rows_per_image: Some(height),
                },
            },
            wgpu::Extent3d {
                width,
                height,
                depth_or_array_layers: 1,
            },
        );
        self.queue.submit([encoder.finish()]);

        let mapped_ok = std::sync::Arc::new(std::sync::atomic::AtomicU8::new(MAP_PENDING));
        let reported = std::sync::Arc::clone(&mapped_ok);
        buffer
            .slice(..needed)
            .map_async(wgpu::MapMode::Read, move |result| {
                let state = if result.is_ok() { MAP_OK } else { MAP_FAILED };
                reported.store(state, std::sync::atomic::Ordering::SeqCst);
            });

        readback.in_flight = Some(InFlight {
            width,
            height,
            padded_bytes_per_row,
            needed,
            mapped_ok,
        });
        true
    }

    /// Collect an outstanding [`Self::begin_readback`] if the GPU has finished with it.
    ///
    /// Never blocks: `PollType::Poll` checks the device once and returns. A `Pending` result is
    /// the normal case on the frame the copy was submitted.
    pub fn poll_readback(&self, readback: &mut PipelinedReadback) -> ReadbackPoll {
        let Some(in_flight) = readback.in_flight.as_ref() else {
            return ReadbackPoll::Idle;
        };

        // Drives the `map_async` callback. Errors here are device loss, not "not ready yet".
        if self.device.poll(wgpu::wgt::PollType::Poll).is_err() {
            readback.in_flight = None;
            return ReadbackPoll::Failed;
        }

        match in_flight
            .mapped_ok
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            MAP_PENDING => return ReadbackPoll::Pending,
            MAP_OK => {}
            _ => {
                // The buffer was never mapped, so it must not be unmapped — just release it.
                readback.in_flight = None;
                return ReadbackPoll::Failed;
            }
        }

        let InFlight {
            width,
            height,
            padded_bytes_per_row,
            needed,
            ..
        } = *in_flight;
        let Some(buffer) = readback.pool.buffer.as_ref() else {
            readback.in_flight = None;
            return ReadbackPoll::Failed;
        };

        let unpadded_bytes_per_row = (width as usize) * 4;
        let slice = buffer.slice(..needed);
        let mapped = slice.get_mapped_range();
        let mut pixels = vec![0u8; unpadded_bytes_per_row * height as usize];
        for row in 0..height as usize {
            let src = row * padded_bytes_per_row;
            let dst = row * unpadded_bytes_per_row;
            pixels[dst..dst + unpadded_bytes_per_row]
                .copy_from_slice(&mapped[src..src + unpadded_bytes_per_row]);
        }
        drop(mapped);
        buffer.unmap();
        readback.in_flight = None;

        ReadbackPoll::Ready {
            width,
            height,
            pixels,
        }
    }

    /// Wait for an outstanding readback and throw its pixels away, leaving `readback` idle.
    ///
    /// For when what the composite depicts has stopped being what belongs on screen — a
    /// different project was opened — so its pixels must not be presented as the new scene's.
    /// Blocking is fine here: this is not the per-frame path.
    pub fn discard_readback(&self, readback: &mut PipelinedReadback) {
        let Some(in_flight) = readback.in_flight.take() else {
            return;
        };
        if self
            .device
            .poll(wgpu::wgt::PollType::wait_indefinitely())
            .is_err()
        {
            // Whether the buffer ended up mapped is now unknowable, and handing a mapped buffer
            // to the next `copy_texture_to_buffer` is a validation error. Start over instead.
            readback.pool.reset();
            return;
        }
        let mapped = in_flight
            .mapped_ok
            .load(std::sync::atomic::Ordering::SeqCst);
        if mapped == MAP_OK
            && let Some(buffer) = readback.pool.buffer.as_ref()
        {
            buffer.unmap();
        }
    }

    /// Put a native-order readback into BGRA. A no-op on Metal and DX12, whose textures are
    /// already BGRA — only GL backends pay for the pass.
    fn swizzle_to_bgra(&self, out: &mut [u8]) {
        if self.texture_format == wgpu::TextureFormat::Rgba8Unorm {
            for texel in out.chunks_exact_mut(4) {
                texel.swap(0, 2);
            }
        }
    }

    /// Swaps R and B when the native texture format is BGRA so a caller-supplied RGBA buffer
    /// lands in the right channels; a no-op copy on RGBA backends.
    fn swizzle_for_native_format(&self, rgba: &[u8]) -> Vec<u8> {
        let mut bytes = rgba.to_vec();
        if self.texture_format == wgpu::TextureFormat::Bgra8Unorm {
            for texel in bytes.chunks_exact_mut(4) {
                texel.swap(0, 2);
            }
        }
        bytes
    }
}

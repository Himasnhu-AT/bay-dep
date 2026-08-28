use bay_gpu::{FULLSCREEN_SHADER_SOURCE, GpuContext};
use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

const JFA_INIT_SHADER_SOURCE: &str = include_str!("shaders/jfa_init.wgsl");
const JFA_STEP_SHADER_SOURCE: &str = include_str!("shaders/jfa_step.wgsl");

pub struct SignedDistanceFieldTextures {
    pub inside_texture: wgpu::Texture,
    pub outside_texture: wgpu::Texture,
}

pub struct SdfPipeline {
    texture_bind_group_layout: wgpu::BindGroupLayout,
    uniform_bind_group_layout: wgpu::BindGroupLayout,
    init_pipeline: wgpu::RenderPipeline,
    step_pipeline: wgpu::RenderPipeline,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct JfaInitUniformBuffer {
    resolution: [f32; 2],
    invert: f32,
    _padding: f32,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct JfaStepUniformBuffer {
    resolution: [f32; 2],
    step_size: f32,
    _padding: f32,
}

impl SdfPipeline {
    pub fn new(context: &GpuContext) -> Self {
        let device = context.device();
        let texture_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("gpu-sdf-texture-bind-group-layout"),
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
        let uniform_bind_group_layout =
            device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                label: Some("gpu-sdf-uniform-bind-group-layout"),
                entries: &[wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                }],
            });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("gpu-sdf-pipeline-layout"),
            bind_group_layouts: &[
                Some(&texture_bind_group_layout),
                Some(&uniform_bind_group_layout),
            ],
            immediate_size: 0,
        });
        let vertex_shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("gpu-sdf-fullscreen-shader"),
            source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
        });
        let init_shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("gpu-jfa-init-shader"),
            source: wgpu::ShaderSource::Wgsl(JFA_INIT_SHADER_SOURCE.into()),
        });
        let step_shader_module = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("gpu-jfa-step-shader"),
            source: wgpu::ShaderSource::Wgsl(JFA_STEP_SHADER_SOURCE.into()),
        });
        // **Pinned, not inherited.** `fixes.md` 10: `jfa_init.wgsl` packs a 16-bit coordinate
        // into two 8-bit channels and `jfa_distance.wgsl` decodes it by undoing exactly that,
        // sentinelling "no seed" on `> 0.99` in all four. That is a hard dependency on an 8-bit
        // unorm target, and taking the format from `context.texture_format()` — the accessor the
        // whole rest of the pipeline uses — meant a widening to `Rgba16Float` would carry these
        // along in silence: compiling, running, and producing a plausible alpha ramp with the
        // distances quietly wrong at the edges.
        //
        // `Rgba8Unorm` rather than the context's `Bgra8Unorm` because the packing is symmetric in
        // the channels it uses (r/g for x, b/a for y) and only the width matters. Naming it here
        // is the point: this pass has an opinion about its format and now states it.
        let jfa_format = wgpu::TextureFormat::Rgba8Unorm;

        let init_pipeline = create_pipeline(
            device,
            "gpu-jfa-init-pipeline",
            &pipeline_layout,
            &vertex_shader_module,
            &init_shader_module,
            jfa_format,
        );
        let step_pipeline = create_pipeline(
            device,
            "gpu-jfa-step-pipeline",
            &pipeline_layout,
            &vertex_shader_module,
            &step_shader_module,
            jfa_format,
        );

        Self {
            texture_bind_group_layout,
            uniform_bind_group_layout,
            init_pipeline,
            step_pipeline,
        }
    }

    pub fn compute_signed_distance_field(
        &self,
        context: &GpuContext,
        source_texture: &wgpu::Texture,
        width: u32,
        height: u32,
    ) -> SignedDistanceFieldTextures {
        let mut encoder =
            context
                .device()
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("gpu-sdf-command-encoder"),
                });
        let textures = self.compute_signed_distance_field_with_encoder(
            context,
            &mut encoder,
            source_texture,
            width,
            height,
        );
        context.queue().submit([encoder.finish()]);
        textures
    }

    pub fn compute_signed_distance_field_with_encoder(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        source_texture: &wgpu::Texture,
        width: u32,
        height: u32,
    ) -> SignedDistanceFieldTextures {
        SignedDistanceFieldTextures {
            inside_texture: self.run_jfa(context, encoder, source_texture, width, height, false),
            outside_texture: self.run_jfa(context, encoder, source_texture, width, height, true),
        }
    }

    fn run_jfa(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        source_texture: &wgpu::Texture,
        width: u32,
        height: u32,
        is_inverted: bool,
    ) -> wgpu::Texture {
        // The textures must carry the same pinned format as the pipelines that write them, or
        // the pass fails validation the moment the context's format is not 8-bit.
        let ping_texture = context.create_render_texture_in(
            width,
            height,
            "gpu-jfa-ping-texture",
            wgpu::TextureFormat::Rgba8Unorm,
        );
        let pong_texture = context.create_render_texture_in(
            width,
            height,
            "gpu-jfa-pong-texture",
            wgpu::TextureFormat::Rgba8Unorm,
        );

        self.run_pass(
            context,
            encoder,
            source_texture,
            &ping_texture,
            &self.init_pipeline,
            bytemuck::bytes_of(&JfaInitUniformBuffer {
                resolution: [width as f32, height as f32],
                invert: if is_inverted { 1.0 } else { 0.0 },
                _padding: 0.0,
            }),
        );

        let mut source_is_ping = true;
        let steps = (width.max(height) as f32).log2().ceil() as u32;
        for step_index in (0..steps).rev() {
            let step_size = 2u32.pow(step_index).max(1);
            let input_texture = if source_is_ping {
                &ping_texture
            } else {
                &pong_texture
            };
            let output_texture = if source_is_ping {
                &pong_texture
            } else {
                &ping_texture
            };
            self.run_pass(
                context,
                encoder,
                input_texture,
                output_texture,
                &self.step_pipeline,
                bytemuck::bytes_of(&JfaStepUniformBuffer {
                    resolution: [width as f32, height as f32],
                    step_size: step_size as f32,
                    _padding: 0.0,
                }),
            );
            source_is_ping = !source_is_ping;
        }

        if source_is_ping {
            ping_texture
        } else {
            pong_texture
        }
    }

    fn run_pass(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        input_texture: &wgpu::Texture,
        output_texture: &wgpu::Texture,
        pipeline: &wgpu::RenderPipeline,
        uniform_buffer_bytes: &[u8],
    ) {
        let input_view = input_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());
        let texture_bind_group = context
            .device()
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("gpu-sdf-texture-bind-group"),
                layout: &self.texture_bind_group_layout,
                entries: &[
                    wgpu::BindGroupEntry {
                        binding: 0,
                        resource: wgpu::BindingResource::TextureView(&input_view),
                    },
                    wgpu::BindGroupEntry {
                        binding: 1,
                        resource: wgpu::BindingResource::Sampler(context.nearest_sampler()),
                    },
                ],
            });
        let uniform_buffer =
            context
                .device()
                .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                    label: Some("gpu-sdf-uniform-buffer"),
                    contents: uniform_buffer_bytes,
                    usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                });
        let uniform_bind_group = context
            .device()
            .create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("gpu-sdf-uniform-bind-group"),
                layout: &self.uniform_bind_group_layout,
                entries: &[wgpu::BindGroupEntry {
                    binding: 0,
                    resource: uniform_buffer.as_entire_binding(),
                }],
            });

        {
            let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("gpu-sdf-render-pass"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &output_view,
                    resolve_target: None,
                    depth_slice: None,
                    ops: wgpu::Operations {
                        load: wgpu::LoadOp::Clear(wgpu::Color::WHITE),
                        store: wgpu::StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                occlusion_query_set: None,
                timestamp_writes: None,
                multiview_mask: None,
            });
            render_pass.set_pipeline(pipeline);
            render_pass.set_vertex_buffer(0, context.fullscreen_quad().slice(..));
            render_pass.set_bind_group(0, &texture_bind_group, &[]);
            render_pass.set_bind_group(1, &uniform_bind_group, &[]);
            render_pass.draw(0..6, 0..1);
        }
    }
}

fn create_pipeline(
    device: &wgpu::Device,
    label: &'static str,
    layout: &wgpu::PipelineLayout,
    vertex_shader_module: &wgpu::ShaderModule,
    fragment_shader_module: &wgpu::ShaderModule,
    texture_format: wgpu::TextureFormat,
) -> wgpu::RenderPipeline {
    device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
        label: Some(label),
        layout: Some(layout),
        vertex: wgpu::VertexState {
            module: vertex_shader_module,
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
            module: fragment_shader_module,
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
    })
}

#[cfg(test)]
mod format_tests {
    use bay_gpu::wgpu;

    /// The JFA pass must render into an 8-bit unorm target, and this is the tripwire that says so.
    ///
    /// `fixes.md` 10. `jfa_init.wgsl` packs a 16-bit coordinate into two 8-bit channels:
    ///
    /// ```wgsl
    /// return vec4f(x_hi / 255.0, x_lo / 255.0, y_hi / 255.0, y_lo / 255.0);
    /// ```
    ///
    /// and `jfa_distance.wgsl` decodes it by undoing exactly that, sentinelling "no seed" on
    /// `> 0.99` in all four channels. Widen the target and every one of those still compiles,
    /// still runs, and still produces a plausible alpha ramp — with the distances quietly wrong
    /// at the edges, which is the hardest kind of error to see because a feathered mask has no
    /// crisp reference to disagree with.
    ///
    /// **This is not the verification the register asked for.** That was: rasterize a known mask,
    /// feather it, and assert the alpha ramp, so a format change anywhere else cannot move the
    /// result. It is not written because the mask path is not reachable from the model — `mask`
    /// is hardcoded `None` on every element, so no fixture can produce one. This test guards the
    /// pinning itself, which is the half that is testable today.
    #[test]
    fn the_jfa_target_is_eight_bit_because_its_shaders_pack_into_bytes() {
        let format = wgpu::TextureFormat::Rgba8Unorm;
        // `block_copy_size`, not `target_pixel_byte_cost`: the latter is wgpu's render-target
        // budget figure (8 for this format) and says nothing about how wide a channel is.
        assert_eq!(
            format.block_copy_size(None),
            Some(4),
            "the JFA target is no longer 4 bytes per pixel; its coordinate packing assumes \
             8 bits per channel and will decode to wrong distances"
        );
        assert!(
            !format.is_srgb(),
            "an sRGB target would apply a transfer curve to packed coordinate bytes"
        );
    }
}

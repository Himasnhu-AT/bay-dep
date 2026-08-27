use std::collections::HashMap;

use bay_gpu::{FULLSCREEN_SHADER_SOURCE, GpuContext};
use bytemuck::{Pod, Zeroable};
use thiserror::Error;
use wgpu::util::DeviceExt;

use crate::{EffectPass, UniformValue};

const GAUSSIAN_BLUR_SHADER_ID: &str = "gaussian-blur";
const GAUSSIAN_BLUR_SHADER_SOURCE: &str = include_str!("shaders/gaussian_blur.wgsl");
const BRIGHTNESS_SHADER_ID: &str = "brightness";
const BRIGHTNESS_SHADER_SOURCE: &str = include_str!("shaders/brightness.wgsl");
const CONTRAST_SHADER_ID: &str = "contrast";
const CONTRAST_SHADER_SOURCE: &str = include_str!("shaders/contrast.wgsl");
const SATURATION_SHADER_ID: &str = "saturation";
const SATURATION_SHADER_SOURCE: &str = include_str!("shaders/saturation.wgsl");
const LUT_SHADER_ID: &str = "lut";
const LUT_SHADER_SOURCE: &str = include_str!("shaders/lut.wgsl");
const DROP_SHADOW_SHADER_ID: &str = "drop-shadow";
const DROP_SHADOW_SHADER_SOURCE: &str = include_str!("shaders/drop_shadow.wgsl");

pub struct ApplyEffectsOptions<'a> {
    pub source: &'a wgpu::Texture,
    pub width: u32,
    pub height: u32,
    pub passes: &'a [EffectPass],
}

pub struct EffectPipeline {
    uniform_bind_group_layout: wgpu::BindGroupLayout,
    pipelines: HashMap<String, wgpu::RenderPipeline>,
    /// The LUT shader needs a third bind group (a 3D texture + its sampler), which the other
    /// effects have no use for — so it gets its own layout rather than every effect paying for
    /// a binding it ignores.
    lut_bind_group_layout: wgpu::BindGroupLayout,
    lut_sampler: wgpu::Sampler,
    /// Uploaded cubes, by the id the pass named. A grade repeated across twenty clips and
    /// every frame of each is one upload.
    lut_textures: std::cell::RefCell<HashMap<String, wgpu::Texture>>,
}

#[derive(Debug, Error)]
pub enum EffectsError {
    #[error("At least one effect pass is required")]
    MissingEffectPasses,
    #[error("Unknown effect shader '{shader}'")]
    UnknownEffectShader { shader: String },
    #[error("Missing uniform '{uniform}' for shader '{shader}'")]
    MissingUniform { shader: String, uniform: String },
    #[error("Uniform '{uniform}' for shader '{shader}' must be a number")]
    InvalidNumberUniform { shader: String, uniform: String },
    #[error(
        "Uniform '{uniform}' for shader '{shader}' must be a vector of length {expected_length}"
    )]
    InvalidVectorUniform {
        shader: String,
        uniform: String,
        expected_length: usize,
    },
    #[error("Shader '{shader}' does not support uniform '{uniform}'")]
    UnsupportedUniform { shader: String, uniform: String },
    #[error("The 'lut' effect needs a lookup table, and this pass carries none")]
    MissingLut,
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct EffectUniformBuffer {
    resolution: [f32; 2],
    direction: [f32; 2],
    scalars: [f32; 4],
    /// A colour a pass may need beyond its scalars — the shadow tint today.
    ///
    /// Every shader declares the same `EffectUniforms` struct, so this field exists in all of
    /// them whether or not they read it. Appended rather than inserted: `vec4f` wants 16-byte
    /// alignment and the three fields before it already total 32 bytes.
    color: [f32; 4],
}

impl EffectPipeline {
    pub fn new(context: &GpuContext) -> Self {
        let uniform_bind_group_layout =
            context
                .device()
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("effects-uniform-bind-group-layout"),
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
        let vertex_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-fullscreen-shader"),
                    source: wgpu::ShaderSource::Wgsl(FULLSCREEN_SHADER_SOURCE.into()),
                });
        let gaussian_blur_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-gaussian-blur-shader"),
                    source: wgpu::ShaderSource::Wgsl(GAUSSIAN_BLUR_SHADER_SOURCE.into()),
                });
        let drop_shadow_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-drop-shadow-shader"),
                    source: wgpu::ShaderSource::Wgsl(DROP_SHADOW_SHADER_SOURCE.into()),
                });
        let brightness_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-brightness-shader"),
                    source: wgpu::ShaderSource::Wgsl(BRIGHTNESS_SHADER_SOURCE.into()),
                });
        let contrast_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-contrast-shader"),
                    source: wgpu::ShaderSource::Wgsl(CONTRAST_SHADER_SOURCE.into()),
                });
        let saturation_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-saturation-shader"),
                    source: wgpu::ShaderSource::Wgsl(SATURATION_SHADER_SOURCE.into()),
                });
        let lut_shader_module =
            context
                .device()
                .create_shader_module(wgpu::ShaderModuleDescriptor {
                    label: Some("effects-lut-shader"),
                    source: wgpu::ShaderSource::Wgsl(LUT_SHADER_SOURCE.into()),
                });
        let pipeline_layout =
            context
                .device()
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("effects-pipeline-layout"),
                    bind_group_layouts: &[
                        Some(context.texture_sampler_bind_group_layout()),
                        Some(&uniform_bind_group_layout),
                    ],
                    immediate_size: 0,
                });
        let lut_bind_group_layout =
            context
                .device()
                .create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
                    label: Some("effects-lut-bind-group-layout"),
                    entries: &[
                        wgpu::BindGroupLayoutEntry {
                            binding: 0,
                            visibility: wgpu::ShaderStages::FRAGMENT,
                            ty: wgpu::BindingType::Texture {
                                sample_type: wgpu::TextureSampleType::Float { filterable: true },
                                view_dimension: wgpu::TextureViewDimension::D3,
                                multisampled: false,
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
        let lut_pipeline_layout =
            context
                .device()
                .create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
                    label: Some("effects-lut-pipeline-layout"),
                    bind_group_layouts: &[
                        Some(context.texture_sampler_bind_group_layout()),
                        Some(&uniform_bind_group_layout),
                        Some(&lut_bind_group_layout),
                    ],
                    immediate_size: 0,
                });
        // Linear between entries, clamped at the edges. A 33-cube is coarse; nearest sampling
        // would band every gradient in the frame.
        let lut_sampler = context.device().create_sampler(&wgpu::SamplerDescriptor {
            label: Some("effects-lut-sampler"),
            address_mode_u: wgpu::AddressMode::ClampToEdge,
            address_mode_v: wgpu::AddressMode::ClampToEdge,
            address_mode_w: wgpu::AddressMode::ClampToEdge,
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        // Every effect shares the fullscreen vertex stage, uniform layout, and target
        // format; only the fragment shader differs. `create_effect_pipeline` captures
        // that shared descriptor so adding an effect is one shader module + one entry.
        let pipelines = HashMap::from([
            (
                GAUSSIAN_BLUR_SHADER_ID.to_string(),
                create_effect_pipeline(
                    context,
                    &pipeline_layout,
                    &vertex_shader_module,
                    &gaussian_blur_shader_module,
                    "effects-gaussian-blur-pipeline",
                ),
            ),
            (
                DROP_SHADOW_SHADER_ID.to_string(),
                create_effect_pipeline(
                    context,
                    &pipeline_layout,
                    &vertex_shader_module,
                    &drop_shadow_shader_module,
                    "effects-drop-shadow-pipeline",
                ),
            ),
            (
                BRIGHTNESS_SHADER_ID.to_string(),
                create_effect_pipeline(
                    context,
                    &pipeline_layout,
                    &vertex_shader_module,
                    &brightness_shader_module,
                    "effects-brightness-pipeline",
                ),
            ),
            (
                CONTRAST_SHADER_ID.to_string(),
                create_effect_pipeline(
                    context,
                    &pipeline_layout,
                    &vertex_shader_module,
                    &contrast_shader_module,
                    "effects-contrast-pipeline",
                ),
            ),
            (
                SATURATION_SHADER_ID.to_string(),
                create_effect_pipeline(
                    context,
                    &pipeline_layout,
                    &vertex_shader_module,
                    &saturation_shader_module,
                    "effects-saturation-pipeline",
                ),
            ),
            (
                LUT_SHADER_ID.to_string(),
                create_effect_pipeline(
                    context,
                    &lut_pipeline_layout,
                    &vertex_shader_module,
                    &lut_shader_module,
                    "effects-lut-pipeline",
                ),
            ),
        ]);

        Self {
            uniform_bind_group_layout,
            pipelines,
            lut_bind_group_layout,
            lut_sampler,
            lut_textures: std::cell::RefCell::new(HashMap::new()),
        }
    }

    pub fn apply(
        &self,
        context: &GpuContext,
        ApplyEffectsOptions {
            source,
            width,
            height,
            passes,
        }: ApplyEffectsOptions<'_>,
    ) -> Result<wgpu::Texture, EffectsError> {
        let mut encoder =
            context
                .device()
                .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                    label: Some("effects-command-encoder"),
                });
        let output = self.apply_with_encoder(
            context,
            &mut encoder,
            ApplyEffectsOptions {
                source,
                width,
                height,
                passes,
            },
        )?;
        context.queue().submit([encoder.finish()]);
        Ok(output)
    }

    pub fn apply_with_encoder(
        &self,
        context: &GpuContext,
        encoder: &mut wgpu::CommandEncoder,
        ApplyEffectsOptions {
            source,
            width,
            height,
            passes,
        }: ApplyEffectsOptions<'_>,
    ) -> Result<wgpu::Texture, EffectsError> {
        let mut current_texture: Option<wgpu::Texture> = None;

        for pass in passes {
            let input_texture = current_texture.as_ref().unwrap_or(source);
            let output_texture =
                context.create_render_texture(width, height, "effects-pass-output");
            let input_view = input_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let output_view = output_texture.create_view(&wgpu::TextureViewDescriptor::default());
            let texture_bind_group =
                context
                    .device()
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("effects-texture-bind-group"),
                        layout: context.texture_sampler_bind_group_layout(),
                        entries: &[
                            wgpu::BindGroupEntry {
                                binding: 0,
                                resource: wgpu::BindingResource::TextureView(&input_view),
                            },
                            wgpu::BindGroupEntry {
                                binding: 1,
                                resource: wgpu::BindingResource::Sampler(context.linear_sampler()),
                            },
                        ],
                    });
            let uniform_buffer =
                context
                    .device()
                    .create_buffer_init(&wgpu::util::BufferInitDescriptor {
                        label: Some("effects-uniform-buffer"),
                        contents: bytemuck::bytes_of(&pack_effect_uniforms(pass, width, height)?),
                        usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
                    });
            let uniform_bind_group =
                context
                    .device()
                    .create_bind_group(&wgpu::BindGroupDescriptor {
                        label: Some("effects-uniform-bind-group"),
                        layout: &self.uniform_bind_group_layout,
                        entries: &[wgpu::BindGroupEntry {
                            binding: 0,
                            resource: uniform_buffer.as_entire_binding(),
                        }],
                    });
            let pipeline = self.pipelines.get(&pass.shader).ok_or_else(|| {
                EffectsError::UnknownEffectShader {
                    shader: pass.shader.clone(),
                }
            })?;
            // The grade's own bind group. Built per pass because the texture it points at is
            // cached across frames but the view and group are cheap.
            let lut_bind_group = if pass.shader == LUT_SHADER_ID {
                let (id, table) = pass.lut.as_ref().ok_or(EffectsError::MissingLut)?;
                let view = {
                    let mut cache = self.lut_textures.borrow_mut();
                    let texture = cache
                        .entry(id.clone())
                        .or_insert_with(|| upload_lut(context, table));
                    texture.create_view(&wgpu::TextureViewDescriptor {
                        dimension: Some(wgpu::TextureViewDimension::D3),
                        ..Default::default()
                    })
                };
                Some(
                    context
                        .device()
                        .create_bind_group(&wgpu::BindGroupDescriptor {
                            label: Some("effects-lut-bind-group"),
                            layout: &self.lut_bind_group_layout,
                            entries: &[
                                wgpu::BindGroupEntry {
                                    binding: 0,
                                    resource: wgpu::BindingResource::TextureView(&view),
                                },
                                wgpu::BindGroupEntry {
                                    binding: 1,
                                    resource: wgpu::BindingResource::Sampler(&self.lut_sampler),
                                },
                            ],
                        }),
                )
            } else {
                None
            };

            {
                let mut render_pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                    label: Some("effects-render-pass"),
                    color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                        view: &output_view,
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
                render_pass.set_pipeline(pipeline);
                render_pass.set_vertex_buffer(0, context.fullscreen_quad().slice(..));
                render_pass.set_bind_group(0, &texture_bind_group, &[]);
                render_pass.set_bind_group(1, &uniform_bind_group, &[]);
                if let Some(lut) = lut_bind_group.as_ref() {
                    render_pass.set_bind_group(2, lut, &[]);
                }
                render_pass.draw(0..6, 0..1);
            }

            current_texture = Some(output_texture);
        }

        current_texture.ok_or(EffectsError::MissingEffectPasses)
    }
}

/// Upload a parsed cube as an RGBA32F 3D texture.
///
/// Float rather than 8-bit: a LUT's whole job is to move colours precisely, and quantising the
/// table to 256 steps before sampling it puts banding back into the thing that was meant to
/// remove it.
fn upload_lut(context: &GpuContext, table: &crate::Lut3d) -> wgpu::Texture {
    let size = table.size;
    let texture = context.device().create_texture(&wgpu::TextureDescriptor {
        label: Some("effects-lut-texture"),
        size: wgpu::Extent3d {
            width: size,
            height: size,
            depth_or_array_layers: size,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D3,
        format: wgpu::TextureFormat::Rgba16Float,
        usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
        view_formats: &[],
    });
    context.queue().write_texture(
        wgpu::TexelCopyTextureInfo {
            texture: &texture,
            mip_level: 0,
            origin: wgpu::Origin3d::ZERO,
            aspect: wgpu::TextureAspect::All,
        },
        &table.to_half_bytes(),
        wgpu::TexelCopyBufferLayout {
            offset: 0,
            bytes_per_row: Some(size * 8), // RGBA × f16
            rows_per_image: Some(size),
        },
        wgpu::Extent3d {
            width: size,
            height: size,
            depth_or_array_layers: size,
        },
    );
    texture
}

fn create_effect_pipeline(
    context: &GpuContext,
    layout: &wgpu::PipelineLayout,
    vertex_module: &wgpu::ShaderModule,
    fragment_module: &wgpu::ShaderModule,
    label: &str,
) -> wgpu::RenderPipeline {
    context
        .device()
        .create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some(label),
            layout: Some(layout),
            vertex: wgpu::VertexState {
                module: vertex_module,
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
                module: fragment_module,
                entry_point: Some("fragment_main"),
                targets: &[Some(wgpu::ColorTargetState {
                    format: context.texture_format(),
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

/// Pack a pass's uniforms into the shared `EffectUniformBuffer`. Each shader owns
/// its own uniform contract; unknown uniform names are rejected so a mismatched
/// pass fails loudly instead of silently rendering wrong.
fn pack_effect_uniforms(
    pass: &EffectPass,
    width: u32,
    height: u32,
) -> Result<EffectUniformBuffer, EffectsError> {
    let resolution = [width as f32, height as f32];
    match pass.shader.as_str() {
        GAUSSIAN_BLUR_SHADER_ID => {
            let sigma = read_number_uniform(pass, "u_sigma")?;
            let step = read_number_uniform(pass, "u_step")?;
            let direction = read_vec2_uniform(pass, "u_direction")?;
            reject_unsupported_uniforms(pass, &["u_sigma", "u_step", "u_direction"])?;
            Ok(EffectUniformBuffer {
                resolution,
                direction,
                scalars: [sigma, step, 0.0, 0.0],
                color: [0.0; 4],
            })
        }
        BRIGHTNESS_SHADER_ID | CONTRAST_SHADER_ID | SATURATION_SHADER_ID => {
            // These three share one contract: a single `u_amount` in scalars.x.
            let amount = read_number_uniform(pass, "u_amount")?;
            reject_unsupported_uniforms(pass, &["u_amount"])?;
            Ok(EffectUniformBuffer {
                resolution,
                direction: [0.0, 0.0],
                scalars: [amount, 0.0, 0.0, 0.0],
                color: [0.0; 4],
            })
        }
        LUT_SHADER_ID => {
            let amount = read_number_uniform(pass, "u_amount")?;
            reject_unsupported_uniforms(pass, &["u_amount"])?;
            // The cube's edge length travels in the uniform because the shader needs it to
            // land on texel centres, and it is a property of the table rather than of the
            // pass — so it is read from the table rather than trusted from a uniform nobody
            // would remember to set.
            let size = pass
                .lut
                .as_ref()
                .map(|(_, table)| table.size as f32)
                .ok_or(EffectsError::MissingLut)?;
            Ok(EffectUniformBuffer {
                resolution,
                direction: [0.0, 0.0],
                scalars: [amount, size, 0.0, 0.0],
                color: [0.0; 4],
            })
        }
        DROP_SHADOW_SHADER_ID => {
            let offset = read_vec2_uniform(pass, "u_offset")?;
            let sigma = read_number_uniform(pass, "u_sigma")?;
            let opacity = read_number_uniform(pass, "u_opacity")?;
            let spread = read_number_uniform(pass, "u_spread")?;
            let color = read_vec3_uniform(pass, "u_color")?;
            reject_unsupported_uniforms(
                pass,
                &["u_offset", "u_sigma", "u_opacity", "u_spread", "u_color"],
            )?;
            Ok(EffectUniformBuffer {
                resolution,
                // The offset rides in `direction` because it is the one vec2 the shared
                // uniform already carries, and no pass uses both a blur axis and an offset.
                direction: offset,
                scalars: [sigma, opacity, spread, 0.0],
                color: [color[0], color[1], color[2], 0.0],
            })
        }
        other => Err(EffectsError::UnknownEffectShader {
            shader: other.to_string(),
        }),
    }
}

fn reject_unsupported_uniforms(pass: &EffectPass, allowed: &[&str]) -> Result<(), EffectsError> {
    for uniform in pass.uniforms.keys() {
        if !allowed.contains(&uniform.as_str()) {
            return Err(EffectsError::UnsupportedUniform {
                shader: pass.shader.clone(),
                uniform: uniform.clone(),
            });
        }
    }
    Ok(())
}

fn read_number_uniform(pass: &EffectPass, uniform: &str) -> Result<f32, EffectsError> {
    let Some(value) = pass.uniforms.get(uniform) else {
        return Err(EffectsError::MissingUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        });
    };
    match value {
        UniformValue::Number(value) => Ok(*value),
        UniformValue::Vector(_) => Err(EffectsError::InvalidNumberUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        }),
    }
}

fn read_vec3_uniform(pass: &EffectPass, uniform: &str) -> Result<[f32; 3], EffectsError> {
    let Some(value) = pass.uniforms.get(uniform) else {
        return Err(EffectsError::MissingUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        });
    };
    let UniformValue::Vector(values) = value else {
        return Err(EffectsError::InvalidVectorUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
            expected_length: 3,
        });
    };
    if values.len() != 3 {
        return Err(EffectsError::InvalidVectorUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
            expected_length: 3,
        });
    }
    Ok([values[0], values[1], values[2]])
}

fn read_vec2_uniform(pass: &EffectPass, uniform: &str) -> Result<[f32; 2], EffectsError> {
    let Some(value) = pass.uniforms.get(uniform) else {
        return Err(EffectsError::MissingUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
        });
    };
    let UniformValue::Vector(values) = value else {
        return Err(EffectsError::InvalidVectorUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
            expected_length: 2,
        });
    };
    if values.len() != 2 {
        return Err(EffectsError::InvalidVectorUniform {
            shader: pass.shader.clone(),
            uniform: uniform.to_string(),
            expected_length: 2,
        });
    }
    Ok([values[0], values[1]])
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::UniformValue;

    fn pass(shader: &str, uniforms: &[(&str, UniformValue)]) -> EffectPass {
        EffectPass {
            shader: shader.to_string(),
            uniforms: uniforms
                .iter()
                .map(|(k, v)| ((*k).to_string(), v.clone()))
                .collect(),
            lut: None,
        }
    }

    #[test]
    fn packs_drop_shadow_offset_scalars_and_tint() {
        let p = pass(
            DROP_SHADOW_SHADER_ID,
            &[
                ("u_offset", UniformValue::Vector(vec![3.0, -7.0])),
                ("u_sigma", UniformValue::Number(12.0)),
                ("u_opacity", UniformValue::Number(0.4)),
                ("u_spread", UniformValue::Number(0.25)),
                ("u_color", UniformValue::Vector(vec![0.1, 0.2, 0.3])),
            ],
        );
        let packed = pack_effect_uniforms(&p, 1920, 1080).expect("the pass packs");
        // The offset rides in `direction`; nothing else in the chain uses both.
        assert_eq!(packed.direction, [3.0, -7.0]);
        assert_eq!(packed.scalars, [12.0, 0.4, 0.25, 0.0]);
        assert_eq!(packed.color, [0.1, 0.2, 0.3, 0.0]);
    }

    #[test]
    fn drop_shadow_rejects_a_two_component_tint() {
        // A vec2 where a vec3 belongs would otherwise read as black with no complaint.
        let p = pass(
            DROP_SHADOW_SHADER_ID,
            &[
                ("u_offset", UniformValue::Vector(vec![0.0, 8.0])),
                ("u_sigma", UniformValue::Number(4.0)),
                ("u_opacity", UniformValue::Number(0.2)),
                ("u_spread", UniformValue::Number(0.0)),
                ("u_color", UniformValue::Vector(vec![0.1, 0.2])),
            ],
        );
        assert!(pack_effect_uniforms(&p, 64, 64).is_err());
    }

    #[test]
    fn packs_brightness_amount_into_first_scalar() {
        let p = pass(
            BRIGHTNESS_SHADER_ID,
            &[("u_amount", UniformValue::Number(1.5))],
        );
        let packed = pack_effect_uniforms(&p, 1920, 1080).unwrap();
        assert_eq!(packed.scalars[0], 1.5);
        assert_eq!(packed.resolution, [1920.0, 1080.0]);
        assert_eq!(packed.direction, [0.0, 0.0]);
    }

    #[test]
    fn brightness_rejects_unknown_uniforms() {
        let p = pass(
            BRIGHTNESS_SHADER_ID,
            &[
                ("u_amount", UniformValue::Number(1.0)),
                ("u_bogus", UniformValue::Number(0.0)),
            ],
        );
        assert!(matches!(
            pack_effect_uniforms(&p, 1, 1),
            Err(EffectsError::UnsupportedUniform { .. })
        ));
    }

    #[test]
    fn brightness_requires_its_amount() {
        let p = pass(BRIGHTNESS_SHADER_ID, &[]);
        assert!(matches!(
            pack_effect_uniforms(&p, 1, 1),
            Err(EffectsError::MissingUniform { .. })
        ));
    }

    #[test]
    fn still_packs_gaussian_blur() {
        let p = pass(
            GAUSSIAN_BLUR_SHADER_ID,
            &[
                ("u_sigma", UniformValue::Number(2.0)),
                ("u_step", UniformValue::Number(1.0)),
                ("u_direction", UniformValue::Vector(vec![1.0, 0.0])),
            ],
        );
        let packed = pack_effect_uniforms(&p, 100, 200).unwrap();
        assert_eq!(packed.scalars[0], 2.0);
        assert_eq!(packed.scalars[1], 1.0);
        assert_eq!(packed.direction, [1.0, 0.0]);
    }

    #[test]
    fn unknown_shader_is_rejected() {
        let p = pass("sepia", &[("u_amount", UniformValue::Number(1.0))]);
        assert!(matches!(
            pack_effect_uniforms(&p, 1, 1),
            Err(EffectsError::UnknownEffectShader { .. })
        ));
    }

    #[test]
    fn packs_contrast_and_saturation_amount() {
        for shader in [CONTRAST_SHADER_ID, SATURATION_SHADER_ID] {
            let p = pass(shader, &[("u_amount", UniformValue::Number(0.75))]);
            let packed = pack_effect_uniforms(&p, 640, 360).unwrap();
            assert_eq!(packed.scalars[0], 0.75, "shader {shader}");
            assert_eq!(packed.resolution, [640.0, 360.0]);
        }
    }

    #[test]
    fn contrast_and_saturation_reject_unknown_uniforms() {
        for shader in [CONTRAST_SHADER_ID, SATURATION_SHADER_ID] {
            let p = pass(
                shader,
                &[
                    ("u_amount", UniformValue::Number(1.0)),
                    ("u_bogus", UniformValue::Number(0.0)),
                ],
            );
            assert!(
                matches!(
                    pack_effect_uniforms(&p, 1, 1),
                    Err(EffectsError::UnsupportedUniform { .. })
                ),
                "shader {shader} should reject unknown uniforms"
            );
        }
    }
}

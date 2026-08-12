use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct EffectPass {
    pub shader: String,
    pub uniforms: HashMap<String, UniformValue>,
    /// The lookup table this pass grades through, for the `lut` shader.
    ///
    /// Carried as data rather than as a texture handle so the pass stays describable without a
    /// GPU — the pipeline caches the upload by `id`, and a pass repeated across frames and
    /// clips uploads once.
    #[allow(clippy::type_complexity)]
    pub lut: Option<(String, std::sync::Arc<crate::Lut3d>)>,
}

#[derive(Clone, Debug)]
pub enum UniformValue {
    Number(f32),
    Vector(Vec<f32>),
}

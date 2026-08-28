use std::collections::HashMap;

use bay_gpu::{GpuContext, wgpu};

type TextureKey = (u32, u32);

/// Frames a size class may go unused before its textures are dropped.
///
/// The pool keys by `(width, height)` and never removed a key, so it retained the high-water mark
/// of **every size ever rendered** for the life of the compositor. The interactive preview is one
/// fixed size and never noticed; a caller that sweeps size does. The snapshot tool renders at
/// twenty scales of the canvas, and each frame acquires four or five intermediates, so twenty
/// scales off a 1080p canvas is on the order of 500 MB held after the sweep finished.
///
/// Generous, because dropping a size class the next frame asks for again means reallocating a
/// render texture rather than reusing one, which is the cost the pool exists to avoid. At 60 fps
/// this is two seconds of not being used.
const IDLE_FRAMES_BEFORE_DROP: u32 = 120;

#[derive(Default)]
pub struct TexturePool {
    available: HashMap<TextureKey, Vec<wgpu::Texture>>,
    in_use: Vec<(TextureKey, wgpu::Texture)>,
    /// Frames since each size class was last acquired. See [`IDLE_FRAMES_BEFORE_DROP`].
    idle: HashMap<TextureKey, u32>,
}

impl TexturePool {
    pub fn recycle_frame(&mut self) {
        for (key, texture) in self.in_use.drain(..) {
            self.idle.insert(key, 0);
            self.available.entry(key).or_default().push(texture);
        }
        // Age every class that this frame did not touch, and drop the ones that have gone cold.
        // Done here rather than in `acquire` because a size class is only ever *retired* by not
        // being asked for, and `acquire` is not called for the sizes that matter.
        self.idle.retain(|key, idle| {
            *idle += 1;
            if *idle > IDLE_FRAMES_BEFORE_DROP {
                available_remove(&mut self.available, key);
                return false;
            }
            true
        });
    }

    /// Size classes currently retained.
    ///
    /// `cfg(test)` because nothing outside the tests reads it and clippy is `-D warnings`. It is
    /// the only observable the trimming has, so it exists for the test that proves a cold class
    /// is dropped rather than as an API anyone is expected to call.
    #[cfg(test)]
    pub fn size_classes(&self) -> usize {
        self.available.len()
    }

    pub fn acquire(
        &mut self,
        context: &GpuContext,
        width: u32,
        height: u32,
        label: &'static str,
    ) -> wgpu::Texture {
        let key = (width, height);
        let texture = self
            .available
            .get_mut(&key)
            .and_then(Vec::pop)
            .unwrap_or_else(|| context.create_render_texture(width, height, label));
        self.idle.insert(key, 0);
        self.in_use.push((key, texture.clone()));
        texture
    }
}

/// Drop a size class's retained textures. Free function so it can be called from inside
/// `HashMap::retain`, which already holds a mutable borrow of `idle`.
fn available_remove(available: &mut HashMap<TextureKey, Vec<wgpu::Texture>>, key: &TextureKey) {
    available.remove(key);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A size class that stops being asked for is eventually dropped.
    ///
    /// `fixes.md` 16b. Without this the pool holds the high-water mark of every size ever
    /// rendered, which only bites a caller that varies frame size — the snapshot tool sweeps
    /// twenty scales — but holds hundreds of megabytes when it does.
    ///
    /// Exercised through the bookkeeping alone: acquiring needs a GPU, and what is under test is
    /// when a class is retired, not what a texture is.
    #[test]
    fn a_size_class_that_goes_cold_is_dropped() {
        let mut pool = TexturePool::default();
        pool.available.insert((1920, 1080), Vec::new());
        pool.idle.insert((1920, 1080), 0);
        pool.available.insert((640, 360), Vec::new());
        pool.idle.insert((640, 360), 0);
        assert_eq!(pool.size_classes(), 2);

        for _ in 0..=IDLE_FRAMES_BEFORE_DROP {
            // The preview's size stays live; the other is never asked for again.
            pool.idle.insert((640, 360), 0);
            pool.recycle_frame();
        }

        assert_eq!(
            pool.size_classes(),
            1,
            "a cold size class was retained for the compositor's life"
        );
        assert!(
            pool.available.contains_key(&(640, 360)),
            "the size class still in use was dropped, which costs a reallocation every frame"
        );
    }
}

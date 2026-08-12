//! `.cube` 3D lookup tables — the format every grading tool exports and every look pack ships.
//!
//! A LUT is the difference between "turn the saturation up a bit" and a grade: one file maps
//! every input colour to an output colour, so the same look lands identically on twenty clips
//! and can be authored somewhere else by somebody who does this for a living. It is the single
//! highest-leverage thing in the picture path, because one shader unlocks a whole library of
//! them.
//!
//! Parsing is here, GPU-free, so a malformed file is a clear error rather than a black frame.

use std::fmt;

/// The largest cube edge accepted. 33 and 65 are the sizes tools actually emit; 256³ would be
/// a 64-million-entry table, and a file claiming that is corrupt or hostile rather than
/// ambitious.
const MAX_SIZE: usize = 128;

/// A parsed 3D lookup table, ready to upload as an RGBA texture.
#[derive(Clone, PartialEq)]
pub struct Lut3d {
    /// Edge length of the cube. `size³` entries.
    pub size: u32,
    /// RGBA, row-major with red varying fastest — which is both `.cube` order and the layout a
    /// 3D texture upload expects, so the data goes to the GPU without a transpose.
    pub rgba: Vec<f32>,
}

impl fmt::Debug for Lut3d {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // The payload is tens of thousands of floats; printing it helps nobody.
        f.debug_struct("Lut3d")
            .field("size", &self.size)
            .field("entries", &(self.rgba.len() / 4))
            .finish()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LutError {
    NoSizeDeclared,
    UnreasonableSize(usize),
    /// The file declared `size³` entries and delivered a different number.
    WrongEntryCount {
        expected: usize,
        found: usize,
    },
    BadLine {
        line: usize,
        text: String,
    },
}

impl fmt::Display for LutError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            LutError::NoSizeDeclared => write!(
                f,
                "the file never declares LUT_3D_SIZE, so it is not a 3D cube — 1D LUTs \
                 (LUT_1D_SIZE) are a different thing and bay does not apply them"
            ),
            LutError::UnreasonableSize(size) => write!(
                f,
                "LUT_3D_SIZE is {size}; a real cube is 2..={MAX_SIZE} on a side (17, 33 and 65 \
                 are what tools emit)"
            ),
            LutError::WrongEntryCount { expected, found } => write!(
                f,
                "the file declares {expected} entries and contains {found} — it is truncated \
                 or its size line does not match its data"
            ),
            LutError::BadLine { line, text } => {
                write!(f, "line {line} is not three numbers: {text:?}")
            }
        }
    }
}

impl std::error::Error for LutError {}

impl Lut3d {
    /// Parse Adobe/Resolve `.cube` text.
    ///
    /// Deliberately lenient about the things that vary between exporters — comments, blank
    /// lines, `TITLE`, `DOMAIN_MIN`/`DOMAIN_MAX`, Windows line endings — and strict about the
    /// two that decide whether the result is a grade or garbage: the declared size, and the
    /// number of entries that follow it.
    pub fn parse_cube(text: &str) -> Result<Self, LutError> {
        let mut size: Option<usize> = None;
        let mut rgba: Vec<f32> = Vec::new();

        for (index, raw) in text.lines().enumerate() {
            let line = raw.split('#').next().unwrap_or("").trim();
            if line.is_empty() {
                continue;
            }
            let mut parts = line.split_whitespace();
            let Some(head) = parts.next() else {
                continue;
            };
            match head {
                "LUT_3D_SIZE" => {
                    let declared: usize = parts
                        .next()
                        .and_then(|value| value.parse().ok())
                        .ok_or_else(|| LutError::BadLine {
                            line: index + 1,
                            text: line.to_string(),
                        })?;
                    if !(2..=MAX_SIZE).contains(&declared) {
                        return Err(LutError::UnreasonableSize(declared));
                    }
                    size = Some(declared);
                }
                // Metadata bay does not need. `DOMAIN_MIN`/`MAX` other than 0..1 would change
                // the mapping, but every LUT in circulation uses the default, and silently
                // mis-applying one is worse than ignoring a line nobody writes.
                "TITLE" | "LUT_1D_SIZE" | "DOMAIN_MIN" | "DOMAIN_MAX" => continue,
                _ => {
                    let mut values = [0.0f32; 3];
                    let mut count = 0;
                    for (slot, token) in values.iter_mut().zip(line.split_whitespace()) {
                        let Ok(value) = token.parse::<f32>() else {
                            return Err(LutError::BadLine {
                                line: index + 1,
                                text: line.to_string(),
                            });
                        };
                        *slot = value;
                        count += 1;
                    }
                    if count != 3 {
                        return Err(LutError::BadLine {
                            line: index + 1,
                            text: line.to_string(),
                        });
                    }
                    rgba.extend_from_slice(&[values[0], values[1], values[2], 1.0]);
                }
            }
        }

        let size = size.ok_or(LutError::NoSizeDeclared)?;
        let expected = size * size * size;
        let found = rgba.len() / 4;
        if found != expected {
            return Err(LutError::WrongEntryCount { expected, found });
        }
        Ok(Self {
            size: size as u32,
            rgba,
        })
    }

    /// The identity cube: every colour maps to itself. Useful as a fallback and as the thing a
    /// test compares against to prove a LUT is being applied at all.
    pub fn identity(size: u32) -> Self {
        let size = size.clamp(2, MAX_SIZE as u32);
        let last = (size - 1) as f32;
        let mut rgba = Vec::with_capacity((size * size * size * 4) as usize);
        for b in 0..size {
            for g in 0..size {
                for r in 0..size {
                    rgba.extend_from_slice(&[
                        r as f32 / last,
                        g as f32 / last,
                        b as f32 / last,
                        1.0,
                    ]);
                }
            }
        }
        Self { size, rgba }
    }

    /// The table as half-float bytes, for a texture upload.
    ///
    /// `Rgba16Float` rather than `Rgba32Float` because only the 16-bit form is guaranteed
    /// *filterable* — and a LUT that cannot be linearly sampled bands every gradient it
    /// touches, which is the opposite of what a grade is for. Half floats carry about three
    /// decimal digits, which is far more than a 33-entry cube resolves.
    pub fn to_half_bytes(&self) -> Vec<u8> {
        let halves: Vec<half::f16> = self.rgba.iter().map(|v| half::f16::from_f32(*v)).collect();
        bytemuck::cast_slice(&halves).to_vec()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A minimal but complete cube: 2 on a side, eight entries, the identity.
    const TINY: &str = "\
# a comment
TITLE \"tiny\"
LUT_3D_SIZE 2

0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
";

    #[test]
    fn a_well_formed_cube_parses_in_red_fastest_order() {
        let lut = Lut3d::parse_cube(TINY).expect("parses");
        assert_eq!(lut.size, 2);
        assert_eq!(lut.rgba.len(), 8 * 4);
        // Second entry is red = 1 with green and blue still 0, which is what "red varies
        // fastest" means and what the 3D texture upload expects.
        assert_eq!(&lut.rgba[4..8], &[1.0, 0.0, 0.0, 1.0]);
    }

    #[test]
    fn comments_blank_lines_and_metadata_are_ignored() {
        let messy = TINY.replace("LUT_3D_SIZE 2", "DOMAIN_MIN 0 0 0\nLUT_3D_SIZE 2\n\n# mid");
        assert_eq!(Lut3d::parse_cube(&messy).unwrap().size, 2);
    }

    #[test]
    fn windows_line_endings_parse() {
        let lut = Lut3d::parse_cube(&TINY.replace('\n', "\r\n")).expect("parses");
        assert_eq!(lut.size, 2);
    }

    /// A truncated file is the common real failure — a partial download, or a LUT edited by
    /// hand. It has to be an error naming both numbers, not a grade that is quietly wrong in
    /// its top half.
    #[test]
    fn a_truncated_cube_says_what_is_missing() {
        let truncated = TINY.rsplit_once("0.0 1.0 1.0").unwrap().0.to_string();
        match Lut3d::parse_cube(&truncated) {
            Err(LutError::WrongEntryCount { expected, found }) => {
                assert_eq!(expected, 8);
                assert_eq!(found, 6);
            }
            other => panic!("expected a count error, got {other:?}"),
        }
    }

    #[test]
    fn a_file_with_no_size_is_refused_with_the_reason() {
        let no_size = TINY.replace("LUT_3D_SIZE 2\n", "");
        let error = Lut3d::parse_cube(&no_size).expect_err("not a 3D cube");
        assert_eq!(error, LutError::NoSizeDeclared);
        assert!(error.to_string().contains("LUT_1D_SIZE"), "{error}");
    }

    /// A size nobody could mean is refused before it allocates: 256³ is 64 million entries.
    #[test]
    fn an_absurd_size_is_refused_before_allocating() {
        let huge = TINY.replace("LUT_3D_SIZE 2", "LUT_3D_SIZE 4096");
        assert!(matches!(
            Lut3d::parse_cube(&huge),
            Err(LutError::UnreasonableSize(4096))
        ));
    }

    #[test]
    fn a_line_that_is_not_three_numbers_names_itself() {
        let broken = TINY.replace("0.0 1.0 0.0", "0.0 nope 0.0");
        match Lut3d::parse_cube(&broken) {
            Err(LutError::BadLine { text, .. }) => assert!(text.contains("nope"), "{text}"),
            other => panic!("expected a line error, got {other:?}"),
        }
    }

    #[test]
    fn the_identity_maps_every_corner_to_itself() {
        let lut = Lut3d::identity(2);
        assert_eq!(lut.size, 2);
        assert_eq!(&lut.rgba[0..4], &[0.0, 0.0, 0.0, 1.0]);
        assert_eq!(&lut.rgba[28..32], &[1.0, 1.0, 1.0, 1.0]);
        // And it is exactly what the same cube written out as a file parses to.
        assert_eq!(Lut3d::parse_cube(TINY).unwrap(), lut);
    }
}

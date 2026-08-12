//! The built-in look library: grades bay ships as *code* rather than as files.
//!
//! A look pack would normally be a download — someone else's `.cube` files, with someone
//! else's licence attached. These are generated instead: each look is a function from colour to
//! colour, evaluated over a cube at load time. That buys three things worth more than the
//! variety a purchased pack would add:
//!
//! 1. **Nothing downloads.** A look is available on a machine that has never been online,
//!    which is the same promise the rest of bay makes.
//! 2. **No licence question.** There is nothing to redistribute — the grade is a few lines of
//!    arithmetic, not an asset with terms.
//! 3. **They cannot go missing.** A `.cube` on disk is a path that can break; a built-in look
//!    is the same grade on every machine, forever.
//!
//! A user's own `.cube` files are still first-class — `lut` takes a path, and that is how a
//! grade authored in Resolve gets in. This is the floor, not the ceiling.

use crate::lut::Lut3d;

/// Edge length of every generated cube.
///
/// 33 is what grading tools emit and what the eye stops resolving: the sampler interpolates
/// between entries, so a smooth curve needs far fewer points than it looks like it should.
const SIZE: u32 = 33;

/// One named grade.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Look {
    /// Stable id, used by tools and stored in projects.
    pub id: &'static str,
    pub name: &'static str,
    /// What it does and when to reach for it — this is what an agent reads to choose.
    pub description: &'static str,
}

/// Every look bay knows, in the order a picker should show them.
pub const LOOKS: &[Look] = &[
    Look {
        id: "neutral-contrast",
        name: "Neutral Contrast",
        description: "A gentle S-curve: deeper blacks, brighter highlights, colour left alone. The \
             default finish for footage that looks flat straight off a phone.",
    },
    Look {
        id: "teal-orange",
        name: "Teal & Orange",
        description: "Warm skin against cool shadows — the blockbuster grade. Strong; dial it back with \
             amount for anything that is not a hero shot.",
    },
    Look {
        id: "bleach-bypass",
        name: "Bleach Bypass",
        description: "Desaturated and high-contrast, like skipping the bleach step in a film lab. Grit, \
             documentary, anything that should not look pretty.",
    },
    Look {
        id: "warm-film",
        name: "Warm Film",
        description: "Lifted, slightly milky blacks with a warm cast. Reads as film stock rather than \
             sensor. Good under type.",
    },
    Look {
        id: "cool-night",
        name: "Cool Night",
        description: "Crushes and cools the low end without touching highlights. Turns evening footage \
             into night without making it muddy.",
    },
    Look {
        id: "mono",
        name: "Monochrome",
        description: "Rec. 709 luma with a slight contrast lift. Black and white that does not \
             go flat.",
    },
];

impl Look {
    pub fn by_id(id: &str) -> Option<&'static Look> {
        LOOKS.iter().find(|look| look.id == id)
    }

    /// Build this look's cube.
    pub fn to_lut(&self) -> Lut3d {
        let last = (SIZE - 1) as f32;
        let mut rgba = Vec::with_capacity((SIZE * SIZE * SIZE * 4) as usize);
        for b in 0..SIZE {
            for g in 0..SIZE {
                for r in 0..SIZE {
                    let input = [r as f32 / last, g as f32 / last, b as f32 / last];
                    let out = self.map(input);
                    rgba.extend_from_slice(&[
                        out[0].clamp(0.0, 1.0),
                        out[1].clamp(0.0, 1.0),
                        out[2].clamp(0.0, 1.0),
                        1.0,
                    ]);
                }
            }
        }
        Lut3d { size: SIZE, rgba }
    }

    /// The grade itself: one colour in, one colour out.
    fn map(&self, [r, g, b]: [f32; 3]) -> [f32; 3] {
        let luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        match self.id {
            "neutral-contrast" => [s_curve(r, 0.18), s_curve(g, 0.18), s_curve(b, 0.18)],
            "teal-orange" => {
                // Warm what is already bright (skin, faces), cool what is not (shadows,
                // backgrounds). Split by luma rather than by hue so it does not need to know
                // what it is looking at.
                let warmth = smoothstep(0.35, 0.75, luma);
                let cool = 1.0 - warmth;
                [
                    s_curve(r + 0.10 * warmth - 0.03 * cool, 0.16),
                    s_curve(g + 0.01 * warmth, 0.16),
                    s_curve(b - 0.06 * warmth + 0.12 * cool, 0.16),
                ]
            }
            "bleach-bypass" => {
                // Pull hard towards luma, then push contrast back in. Saturation last, or the
                // contrast would just re-saturate what was removed.
                let desaturated = |c: f32| luma + (c - luma) * 0.35;
                [
                    s_curve(desaturated(r), 0.34),
                    s_curve(desaturated(g), 0.34),
                    s_curve(desaturated(b), 0.34),
                ]
            }
            "warm-film" => {
                // A lifted floor is what separates "film" from "sensor": true black never
                // appears in a print.
                let lift = |c: f32| 0.045 + c * 0.955;
                [
                    lift(s_curve(r, 0.12) + 0.035),
                    lift(s_curve(g, 0.12) + 0.012),
                    lift(s_curve(b, 0.12) - 0.02),
                ]
            }
            "cool-night" => {
                let shadow = 1.0 - smoothstep(0.0, 0.55, luma);
                [
                    (r - 0.05 * shadow) * 0.94,
                    (g - 0.01 * shadow) * 0.97,
                    b + 0.07 * shadow,
                ]
            }
            "mono" => {
                let v = s_curve(luma, 0.15);
                [v, v, v]
            }
            // An unknown id maps to itself. Unreachable through `by_id`, and an identity is a
            // better failure than a black frame.
            _ => [r, g, b],
        }
    }
}

/// A contrast S-curve of `strength`, pivoting about mid-grey. Strength 0 is the identity.
fn s_curve(value: f32, strength: f32) -> f32 {
    let v = value.clamp(0.0, 1.0);
    // smoothstep is the S; mixing towards it by `strength` scales how much of it applies.
    let curved = v * v * (3.0 - 2.0 * v);
    v + (curved - v) * strength.clamp(0.0, 1.0) * 3.0
}

fn smoothstep(edge0: f32, edge1: f32, x: f32) -> f32 {
    if edge1 <= edge0 {
        return if x < edge0 { 0.0 } else { 1.0 };
    }
    let t = ((x - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(lut: &Lut3d, r: f32, g: f32, b: f32) -> [f32; 3] {
        let last = (lut.size - 1) as f32;
        let index = |v: f32| (v.clamp(0.0, 1.0) * last).round() as u32;
        let (ri, gi, bi) = (index(r), index(g), index(b));
        let offset = ((bi * lut.size * lut.size + gi * lut.size + ri) * 4) as usize;
        [lut.rgba[offset], lut.rgba[offset + 1], lut.rgba[offset + 2]]
    }

    #[test]
    fn every_look_builds_a_well_formed_cube() {
        for look in LOOKS {
            let lut = look.to_lut();
            assert_eq!(lut.size, SIZE, "{}", look.id);
            assert_eq!(
                lut.rgba.len(),
                (SIZE * SIZE * SIZE * 4) as usize,
                "{}",
                look.id
            );
            assert!(
                lut.rgba
                    .iter()
                    .all(|v| v.is_finite() && (0.0..=1.0).contains(v)),
                "{} produced a value outside 0..1",
                look.id
            );
        }
    }

    /// Ids are stored in projects, so a rename is a broken grade in someone's saved film.
    #[test]
    fn look_ids_are_unique_and_resolvable() {
        for look in LOOKS {
            assert_eq!(Look::by_id(look.id).map(|l| l.name), Some(look.name));
            assert_eq!(
                LOOKS.iter().filter(|other| other.id == look.id).count(),
                1,
                "duplicate id {}",
                look.id
            );
        }
        assert!(Look::by_id("nope").is_none());
    }

    /// Every look must actually change something, or it is a menu entry that does nothing.
    #[test]
    fn no_look_is_secretly_the_identity() {
        let identity = Lut3d::identity(SIZE);
        for look in LOOKS {
            assert_ne!(look.to_lut(), identity, "{} grades nothing", look.id);
        }
    }

    /// Black and white must stay black and white in the looks that do not deliberately lift
    /// them — a grade that tints the whitest highlight is a grade nobody can key against.
    #[test]
    fn contrast_looks_keep_their_ends() {
        let lut = Look::by_id("neutral-contrast").unwrap().to_lut();
        let black = sample(&lut, 0.0, 0.0, 0.0);
        let white = sample(&lut, 1.0, 1.0, 1.0);
        assert!(black.iter().all(|v| *v < 0.02), "{black:?}");
        assert!(white.iter().all(|v| *v > 0.98), "{white:?}");
    }

    #[test]
    fn monochrome_leaves_no_colour_behind() {
        let lut = Look::by_id("mono").unwrap().to_lut();
        for (r, g, b) in [(1.0, 0.0, 0.0), (0.2, 0.7, 0.4), (0.0, 0.0, 1.0)] {
            let out = sample(&lut, r, g, b);
            assert!(
                (out[0] - out[1]).abs() < 1e-4 && (out[1] - out[2]).abs() < 1e-4,
                "{r},{g},{b} came out as {out:?}"
            );
        }
    }

    /// The look is named for what it does: warm highlights, cool shadows. If that ever stops
    /// being true the name is a lie.
    #[test]
    fn teal_and_orange_warms_the_light_and_cools_the_dark() {
        let lut = Look::by_id("teal-orange").unwrap().to_lut();
        let highlight = sample(&lut, 0.8, 0.8, 0.8);
        assert!(
            highlight[0] > highlight[2],
            "a bright neutral should come out warm: {highlight:?}"
        );
        let shadow = sample(&lut, 0.15, 0.15, 0.15);
        assert!(
            shadow[2] > shadow[0],
            "a dark neutral should come out cool: {shadow:?}"
        );
    }

    /// A lifted floor is the whole point of the film look; asserting it stops a future tweak
    /// from quietly turning it back into a digital black.
    #[test]
    fn warm_film_lifts_its_blacks() {
        let lut = Look::by_id("warm-film").unwrap().to_lut();
        let black = sample(&lut, 0.0, 0.0, 0.0);
        assert!(black[0] > 0.03, "blacks should be lifted, got {black:?}");
        assert!(black[0] > black[2], "and warm, got {black:?}");
    }

    #[test]
    fn bleach_bypass_removes_saturation() {
        let lut = Look::by_id("bleach-bypass").unwrap().to_lut();
        let graded = sample(&lut, 0.9, 0.2, 0.2);
        let spread_before: f32 = 0.9 - 0.2;
        let spread_after = graded[0] - graded[1];
        assert!(
            spread_after < spread_before,
            "colour should be pulled towards grey: {graded:?}"
        );
    }
}

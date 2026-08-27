//! The six pages, and how the bar that switches them behaves at any window width.
//!
//! Shaped after [`crate::settings_model::Pane`] — `ALL`, a label, a glyph, a blurb — because that
//! is the existing multi-pane precedent in this tree and a second shape for the same idea is how
//! two navigation surfaces drift apart.
//!
//! **A page is a method on `EditorView`, not its own GPUI view.** Every piece of editor state
//! already lives on that struct and survives a page switch for free. The moment a page becomes
//! its own view, the `PreviewRenderer` and its atlas bookkeeping, the audio output, the waveform
//! cache, undo history and presets all have to be hoisted somewhere shared — which is the same
//! reason the shell keeps one editor entity across projects.
//!
//! Everything here is GPUI-free and unit-testable: the page bar's whole responsive behaviour is
//! [`BarLayout::for_width`], so the numbers cannot drift and the small-window case is asserted
//! rather than hoped for.

/// The six pages, in pipeline order.
///
/// Six is the ceiling, not the target. `docs/native/pages.md`: if Media and Deliver stay thin
/// they are the two to fold back into Cut.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Page {
    Media,
    Cut,
    Motion,
    Color,
    Audio,
    Deliver,
}

impl Default for Page {
    /// Cut, because assembly is where a project is opened to work on, not where it is imported.
    fn default() -> Self {
        Page::Cut
    }
}

impl Page {
    pub const ALL: [Page; 6] = [
        Page::Media,
        Page::Cut,
        Page::Motion,
        Page::Color,
        Page::Audio,
        Page::Deliver,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Page::Media => "Media",
            Page::Cut => "Cut",
            Page::Motion => "Motion",
            Page::Color => "Color",
            Page::Audio => "Audio",
            Page::Deliver => "Deliver",
        }
    }

    /// The glyph over the label.
    ///
    /// Text rather than an icon font, the same call `bay_core::blocks::Panel::glyph` makes and
    /// for the same reason: bay ships no icon font, and a missing glyph draws as a hollow box.
    /// Now that `draw::Shape` exists these could be real drawn icons, which would match the
    /// approved prototype more closely; that is a deliberate follow-up, not part of this
    /// milestone.
    pub fn glyph(self) -> &'static str {
        match self {
            Page::Media => "▤",
            Page::Cut => "✂",
            Page::Motion => "∿",
            Page::Color => "◑",
            Page::Audio => "♪",
            Page::Deliver => "⇧",
        }
    }

    /// What the page owns. Shown on the pages that are not built yet, so the placeholder is a
    /// statement of scope rather than the word "soon".
    pub fn blurb(self) -> &'static str {
        match self {
            Page::Media => {
                "Getting footage off disk and describing it. The only page that touches the \
                 filesystem; every other page browses the pool."
            }
            Page::Cut => {
                "Fast assembly. Source tape, dual timeline, and the smart-edit set — deliberately \
                 a smaller vocabulary than a full edit page."
            }
            Page::Motion => {
                "How a thing moves. Curve and keyframe editors, layer composition over one clip, \
                 masks and shapes. Not a node graph — that is ruled out."
            }
            Page::Color => {
                "Per-shot image manipulation. Node list, palettes, scopes, gallery. Never a place \
                 where a wheel turns and nothing renders."
            }
            Page::Audio => {
                "Everything that happens to sound. Mixer, buses, meters, loudness, automation — \
                 with faders that are actually audible."
            }
            Page::Deliver => {
                "Output. Settings, range, queue. Not a second, ungated output path beside the \
                 toolbar's Export."
            }
        }
    }

    /// What the engine still owes this page, from `docs/native/pages.md`.
    ///
    /// On screen under [`blurb`](Self::blurb), because a page that is empty for a reason is worth
    /// more than a page that is empty. `None` for Cut, which is the page that exists today.
    pub fn engine_gap(self) -> Option<&'static str> {
        match self {
            Page::Media => None,
            Page::Cut => None,
            // Motion's gap is closed: M5 landed bezier handles on `Keyframe`, keyframe ids that
            // survive a move, `MoveKeyframe`/`SetKeyframeCurve` and the property descriptor
            // table. `editor/motion.rs` draws its value axis from that table and drags handles
            // through those commands, so leaving the warning up would make the map lie.
            Page::Motion => None,
            Page::Color => Some(
                "Waiting on the engine: lift/gamma/gain, curves, qualifier and windows. Exactly \
                 four colour operations compile to a shader today. Scopes need no GPU work.",
            ),
            Page::Audio => Some(
                "Waiting on the engine: there is no real-time audio path, no pan anywhere in the \
                 codebase, and no track-level gain or solo.",
            ),
            // Deliver's gap is closed: the encode runs on a worker with its own GPU device,
            // through the same `render` the MCP server calls, so the queue's bars move and both
            // output paths meet the same gate. Leaving the warning up after the fix would make
            // the map of remaining engine work lie in the other direction.
            Page::Deliver => None,
        }
    }

    /// A stable identifier for persistence.
    ///
    /// Deliberately not `Debug` and not the index: a settings file that survives a reordering of
    /// the enum is worth the six lines, and it means `bay-settings` stores a string it can
    /// validate rather than a UI type it would have to depend on.
    pub fn id(self) -> &'static str {
        match self {
            Page::Media => "media",
            Page::Cut => "cut",
            Page::Motion => "motion",
            Page::Color => "color",
            Page::Audio => "audio",
            Page::Deliver => "deliver",
        }
    }

    /// The inverse of [`id`](Self::id). Unknown ids fall back to the default rather than
    /// failing — a settings file naming a page this build removed must not lock the user out.
    pub fn from_id(id: &str) -> Option<Self> {
        Page::ALL.into_iter().find(|page| page.id() == id)
    }

    /// Position in the bar, and therefore the digit that selects it: Media is 1, Deliver is 6.
    pub fn index(self) -> usize {
        Page::ALL
            .iter()
            .position(|page| *page == self)
            .expect("every page is in ALL")
    }
}

/// The bar's fixed height. Permanent chrome on every page, which is why `pages.md` counts it
/// against the window budget.
pub const BAR_HEIGHT: f32 = 46.0;

/// Width of one page button with its label, and without.
const TAB_WIDE: f32 = 82.0;
const TAB_ICON: f32 = 46.0;
// Six of these plus the 92px right-hand cluster and insets must fit 320px, the narrowest
// window `the_bar_fits_every_window_it_is_given` asserts: 6 × 36 + 92 = 308. At 40 it came to
// 332 and overflowed by twelve, which is the kind of thing that looks fine at 1440 and clips
// on a laptop with a panel open.
const TAB_TIGHT: f32 = 36.0;

/// Widths at which the bar gives something up. Named, because "it looked fine on my monitor" is
/// how the toolbar came to collide with itself.
const WORDMARK_FLOOR: f32 = 1100.0;
const LABEL_FLOOR: f32 = 700.0;
const TIGHT_FLOOR: f32 = 480.0;

/// What the page bar shows at a given window width.
///
/// Six buttons at [`TAB_WIDE`] is 492px before the wordmark or the right-hand cluster, so the bar
/// does not fit a narrow window and something has to go. The order it goes in is a decision, not
/// an accident:
///
/// 1. **The wordmark first.** It is a signature, not a control — it anchors the left edge so the
///    centred group reads as centred, and nothing breaks when it is gone.
/// 2. **The labels next.** Six glyphs in pipeline order stay readable; six truncated words do not.
/// 3. **The tabs get tighter last.**
///
/// The right-hand cluster never goes. `pages.md` puts project library and settings outside the
/// centred group precisely so a mis-aimed click never leaves the project, and hiding them does
/// not serve that.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BarLayout {
    pub tab_width: f32,
    pub show_labels: bool,
    pub show_wordmark: bool,
}

impl BarLayout {
    pub fn for_width(window_width: f32) -> Self {
        let width = if window_width.is_finite() {
            window_width
        } else {
            0.0
        };
        if width >= WORDMARK_FLOOR {
            Self {
                tab_width: TAB_WIDE,
                show_labels: true,
                show_wordmark: true,
            }
        } else if width >= LABEL_FLOOR {
            Self {
                tab_width: TAB_WIDE,
                show_labels: true,
                show_wordmark: false,
            }
        } else if width >= TIGHT_FLOOR {
            Self {
                tab_width: TAB_ICON,
                show_labels: false,
                show_wordmark: false,
            }
        } else {
            Self {
                tab_width: TAB_TIGHT,
                show_labels: false,
                show_wordmark: false,
            }
        }
    }

    /// Width of the six buttons together — what has to fit between the two flanking clusters.
    pub fn tabs_width(self) -> f32 {
        self.tab_width * Page::ALL.len() as f32
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_page_is_distinct_in_every_way_it_is_shown() {
        let mut labels: Vec<&str> = Page::ALL.iter().map(|page| page.label()).collect();
        let mut glyphs: Vec<&str> = Page::ALL.iter().map(|page| page.glyph()).collect();
        let mut ids: Vec<&str> = Page::ALL.iter().map(|page| page.id()).collect();
        for list in [&mut labels, &mut glyphs, &mut ids] {
            let total = list.len();
            list.sort_unstable();
            list.dedup();
            assert_eq!(
                list.len(),
                total,
                "two pages present themselves the same way"
            );
        }
    }

    /// A page whose blurb is empty is a placeholder that says nothing, which is the thing
    /// `pages.md` rules out.
    #[test]
    fn every_page_says_what_it_owns() {
        for page in Page::ALL {
            assert!(page.blurb().len() > 40, "{} has no blurb", page.label());
            assert!(!page.label().is_empty());
            assert!(!page.glyph().is_empty());
        }
    }

    /// The engine gaps are the map of remaining work, and a map is only worth having if it is
    /// current in **both** directions: an unbuilt page must say what it is waiting for, and a
    /// page whose gap has been closed must stop saying it.
    ///
    /// Only the first half is machine-checkable, and it is worth being clear about why. "Is
    /// this page built?" is not a fact in the code — nothing here can tell a `None` that means
    /// "done" from a `None` somebody forgot to fill in. So this test pins the wording of every
    /// gap that exists, and Cut, which has never had one; **clearing a gap is part of landing
    /// the page milestone that closes it**, and `todo.pages.md` is the record of which have.
    ///
    /// Leaving a warning up after closing the gap it names makes the map lie in the direction
    /// nobody checks — Deliver's said "a progress bar cannot move" while the queue's bars were
    /// moving.
    #[test]
    fn every_engine_gap_says_what_it_is_waiting_for() {
        assert_eq!(
            Page::Cut.engine_gap(),
            None,
            "Cut is the page that has always existed"
        );
        for page in Page::ALL {
            let Some(gap) = page.engine_gap() else {
                continue;
            };
            assert!(
                gap.starts_with("Waiting on the engine:"),
                "{} should say what it is waiting for",
                page.label()
            );
            assert!(
                gap.len() > 60,
                "{}'s gap is too short to name anything concrete",
                page.label()
            );
        }
    }

    #[test]
    fn ids_round_trip_and_nonsense_is_refused() {
        for page in Page::ALL {
            assert_eq!(Page::from_id(page.id()), Some(page));
        }
        assert_eq!(Page::from_id("fusion"), None);
        assert_eq!(Page::from_id(""), None);
    }

    #[test]
    fn the_index_is_the_digit_that_selects_it() {
        assert_eq!(Page::Media.index(), 0);
        assert_eq!(Page::Deliver.index(), 5);
        for (position, page) in Page::ALL.into_iter().enumerate() {
            assert_eq!(page.index(), position);
        }
    }

    /// The whole point of the ladder: the bar has to fit. `pages.md` requires every page to be
    /// looked at at 1440×900 *and* at a small window, and the toolbar already collides with
    /// itself when narrow.
    #[test]
    fn the_bar_fits_every_window_it_is_given() {
        // The two right-hand buttons, their gap, and both 16px insets.
        const FLANKS: f32 = 27.0 * 2.0 + 6.0 + 32.0;
        for width in [
            320.0, 400.0, 480.0, 640.0, 700.0, 900.0, 1100.0, 1440.0, 2560.0,
        ] {
            let layout = BarLayout::for_width(width);
            assert!(
                layout.tabs_width() + FLANKS <= width,
                "at {width}px the bar needs {} + {FLANKS} and has {width}",
                layout.tabs_width()
            );
        }
    }

    /// The order things are given up in is the decision. A bar that dropped the labels before the
    /// wordmark would be keeping a signature at the cost of navigation.
    #[test]
    fn the_wordmark_goes_before_the_labels() {
        let wide = BarLayout::for_width(1440.0);
        assert!(wide.show_wordmark && wide.show_labels);

        let medium = BarLayout::for_width(900.0);
        assert!(!medium.show_wordmark, "the signature goes first");
        assert!(medium.show_labels, "and the labels stay");

        let narrow = BarLayout::for_width(640.0);
        assert!(!narrow.show_labels);
        assert!(narrow.tab_width < wide.tab_width);

        let tiny = BarLayout::for_width(320.0);
        assert!(tiny.tab_width < narrow.tab_width);
    }

    /// The ladder must never widen as the window narrows, or a resize makes the bar jump about.
    #[test]
    fn narrowing_never_makes_the_bar_wider() {
        let mut previous = f32::INFINITY;
        for step in (200..2600).step_by(20).rev() {
            let layout = BarLayout::for_width(step as f32);
            assert!(
                layout.tabs_width() <= previous,
                "the bar grew as the window shrank, at {step}px"
            );
            previous = layout.tabs_width();
        }
    }

    /// A viewport size can be zero during a resize, and a NaN would poison every width derived
    /// from it. Neither may produce a bar that cannot be drawn.
    #[test]
    fn a_degenerate_window_still_produces_a_drawable_bar() {
        for width in [0.0, -100.0, f32::NAN, f32::INFINITY] {
            let layout = BarLayout::for_width(width);
            assert!(layout.tab_width > 0.0 && layout.tab_width.is_finite());
        }
    }
}

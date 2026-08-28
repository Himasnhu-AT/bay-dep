//! The media page — getting footage off disk and describing it.
//!
//! The one page that touches the filesystem. Everything else browses the pool it fills.
//!
//! A child module of [`super`], so it can reach `EditorView`'s private fields; a sibling could
//! not. The contract is `docs/native/pages.md`, and two of its rules shape every line here:
//! a page is a *method* on `EditorView`, never its own GPUI view, and **a control the engine
//! cannot back is drawn disabled rather than hidden** — the disabled controls are the map of the
//! remaining engine work, and that map is worth having on screen.
//!
//! ## What this page will not show you
//!
//! [`MediaAsset`] carries `id`, `name`, `path` and five `Option`s. It has **no `kind` field, no
//! frame rate and no codec**, and `bay_preview::probe` parses none of those. So the metadata
//! panel shows what the model holds — duration, resolution, loudness, transcript — with an
//! absent value drawn **"unknown", never "0"**: `project.rs` says in as many words that absent
//! means "cannot check", not "the file is empty". Frame rate and codec are drawn as *disabled*
//! rows naming what is missing, because a page that shows six honest rows beats one that shows
//! twelve with six of them lying, and because hiding the gap is how it stops being work anyone
//! remembers to do. Adding them properly is two serde-default fields on `MediaAsset` plus
//! `codec_name`/`r_frame_rate` in `probe.rs`, and it belongs in `bay-project`/`bay-preview`,
//! not here.
//!
//! Bins, Power Bins and Smart Bins are not in the project model either; nor is scene-cut
//! detection, nor proxies, nor audio sync. All of them are on screen, all of them disabled.
//!
//! ## The bands
//!
//! `pages.md` calls the transport band the horizon line of the app: it must land at the same
//! distance from the window top on every page that has one. Media drops the *timeline* band, so
//! the space Cut spends on its scene bar and timeline is spent here on the media pool — which is
//! also where a media page's browser belongs. See [`POOL_BAND`].

use super::*;

/// Which way the pool draws its assets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PoolView {
    #[default]
    Thumbnails,
    List,
}

/// What the pool is currently showing.
///
/// One value rather than two independent filters, because a storage folder and a kind group are
/// two answers to the same question and letting both be live at once means neither heading on
/// screen describes what is under it.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum PoolFilter {
    /// Every asset in the project.
    #[default]
    All,
    /// Everything that came out of one directory. The directory is real — it is where the files
    /// on disk actually are — which is the only folder hierarchy bay has.
    Folder(String),
    /// One of the three kind groups.
    Kind(MediaKind),
}

/// The Media page's own state.
///
/// A value type, per `pages.md` rule 5: `pixels_per_second` and `scroll_x` were single fields on
/// `EditorView` and two timelines on one page fought over them. Everything the media page
/// remembers is here instead, so it can be built, mutated and asserted on without a window.
#[derive(Debug, Clone, PartialEq)]
pub struct MediaPageState {
    /// The asset the source viewer and the metadata panel are describing. An id, not an index:
    /// deleting an asset must not silently re-point the panel at its neighbour.
    pub selected: Option<String>,
    pub view: PoolView,
    pub filter: PoolFilter,
    /// The two panels the top chrome toggles. Open by default — a page whose panels start closed
    /// looks like a page that failed to load.
    pub show_storage: bool,
    pub show_metadata: bool,
}

impl Default for MediaPageState {
    fn default() -> Self {
        Self {
            selected: None,
            view: PoolView::default(),
            filter: PoolFilter::default(),
            show_storage: true,
            show_metadata: true,
        }
    }
}

impl MediaPageState {
    /// Whether `asset` belongs in the pool as it is currently filtered.
    pub fn admits(&self, asset: &MediaAsset) -> bool {
        match &self.filter {
            PoolFilter::All => true,
            PoolFilter::Folder(folder) => parent_folder(&asset.path) == *folder,
            PoolFilter::Kind(kind) => MediaKind::of_path(&asset.path) == *kind,
        }
    }

    /// What the pool's heading calls the current filter.
    pub fn filter_label(&self) -> String {
        match &self.filter {
            PoolFilter::All => "Master".to_string(),
            PoolFilter::Folder(folder) => folder_label(folder).to_string(),
            PoolFilter::Kind(kind) => kind.label().to_string(),
        }
    }
}

/// One directory the project's media actually came from.
///
/// bay has no folder hierarchy in the project format, and inventing one here would be a
/// directory tree nobody created — the same trap `view_model::MediaFolder` names. What the page
/// *can* show honestly is where the files are: the storage tree is derived from the paths.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageFolder {
    /// The directory, as it is on disk.
    pub path: String,
    /// Its last component — what the row is labelled.
    pub label: String,
    pub count: usize,
}

/// The directory part of a media path, or `""` for a bare filename.
fn parent_folder(path: &str) -> String {
    std::path::Path::new(path)
        .parent()
        .map(|parent| parent.to_string_lossy().into_owned())
        .unwrap_or_default()
}

/// The last component of a directory, which is what a tree row shows. Falls back to the whole
/// path, because "/" and "" have no last component and an empty row is unreadable.
fn folder_label(folder: &str) -> &str {
    std::path::Path::new(folder)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or(if folder.is_empty() { "—" } else { folder })
}

/// The directories this project's media came from, alphabetically, with their counts.
pub fn storage_folders(assets: &[MediaAsset]) -> Vec<StorageFolder> {
    let mut counts: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    for asset in assets {
        *counts.entry(parent_folder(&asset.path)).or_default() += 1;
    }
    counts
        .into_iter()
        .map(|(path, count)| StorageFolder {
            label: folder_label(&path).to_string(),
            path,
            count,
        })
        .collect()
}

/// What one metadata row can say.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MetaValue {
    /// The project model holds it, and this is it.
    Known(String),
    /// The model has the field and nothing filled it. Drawn **"unknown"**. Never "0" —
    /// `project.rs`: absent means "cannot check", not "the file is empty".
    Unknown,
    /// Not a property of this kind of file. A still has no duration; that is not a gap.
    NotApplicable(&'static str),
    /// The model has no such field at all. Drawn disabled, naming what is missing.
    Unbacked(&'static str),
}

impl MetaValue {
    /// Whether the row is drawn in the disabled treatment.
    pub fn is_unbacked(&self) -> bool {
        matches!(self, MetaValue::Unbacked(_))
    }

    /// The text the row shows on the right.
    pub fn text(&self) -> String {
        match self {
            MetaValue::Known(value) => value.clone(),
            MetaValue::Unknown => "unknown".to_string(),
            MetaValue::NotApplicable(why) => format!("— {why}"),
            MetaValue::Unbacked(_) => "not probed".to_string(),
        }
    }
}

/// One row of the metadata panel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MetaRow {
    pub label: &'static str,
    pub value: MetaValue,
}

/// Everything the metadata panel can honestly say about one asset.
///
/// The order is fixed so the panel does not reshuffle when a probe fills a field in, and it puts
/// the *measured* rows first. Location is last because it is the only unbounded one: an absolute
/// path wraps to five lines in a 232px panel, and at the top it pushed every number the panel
/// exists to show below the fold.
pub fn metadata_rows(asset: &MediaAsset) -> Vec<MetaRow> {
    let kind = MediaKind::of_path(&asset.path);
    let timed = kind.is_timed();
    let row = |label, value| MetaRow { label, value };

    let mut rows = vec![
        row("Name", MetaValue::Known(asset.name.clone())),
        // Derived from the extension, because `MediaAsset` has no `kind`. That derivation is
        // the same one the importer, the timeline and the compositor already use, so the label
        // cannot disagree with what the file is treated as.
        row("Kind", MetaValue::Known(kind.label().to_string())),
        row(
            "Duration",
            match (timed, asset.duration_seconds) {
                (false, _) => MetaValue::NotApplicable("still"),
                (true, Some(seconds)) => {
                    MetaValue::Known(format!("{}  ({seconds:.2} s)", timecode(seconds)))
                }
                (true, None) => MetaValue::Unknown,
            },
        ),
        row(
            "Resolution",
            match (kind, asset.width, asset.height) {
                (MediaKind::Audio, _, _) => MetaValue::NotApplicable("audio"),
                // Both or neither. One number without the other describes no frame.
                (_, Some(width), Some(height)) => MetaValue::Known(format!("{width} × {height}")),
                _ => MetaValue::Unknown,
            },
        ),
        // The two the model cannot hold. Drawn, disabled, and named — `pages.md` rule 2.
        row(
            "Frame rate",
            MetaValue::Unbacked("MediaAsset has no fps field, and probe.rs parses no frame rate"),
        ),
        row(
            "Codec",
            MetaValue::Unbacked("MediaAsset has no codec field, and probe.rs parses no codec_name"),
        ),
    ];

    if kind == MediaKind::Image {
        rows.push(location_row(asset));
        return rows;
    }

    rows.push(row(
        "Loudness",
        match &asset.loudness {
            Some(loudness) if loudness.is_audible() => MetaValue::Known(format!(
                "{:.1} LUFS  ·  peak {:.1} dBFS",
                loudness.lufs, loudness.peak_db
            )),
            // Not "silent": a file shorter than R128's 400 ms block never crosses the gate
            // however loud it is. `AssetLoudness::is_audible` says exactly this.
            Some(_) => MetaValue::Known("below the R128 gate".to_string()),
            None => MetaValue::Unknown,
        },
    ));
    rows.push(row(
        "Transcript",
        match &asset.transcript {
            Some(transcript) => MetaValue::Known(format!(
                "{} words  ·  {}  ·  {}",
                transcript.words.len(),
                transcript.language,
                transcript.model
            )),
            None => MetaValue::Unknown,
        },
    ));
    rows.push(location_row(asset));
    rows
}

/// The directory the file is in. Its own function only because both returns of
/// [`metadata_rows`] end with it.
fn location_row(asset: &MediaAsset) -> MetaRow {
    MetaRow {
        label: "Location",
        value: MetaValue::Known(parent_folder(&asset.path)),
    }
}

/// The three operations a media page is expected to offer and this engine cannot perform.
///
/// Listed rather than hidden, with the reason each one is dark, so the page is the register of
/// what is left rather than a page that quietly does less than it looks like it does.
const UNBUILT_OPERATIONS: [(&str, &str, &str); 3] = [
    (
        "op-scene-cut",
        "Scene Cut Detection",
        "no shot-boundary detector in the engine",
    ),
    (
        "op-proxies",
        "Generate Optimized Media",
        "no proxy render path, and no proxy field on MediaAsset",
    ),
    (
        "op-sync",
        "Auto Sync Audio",
        "no waveform or timecode sync in bay-audio",
    ),
];

/// The bin kinds Resolve has and bay's project model does not.
const UNBUILT_BINS: [(&str, &str, &str); 3] = [
    ("bin-new", "＋ New Bin", "the project format has no bins"),
    (
        "bin-power",
        "⚡ Power Bin",
        "shared across projects; no library-wide media store",
    ),
    (
        "bin-smart",
        "✨ Smart Bin",
        "needs a saved query, and there is no query model",
    ),
];

/// Heights of the two fixed bands, chosen so the transport lands where Cut's does.
///
/// `pages.md`: the transport band is the horizon line of the app. Cut spends 40px on its scene
/// bar and 300px on its timeline *below* the transport (`toolbar.rs` and `timeline.rs`); Media
/// has no timeline, so the media pool takes exactly that 340px. Both pages then put a 52px
/// chrome strip on top and a 54px transport in the same place, and the horizon holds.
///
/// GPUI lays out border-box (taffy's default), so these are totals, borders included.
const CHROME_BAND: f32 = 52.0;
const TRANSPORT_BAND: f32 = 54.0;
const POOL_BAND: f32 = 340.0;

/// Width of the two flanking columns, and the floor they shrink to.
///
/// They *shrink* rather than being `flex_none`: the page cannot see the window width from here
/// (a page body is handed only `cx`), so a fixed column is a column that overflows a 320px
/// window. The floors keep a squeezed column readable, and the real answer on a small window is
/// the two toggles in the top chrome, which is what they are for.
const SIDE_COLUMN: f32 = 232.0;
const SIDE_COLUMN_MIN: f32 = 104.0;
const BIN_RAIL: f32 = 168.0;
const BIN_RAIL_MIN: f32 = 92.0;
/// One pool thumbnail. Wrapped rather than laid out in computed columns, so the grid reflows
/// with the panel instead of with a number this file would have to keep in step with it.
const TILE_WIDTH: f32 = 138.0;
const TILE_IMAGE: f32 = 76.0;

/// Peaks across a pool tile. Coarse on purpose: a tile is ~170px wide, so more buckets would be
/// sub-pixel bars and a longer extraction for a picture nobody can resolve.
const POOL_WAVEFORM_BUCKETS: usize = 56;

impl EditorView {
    /// Where the Media page's own state lives. One accessor pair, so the page body never
    /// reaches past it.
    fn media_state(&self) -> &MediaPageState {
        &self.media_page
    }

    fn media_state_mut(&mut self) -> &mut MediaPageState {
        &mut self.media_page
    }

    /// The asset the page is currently describing, if it still exists.
    ///
    /// Resolved every frame rather than cached, because the selected asset can be removed by an
    /// agent tool call between one frame and the next and a stale clone would keep describing a
    /// file the project no longer has.
    fn media_selection(&self) -> Option<&MediaAsset> {
        let id = self.media_state().selected.as_ref()?;
        self.editor
            .project()
            .media
            .iter()
            .find(|asset| asset.id == *id)
    }

    pub(super) fn media_page(&self, cx: &mut gpui::Context<Self>) -> Div {
        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .bg(rgb(theme::BG))
            .child(self.media_chrome(cx))
            .child(self.media_viewers(cx))
            .child(self.media_transport(cx))
            .child(self.media_pool(cx))
    }

    /// The top chrome: source-side toggles, the project name centred **on the window**, then the
    /// destination-side toggle and the one app-wide action this page has.
    ///
    /// `1fr auto 1fr`, the same construction as the page bar, because `pages.md` is explicit
    /// that the centre is centred on the window and not on the gap between the clusters — with
    /// `justify_between` it would slide every time the status line changed length.
    fn media_chrome(&self, cx: &mut gpui::Context<Self>) -> Div {
        let state = self.media_state();
        let left = div()
            .flex_1()
            .min_w(px(0.0))
            .flex()
            .flex_row()
            .items_center()
            .gap(px(6.0))
            .overflow_hidden()
            .child(self.mode_button(
                "media-toggle-storage",
                "◧ Storage",
                state.show_storage,
                cx,
                |this| {
                    let state = this.media_state_mut();
                    state.show_storage = !state.show_storage;
                },
            ))
            .child(self.mode_button(
                "media-toggle-metadata",
                "≡ Metadata",
                state.show_metadata,
                cx,
                |this| {
                    let state = this.media_state_mut();
                    state.show_metadata = !state.show_metadata;
                },
            ))
            // No status strip here either — see the note in `toolbar.rs`. `render_inner` takes
            // `self.status` before this bar is built, so this read was always `None`. Import
            // failures reach the notification layer instead.
            ;

        let centre = div()
            .flex_none()
            .flex()
            .flex_row()
            .items_center()
            .gap(px(8.0))
            .px(px(10.0))
            .child(
                div()
                    .text_sm()
                    .text_color(rgb(theme::TEXT))
                    .overflow_hidden()
                    .child(Self::shared(self.project_name().to_string())),
            )
            .child(widgets::note(format!(
                "{} in pool",
                plural_assets(self.editor.project().media.len())
            )));

        let right = div()
            .flex_1()
            .min_w(px(0.0))
            .flex()
            .flex_row()
            .items_center()
            .justify_end()
            .gap(px(6.0))
            .overflow_hidden()
            // The page's whole reason to touch the filesystem, and the only control here that
            // opens a dialog. `pages.md`: Media must not become a second file picker — this is
            // the first, and every other page browses what it produced.
            .child(
                self.button("media-import", "Import Media…", cx, |this, _cx| {
                    this.import_media();
                    // Land the selection on whatever just arrived, so the panel describes the file
                    // the user was thinking about rather than staying on the previous one.
                    let newest = this
                        .editor
                        .project()
                        .media
                        .last()
                        .map(|asset| asset.id.clone());
                    if newest.is_some() {
                        this.media_state_mut().selected = newest;
                    }
                }),
            );

        div()
            .h(px(CHROME_BAND))
            .flex_none()
            .flex()
            .flex_row()
            .items_center()
            .px(px(12.0))
            .bg(rgb(theme::PANEL))
            .border_b_1()
            .border_color(rgb(theme::BORDER))
            .child(left)
            .child(centre)
            .child(right)
    }

    /// Band one: the storage tree, the two viewers, and the metadata panel.
    fn media_viewers(&self, cx: &mut gpui::Context<Self>) -> Div {
        let state = self.media_state();
        div()
            .flex()
            .flex_row()
            .flex_1()
            .min_h(px(0.0))
            .overflow_hidden()
            .children(state.show_storage.then(|| self.media_storage(cx)))
            .child(
                div()
                    .flex()
                    .flex_row()
                    .flex_1()
                    .min_w(px(0.0))
                    .gap(px(1.0))
                    .bg(rgb(theme::BORDER_SOFT))
                    .child(self.media_source_viewer())
                    .child(self.media_clip_viewer()),
            )
            .children(state.show_metadata.then(|| self.media_metadata(cx)))
    }

    /// The storage tree: the directories this project's media actually came from.
    fn media_storage(&self, cx: &mut gpui::Context<Self>) -> Div {
        let assets = &self.editor.project().media;
        let folders = storage_folders(assets);
        let state = self.media_state();

        let mut tree = div()
            .id("media-storage-tree")
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .gap(px(1.0))
            .overflow_y_scroll();

        if folders.is_empty() {
            tree = tree.child(widgets::note(
                "Nothing imported yet. Import Media adds a file to the pool; every other page \
                 browses what lands here.",
            ));
        }

        for folder in &folders {
            let on = state.filter == PoolFilter::Folder(folder.path.clone());
            let path = folder.path.clone();
            tree = tree.child(
                div()
                    .id(SharedString::from(format!("storage-{}", folder.path)))
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(6.0))
                    .px(px(6.0))
                    .py(px(4.0))
                    .rounded(px(4.0))
                    .bg(rgb(if on { theme::SELECTED } else { theme::PANEL }))
                    .cursor_pointer()
                    .hover(|style| style.bg(rgb(theme::HOVER)))
                    .child(
                        div()
                            .flex_none()
                            .text_xs()
                            .text_color(rgb(theme::FAINT))
                            .child("▸"),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w(px(0.0))
                            .text_xs()
                            .text_color(rgb(if on { theme::TEXT } else { theme::MUTED }))
                            .overflow_hidden()
                            .child(Self::shared(folder.label.clone())),
                    )
                    .child(widgets::note(folder.count.to_string()))
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.media_state_mut().filter = PoolFilter::Folder(path.clone());
                        cx.notify();
                    })),
            );
        }

        div()
            .w(px(SIDE_COLUMN))
            .min_w(px(SIDE_COLUMN_MIN))
            .flex()
            .flex_col()
            .gap(px(8.0))
            .p(px(10.0))
            .bg(rgb(theme::PANEL))
            .border_r_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(widgets::section("MEDIA STORAGE"))
            .child(tree)
            .child(widgets::note(
                "Folders come from where the files are on disk. bay's project format has no \
                 folder hierarchy of its own.",
            ))
    }

    /// The source viewer: the asset selected in the pool.
    ///
    /// A still is shown for real, through `img(path)`, which resolves on GPUI's asset cache off
    /// the render path and is keyed by the path — so it is loaded once, not rebuilt per frame,
    /// and it carries none of the `RetiredImages` obligation that a `RenderImage` this crate
    /// constructs would (`docs/native/drawing.md`). Exactly one of them is ever on screen.
    ///
    /// Video and audio get an honest plate instead: playing a source clip needs a decode that
    /// **cannot** run on the interactive render path, and there is no source-side decode target
    /// in this build to run it into.
    fn media_source_viewer(&self) -> Div {
        let selected = self.media_selection();
        let body = match selected {
            None => viewer_plate(
                theme::FAINT,
                "Nothing selected",
                "Pick an asset in the pool below.",
            ),
            Some(asset) => match MediaKind::of_path(&asset.path) {
                MediaKind::Image => div()
                    .flex_1()
                    .min_h(px(0.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .overflow_hidden()
                    .child(
                        img(std::path::PathBuf::from(asset.path.clone()))
                            .max_w(gpui::relative(1.0))
                            .max_h(gpui::relative(1.0)),
                    ),
                // A video shows its poster frame if one has been decoded. Still a picture and
                // not playback — the note below says so rather than letting a still frame imply
                // a transport that does not exist.
                MediaKind::Video if self.poster_image(&asset.id).is_some() => div()
                    .flex_1()
                    .min_h(px(0.0))
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(8.0))
                    .overflow_hidden()
                    .children(self.poster_image(&asset.id).map(|image| {
                        img(ImageSource::Render(image))
                            .max_w(gpui::relative(1.0))
                            .max_h(gpui::relative(1.0))
                    }))
                    .child(widgets::note(
                        "Poster frame. Source playback is not built: a decode cannot run on the \
                         interactive render path, and this page has no source decode target.",
                    )),
                kind => viewer_plate(
                    theme::element_color(kind.label()),
                    &asset.name,
                    "Source playback is not built: a decode cannot run on the interactive \
                     render path, and this page has no source decode target to run it into.",
                ),
            },
        };
        viewer_frame(
            "SOURCE",
            selected
                .map(|asset| asset.name.clone())
                .unwrap_or_else(|| "—".to_string()),
            body,
        )
    }

    /// The clip viewer: the timeline at the global playhead.
    ///
    /// The same composite the Cut page's preview draws, because it is the same `preview_image`
    /// on the same `EditorView` — which is what `pages.md` rule 1 buys, and why the playhead
    /// surviving a page switch costs no code.
    fn media_clip_viewer(&self) -> Div {
        let body = match &self.preview_image {
            Some(image) => div()
                .flex_1()
                .min_h(px(0.0))
                .flex()
                .items_center()
                .justify_center()
                .overflow_hidden()
                .child(
                    img(ImageSource::Render(image.clone()))
                        .max_w(gpui::relative(1.0))
                        .max_h(gpui::relative(1.0)),
                ),
            // No adapter, or nothing composited yet. Not a black rectangle: a black rectangle
            // reads as "the project is empty" rather than "there is no GPU here".
            None => viewer_plate(
                theme::FAINT,
                "No composite yet",
                if self.preview.is_some() {
                    "The compositor has not returned a frame for this playhead."
                } else {
                    "No GPU adapter — the compositor is unavailable in this session."
                },
            ),
        };
        viewer_frame(
            "TIMELINE",
            timecode(self.editor.playhead().to_seconds_f64()),
            body,
        )
    }

    /// The metadata panel: what the model holds about the selected asset, and what it cannot.
    fn media_metadata(&self, cx: &mut gpui::Context<Self>) -> Div {
        let mut body = div()
            .id("media-metadata-scroll")
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .gap(px(4.0))
            .overflow_y_scroll();

        match self.media_selection() {
            None => {
                body = body.child(widgets::note("Select an asset in the pool to describe it."));
            }
            Some(asset) => {
                for row in metadata_rows(asset) {
                    body = body.child(meta_row_element(&row));
                }
                body = body.child(div().h(px(6.0)));
                body = body.child(widgets::section("OPERATIONS"));
                for (id, label, reason) in UNBUILT_OPERATIONS {
                    body = body.child(disabled_control(id, label, reason));
                }
            }
        }

        let selected = self
            .media_selection()
            .map(|asset| (asset.id.clone(), asset.name.clone(), asset.path.clone()));

        div()
            .w(px(SIDE_COLUMN))
            .min_w(px(SIDE_COLUMN_MIN))
            .flex()
            .flex_col()
            .gap(px(8.0))
            .p(px(10.0))
            .bg(rgb(theme::PANEL))
            .border_l_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(widgets::section("METADATA"))
            .child(body)
            .child(self.button_enabled(
                "media-add-at-playhead",
                "＋ Add at playhead",
                selected.is_some(),
                cx,
                move |this, _cx| {
                    if let Some((id, name, path)) = selected.clone() {
                        this.place_media(&id, &name, &path);
                    }
                },
            ))
    }

    /// The transport band. The horizon line — same height, same place, as every other page's.
    ///
    /// No zoom controls, unlike Cut's: this page has no timeline for them to zoom, and a pair of
    /// buttons that change a number nothing on screen reads is the dead control `pages.md` rule
    /// 2 exists to stop. What is here drives the global playhead, which is the same playhead the
    /// clip viewer above is showing.
    fn media_transport(&self, cx: &mut gpui::Context<Self>) -> Div {
        let now = timecode(self.editor.playhead().to_seconds_f64());
        let total = timecode(self.editor.duration().to_seconds_f64());

        widgets::row()
            .h(px(TRANSPORT_BAND))
            .flex_none()
            .justify_center()
            .gap(px(14.0))
            .px(px(16.0))
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(
                widgets::row()
                    .gap(px(2.0))
                    .child(self.transport_button("media-seek-start", "|◀", cx, |this| {
                        this.editor.seek(MediaTime::ZERO)
                    }))
                    .child(self.transport_button("media-seek-back", "◀◀", cx, |this| {
                        let ticks = this.editor.playhead().as_ticks();
                        this.editor
                            .seek(MediaTime::from_ticks(ticks - TICKS_PER_SECOND));
                    })),
            )
            .child(
                div()
                    .id("media-play")
                    .w(px(44.0))
                    .h(px(32.0))
                    .flex_none()
                    .rounded(px(6.0))
                    .bg(rgb(theme::ACCENT))
                    .text_color(rgb(theme::ON_ACCENT))
                    .flex()
                    .items_center()
                    .justify_center()
                    .cursor_pointer()
                    .child(if self.playing { "❚❚" } else { "▶" })
                    .on_click(cx.listener(|this, _event, _window, cx| {
                        this.toggle_play();
                        cx.notify();
                    })),
            )
            .child(
                widgets::row()
                    .gap(px(2.0))
                    .child(self.transport_button("media-seek-fwd", "▶▶", cx, |this| {
                        let ticks = this.editor.playhead().as_ticks();
                        this.editor
                            .seek(MediaTime::from_ticks(ticks + TICKS_PER_SECOND));
                    }))
                    .child(self.transport_button("media-seek-end", "▶|", cx, |this| {
                        this.editor.seek(this.editor.duration())
                    })),
            )
            .child(
                widgets::row()
                    .gap(px(6.0))
                    .ml(px(6.0))
                    .child(
                        div()
                            .font_family("ui-monospace")
                            .text_color(rgb(theme::TEXT))
                            .child(shared_text(now)),
                    )
                    .child(
                        div()
                            .font_family("ui-monospace")
                            .text_xs()
                            .text_color(rgb(theme::FAINT))
                            .child(shared_text(format!("/ {total}"))),
                    ),
            )
            .child(div().flex_1().min_w(px(0.0)))
            // A source clip's in and out points. There is no source-side trim in the model —
            // an in-point exists only once a clip is on the timeline — so both are dark, and
            // they share one reason line rather than repeating it in a 54px band.
            .child(
                div()
                    .flex_none()
                    .flex()
                    .flex_col()
                    .gap(px(1.0))
                    .overflow_hidden()
                    .child(
                        widgets::row()
                            .gap(px(4.0))
                            .child(dark_button("media-mark-in", "Mark In"))
                            .child(dark_button("media-mark-out", "Mark Out")),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::DISABLED_TEXT))
                            .overflow_hidden()
                            .child("source in/out points are not in the project model"),
                    ),
            )
    }

    /// Band three: the bins rail and the pool itself.
    fn media_pool(&self, cx: &mut gpui::Context<Self>) -> Div {
        div()
            .h(px(POOL_BAND))
            .flex_none()
            .flex()
            .flex_row()
            .bg(rgb(theme::PANEL))
            .border_t_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(self.media_bins(cx))
            .child(self.media_pool_body(cx))
    }

    /// The bins rail. One real bin, three real kind groups, three dark ones.
    fn media_bins(&self, cx: &mut gpui::Context<Self>) -> Div {
        let assets = &self.editor.project().media;
        let state = self.media_state();
        // The rail scrolls. Seven rows and three reason lines are taller than the 340px pool
        // band at a 900px window, and a bin list that silently loses its last entry off the
        // bottom edge is a control that is on screen in this file and not on screen in the app.
        let mut rail = div()
            .id("media-bins-scroll")
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .gap(px(2.0))
            .overflow_y_scroll()
            .child(self.bin_row(
                "bin-master",
                "Master",
                assets.len(),
                state.filter == PoolFilter::All,
                PoolFilter::All,
                cx,
            ));

        // The three kind groups, always all three and always in this order, so the rail does
        // not reshuffle when the first file of a kind arrives — the same reason
        // `view_model::MediaFolder` fixes its order.
        for (kind, id) in [
            (MediaKind::Video, "bin-video"),
            (MediaKind::Image, "bin-image"),
            (MediaKind::Audio, "bin-audio"),
        ] {
            let count = assets
                .iter()
                .filter(|asset| MediaKind::of_path(&asset.path) == kind)
                .count();
            rail = rail.child(self.bin_row(
                id,
                kind.label(),
                count,
                state.filter == PoolFilter::Kind(kind),
                PoolFilter::Kind(kind),
                cx,
            ));
        }

        rail = rail.child(div().h(px(6.0)));
        for (id, label, reason) in UNBUILT_BINS {
            rail = rail.child(disabled_control(id, label, reason));
        }

        div()
            .w(px(BIN_RAIL))
            .min_w(px(BIN_RAIL_MIN))
            .flex()
            .flex_col()
            .gap(px(6.0))
            .p(px(10.0))
            .bg(rgb(theme::PANEL_ALT))
            .border_r_1()
            .border_color(rgb(theme::BORDER))
            .overflow_hidden()
            .child(widgets::section("BINS"))
            .child(rail)
    }

    /// One selectable bin row.
    fn bin_row(
        &self,
        id: &'static str,
        label: &str,
        count: usize,
        on: bool,
        filter: PoolFilter,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::Stateful<Div> {
        div()
            .id(id)
            .flex()
            .flex_row()
            .items_center()
            .gap(px(6.0))
            .px(px(6.0))
            .py(px(4.0))
            .rounded(px(4.0))
            .bg(rgb(if on {
                theme::SELECTED
            } else {
                theme::PANEL_ALT
            }))
            .cursor_pointer()
            .hover(|style| style.bg(rgb(theme::HOVER)))
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .text_xs()
                    .text_color(rgb(if on { theme::TEXT } else { theme::MUTED }))
                    .overflow_hidden()
                    .child(Self::shared(label.to_string())),
            )
            .child(widgets::note(count.to_string()))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.media_state_mut().filter = filter.clone();
                cx.notify();
            }))
    }

    /// The pool: a header, then the assets as thumbnails or as a list.
    fn media_pool_body(&self, cx: &mut gpui::Context<Self>) -> Div {
        let state = self.media_state();
        let shown: Vec<&MediaAsset> = self
            .editor
            .project()
            .media
            .iter()
            .filter(|asset| state.admits(asset))
            .collect();

        // `flex_col`, not the default row. In a row the grid and the list are flex *items*
        // sized to their own content, so `flex_1` on the list's name column got no width and
        // the four columns bunched against the left edge of a 1,200px pool.
        let mut body = div()
            .id("media-pool-scroll")
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .overflow_y_scroll();

        if shown.is_empty() {
            body = body.child(widgets::note(if self.editor.project().media.is_empty() {
                "The pool is empty. Import Media puts a file in it."
            } else {
                "Nothing in this bin."
            }));
        } else if state.view == PoolView::Thumbnails {
            let mut grid = div().w_full().flex().flex_row().flex_wrap().gap(px(8.0));
            for (index, asset) in shown.iter().enumerate() {
                grid = grid.child(self.pool_tile(asset, index, cx));
            }
            body = body.child(grid);
        } else {
            let mut list = div()
                .w_full()
                .flex()
                .flex_col()
                .gap(px(1.0))
                .child(pool_list_head());
            for (index, asset) in shown.iter().enumerate() {
                list = list.child(self.pool_row(asset, index, cx));
            }
            body = body.child(list);
        }

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_w(px(0.0))
            .gap(px(8.0))
            .p(px(10.0))
            .child(self.media_pool_header(shown.len(), cx))
            .child(body)
    }

    fn media_pool_header(&self, shown: usize, cx: &mut gpui::Context<Self>) -> Div {
        let state = self.media_state();
        let thumbnails = state.view == PoolView::Thumbnails;
        widgets::row()
            .flex_none()
            .gap(px(8.0))
            .overflow_hidden()
            .child(widgets::section("MEDIA POOL"))
            .child(widgets::chip(state.filter_label()))
            .child(widgets::note(plural_assets(shown)))
            // A search field is drawn and dark: bay has a semantic index on `MediaAsset` and a
            // `bay-vision` encoder, but nothing in this build turns a typed string into a query
            // over them, and an input that accepts text and filters nothing is worse than one
            // that says it cannot.
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .h(px(22.0))
                    .px(px(8.0))
                    .flex()
                    .items_center()
                    .rounded(px(4.0))
                    .bg(rgb(theme::DISABLED))
                    .border_1()
                    .border_color(rgb(theme::BORDER_SOFT))
                    .text_xs()
                    .text_color(rgb(theme::DISABLED_TEXT))
                    .overflow_hidden()
                    .child("Search — no media query in this build"),
            )
            .child(
                widgets::row()
                    .flex_none()
                    .gap(px(1.0))
                    .child(self.mode_button(
                        "pool-view-thumbs",
                        "▦ Thumbnails",
                        thumbnails,
                        cx,
                        |this| this.media_state_mut().view = PoolView::Thumbnails,
                    ))
                    .child(self.mode_button(
                        "pool-view-list",
                        "☰ List",
                        !thumbnails,
                        cx,
                        |this| this.media_state_mut().view = PoolView::List,
                    )),
            )
    }

    /// One pool thumbnail.
    ///
    /// A coloured plate rather than a decoded poster frame, for every kind including stills.
    /// Decoding a frame per tile on the render path is what the decode rule forbids outright,
    /// and routing N stills through GPUI's image cache would put N full-resolution decodes in
    /// the sprite atlas to draw N 76px squares. The source viewer above shows one at full size,
    /// which is the bounded version of the same idea.
    fn pool_tile(
        &self,
        asset: &MediaAsset,
        index: usize,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::Stateful<Div> {
        let kind = MediaKind::of_path(&asset.path);
        // Taken before the element chain starts, because uploading a first-seen thumbnail needs
        // `&mut self` and everything below borrows immutably.
        let poster = self.poster_image(&asset.id);
        // Audio tiles draw peaks where a video tile draws a frame.
        let peaks = (kind == MediaKind::Audio)
            .then(|| self.waveforms.peaks(&asset.id, POOL_WAVEFORM_BUCKETS))
            .flatten()
            .filter(|peaks| !peaks.is_empty());
        let on = self.media_state().selected.as_deref() == Some(asset.id.as_str());
        let id = asset.id.clone();
        div()
            .id(("pool-tile", index))
            .w(px(TILE_WIDTH))
            .flex_none()
            .flex()
            .flex_col()
            .p(px(4.0))
            .rounded(px(6.0))
            .bg(rgb(if on { theme::SELECTED } else { theme::PANEL }))
            .border_1()
            .border_color(rgb(if on {
                theme::SELECTED_BORDER
            } else {
                theme::BORDER_SOFT
            }))
            .cursor_pointer()
            .hover(|style| style.bg(rgb(theme::HOVER)))
            .child({
                let plate = div()
                    .h(px(TILE_IMAGE))
                    .rounded(px(4.0))
                    .bg(rgb(theme::LANE))
                    .flex()
                    .items_center()
                    .justify_center()
                    .overflow_hidden();
                match (poster, peaks) {
                    // The picture, once a worker has produced one.
                    (Some(image), _) => plate.child(
                        img(ImageSource::Render(image))
                            .h(px(TILE_IMAGE))
                            .w(px(TILE_WIDTH - 8.0)),
                    ),
                    // Audio has no frame to show, so it shows its shape instead — which is the
                    // one thing that distinguishes two audio files at a glance.
                    (None, Some(peaks)) => plate
                        .flex()
                        .flex_row()
                        .items_center()
                        .gap(px(1.0))
                        .px(px(4.0))
                        .children(peaks.iter().map(|peak| {
                            div()
                                .flex_1()
                                .h(px((peak * (TILE_IMAGE - 12.0)).max(1.0)))
                                .bg(rgb(theme::ACCENT))
                        })),
                    // Still decoding, decode failed, or the kind has no picture to show. The
                    // coloured bar stays for those, because a tile with nothing in it reads as
                    // a broken file rather than one whose thumbnail has not arrived.
                    (None, None) => plate.child(
                        div()
                            .w(px(30.0))
                            .h(px(4.0))
                            .rounded(px(2.0))
                            .bg(rgb(theme::element_color(kind.label()))),
                    ),
                }
            })
            .child(
                div()
                    .mt(px(4.0))
                    .text_xs()
                    .text_color(rgb(theme::TEXT))
                    .overflow_hidden()
                    .child(Self::shared(asset.name.clone())),
            )
            .child(widgets::note(format!(
                "{}  ·  {}",
                kind.label(),
                short_duration(asset)
            )))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.media_state_mut().selected = Some(id.clone());
                cx.notify();
            }))
    }

    /// One pool list row: the same four facts a metadata panel leads with, in columns.
    fn pool_row(
        &self,
        asset: &MediaAsset,
        index: usize,
        cx: &mut gpui::Context<Self>,
    ) -> gpui::Stateful<Div> {
        let kind = MediaKind::of_path(&asset.path);
        let on = self.media_state().selected.as_deref() == Some(asset.id.as_str());
        let id = asset.id.clone();
        div()
            .id(("pool-row", index))
            .flex()
            .flex_row()
            .items_center()
            .gap(px(8.0))
            .px(px(6.0))
            .py(px(4.0))
            .rounded(px(4.0))
            .bg(rgb(if on { theme::SELECTED } else { theme::PANEL }))
            .cursor_pointer()
            .hover(|style| style.bg(rgb(theme::HOVER)))
            .child(
                div()
                    .w(px(6.0))
                    .h(px(14.0))
                    .flex_none()
                    .rounded(px(2.0))
                    .bg(rgb(theme::element_color(kind.label()))),
            )
            .child(
                div()
                    .flex_1()
                    .min_w(px(0.0))
                    .text_xs()
                    .text_color(rgb(theme::TEXT))
                    .overflow_hidden()
                    .child(Self::shared(asset.name.clone())),
            )
            .child(pool_cell(kind.label().to_string(), 64.0))
            .child(pool_cell(short_duration(asset), 84.0))
            .child(pool_cell(short_resolution(asset), 96.0))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.media_state_mut().selected = Some(id.clone());
                cx.notify();
            }))
    }
}

/// A viewer's frame: a title strip over the picture. Both viewers use it, so the two cannot
/// drift into different chrome for the same job.
fn viewer_frame(title: &'static str, detail: String, body: Div) -> Div {
    div()
        .flex()
        .flex_col()
        .flex_1()
        .min_w(px(0.0))
        .bg(rgb(theme::BG))
        .child(
            widgets::row()
                .h(px(24.0))
                .flex_none()
                .px(px(8.0))
                .gap(px(8.0))
                .overflow_hidden()
                .child(widgets::section(title))
                .child(div().flex_1().min_w(px(0.0)))
                .child(
                    div()
                        .font_family("ui-monospace")
                        .text_xs()
                        .text_color(rgb(theme::MUTED))
                        .overflow_hidden()
                        .child(widgets::text(detail)),
                ),
        )
        .child(body)
}

/// What a viewer shows when there is no picture: what it would be showing, and why it is not.
fn viewer_plate(accent: u32, title: &str, why: &str) -> Div {
    div()
        .flex_1()
        .min_h(px(0.0))
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(6.0))
        .p(px(16.0))
        .child(
            div()
                .w(px(44.0))
                .h(px(4.0))
                .rounded(px(2.0))
                .bg(rgb(accent)),
        )
        .child(
            div()
                .text_xs()
                .text_color(rgb(theme::MUTED))
                .overflow_hidden()
                .child(widgets::text(title.to_string())),
        )
        .child(
            div()
                .max_w(px(320.0))
                .text_xs()
                .text_color(rgb(theme::FAINT))
                .child(widgets::text(why.to_string())),
        )
}

/// One metadata row. An unbacked row is drawn in the disabled treatment and carries its reason
/// on a second line, so what is missing is legible on the page rather than only in this file.
fn meta_row_element(row: &MetaRow) -> Div {
    let unbacked = row.value.is_unbacked();
    div()
        .flex()
        .flex_col()
        .py(px(2.0))
        .child(
            div()
                .flex()
                .flex_row()
                .items_start()
                .gap(px(8.0))
                .child(
                    div()
                        .w(px(78.0))
                        .flex_none()
                        .text_xs()
                        .text_color(rgb(if unbacked {
                            theme::DISABLED_TEXT
                        } else {
                            theme::FAINT
                        }))
                        .child(row.label),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w(px(0.0))
                        .text_xs()
                        .text_color(rgb(match &row.value {
                            MetaValue::Known(_) => theme::TEXT,
                            MetaValue::Unknown | MetaValue::NotApplicable(_) => theme::MUTED,
                            MetaValue::Unbacked(_) => theme::DISABLED_TEXT,
                        }))
                        .overflow_hidden()
                        .child(widgets::text(row.value.text())),
                ),
        )
        .children(match &row.value {
            MetaValue::Unbacked(reason) => Some(
                div()
                    .pl(px(86.0))
                    .text_xs()
                    .text_color(rgb(theme::DISABLED_TEXT))
                    .child(widgets::text(*reason)),
            ),
            _ => None,
        })
}

/// A button in the disabled treatment. `widgets::button_face(_, false)` is the one place that
/// treatment is defined — before it existed, "disabled" in bay was grey text on an identical
/// fill with the handler simply not attached, which a user only discovered by clicking.
fn dark_button(id: &'static str, label: &str) -> gpui::Stateful<Div> {
    widgets::button_face(widgets::ButtonKind::Normal, false)
        .id(id)
        .flex_none()
        .px(px(8.0))
        .py(px(3.0))
        .rounded(px(4.0))
        .text_xs()
        .overflow_hidden()
        .child(widgets::text(label.to_string()))
}

/// A control the engine cannot back: drawn as an ordinary control, dark, with the reason under
/// it. `pages.md` rule 2 — not hidden, not faked.
fn disabled_control(id: &'static str, label: &str, reason: &str) -> Div {
    div()
        .flex()
        .flex_col()
        .gap(px(1.0))
        .py(px(2.0))
        .child(dark_button(id, label))
        .child(
            div()
                .text_xs()
                .text_color(rgb(theme::DISABLED_TEXT))
                .overflow_hidden()
                .child(widgets::text(reason.to_string())),
        )
}

/// The list view's column heads.
fn pool_list_head() -> Div {
    div()
        .flex()
        .flex_row()
        .items_center()
        .gap(px(8.0))
        .px(px(6.0))
        .pb(px(2.0))
        .child(div().w(px(6.0)).flex_none())
        .child(
            div()
                .flex_1()
                .min_w(px(0.0))
                .child(widgets::section("NAME")),
        )
        .child(
            div()
                .w(px(64.0))
                .flex_none()
                .child(widgets::section("KIND")),
        )
        .child(
            div()
                .w(px(84.0))
                .flex_none()
                .child(widgets::section("DURATION")),
        )
        .child(
            div()
                .w(px(96.0))
                .flex_none()
                .child(widgets::section("RESOLUTION")),
        )
}

/// One fixed-width cell of the list view.
fn pool_cell(value: String, width: f32) -> Div {
    div()
        .w(px(width))
        .flex_none()
        .text_xs()
        .text_color(rgb(theme::MUTED))
        .overflow_hidden()
        .child(widgets::text(value))
}

/// A duration short enough for a tile caption. "unknown", never "0".
pub fn short_duration(asset: &MediaAsset) -> String {
    if !MediaKind::of_path(&asset.path).is_timed() {
        return "still".to_string();
    }
    match asset.duration_seconds {
        Some(seconds) => timecode(seconds),
        None => "unknown".to_string(),
    }
}

/// A resolution short enough for a list cell. Both numbers or neither.
pub fn short_resolution(asset: &MediaAsset) -> String {
    if MediaKind::of_path(&asset.path) == MediaKind::Audio {
        return "—".to_string();
    }
    match (asset.width, asset.height) {
        (Some(width), Some(height)) => format!("{width} × {height}"),
        _ => "unknown".to_string(),
    }
}

fn plural_assets(count: usize) -> String {
    if count == 1 {
        "1 asset".to_string()
    } else {
        format!("{count} assets")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asset(id: &str, path: &str) -> MediaAsset {
        MediaAsset::new(id.to_string(), id.to_string(), path.to_string())
    }

    fn row_of<'a>(rows: &'a [MetaRow], label: &str) -> &'a MetaRow {
        rows.iter()
            .find(|row| row.label == label)
            .unwrap_or_else(|| panic!("no {label} row"))
    }

    /// The defect this page exists not to have. `project.rs`: an absent probe means "cannot
    /// check", not "the file is empty" — so an unprobed clip reads "unknown" and never "0".
    #[test]
    fn an_unprobed_clip_reads_unknown_and_never_zero() {
        let rows = metadata_rows(&asset("a", "/footage/a.mp4"));
        assert_eq!(row_of(&rows, "Duration").value, MetaValue::Unknown);
        assert_eq!(row_of(&rows, "Resolution").value, MetaValue::Unknown);
        for row in &rows {
            let text = row.value.text();
            assert_ne!(text, "0", "{} rendered a zero", row.label);
            assert!(
                !text.starts_with("0 ×") && !text.starts_with("0:00:00:00"),
                "{} rendered {text:?} for a value nobody measured",
                row.label
            );
        }
        assert_eq!(short_duration(&asset("a", "/f/a.mp4")), "unknown");
        assert_eq!(short_resolution(&asset("a", "/f/a.mp4")), "unknown");
    }

    /// Half a resolution describes no frame, so it is not half-reported.
    #[test]
    fn one_dimension_without_the_other_is_still_unknown() {
        let mut half = asset("a", "/footage/a.mp4");
        half.width = Some(1920);
        assert_eq!(
            row_of(&metadata_rows(&half), "Resolution").value,
            MetaValue::Unknown
        );
        assert_eq!(short_resolution(&half), "unknown");

        half.height = Some(1080);
        assert_eq!(
            row_of(&metadata_rows(&half), "Resolution").value,
            MetaValue::Known("1920 × 1080".to_string())
        );
    }

    /// The two rows the model cannot fill are on the page, disabled, naming what is missing.
    /// If someone adds the fields to `MediaAsset` and forgets this file, this test is what says
    /// so — the rows must become `Known`, not stay dark next to real data.
    #[test]
    fn frame_rate_and_codec_are_drawn_and_unbacked() {
        let rows = metadata_rows(&asset("a", "/footage/a.mp4"));
        for label in ["Frame rate", "Codec"] {
            let row = row_of(&rows, label);
            assert!(row.value.is_unbacked(), "{label} claimed to be backed");
            match &row.value {
                MetaValue::Unbacked(reason) => {
                    assert!(
                        reason.contains("MediaAsset") && reason.contains("probe.rs"),
                        "{label}'s reason must name where the gap is: {reason:?}"
                    );
                }
                other => panic!("{label}: {other:?}"),
            }
        }
    }

    /// A still has no duration and audio has no resolution. Neither is a gap in the engine, so
    /// neither is reported as one — "unknown" there would send someone looking for a probe.
    #[test]
    fn a_still_has_no_duration_and_audio_has_no_resolution() {
        let rows = metadata_rows(&asset("a", "/stock/a.png"));
        assert!(matches!(
            row_of(&rows, "Duration").value,
            MetaValue::NotApplicable(_)
        ));
        assert_eq!(short_duration(&asset("a", "/stock/a.png")), "still");

        let rows = metadata_rows(&asset("b", "/music/b.wav"));
        assert!(matches!(
            row_of(&rows, "Resolution").value,
            MetaValue::NotApplicable(_)
        ));
    }

    /// An image cannot carry loudness or speech, so it is not offered rows for either.
    #[test]
    fn an_image_is_not_asked_about_its_loudness() {
        let labels: Vec<&str> = metadata_rows(&asset("a", "/stock/a.png"))
            .iter()
            .map(|row| row.label)
            .collect();
        assert!(!labels.contains(&"Loudness"));
        assert!(!labels.contains(&"Transcript"));
        assert!(metadata_rows(&asset("b", "/f/b.mp4"))
            .iter()
            .any(|row| row.label == "Loudness"));
    }

    /// The storage tree is derived from where the files are, not from a hierarchy nobody made.
    #[test]
    fn storage_folders_come_from_the_paths() {
        let assets = [
            asset("a", "/Volumes/Card/DCIM/a.mp4"),
            asset("b", "/Volumes/Card/DCIM/b.mp4"),
            asset("c", "/Users/me/Music/c.wav"),
        ];
        let folders = storage_folders(&assets);
        assert_eq!(folders.len(), 2);
        assert_eq!(folders[0].path, "/Users/me/Music");
        assert_eq!(folders[0].label, "Music");
        assert_eq!(folders[0].count, 1);
        assert_eq!(folders[1].label, "DCIM");
        assert_eq!(folders[1].count, 2);
    }

    /// A bare filename has no directory, and the row for it must still be readable.
    #[test]
    fn a_pathless_asset_still_gets_a_row() {
        let folders = storage_folders(&[asset("a", "a.mp4")]);
        assert_eq!(folders.len(), 1);
        assert_eq!(folders[0].path, "");
        assert_eq!(folders[0].label, "—");
    }

    #[test]
    fn a_filter_shows_only_what_it_names() {
        let assets = [
            asset("a", "/footage/a.mp4"),
            asset("b", "/stock/b.png"),
            asset("c", "/footage/c.wav"),
        ];
        let mut state = MediaPageState::default();
        assert!(assets.iter().all(|item| state.admits(item)));
        assert_eq!(state.filter_label(), "Master");

        state.filter = PoolFilter::Kind(MediaKind::Image);
        let shown: Vec<&str> = assets
            .iter()
            .filter(|item| state.admits(item))
            .map(|item| item.id.as_str())
            .collect();
        assert_eq!(shown, ["b"]);
        assert_eq!(state.filter_label(), "Image");

        state.filter = PoolFilter::Folder("/footage".to_string());
        let shown: Vec<&str> = assets
            .iter()
            .filter(|item| state.admits(item))
            .map(|item| item.id.as_str())
            .collect();
        assert_eq!(shown, ["a", "c"]);
        assert_eq!(state.filter_label(), "footage");
    }

    /// Both panels open on a fresh page: a page whose panels start closed looks broken.
    #[test]
    fn the_page_opens_with_its_panels_open() {
        let state = MediaPageState::default();
        assert!(state.show_storage);
        assert!(state.show_metadata);
        assert_eq!(state.view, PoolView::Thumbnails);
        assert_eq!(state.selected, None);
    }

    /// The horizon line. `pages.md`: the transport must land at the same distance from the
    /// window top on every page that has one. Cut puts a 52px toolbar above its transport and
    /// 40px of scene bar plus 300px of timeline below it; Media has no timeline, so the pool
    /// takes exactly that 340px. If someone retunes Cut's timeline height, this fails here —
    /// which is the point, because the alternative is noticing by eye two pages later.
    #[test]
    fn the_transport_lands_where_cut_puts_it() {
        const CUT_TOOLBAR: f32 = 52.0;
        const CUT_SCENE_BAR: f32 = 40.0;
        const CUT_TIMELINE: f32 = 300.0;
        assert_eq!(CHROME_BAND, CUT_TOOLBAR);
        assert_eq!(POOL_BAND, CUT_SCENE_BAR + CUT_TIMELINE);
        // And the two pages therefore need the same window height before anything is squeezed.
        assert_eq!(
            CHROME_BAND + TRANSPORT_BAND + POOL_BAND,
            CUT_TOOLBAR + TRANSPORT_BAND + CUT_SCENE_BAR + CUT_TIMELINE
        );
    }

    /// The flanking columns shrink rather than overflow. A page body cannot see the window
    /// width, so a `flex_none` column here is a column that runs off a 320px window.
    #[test]
    fn the_side_columns_have_a_floor_they_can_shrink_to() {
        const { assert!(SIDE_COLUMN_MIN < SIDE_COLUMN) };
        const { assert!(BIN_RAIL_MIN < BIN_RAIL) };
        // Both panels closed, the bins rail at its floor, and the pool still has room: the
        // small-window answer is the two toggles in the top chrome.
        const { assert!(BIN_RAIL_MIN + TILE_WIDTH < 320.0) };
    }

    /// Every disabled control says why it is dark. A dark button with no reason is indis-
    /// tinguishable from a broken one.
    #[test]
    fn every_dark_control_carries_its_reason() {
        for (id, label, reason) in UNBUILT_OPERATIONS.iter().chain(UNBUILT_BINS.iter()) {
            assert!(!id.is_empty() && !label.is_empty());
            assert!(
                reason.len() > 12,
                "{label} is dark for the unhelpful reason {reason:?}"
            );
        }
    }
}

/// Painting the page for real.
///
/// Every other test in this file drives values and asserts on them, which never touches the
/// element tree. `editor::paint_tests` opens a window on the *Cut* page — the default — so
/// nothing there ever lays this page out. These do: layout, prepaint and paint over the whole
/// media page, in both pool views, with and without a selection, at the two window sizes
/// `pages.md` requires every page milestone to be looked at in. They are what catch a colliding
/// element id, an impossible layout, or a panel squeezed to a negative width.
#[cfg(test)]
mod paint_tests {
    use super::*;
    use gpui::{TestAppContext, VisualTestContext};

    /// An editor on the media page with one asset of each kind in the pool: a probed video, an
    /// unprobed one (the "unknown" path), a still whose file is not on disk (the `img` fallback)
    /// and an audio file.
    fn windowed(cx: &mut TestAppContext) -> (gpui::Entity<EditorView>, &mut VisualTestContext) {
        let (view, cx) = crate::paint_harness::window(cx, |_window, cx| {
            let focus = cx.focus_handle();
            let mut editor = Editor::starter();
            let mut probed = MediaAsset::new(
                "m1".to_string(),
                "probed.mp4".to_string(),
                "/Volumes/Card/DCIM/probed.mp4".to_string(),
            );
            probed.duration_seconds = Some(12.5);
            probed.width = Some(3840);
            probed.height = Some(2160);
            editor.add_media(probed);
            editor.add_media(MediaAsset::new(
                "m2".to_string(),
                "unprobed.mov".to_string(),
                "/Volumes/Card/DCIM/unprobed.mov".to_string(),
            ));
            editor.add_media(MediaAsset::new(
                "m3".to_string(),
                "still.png".to_string(),
                "/does/not/exist/still.png".to_string(),
            ));
            editor.add_media(MediaAsset::new(
                "m4".to_string(),
                "score.wav".to_string(),
                "/Users/me/Music/score.wav".to_string(),
            ));
            let mut view = EditorView::new(editor, focus, None, None);
            view.page = Page::Media;
            view
        });
        (view, cx)
    }

    use crate::paint_harness::paint;

    /// The window the app actually opens, in both pool views, with nothing selected.
    #[gpui::test]
    fn the_media_page_paints_at_1440_by_900(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        paint(&view, cx, 1440.0, 900.0);
        view.update(cx, |view, _| view.media_state_mut().view = PoolView::List);
        paint(&view, cx, 1440.0, 900.0);
    }

    /// With something selected: the source viewer, the metadata rows and the dark operations
    /// are only in the tree at all once the panel has an asset to describe. The still is the
    /// case that reaches `img`, and its file deliberately does not exist.
    #[gpui::test]
    fn a_selection_paints_the_source_viewer_and_the_metadata(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        for id in ["m1", "m2", "m3", "m4"] {
            view.update(cx, |view, _| {
                view.media_state_mut().selected = Some(id.to_string())
            });
            paint(&view, cx, 1440.0, 900.0);
        }
    }

    /// A selection that no longer exists — an agent removed the asset between two frames — must
    /// draw the empty panel, not describe the wrong file and not panic.
    #[gpui::test]
    fn a_selection_that_vanished_paints_as_nothing_selected(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        view.update(cx, |view, _| {
            view.media_state_mut().selected = Some("gone".to_string());
            assert!(view.media_selection().is_none());
        });
        paint(&view, cx, 1440.0, 900.0);
    }

    /// The two sizes every page milestone has to be looked at in, plus the case the flanking
    /// columns exist for: at 320px the answer is closing them, and closed must paint too.
    #[gpui::test]
    fn the_media_page_paints_in_a_small_window(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        view.update(cx, |view, _| {
            view.media_state_mut().selected = Some("m1".to_string())
        });
        paint(&view, cx, 640.0, 420.0);
        paint(&view, cx, 320.0, 240.0);
        view.update(cx, |view, _| {
            let state = view.media_state_mut();
            state.show_storage = false;
            state.show_metadata = false;
        });
        paint(&view, cx, 320.0, 240.0);
        paint(&view, cx, 1440.0, 900.0);
    }

    /// Every filter, including one naming a folder no asset is in — an empty pool is a state
    /// this page reaches by clicking, so it has to draw.
    #[gpui::test]
    fn every_filter_paints_including_an_empty_one(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        for filter in [
            PoolFilter::All,
            PoolFilter::Kind(MediaKind::Video),
            PoolFilter::Kind(MediaKind::Image),
            PoolFilter::Kind(MediaKind::Audio),
            PoolFilter::Folder("/Volumes/Card/DCIM".to_string()),
            PoolFilter::Folder("/nowhere".to_string()),
        ] {
            view.update(cx, |view, _| view.media_state_mut().filter = filter.clone());
            paint(&view, cx, 1440.0, 900.0);
        }
    }

    /// An empty project: the page a user sees before they have imported anything. The storage
    /// tree, the pool and the metadata panel each have their own empty state and all three are
    /// on screen at once here.
    #[gpui::test]
    fn the_media_page_paints_with_an_empty_pool(cx: &mut TestAppContext) {
        let (view, cx) = crate::paint_harness::window(cx, |_window, cx| {
            let focus = cx.focus_handle();
            let mut view = EditorView::new(Editor::starter(), focus, None, None);
            view.page = Page::Media;
            view
        });
        view.update(cx, |view, _| {
            assert!(view.editor.project().media.is_empty())
        });
        paint(&view, cx, 1440.0, 900.0);
        paint(&view, cx, 320.0, 240.0);
    }

    /// The playhead survives the page switch — `pages.md` rule 3, the single behaviour that
    /// makes six pages feel like one application. The clip viewer's timecode is read off it.
    #[gpui::test]
    fn switching_to_media_and_back_leaves_the_playhead_alone(cx: &mut TestAppContext) {
        let (view, cx) = windowed(cx);
        view.update(cx, |view, _| {
            view.editor
                .seek(MediaTime::from_ticks(TICKS_PER_SECOND * 3));
            view.show_page(Page::Cut);
            view.show_page(Page::Media);
            assert_eq!(
                view.editor.playhead().as_ticks(),
                TICKS_PER_SECOND * 3,
                "the page switch moved the playhead"
            );
        });
        paint(&view, cx, 1440.0, 900.0);
    }
}

impl EditorView {
    /// Queue a thumbnail for every asset, poll the ones in flight, and upload any that landed.
    ///
    /// Uploading happens *here*, in the one `&mut self` pass render already makes, rather than
    /// lazily at the tile. Doing it at the tile means `pool_tile` needs `&mut self`, and that
    /// borrow cascades up through `media_pool_body`, `media_pool` and `media_page` — turning a
    /// thumbnail into a refactor of the page. This keeps the element tree immutable.
    pub(super) fn request_posters(&mut self) {
        let assets: Vec<(String, String)> = self
            .editor
            .project()
            .media
            .iter()
            .map(|asset| (asset.id.clone(), asset.path.clone()))
            .collect();
        for (id, path) in assets {
            self.posters.request(&id, Some(path.as_str()));
            self.strips.request(&id, Some(path.as_str()));
            self.upload_strip(&id);
            // Audio has no frame to show, so its tile draws peaks instead. Requested here
            // because `request_scene` only covers clips on the timeline, and a pool shows every
            // imported asset whether it has been used yet or not.
            if bay_core::MediaKind::of_path(&path) == bay_core::MediaKind::Audio {
                self.waveforms
                    .request(&id, Some(path.as_str()), POOL_WAVEFORM_BUCKETS);
            }
            if self.poster_images.contains_key(&id) {
                continue;
            }
            let Some(frame) = self.posters.poster(&id) else {
                continue;
            };
            // The channel swap, once per asset rather than once per frame. `PosterFrame` carries
            // **RGBA**, because that is what ffmpeg was asked for; gpui documents `RenderImage`
            // as **BGRA**. `viewer.rs` correctly does *not* swap, because its frames come off
            // the GPU already in BGRA — the two paths genuinely differ, and reconciling them
            // turns every face blue.
            let mut bgra = frame.rgba.clone();
            for texel in bgra.chunks_exact_mut(4) {
                texel.swap(0, 2);
            }
            if let Some(buffer) = image::RgbaImage::from_raw(frame.width, frame.height, bgra) {
                self.poster_images.insert(
                    id,
                    Arc::new(RenderImage::new(vec![image::Frame::new(buffer)])),
                );
            }
        }
    }

    /// The uploaded thumbnail for `media_id`, if one has landed. A pure lookup.
    pub(super) fn poster_image(&self, media_id: &str) -> Option<Arc<RenderImage>> {
        self.poster_images.get(media_id).map(Arc::clone)
    }

    /// Upload a decoded filmstrip's cells, once.
    ///
    /// Same reasoning as the poster: the channel swap is per cell and must not happen per frame,
    /// and doing it in the mutable pass keeps the element tree immutable. `PosterFrame` is RGBA
    /// from ffmpeg; gpui wants BGRA.
    fn upload_strip(&mut self, media_id: &str) {
        if self.strip_images.contains_key(media_id) {
            return;
        }
        let Some(frames) = self.strips.strip(media_id) else {
            return;
        };
        let images: Vec<Arc<RenderImage>> = frames
            .iter()
            .filter_map(|frame| {
                let mut bgra = frame.rgba.clone();
                for texel in bgra.chunks_exact_mut(4) {
                    texel.swap(0, 2);
                }
                let buffer = image::RgbaImage::from_raw(frame.width, frame.height, bgra)?;
                Some(Arc::new(RenderImage::new(vec![image::Frame::new(buffer)])))
            })
            .collect();
        if !images.is_empty() {
            self.strip_images.insert(media_id.to_string(), images);
        }
    }

    /// The cells to draw across a clip, and how wide each one is.
    ///
    /// A cell is **one whole frame**, drawn at lane height with its width following the frame's
    /// aspect — which is how Resolve draws a filmstrip, and the only way a vertical clip is
    /// recognisable. Stretching each cell to an equal share of the block width instead turns a
    /// 9:16 frame into a 2:1 sliver: what shipped looked like vertical stripes, not pictures.
    ///
    /// Returns the cells to draw left to right and the width of one, so the caller can lay them
    /// out and clip the overflow at the block's edge.
    pub(super) fn filmstrip_cells(
        &self,
        media_id: &str,
        block_width: f32,
        lane_height: f32,
    ) -> Option<(Vec<Arc<RenderImage>>, f32)> {
        let cells = self.strip_images.get(media_id)?;
        let first = cells.first()?;
        if !block_width.is_finite() || block_width <= 0.0 || lane_height <= 0.0 {
            return None;
        }

        let size = first.size(0);
        let (fw, fh) = (u32::from(size.width) as f32, u32::from(size.height) as f32);
        if fw <= 0.0 || fh <= 0.0 {
            return None;
        }
        // One whole frame, lane-height tall.
        let cell_width = (lane_height * (fw / fh)).max(8.0);

        // How many fit, plus one so the strip runs to the edge instead of stopping short and
        // leaving a bar of flat colour.
        let fits = ((block_width / cell_width).ceil() as usize).clamp(1, 64);
        Some((
            (0..fits)
                .map(|i| {
                    let fraction = if fits > 1 {
                        i as f32 / (fits - 1) as f32
                    } else {
                        0.0
                    };
                    let index =
                        bay_preview::poster::filmstrip_cell(cells.len(), fraction, (0.0, 1.0));
                    Arc::clone(&cells[index])
                })
                .collect(),
            cell_width,
        ))
    }
}

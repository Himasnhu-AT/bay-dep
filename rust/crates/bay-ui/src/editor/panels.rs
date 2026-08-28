//! The left panel — its rail, the media library, and the block palettes.
//!
//! A child module of [`super`], so it can reach `EditorView`'s private fields; a sibling
//! could not.

use super::*;

impl EditorView {
    /// Pick a media file, import it into the project library, and add a clip at the playhead.
    pub(super) fn import_media(&mut self) {
        let Some(path) = rfd::FileDialog::new()
            .add_filter(
                "Media",
                &[
                    "png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "mov", "mkv", "webm", "avi",
                    "m4v", "mp3", "wav", "m4a", "aac", "flac", "ogg",
                ],
            )
            .pick_file()
        else {
            return;
        };
        let path = path.to_string_lossy().into_owned();
        let name = std::path::Path::new(&path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "Media".to_string());

        self.add_counter += 1;
        let media_id = format!("media-{}", self.add_counter);
        let mut asset = MediaAsset::new(media_id.clone(), name.clone(), path.clone());
        // Probed once at import and kept: a trim can then stop at the end of the file, and
        // `check` has something to measure a clip against.
        if let Ok(meta) = bay_preview::probe::probe_media(&path) {
            asset.duration_seconds = Some(meta.duration.to_seconds_f64());
            asset.width = Some(meta.width);
            asset.height = Some(meta.height);
        }
        self.editor.add_media(asset);
        self.place_media(&media_id, &name, &path);
        self.preview_sig = None; // new media asset → force a re-render
    }

    /// The 56px rail of panel tabs down the left edge.
    pub(super) fn panel_rail(&self, cx: &mut Context<Self>) -> Div {
        let mut rail = div()
            .w(px(56.0))
            .flex_none()
            .flex()
            .flex_col()
            .gap(px(4.0))
            .px(px(6.0))
            .py(px(10.0))
            .bg(rgb(theme::RAIL))
            .border_r_1()
            .border_color(rgb(theme::BORDER_SOFT));

        for (index, panel) in Panel::ALL.into_iter().enumerate() {
            let on = self.panel == panel;
            rail = rail.child(
                div()
                    .id(("panel-tab", index))
                    .h(px(46.0))
                    .flex()
                    .flex_col()
                    .items_center()
                    .justify_center()
                    .gap(px(2.0))
                    .rounded(px(6.0))
                    .bg(rgb(if on { theme::SELECTED } else { theme::RAIL }))
                    .child(
                        div()
                            .text_color(rgb(if on { theme::TEXT } else { theme::MUTED }))
                            .child(panel.glyph()),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(if on { theme::ACCENT_SOFT } else { theme::FAINT }))
                            .child(panel.label()),
                    )
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.panel = panel;
                        cx.notify();
                    })),
            );
        }
        rail
    }

    /// The panel itself, plus the divider that resizes it.
    pub(super) fn left_panel(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let body = match self.panel {
            Panel::Media => self.library_panel(vm, cx),
            other => self.blocks_panel(other, vm, cx),
        };
        // No width and no divider here any more: the resizable split in `edit_page` owns both.
        // `media_width` is still read for the media grid's column count, but it is now a mirror
        // of the split's size rather than a number this panel sets for itself.
        div()
            .size_full()
            .flex()
            .flex_col()
            .py(px(12.0))
            .gap(px(10.0))
            .bg(rgb(theme::PANEL))
            .child(body)
    }

    /// The project's own media, grouped by kind.
    pub(super) fn library_panel(&self, vm: &EditorViewModel, cx: &mut Context<Self>) -> Div {
        let columns = self.panel_columns();
        let cell = self.panel_cell_height(columns);
        let media: Vec<crate::view_model::MediaItem> = vm
            .media
            .iter()
            .map(|item| crate::view_model::MediaItem {
                id: item.id.clone(),
                name: item.name.clone(),
                path: item.path.clone(),
                kind: item.kind,
            })
            .collect();
        let count = media.len();
        let folders = MediaFolder::group(media);

        let mut list = div()
            .id("media-list")
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .gap(px(10.0))
            .px(px(12.0))
            .overflow_y_scroll();

        if folders.is_empty() {
            list = list.child(widgets::note(
                "No media yet. Import a video, image or audio file and it appears here.",
            ));
        }

        let mut index = 0usize;
        for folder in &folders {
            let open = !self.collapsed_folders.contains(folder.name);
            let name = folder.name.to_string();
            let mut group = div().flex().flex_col().child(
                div()
                    .id(SharedString::from(format!("folder-{}", folder.name)))
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap(px(6.0))
                    .py(px(3.0))
                    .child(
                        div()
                            .w(px(10.0))
                            .text_xs()
                            .text_color(rgb(theme::FAINT))
                            .child(if open { "▼" } else { "▶" }),
                    )
                    .child(
                        div()
                            .flex_1()
                            .text_xs()
                            .text_color(rgb(theme::TEXT))
                            .child(folder.name),
                    )
                    .child(widgets::note(folder.items.len().to_string()))
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        if !this.collapsed_folders.remove(&name) {
                            this.collapsed_folders.insert(name.clone());
                        }
                        cx.notify();
                    })),
            );

            if open {
                let mut grid = div().flex().flex_col().gap(px(8.0)).mt(px(4.0));
                let mut row = div().flex().flex_row().gap(px(8.0));
                let mut in_row = 0usize;
                for asset in &folder.items {
                    row = row.child(self.media_tile(asset, cell, index, cx));
                    index += 1;
                    in_row += 1;
                    if in_row == columns {
                        grid = grid.child(row);
                        row = div().flex().flex_row().gap(px(8.0));
                        in_row = 0;
                    }
                }
                if in_row > 0 {
                    for _ in in_row..columns {
                        row = row.child(div().flex_1().min_w(px(0.0)));
                    }
                    grid = grid.child(row);
                }
                group = group.child(grid);
            }
            list = list.child(group);
        }

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .gap(px(10.0))
            .child(
                widgets::row()
                    .px(px(12.0))
                    .justify_between()
                    .child(widgets::section("LIBRARY"))
                    .child(widgets::note(format!("{count} items"))),
            )
            .child(div().px(px(12.0)).child(self.button(
                "import-media",
                "Import Media…",
                false,
                cx,
                |this, _cx| this.import_media(),
            )))
            .child(list)
            .child(
                div()
                    .px(px(12.0))
                    .child(widgets::note("Click a tile to add it at the playhead")),
            )
    }

    /// One media thumbnail.
    ///
    /// A coloured plate with the clip-kind colour, not a decoded frame: bay has no thumbnail
    /// cache, and decoding a poster per tile on the render path is exactly what the decode rule
    /// forbids. The kind, name and a dot are what the panel can honestly show.
    pub(super) fn media_tile(
        &self,
        asset: &crate::view_model::MediaItem,
        cell: f32,
        index: usize,
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<Div> {
        let (id, name, path) = (asset.id.clone(), asset.name.clone(), asset.path.clone());
        let color = theme::element_color(asset.kind.label());
        let payload = super::timeline::MediaDrag {
            media_id: id.clone(),
            name: name.clone(),
            path: path.clone(),
        };
        let chip_label = SharedString::from(name.clone());
        let chip_poster = self.poster_image(&id);
        div()
            .id(("media-tile", index))
            // Dragged onto the timeline it lands where it is dropped; clicked it lands at the
            // playhead. Both go through `place_media_at`, so the two routes cannot drift.
            .on_drag(payload, move |_, _, _, cx| {
                let (label, poster) = (chip_label.clone(), chip_poster.clone());
                cx.new(|_| super::timeline::MediaDragChip::new(label, poster))
            })
            .flex_1()
            .min_w(px(0.0))
            .flex()
            .flex_col()
            .child(
                div()
                    .h(px(cell))
                    .rounded(px(5.0))
                    .bg(rgb(theme::LANE))
                    .border_1()
                    .border_color(rgb(theme::BORDER_SOFT))
                    .flex()
                    .items_center()
                    .justify_center()
                    .overflow_hidden()
                    // The Cut page's library is a *different* renderer from the Media page's
                    // pool, and wiring thumbnails into only one of them is why the Cut page
                    // still showed coloured bars after the pool stopped.
                    .children(self.poster_image(&asset.id).map(|image| {
                        gpui::img(gpui::ImageSource::Render(image))
                            .h(px(cell))
                            .w_full()
                    }))
                    .children(
                        self.poster_image(&asset.id)
                            .is_none()
                            .then(|| div().w(px(28.0)).h(px(4.0)).rounded(px(2.0)).bg(rgb(color))),
                    ),
            )
            .child(
                div()
                    .mt(px(4.0))
                    .text_xs()
                    .text_color(rgb(theme::TEXT))
                    .overflow_hidden()
                    .child(shared_text(name.clone())),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::FAINT))
                    .child(asset.kind.label()),
            )
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.place_media(&id, &name, &path);
                cx.notify();
            }))
    }

    /// Text / Transitions / Effects / Audio: a grid of tiles that each apply one edit.
    pub(super) fn blocks_panel(
        &self,
        panel: Panel,
        vm: &EditorViewModel,
        cx: &mut Context<Self>,
    ) -> Div {
        let columns = self.panel_columns();
        let cell = self.panel_cell_height(columns);
        let tiles = panel.blocks();
        let has_selection = vm.selected.is_some();
        let hint = match (panel, has_selection) {
            (Panel::Text, _) => "Adds a clip at the playhead.",
            (_, true) => "Applies to the selected clip.",
            (_, false) => "Select a clip first — these change one.",
        };

        let mut grid = div().flex().flex_col().gap(px(8.0));
        let mut row = div().flex().flex_row().gap(px(8.0));
        let mut in_row = 0usize;
        for (index, tile) in tiles.iter().enumerate() {
            let enabled = !tile.needs_selection || has_selection;
            let id = tile.id;
            row = row.child(
                div()
                    .id(("block", index))
                    .flex_1()
                    .min_w(px(0.0))
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .h(px(cell))
                            .rounded(px(5.0))
                            .bg(rgb(theme::PANEL_ALT))
                            .border_1()
                            .border_color(rgb(theme::BORDER_SOFT))
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_color(rgb(if enabled {
                                theme::ACCENT_SOFT
                            } else {
                                theme::FAINT
                            }))
                            .child(panel.glyph()),
                    )
                    .child(
                        div()
                            .mt(px(4.0))
                            .text_xs()
                            .text_color(rgb(if enabled { theme::TEXT } else { theme::FAINT }))
                            .overflow_hidden()
                            .child(tile.label),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::FAINT))
                            .overflow_hidden()
                            .child(tile.detail),
                    )
                    .on_click(cx.listener(move |this, _event, _window, cx| {
                        this.apply_block(id);
                        cx.notify();
                    })),
            );
            in_row += 1;
            if in_row == columns {
                grid = grid.child(row);
                row = div().flex().flex_row().gap(px(8.0));
                in_row = 0;
            }
        }
        if in_row > 0 {
            for _ in in_row..columns {
                row = row.child(div().flex_1().min_w(px(0.0)));
            }
            grid = grid.child(row);
        }

        div()
            .flex()
            .flex_col()
            .flex_1()
            .min_h(px(0.0))
            .gap(px(8.0))
            .child(
                widgets::row()
                    .px(px(12.0))
                    .justify_between()
                    .child(widgets::section(panel.title()))
                    .child(widgets::note(format!("{} presets", tiles.len()))),
            )
            .child(div().px(px(12.0)).child(widgets::note(hint)))
            .child(
                div()
                    .id("blocks-scroll")
                    .flex_1()
                    .min_h(px(0.0))
                    .px(px(12.0))
                    .pb(px(8.0))
                    .overflow_y_scroll()
                    .child(grid),
            )
    }

    /// Two columns until the panel is wide enough for three.
    pub(super) fn panel_columns(&self) -> usize {
        if self.media_width >= 330.0 {
            3
        } else {
            2
        }
    }

    /// A 16:9-ish tile at whatever width the columns work out to.
    pub(super) fn panel_cell_height(&self, columns: usize) -> f32 {
        let gutters = 24.0 + (columns as f32 - 1.0) * 8.0;
        (((self.media_width - gutters) / columns as f32) * 0.56).max(34.0)
    }

    /// Run one panel tile against the editor.
    ///
    /// The catalog and the commands live in `bay_core::blocks`, so an MCP client can do exactly
    /// this without a window — and so the "does this effect exist in the compositor?" test runs
    /// headlessly.
    pub(super) fn apply_block(&mut self, block_id: &'static str) {
        let mut counter = self.add_counter;
        let planned = {
            let mut fresh = |prefix: &str| {
                counter += 1;
                format!("{prefix}-{counter}")
            };
            blocks::plan(&self.editor, block_id, &mut fresh)
        };
        self.add_counter = counter;
        match planned {
            Ok(commands) => {
                for command in commands {
                    self.editor.execute(command);
                }
                self.status = None;
            }
            Err(error) => self.status = Some(error.to_string()),
        }
    }
}

/// The left panel: its tabs, the tiles in them, and the divider that resizes it.
#[cfg(test)]
mod panel_tests {
    use super::*;
    use gpui::TestAppContext;

    fn view(cx: &mut TestAppContext) -> gpui::Entity<EditorView> {
        cx.update(|cx| {
            let focus = cx.focus_handle();
            cx.new(|_| EditorView::new(Editor::starter(), focus, None, None))
        })
    }

    /// The library is what opens, because it is the panel a project starts in.
    #[gpui::test]
    fn the_panel_opens_on_the_library(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            assert_eq!(view.panel, Panel::Media);
            assert_eq!(view.media_width, DEFAULT_PANEL_WIDTH);
            assert!(view.collapsed_folders.is_empty(), "groups start open");
        });
    }

    /// A tile on the Text panel adds a clip with nothing selected — that is the whole point of
    /// it — and the new clip is what ends up selected.
    #[gpui::test]
    fn a_text_tile_adds_a_clip_and_selects_it(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.editor.select(Vec::new());
            view.panel = Panel::Text;
            view.apply_block("text.headline");

            let selected = view.editor.selected_element().expect("the new clip");
            assert_eq!(selected.name(), "Headline");
            assert!(view.status.is_none(), "no complaint: {:?}", view.status);
        });
    }

    /// A tile that needs a clip must explain itself in the status line rather than doing
    /// nothing — a dead-looking button is the failure this replaces.
    #[gpui::test]
    fn a_tile_that_needs_a_clip_says_so_in_the_status_line(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.editor.select(Vec::new());
            view.panel = Panel::Effects;
            view.apply_block("fx.blur");

            let status = view.status.clone().expect("a complaint");
            assert!(status.contains("Select a clip"), "{status}");
        });
    }

    /// And with a clip selected it applies, undoably, and clears the complaint.
    #[gpui::test]
    fn an_effect_tile_applies_to_the_selection_and_undoes(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.editor
                .select(vec![ElementRef::new("track-main", "el-title")]);
            view.status = Some("stale".into());
            view.apply_block("fx.blur");

            assert!(view.status.is_none(), "a success must clear the complaint");
            let effects = view.editor.selected_element().unwrap().effects().len();
            assert_eq!(effects, 1);
            assert_eq!(
                view.editor.selected_element().unwrap().effects()[0].effect_type,
                "blur"
            );

            view.editor.undo();
            assert!(view.editor.selected_element().unwrap().effects().is_empty());
        });
    }

    /// Every tile has to mint its own ids. Two clicks that produce the same element id would
    /// make the second clip unaddressable.
    #[gpui::test]
    fn two_clicks_produce_two_distinct_clips(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.apply_block("text.caption");
            let first = view.editor.selection().first().cloned().unwrap();
            view.apply_block("text.caption");
            let second = view.editor.selection().first().cloned().unwrap();
            assert_ne!(first.element_id, second.element_id);
        });
    }

    // The divider's clamp test lived here. The divider is gone: `edit_page` hands the split a
    // `size_range(MIN_PANEL_WIDTH..MAX_PANEL_WIDTH)` and the library enforces it, so there is no
    // bay-side arithmetic left to assert on. `render` still clamps what it mirrors back into
    // `media_width`, which is what `the_panel_grid_gains_a_column_when_it_is_wide_enough` below
    // depends on, and that one still runs.

    /// The grid gains a column once there is room for one, and never fewer than two.
    #[gpui::test]
    fn the_panel_grid_gains_a_column_when_it_is_wide_enough(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.media_width = MIN_PANEL_WIDTH;
            assert_eq!(view.panel_columns(), 2);
            assert!(view.panel_cell_height(2) > 0.0);

            view.media_width = MAX_PANEL_WIDTH;
            assert_eq!(view.panel_columns(), 3);
        });
    }

    /// Collapsing is stored as the closed set, so a group that appears later is open — a folder
    /// that arrives collapsed hides the file that just landed in it.
    #[gpui::test]
    fn collapsing_a_group_is_remembered_and_reversible(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.collapsed_folders.insert("Audio".into());
            assert!(view.collapsed_folders.contains("Audio"));
            assert!(
                !view.collapsed_folders.contains("Video"),
                "a group nobody touched stays open"
            );
            view.collapsed_folders.remove("Audio");
            assert!(view.collapsed_folders.is_empty());
        });
    }

    /// The transport reads in frames, because that is how a cut is chosen.
    #[test]
    fn the_transport_timecode_counts_frames() {
        assert_eq!(timecode(0.0), "0:00:00:00");
        assert_eq!(timecode(1.0), "0:00:01:00");
        assert_eq!(timecode(2.5), "0:00:02:15");
        assert_eq!(timecode(61.0), "0:01:01:00");
        assert_eq!(timecode(3661.0), "1:01:01:00");
        assert_eq!(
            timecode(-5.0),
            "0:00:00:00",
            "a negative time is not a crash"
        );
    }

    /// Fit must survive an empty timeline rather than dividing by zero.
    #[gpui::test]
    fn fitting_an_empty_timeline_changes_nothing(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.editor = Editor::new(bay_core::Project::empty(
                "p",
                "Empty",
                bay_core::CanvasSize::default(),
                bay_core::Fps::default(),
                "#000000",
            ));
            let before = view.timeline.pixels_per_second();
            view.fit_to_window(1200.0);
            assert_eq!(view.timeline.pixels_per_second(), before);
        });
    }

    #[gpui::test]
    fn fitting_a_real_timeline_brings_it_into_view(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.timeline = view.timeline.with_scroll_x(500.0);
            view.fit_to_window(1200.0);
            let duration = view.editor.duration().to_seconds_f64() as f32;
            assert!(view.timeline.pixels_per_second() * duration <= 1200.0);
            assert!(view.timeline.pixels_per_second() >= MIN_ZOOM);
            assert_eq!(
                view.timeline.scroll_x(),
                0.0,
                "fitting starts at the beginning"
            );
        });
    }

    /// Adding an overlay lane must add exactly one, named for its position.
    #[gpui::test]
    fn adding_a_track_adds_one_overlay_lane(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            let before = view.editor.active_scene().tracks.overlay.len();
            view.add_overlay_track();
            assert_eq!(view.editor.active_scene().tracks.overlay.len(), before + 1);
        });
    }

    #[gpui::test]
    fn duplicating_needs_a_selection_and_then_copies_the_clip(cx: &mut TestAppContext) {
        let view = view(cx);
        view.update(cx, |view, _| {
            view.editor.select(Vec::new());
            let before = view.editor.active_scene().tracks.main.elements.len();
            view.duplicate_selected();
            assert_eq!(
                view.editor.active_scene().tracks.main.elements.len(),
                before,
                "nothing selected, nothing duplicated"
            );

            view.editor
                .select(vec![ElementRef::new("track-main", "el-title")]);
            view.duplicate_selected();
            assert_eq!(
                view.editor.active_scene().tracks.main.elements.len(),
                before + 1
            );
        });
    }
}

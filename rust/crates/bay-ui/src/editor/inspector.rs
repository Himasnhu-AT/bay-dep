//! The right-hand inspector: the property rows, and the presets it saves and applies.
//!
//! A child module of [`super`], so it can reach `EditorView`'s private fields; a sibling
//! could not.

use super::*;

impl EditorView {
    /// Save the selected clip's effects + animations as an in-memory motion preset.
    pub(super) fn save_preset(&mut self) {
        let captured = self.editor.selected_element().map(|element| {
            (
                element.effects().to_vec(),
                element.animations().cloned().unwrap_or_default(),
            )
        });
        if let Some((effects, animations)) = captured {
            if effects.is_empty() && animations.is_empty() {
                return;
            }
            let name = format!("Preset {}", self.presets.len() + 1);
            self.presets.push(MotionPreset {
                name,
                effects,
                animations,
            });
        }
    }

    /// Save the selected clips as a template in the library, so they can be placed again in
    /// this project or any other.
    ///
    /// The motion presets above live in this window and die with it — useful until the app is
    /// closed, which is not really a preset at all. A template is written to disk.
    pub(super) fn save_template(&mut self) {
        let selected: Vec<bay_core::Element> = self
            .editor
            .selection()
            .iter()
            .filter_map(|reference| self.editor.active_scene().element(reference).cloned())
            .collect();
        if selected.is_empty() {
            self.status = Some("Select the clips to save as a template first.".into());
            return;
        }
        let Some(library) = bay_core::project::TemplateLibrary::open_default() else {
            self.status = Some("No data directory, so there is nowhere to save a template.".into());
            return;
        };

        // Times are stored relative to the template's own start, so placing it later does not
        // require rewriting every time inside it.
        let origin = selected
            .iter()
            .map(|element| element.start())
            .min()
            .unwrap_or(MediaTime::ZERO);
        let elements: Vec<bay_core::Element> = selected
            .iter()
            .map(|element| {
                let mut relative = element.clone();
                relative.set_start(MediaTime::from_ticks(
                    element.start().as_ticks() - origin.as_ticks(),
                ));
                relative
            })
            .collect();
        // Every title in the bundle is a slot worth filling when it is placed again.
        let text_slots = elements
            .iter()
            .filter(|element| matches!(element, bay_core::Element::Text(_)))
            .map(|element| element.id().to_string())
            .collect();

        self.add_counter += 1;
        let id = format!("saved-{}", self.add_counter);
        let template = bay_core::project::Template {
            name: format!("Template {}", self.add_counter),
            description: format!("{} element(s) saved from this project", elements.len()),
            id: id.clone(),
            elements,
            text_slots,
        };
        self.status = Some(match library.save(&template) {
            Ok(path) => format!("Saved template {id} to {}", path.display()),
            Err(error) => format!("Could not save the template: {error}"),
        });
    }

    /// Apply a saved preset to the selected clip (minting fresh effect ids), one undo step.
    pub(super) fn apply_preset(&mut self, index: usize) {
        let Some(reference) = self.editor.selection().first().cloned() else {
            return;
        };
        let Some(preset) = self.presets.get(index).cloned() else {
            return;
        };
        let mut effects = Vec::with_capacity(preset.effects.len());
        for effect in preset.effects {
            self.add_counter += 1;
            effects.push(bay_core::Effect {
                id: format!("fx-{}", self.add_counter),
                ..effect
            });
        }
        self.editor.execute(Command::ApplyMotionPreset {
            reference,
            effects,
            animations: preset.animations,
        });
    }

    /// Add a keyframe for `property` at the playhead using the element's current sampled value.
    pub(super) fn add_keyframe(&mut self, property: &'static str) {
        let Some(reference) = self.editor.selection().first().cloned() else {
            return;
        };
        let playhead = self.editor.playhead();
        let computed = {
            let scene = self.editor.active_scene();
            let Some(element) = scene.element(&reference) else {
                return;
            };
            let local =
                MediaTime::from_ticks((playhead.as_ticks() - element.start().as_ticks()).max(0));
            element.sampled_transform(local).map(|t| {
                let value = match property {
                    "scale" => t.scale,
                    "x" => t.x,
                    "y" => t.y,
                    "rotation" => t.rotation,
                    _ => t.opacity,
                };
                (local, value)
            })
        };
        if let Some((time, value)) = computed {
            self.editor.execute(Command::AddKeyframe {
                reference,
                property: property.to_string(),
                time,
                value,
            });
        }
    }

    pub(super) fn info_row(&self, label: &str, value: &str) -> Div {
        div()
            .flex()
            .flex_row()
            .justify_between()
            .gap_2()
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(label.to_string())),
            )
            .child(
                div()
                    .text_sm()
                    .text_color(rgb(theme::TEXT))
                    .child(Self::shared(value.to_string())),
            )
    }

    pub(super) fn mini_button(
        &self,
        id: SharedString,
        label: &str,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView) + 'static,
    ) -> gpui::Stateful<Div> {
        widgets::pressable(
            widgets::ButtonKind::Normal,
            widgets::button_face(widgets::ButtonKind::Normal, true)
                .id(id)
                .w(px(22.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded_md()
                .text_sm()
                .child(Self::shared(label.to_string())),
        )
        .cursor_pointer()
        .on_click(cx.listener(move |this, _event, _window, cx| {
            handler(this);
            cx.notify();
        }))
    }

    /// A button that adds a keyframe for `property` at the playhead.
    pub(super) fn kf_button(
        &self,
        property: &'static str,
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<Div> {
        div()
            .id(SharedString::from(format!("kf-{property}")))
            .px_2()
            .py_1()
            .rounded_md()
            .bg(rgb(theme::PANEL_ALT))
            .text_xs()
            .text_color(rgb(theme::TEXT))
            .child(Self::shared(property.to_string()))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                this.add_keyframe(property);
                cx.notify();
            }))
    }

    /// A small square toggle (used for track hide/mute); highlighted when `active`.
    pub(super) fn track_toggle(
        &self,
        id: SharedString,
        label: &str,
        active: bool,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView) + 'static,
    ) -> gpui::Stateful<Div> {
        div()
            .id(id)
            .w(px(20.0))
            .flex()
            .items_center()
            .justify_center()
            .rounded_md()
            .bg(rgb(if active {
                theme::SELECTED
            } else {
                theme::PANEL_ALT
            }))
            .text_xs()
            .text_color(rgb(theme::TEXT))
            .child(Self::shared(label.to_string()))
            .on_click(cx.listener(move |this, _event, _window, cx| {
                handler(this);
                cx.notify();
            }))
    }

    /// A label + value with `−`/`+` steppers that call `handler(this, delta_ticks)`.
    pub(super) fn nudge_row(
        &self,
        label: &str,
        value: String,
        id_prefix: &'static str,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView, i64) + Clone + 'static,
    ) -> Div {
        let minus = {
            let handler = handler.clone();
            self.mini_button(
                SharedString::from(format!("{id_prefix}-minus")),
                "−",
                cx,
                move |this| handler(this, -NUDGE_TICKS),
            )
        };
        let plus = self.mini_button(
            SharedString::from(format!("{id_prefix}-plus")),
            "+",
            cx,
            move |this| handler(this, NUDGE_TICKS),
        );
        div()
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .gap_2()
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(label.to_string())),
            )
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_1()
                    .child(minus)
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(theme::TEXT))
                            .child(Self::shared(value)),
                    )
                    .child(plus),
            )
    }

    /// Like `nudge_row` but the steppers call `handler(this, sign)` with `sign = ∓1.0` (the
    /// closure applies the field-specific step). Used for float transform fields.
    pub(super) fn stepper_row(
        &self,
        label: &str,
        value: String,
        id_prefix: &'static str,
        cx: &mut Context<Self>,
        handler: impl Fn(&mut EditorView, f32) + Clone + 'static,
    ) -> Div {
        let minus = {
            let handler = handler.clone();
            self.mini_button(
                SharedString::from(format!("{id_prefix}-minus")),
                "−",
                cx,
                move |this| handler(this, -1.0),
            )
        };
        let plus = self.mini_button(
            SharedString::from(format!("{id_prefix}-plus")),
            "+",
            cx,
            move |this| handler(this, 1.0),
        );
        div()
            .flex()
            .flex_row()
            .items_center()
            .justify_between()
            .gap_2()
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child(Self::shared(label.to_string())),
            )
            .child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_1()
                    .child(minus)
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(theme::TEXT))
                            .child(Self::shared(value)),
                    )
                    .child(plus),
            )
    }

    /// A transform stepper that reads the element's current transform, applies `edit`, and
    /// dispatches a SetTransform command.
    pub(super) fn transform_row(
        &self,
        label: &str,
        value: String,
        id_prefix: &'static str,
        reference: ElementRef,
        cx: &mut Context<Self>,
        edit: impl Fn(&mut Transform, f32) + Clone + 'static,
    ) -> Div {
        self.stepper_row(label, value, id_prefix, cx, move |this, sign| {
            let current = this
                .editor
                .active_scene()
                .element(&reference)
                .and_then(|e| e.transform());
            if let Some(mut transform) = current {
                edit(&mut transform, sign);
                this.editor.execute(Command::SetTransform {
                    reference: reference.clone(),
                    transform,
                });
            }
        })
    }

    pub(super) fn inspector(
        &self,
        vm: &EditorViewModel,
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<Div> {
        // No fixed width: the resizable split in `edit_page` sizes this panel now.
        // Scrollable: the inspector is a column of every property a clip has, and on a short
        // window the transform rows fell off the bottom with no way to reach them.
        let panel = div()
            .id("inspector")
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .size_full()
            .p_3()
            .gap_3()
            .bg(rgb(theme::PANEL))
            .border_l_1()
            .border_color(rgb(theme::BORDER))
            .child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child("INSPECTOR"),
            );

        let Some(selected) = &vm.selected else {
            return panel.child(
                div()
                    .text_sm()
                    .text_color(rgb(theme::MUTED))
                    .child("Select a clip to inspect it."),
            );
        };

        let start_ref = selected.reference.clone();
        let duration_ref = selected.reference.clone();

        let mut body = div()
            .flex()
            .flex_col()
            .gap_2()
            .child(self.info_row("Name", &selected.name))
            .child(self.info_row("Kind", &selected.kind_label))
            .child(self.nudge_row(
                "Start",
                format!("{:.2}s", selected.start_seconds),
                "start",
                cx,
                move |this, delta| {
                    let current = this
                        .editor
                        .active_scene()
                        .element(&start_ref)
                        .map(|element| element.start().as_ticks());
                    if let Some(ticks) = current {
                        this.editor.execute(Command::MoveElement {
                            reference: start_ref.clone(),
                            start: MediaTime::from_ticks((ticks + delta).max(0)),
                        });
                    }
                },
            ))
            .child(self.nudge_row(
                "Duration",
                format!("{:.2}s", selected.duration_seconds),
                "duration",
                cx,
                move |this, delta| {
                    let current = this
                        .editor
                        .active_scene()
                        .element(&duration_ref)
                        .map(|element| element.duration().as_ticks());
                    if let Some(ticks) = current {
                        this.editor.execute(Command::SetElementDuration {
                            reference: duration_ref.clone(),
                            duration: MediaTime::from_ticks(
                                (ticks + delta).max(MIN_DURATION_TICKS),
                            ),
                        });
                    }
                },
            ));

        // Fades. One pair of rows for every kind: on picture this ramps opacity, on audio it
        // ramps level, so a shot and its sound are faded the same way.
        for (label, id, is_in) in [
            ("Fade in", "fade-in", true),
            ("Fade out", "fade-out", false),
        ] {
            let seconds = if is_in {
                selected.fade_in_seconds
            } else {
                selected.fade_out_seconds
            };
            let fade_ref = selected.reference.clone();
            body = body.child(self.nudge_row(
                label,
                format!("{seconds:.2}s"),
                id,
                cx,
                move |this, delta| {
                    let current = this
                        .editor
                        .active_scene()
                        .element(&fade_ref)
                        .map(|element| (element.fade_in(), element.fade_out()));
                    if let Some((fade_in, fade_out)) = current {
                        let bumped = |time: MediaTime| {
                            MediaTime::from_ticks((time.as_ticks() + delta).max(0))
                        };
                        this.editor.execute(Command::SetFades {
                            reference: fade_ref.clone(),
                            fade_in: if is_in { bumped(fade_in) } else { fade_in },
                            fade_out: if is_in { fade_out } else { bumped(fade_out) },
                        });
                    }
                },
            ));
        }

        // Which part of the file this clip plays. Only clips with a timeline inside them have
        // one, and until it was shown here a slip was invisible: two clips of the same shot
        // looked identical in the inspector no matter what they were actually playing.
        if let Some(source_start) = selected.source_start_seconds {
            let label = match selected.source_length_seconds {
                Some(length) => format!("{source_start:.2}s of {length:.2}s"),
                None => format!("{source_start:.2}s"),
            };
            let source_ref = selected.reference.clone();
            body = body.child(self.nudge_row(
                "Source in",
                label,
                "source-in",
                cx,
                move |this, delta| {
                    let current = this
                        .editor
                        .active_scene()
                        .element(&source_ref)
                        .and_then(|element| element.source_start())
                        .map(|time| time.as_ticks());
                    if let Some(ticks) = current {
                        // A slip, not a trim: the clip stays where it is and plays a different
                        // part of the shot. The command clamps it to the file.
                        this.editor.execute(Command::SetSourceStart {
                            reference: source_ref.clone(),
                            trim_start: MediaTime::from_ticks((ticks + delta).max(0)),
                        });
                    }
                },
            ));
        }

        if let Some(content) = &selected.text_content {
            let editing = self
                .editing_text
                .as_ref()
                .filter(|(reference, _)| reference == &selected.reference);
            match editing {
                Some((_, buffer)) => {
                    body = body
                        .child(
                            div()
                                .text_xs()
                                .text_color(rgb(theme::MUTED))
                                .child("Editing (Enter = save, Esc = cancel)"),
                        )
                        .child(
                            div()
                                .px_2()
                                .py_1()
                                .rounded_md()
                                .bg(rgb(theme::SELECTED))
                                .text_sm()
                                .text_color(rgb(theme::TEXT))
                                .child(Self::shared(format!("{buffer}\u{258f}"))),
                        );
                }
                None => {
                    body = body
                        .child(self.info_row("Text", content))
                        .child(self.button("edit-text", "Edit Text", cx, {
                            let reference = selected.reference.clone();
                            let content = content.clone();
                            move |this, _cx| {
                                this.editing_text = Some((reference.clone(), content.clone()));
                            }
                        }));
                }
            }
        }

        // Transform controls for visual elements (drive the layout preview).
        if let Some(transform) = selected.transform {
            let reference = selected.reference.clone();
            body = body
                .child(self.transform_row(
                    "Opacity",
                    format!("{:.0}%", transform.opacity * 100.0),
                    "opacity",
                    reference.clone(),
                    cx,
                    |t, sign| t.opacity = (t.opacity + sign * 0.1).clamp(0.0, 1.0),
                ))
                .child(self.transform_row(
                    "Scale",
                    format!("{:.2}", transform.scale),
                    "scale",
                    reference.clone(),
                    cx,
                    |t, sign| t.scale = (t.scale + sign * 0.1).clamp(0.05, 4.0),
                ))
                .child(self.transform_row(
                    "X",
                    format!("{:.2}", transform.x),
                    "posx",
                    reference.clone(),
                    cx,
                    |t, sign| t.x = (t.x + sign * 0.05).clamp(0.0, 1.0),
                ))
                .child(self.transform_row(
                    "Y",
                    format!("{:.2}", transform.y),
                    "posy",
                    reference,
                    cx,
                    |t, sign| t.y = (t.y + sign * 0.05).clamp(0.0, 1.0),
                ));

            // Keyframe the current value of a property at the playhead.
            body = body.child(
                div()
                    .flex()
                    .flex_row()
                    .items_center()
                    .gap_1()
                    .child(
                        div()
                            .text_xs()
                            .text_color(rgb(theme::MUTED))
                            .child(Self::shared(format!(
                                "◇ keyframe ({} animated):",
                                selected.animated_count
                            ))),
                    )
                    .child(self.kf_button("opacity", cx))
                    .child(self.kf_button("scale", cx))
                    .child(self.kf_button("x", cx))
                    .child(self.kf_button("y", cx)),
            );

            // Effects list + add.
            body = body.child(
                div()
                    .text_xs()
                    .text_color(rgb(theme::MUTED))
                    .child("EFFECTS"),
            );
            for effect in &selected.effects {
                let effect_id = effect.id.clone();
                let mut controls = div().flex().flex_row().items_center().gap_1();
                if let Some(amount) = effect.amount {
                    controls = controls
                        .child(self.mini_button(
                            SharedString::from(format!("{effect_id}-amt-minus")),
                            "−",
                            cx,
                            {
                                let reference = selected.reference.clone();
                                let effect_id = effect_id.clone();
                                move |this| {
                                    this.editor.execute(Command::SetEffectParam {
                                        reference: reference.clone(),
                                        effect_id: effect_id.clone(),
                                        key: "amount".into(),
                                        value: (amount - 0.1).max(0.0),
                                    });
                                }
                            },
                        ))
                        .child(
                            div()
                                .text_xs()
                                .text_color(rgb(theme::TEXT))
                                .child(Self::shared(format!("{amount:.1}"))),
                        )
                        .child(self.mini_button(
                            SharedString::from(format!("{effect_id}-amt-plus")),
                            "+",
                            cx,
                            {
                                let reference = selected.reference.clone();
                                let effect_id = effect_id.clone();
                                move |this| {
                                    this.editor.execute(Command::SetEffectParam {
                                        reference: reference.clone(),
                                        effect_id: effect_id.clone(),
                                        key: "amount".into(),
                                        value: (amount + 0.1).min(4.0),
                                    });
                                }
                            },
                        ));
                }
                controls = controls
                    .child(self.track_toggle(
                        SharedString::from(format!("{effect_id}-toggle")),
                        if effect.enabled { "on" } else { "off" },
                        effect.enabled,
                        cx,
                        {
                            let reference = selected.reference.clone();
                            let effect_id = effect_id.clone();
                            move |this| {
                                this.editor.execute(Command::ToggleEffect {
                                    reference: reference.clone(),
                                    effect_id: effect_id.clone(),
                                });
                            }
                        },
                    ))
                    .child(self.mini_button(
                        SharedString::from(format!("{effect_id}-rm")),
                        "✕",
                        cx,
                        {
                            let reference = selected.reference.clone();
                            let effect_id = effect_id.clone();
                            move |this| {
                                this.editor.execute(Command::RemoveEffect {
                                    reference: reference.clone(),
                                    effect_id: effect_id.clone(),
                                });
                            }
                        },
                    ));
                body = body.child(
                    div()
                        .flex()
                        .flex_row()
                        .items_center()
                        .justify_between()
                        .gap_2()
                        .child(
                            div()
                                .text_sm()
                                .text_color(rgb(if effect.enabled {
                                    theme::TEXT
                                } else {
                                    theme::MUTED
                                }))
                                .child(Self::shared(effect.effect_type.clone())),
                        )
                        .child(controls),
                );
            }
            // One add-button per supported effect type. What each is born with comes from
            // `bay_core::blocks::default_effect_params`, not from here — the seed is engine
            // logic a headless client needs too, and when this view owned its own copy the
            // same effect arrived with different parameters depending on whether a person
            // clicked a button or an agent called a tool.
            let add_effects: [(&'static str, &'static str, &'static str); 5] = [
                ("add-fx-brightness", "brightness", "+ Bright"),
                ("add-fx-contrast", "contrast", "+ Contrast"),
                ("add-fx-saturation", "saturation", "+ Sat"),
                ("add-fx-blur", "blur", "+ Blur"),
                ("add-fx-shadow", "drop-shadow", "+ Shadow"),
            ];
            let mut add_row = div().flex().flex_row().flex_wrap().gap_1();
            for (id, effect_type, label) in add_effects {
                let reference = selected.reference.clone();
                add_row = add_row.child(self.button(id, label, cx, move |this, _cx| {
                    this.add_counter += 1;
                    let effect = bay_core::Effect {
                        id: format!("fx-{}", this.add_counter),
                        effect_type: effect_type.into(),
                        enabled: true,
                        params: bay_core::blocks::default_effect_params(effect_type),
                        asset: None,
                    };
                    this.editor.execute(Command::AddEffect {
                        reference: reference.clone(),
                        effect,
                    });
                }));
            }
            body = body.child(add_row);

            // Blend mode: how this layer composites over everything beneath it. One button
            // cycling all 17 modes — the compositor's full WGSL blend set.
            if let Some(mode) = selected.blend_mode {
                let reference = selected.reference.clone();
                body = body
                    .child(div().text_xs().text_color(rgb(theme::MUTED)).child("BLEND"))
                    .child(
                        self.button("blend-mode", mode.label(), cx, move |this, _cx| {
                            this.editor.execute(Command::SetBlendMode {
                                reference: reference.clone(),
                                blend_mode: mode.next(),
                            });
                        }),
                    );
            }

            // Motion presets (in-memory): save the clip's effects+animations, apply elsewhere.
            body = body
                .child(
                    div()
                        .text_xs()
                        .text_color(rgb(theme::MUTED))
                        .child("PRESETS"),
                )
                .child(self.button("save-preset", "Save Preset", cx, |this, _cx| {
                    this.save_preset()
                }))
                .child(
                    // The one above lives in this window; this one is written to the library
                    // and survives it.
                    self.button("save-template", "Save as Template", cx, |this, _cx| {
                        this.save_template()
                    }),
                );
            for (index, preset) in self.presets.iter().enumerate() {
                let label = format!("Apply {}", preset.name);
                body = body.child(
                    div()
                        .id(SharedString::from(format!("apply-preset-{index}")))
                        .px_3()
                        .py_1()
                        .rounded_md()
                        .bg(rgb(theme::PANEL_ALT))
                        .text_sm()
                        .text_color(rgb(theme::TEXT))
                        .child(Self::shared(label))
                        .on_click(cx.listener(move |this, _event, _window, cx| {
                            this.apply_preset(index);
                            cx.notify();
                        })),
                );
            }
        }

        panel.child(body)
    }
}

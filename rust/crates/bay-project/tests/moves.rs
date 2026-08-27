//! The move registry, held to its own invariants.
//!
//! These are the claims that make the registry worth having. A vocabulary whose entries are not
//! measurably better than what an agent types by hand is a vocabulary nobody has a reason to use,
//! and the failing project this exists to prevent was, in its own terms, *correct* — it followed
//! a document whose numbers were free parameters. Here they are not free.

use std::collections::BTreeMap;

use bay_project::moves::{
    self, CORE_SPANS, Direction, LEAD_CHANNELS, MIN_CORE_FRAMES, MOVES, MoveKind, MoveParams,
    REFERENCE_FPS, amplitude_floor, core_span, sampled_core_span,
};
use bay_project::{
    AnimationChannel, Easing, Element, ElementRole, ElementSource, Keyframe, MediaTime, Scene,
    ShapeElement, ShapeKind, TextAlign, TextElement, Transform, VideoElement,
};

// ---------------------------------------------------------------------------- the core-span table

/// The table is derived, not asserted. If [`Easing::apply`] ever changes shape, this fails and
/// the durations in the registry are recomputed — rather than the table quietly describing a
/// curve the engine no longer draws.
#[test]
fn the_core_span_table_is_what_the_curves_do() {
    for (easing, tabled) in CORE_SPANS {
        let sampled = sampled_core_span(easing);
        assert!(
            (sampled - tabled).abs() <= 0.01,
            "{easing:?}: the table says {tabled:.3}, sampling Easing::apply says {sampled:.3}"
        );
    }
    assert_eq!(
        CORE_SPANS.len(),
        14,
        "one row per easing the engine offers — a curve with no row silently gets a core span of \
         zero"
    );
    // The whole point of the table in one assertion: two curves given the same nominal duration
    // deliver wildly different amounts of visible motion.
    assert!(core_span(Easing::Linear) / core_span(Easing::BackOut) > 2.5);
}

/// Nothing on the tool surface may take a core-frame count, or the number becomes the next
/// `fontSize: 34` — a value copied out of a document into 73 calls.
#[test]
fn core_frames_are_not_a_tool_argument() {
    let schema = std::fs::read_to_string(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../bay-mcp/src/tools.rs"
    ))
    .expect("the MCP tool surface");
    for banned in ["coreFrames", "core_frames", "coreSpan", "core_span"] {
        assert!(
            !schema.contains(banned),
            "{banned:?} appears on the tool surface — the registry is where that arithmetic \
             already happened"
        );
    }
}

// ---------------------------------------------------------------------------- registry invariants

/// The rule that kills the 90 %-opacity project: opacity may ride, it may never lead.
#[test]
fn no_move_leads_with_opacity() {
    for mv in MOVES {
        assert!(
            LEAD_CHANNELS.contains(&mv.lead),
            "{}: leads with {:?}, which is not a geometric channel",
            mv.id,
            mv.lead
        );
        assert!(
            mv.channel(mv.lead).is_some(),
            "{}: leads with a channel it does not have",
            mv.id
        );
        if let Some(opacity) = mv.channel("opacity") {
            let lead = mv.lead_channel();
            assert!(
                opacity.span_seconds() <= lead.span_seconds() + 1e-6,
                "{}: its opacity outlasts its geometry, which makes the fade the event",
                mv.id
            );
        }
    }
}

/// Amplitude floors are the anti-gaming layer under any channel-share rule: a distribution over
/// channels is satisfied exactly as well by a 4 px nudge nobody can see.
#[test]
fn every_move_clears_its_own_amplitude_floor() {
    for mv in MOVES {
        let floor = amplitude_floor(mv.kind, mv.lead);
        let amplitude = mv.lead_channel().amplitude();
        assert!(
            amplitude >= floor - 1e-6,
            "{}: {} travels {amplitude:.4}, under the {:?} floor of {floor:.4}",
            mv.id,
            mv.lead,
            mv.kind
        );
    }
}

/// Duration and curve are properties OF the move, chosen together so the eye is given something
/// to see. Checking nominal duration alone is exactly the mistake that shipped 76 three-frame
/// pops through a rule that only counted distinct durations.
#[test]
fn every_move_delivers_at_least_four_core_frames() {
    for mv in MOVES {
        let core = mv.core_frames(REFERENCE_FPS);
        assert!(
            core >= MIN_CORE_FRAMES,
            "{}: {:.1} core frames on {} — under {MIN_CORE_FRAMES}, a viewer receives the \
             before-state and the after-state and never the transit",
            mv.id,
            core,
            mv.lead
        );
    }
}

/// A vocabulary of one is not a vocabulary. The two-sided histogram gate needs enough entries
/// that four distinct moves at a tenth each is a composition rather than the whole registry.
#[test]
fn the_registry_is_a_vocabulary_with_every_kind_in_it() {
    assert!(MOVES.len() >= 24, "{} moves", MOVES.len());
    let mut ids: Vec<&str> = MOVES.iter().map(|m| m.id).collect();
    ids.sort_unstable();
    let mut unique = ids.clone();
    unique.dedup();
    assert_eq!(ids, unique, "two moves share an id");

    for kind in [
        MoveKind::Entrance,
        MoveKind::Accent,
        MoveKind::Secondary,
        MoveKind::Group,
        MoveKind::Response,
        MoveKind::Ambient,
        MoveKind::Exit,
        MoveKind::Seam,
    ] {
        assert!(
            MOVES.iter().any(|m| m.kind == kind),
            "nothing in the registry is a {kind:?} — an author who needs one has to hand-key it"
        );
    }

    // Entrance-direction diversity has to be reachable: leading channels, not one axis.
    let leads: std::collections::BTreeSet<&str> = MOVES
        .iter()
        .filter(|m| m.kind == MoveKind::Entrance)
        .map(|m| m.lead)
        .collect();
    assert!(
        leads.len() >= 4,
        "entrances lead with only {leads:?} — direction diversity would be unbuildable"
    );
}

/// Each move's declared directions have to be usable, and a direction it does not travel has to
/// be refused by name rather than silently ignored.
#[test]
fn directions_are_checked_rather_than_assumed() {
    for mv in MOVES {
        assert!(!mv.directions.is_empty(), "{}: no direction at all", mv.id);
        for direction in mv.directions {
            assert!(mv.sign_for(Some(*direction)).is_ok(), "{}", mv.id);
        }
        let flips = mv.channels.iter().any(|c| c.directional);
        assert_eq!(
            flips,
            mv.directions.len() > 1,
            "{}: it offers {} directions but {} channel flips",
            mv.id,
            mv.directions.len(),
            if flips { "a" } else { "no" }
        );
    }
    let sweep = moves::find("sweep").unwrap();
    let error = sweep
        .sign_for(Some(Direction::Cw))
        .expect_err("a sweep does not rotate");
    assert!(error.contains("left"), "it says what it does take: {error}");
}

// ---------------------------------------------------------------------------- instantiation

fn text_at(id: &str, y: f32) -> Element {
    Element::Text(TextElement {
        id: id.to_string(),
        name: id.to_string(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_seconds_f64(6.0).unwrap(),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        content: "Line".into(),
        font_size: 96.0,
        color: "#ffffff".into(),
        transform: Transform {
            y,
            ..Transform::default()
        },
        effects: Vec::new(),
        animations: BTreeMap::new(),
        blend_mode: Default::default(),
        mask: None,
        font_family: Some("Helvetica Neue".into()),
        font_weight: 700,
        align: TextAlign::Center,
        letter_spacing: 0.0,
        line_height: 1.2,
        decorations: None,
        karaoke: None,
        type_on: None,
        source: ElementSource::Author,
        role: ElementRole::Headline,
    })
}

fn shape_at(id: &str) -> Element {
    Element::Shape(ShapeElement {
        id: id.to_string(),
        name: id.to_string(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_seconds_f64(6.0).unwrap(),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        shape: ShapeKind::Rect { radius: 0.0 },
        color: "#ffffff".into(),
        gradient: None,
        stroke: None,
        transform: Transform::default(),
        effects: Vec::new(),
        animations: BTreeMap::new(),
        blend_mode: Default::default(),
        mask: None,
        source: ElementSource::Author,
        role: ElementRole::Ground,
    })
}

/// `Element` exposes its animations by reference; a test that has just built a whole set needs
/// to install it.
fn set_animations(element: &mut Element, animations: BTreeMap<String, AnimationChannel>) {
    if let Some(target) = element.animations_mut() {
        *target = animations;
    }
}

fn scene_of(elements: Vec<Element>) -> Scene {
    let mut scene = Scene::empty("s", "Scene");
    scene.tracks.main.elements = elements;
    scene
}

fn tracked_crop(id: &str, right_values: [f32; 3]) -> Element {
    let times = [0.0, 1.0, 2.0];
    let left_values = [0.10, 0.18, 0.25];
    let channel = |values: [f32; 3]| AnimationChannel {
        keys: times
            .into_iter()
            .zip(values)
            .map(|(time, value)| Keyframe {
                time: MediaTime::from_seconds_f64(time).unwrap(),
                value,
                easing: None,
            })
            .collect(),
        easing: Easing::Linear,
    };
    let animations = BTreeMap::from([
        ("cropLeft".into(), channel(left_values)),
        ("cropRight".into(), channel(right_values)),
        ("cropTop".into(), channel([0.0; 3])),
        ("cropBottom".into(), channel([0.0; 3])),
    ]);
    Element::Video(VideoElement {
        id: id.into(),
        name: id.into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_seconds_f64(2.0).unwrap(),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        media_id: "source".into(),
        trim_start: MediaTime::ZERO,
        trim_end: MediaTime::from_seconds_f64(2.0).unwrap(),
        speed: 1.0,
        freeze: None,
        transform: Transform {
            crop_left: left_values[0],
            crop_right: right_values[0],
            ..Transform::default()
        },
        effects: Vec::new(),
        animations,
        blend_mode: Default::default(),
        mask: None,
        source: ElementSource::Author,
        role: ElementRole::Label,
    })
}

/// `auto_reframe` writes a coordinated camera window, not four independent authored moves. The
/// opposite crop edges preserve one aperture while the window follows the subject.
#[test]
fn a_coordinated_video_crop_is_in_the_camera_vocabulary() {
    let scene = scene_of(vec![tracked_crop("tracked", [0.40, 0.32, 0.25])]);
    assert!(
        moves::off_vocabulary(&scene, REFERENCE_FPS).is_empty(),
        "{:#?}",
        moves::off_vocabulary(&scene, REFERENCE_FPS)
    );
}

/// Superficial resemblance is not enough: independently changing crop edges resize/squash the
/// picture rather than moving a fixed-aspect camera window, and remain named as raw motion.
#[test]
fn an_uncoordinated_video_crop_remains_off_vocabulary() {
    let scene = scene_of(vec![tracked_crop("warped", [0.40, 0.34, 0.25])]);
    let off = moves::off_vocabulary(&scene, REFERENCE_FPS);
    assert!(
        off.iter().any(|finding| finding.element_id == "warped"
            && matches!(finding.property.as_str(), "cropLeft" | "cropRight")),
        "{off:#?}"
    );
}

/// Fixed aperture alone is not enough: a coordinated path sampled so tightly that the eye sees
/// cuts can still be bad camera motion, and must not use the reframe case to bypass the core-frame
/// floor.
#[test]
fn a_too_fast_coordinated_crop_remains_off_vocabulary() {
    let mut crop = tracked_crop("jerky", [0.40, 0.32, 0.25]);
    for channel in crop.animations_mut().unwrap().values_mut() {
        channel.keys[1].time = MediaTime::from_seconds_f64(0.01).unwrap();
        channel.keys[2].time = MediaTime::from_seconds_f64(0.02).unwrap();
    }
    let scene = scene_of(vec![crop]);
    let off = moves::off_vocabulary(&scene, REFERENCE_FPS);
    assert!(
        off.iter().any(|finding| finding.element_id == "jerky"
            && matches!(finding.property.as_str(), "cropLeft" | "cropRight")),
        "{off:#?}"
    );
}

/// A move lands on the element where the element is: `lift` on a title at y = 0.31 and on a
/// caption at y = 0.88 is the same rise, not two different destinations.
#[test]
fn a_move_is_relative_to_where_the_element_rests() {
    let lift = moves::find("lift").unwrap();
    for y in [0.18_f32, 0.5, 0.88] {
        let element = text_at("t", y);
        let animations = moves::apply(&element, lift, &MoveParams::default()).unwrap();
        let channel = &animations["y"];
        assert_eq!(channel.keys.len(), 2);
        assert!((channel.keys[0].value - (y + 0.0313)).abs() < 1e-5, "{y}");
        assert!((channel.keys[1].value - y).abs() < 1e-6, "{y}");
        assert_eq!(channel.keys[1].time.to_seconds_f64(), 24.0 / 30.0);
        // Opacity rides: it is finished long before the geometry is.
        assert!(animations["opacity"].keys[1].time < channel.keys[1].time);
    }
}

/// Every registry move, instantiated on a real element, is recognised as itself. This is the
/// claim `off-vocabulary-motion` rests on — if the matcher and the emitter can disagree, the
/// finding is noise.
#[test]
fn every_move_round_trips_through_the_matcher() {
    for mv in MOVES {
        let element = match mv.lead {
            "scaleX" | "scaleY" => shape_at("e"),
            _ => text_at("e", 0.42),
        };
        for direction in mv.directions {
            let params = MoveParams {
                at: 0.5,
                direction: Some(*direction),
                distance: 1.0,
            };
            let animations = moves::apply(&element, mv, &params)
                .unwrap_or_else(|e| panic!("{} {}: {e}", mv.id, direction.as_str()));
            let mut moved = element.clone();
            set_animations(&mut moved, animations);
            let scene = scene_of(vec![moved]);

            let off = moves::off_vocabulary(&scene, REFERENCE_FPS);
            assert!(
                off.is_empty(),
                "{} {}: its own output reads as off-vocabulary: {:#?}",
                mv.id,
                direction.as_str(),
                off.iter().map(|o| o.message()).collect::<Vec<_>>()
            );
            let histogram = moves::histogram(&scene);
            assert!(
                histogram.contains_key(mv.id),
                "{} {}: not named in the histogram, which read {:?}",
                mv.id,
                direction.as_str(),
                histogram
            );
        }
    }
}

/// `distance` scales a move without changing which move it is, and a distance that would turn a
/// move into something invisible (or into a different move entirely) is refused.
#[test]
fn distance_scales_a_move_within_a_bounded_range() {
    let sweep = moves::find("sweep").unwrap();
    let element = text_at("t", 0.4);
    let wide = moves::apply(
        &element,
        sweep,
        &MoveParams {
            distance: 2.0,
            ..MoveParams::default()
        },
    )
    .unwrap();
    assert!((wide["x"].keys[0].value - (0.5 + 0.2222)).abs() < 1e-4);

    for absurd in [0.01_f32, 40.0] {
        assert!(
            moves::apply(
                &element,
                sweep,
                &MoveParams {
                    distance: absurd,
                    ..MoveParams::default()
                },
            )
            .is_err(),
            "distance {absurd} should be refused"
        );
    }
}

/// The point of the `by`/response family: a move that lands after an element has settled
/// **appends** to the channel the entrance already wrote. Without this, making room for an
/// arriving element means rewriting every incumbent's whole absolute key list — which is exactly
/// why a crossfade won at every seam in the project this exists to prevent.
#[test]
fn a_later_move_extends_the_channel_instead_of_erasing_the_entrance() {
    let element = text_at("t", 0.4);
    let lift = moves::find("lift").unwrap();
    let entrance = moves::apply(&element, lift, &MoveParams::default()).unwrap();
    let mut settled = element.clone();
    set_animations(&mut settled, entrance.clone());

    let make_room = moves::find("make-room").unwrap();
    let after = moves::apply(
        &settled,
        make_room,
        &MoveParams {
            at: 3.0,
            ..MoveParams::default()
        },
    )
    .unwrap();

    let y = &after["y"];
    assert_eq!(
        y.keys.len(),
        5,
        "the entrance's two keys plus the response's three: {y:?}"
    );
    assert!((y.keys[0].value - (0.4 + 0.0313)).abs() < 1e-5, "{y:?}");
    assert!(
        (y.keys[1].value - 0.4).abs() < 1e-6,
        "the entrance still settles where it did"
    );
    // …and the response is measured from where the element actually is, not from its authored
    // transform, so the two compose.
    assert!((y.keys[4].value - (0.4 - 0.0278)).abs() < 1e-5, "{y:?}");

    let scene = scene_of(vec![{
        let mut e = element.clone();
        set_animations(&mut e, after);
        e
    }]);
    assert!(moves::off_vocabulary(&scene, REFERENCE_FPS).is_empty());
    let histogram = moves::histogram(&scene);
    assert_eq!(histogram.get("lift"), Some(&1), "{histogram:?}");
    assert_eq!(histogram.get("make-room"), Some(&1), "{histogram:?}");
}

/// A move whose channel the element does not have is refused by name, rather than accepted and
/// silently doing nothing.
#[test]
fn a_move_an_element_cannot_perform_is_refused() {
    let audio = Element::Audio(bay_project::AudioElement {
        id: "bed".into(),
        name: "bed".into(),
        start: MediaTime::ZERO,
        duration: MediaTime::from_seconds_f64(10.0).unwrap(),
        fade_in: MediaTime::ZERO,
        fade_out: MediaTime::ZERO,
        media_id: "m".into(),
        muted: false,
        volume: 1.0,
        pan: 0.0,
        speed: 1.0,
        prosody: None,
        dialogue_chain: None,
        trim_start: MediaTime::ZERO,
        animations: BTreeMap::new(),
        source: ElementSource::Author,
        role: Default::default(),
    });
    let error = moves::apply(&audio, moves::find("lift").unwrap(), &MoveParams::default())
        .expect_err("a music bed has no position");
    assert!(
        error.contains("volume"),
        "it says what it does have: {error}"
    );
}

// ---------------------------------------------------------------------------- reading it back

/// Hand-written keys stay legal and stop being anonymous: every channel no registry move
/// accounts for is named, with its element and its property.
#[test]
fn hand_keyed_motion_is_reported_per_channel_with_the_element_id() {
    let mut element = text_at("hand", 0.4);
    let mut animations = BTreeMap::new();
    // The exact artefact: a three-frame opacity pop, 0.098 s, on a channel that leads.
    animations.insert(
        "opacity".to_string(),
        AnimationChannel {
            keys: vec![
                Keyframe::new(MediaTime::ZERO, 0.0),
                Keyframe::new(MediaTime::from_seconds_f64(0.098).unwrap(), 1.0),
            ],
            easing: Easing::EaseOut,
        },
    );
    set_animations(&mut element, animations);
    let scene = scene_of(vec![element]);

    let off = moves::off_vocabulary(&scene, REFERENCE_FPS);
    assert_eq!(off.len(), 1, "{off:#?}");
    assert_eq!(off[0].element_id, "hand");
    assert_eq!(off[0].property, "opacity");
    assert_eq!(
        bay_project::OffVocabularyMotion::CODE,
        "off-vocabulary-motion"
    );
    assert!(
        off[0].shortest_core_frames < MIN_CORE_FRAMES,
        "{:?}",
        off[0].shortest_core_frames
    );
    let message = off[0].message();
    assert!(message.contains("hand"), "{message}");
    assert!(message.contains("opacity"), "{message}");
    assert!(message.contains("core frames"), "{message}");

    let audit = moves::audit(&scene, REFERENCE_FPS);
    assert_eq!(audit.len(), 1);
    assert!(!audit[0].geometric, "opacity is not motion");
    assert!(moves::histogram(&scene).is_empty());
}

/// bay's own captions are bay's. Measuring their motion as though an author chose it is what
/// inverted four separate motion measurements — 100 % of the famous three-frame pops were
/// `narrate`'s caption fade, and both predecessor projects carry the identical artefact.
#[test]
fn the_captions_bay_wrote_are_not_off_vocabulary() {
    let mut caption = text_at("caption-1", 0.88);
    caption.set_source(ElementSource::Tool);
    let mut animations = BTreeMap::new();
    animations.insert(
        "opacity".to_string(),
        AnimationChannel {
            keys: vec![
                Keyframe::new(MediaTime::ZERO, 0.0),
                Keyframe::new(MediaTime::from_seconds_f64(0.1).unwrap(), 1.0),
            ],
            easing: Easing::EaseOut,
        },
    );
    set_animations(&mut caption, animations);
    let scene = scene_of(vec![caption]);
    assert!(moves::off_vocabulary(&scene, REFERENCE_FPS).is_empty());
    assert!(moves::audit(&scene, REFERENCE_FPS).is_empty());
}

/// The data the two-sided histogram gate is computed from: which moves, on how many elements,
/// and how many distinct signatures. A rotation table beats a one-sided rule, so both halves
/// have to be visible.
#[test]
fn the_histogram_and_the_signatures_are_available_to_a_checker() {
    let mut elements = Vec::new();
    for (index, id) in ["a", "b", "c", "d"].iter().enumerate() {
        let element = text_at(id, 0.3 + index as f32 * 0.1);
        let mv = moves::find(["lift", "sweep", "swell", "arc-in"][index]).unwrap();
        let animations = moves::apply(&element, mv, &MoveParams::default()).unwrap();
        let mut placed = element;
        set_animations(&mut placed, animations);
        elements.push(placed);
    }
    // …and one of them also leaves.
    let duck = moves::find("duck").unwrap();
    let animations = moves::apply(
        &elements[0],
        duck,
        &MoveParams {
            at: 4.0,
            ..MoveParams::default()
        },
    )
    .unwrap();
    set_animations(&mut elements[0], animations);

    let scene = scene_of(elements);
    let histogram = moves::histogram(&scene);
    assert_eq!(histogram.get("lift"), Some(&1), "{histogram:?}");
    assert_eq!(histogram.get("duck"), Some(&1), "{histogram:?}");
    assert_eq!(histogram.len(), 5, "{histogram:?}");

    let signatures = moves::signatures(&scene);
    assert_eq!(signatures.len(), 4, "{signatures:?}");
    assert_eq!(signatures.get("duck+lift"), Some(&1), "{signatures:?}");
    assert!(moves::off_vocabulary(&scene, REFERENCE_FPS).is_empty());
}

/// The real thing, measured. `project-1786466680050.json` is the 61-second video this whole
/// effort is about: 90 % of its animated channels are opacity and none of its motion came out of
/// a vocabulary, because there was not one.
///
/// Skipped rather than failed when the file is not on this machine — it lives in the user's own
/// project library, not in the repository, and a test that fails for reasons outside the repo
/// teaches people to re-run until green.
#[test]
fn the_failed_projects_motion_is_almost_entirely_off_vocabulary() {
    let Ok(root) = bay_project::ProjectLibrary::default_root() else {
        eprintln!("skipping: no project library on this machine");
        return;
    };
    let path = root.join("project-1786466680050.json");
    if !path.exists() {
        eprintln!("skipping: {} is not on this machine", path.display());
        return;
    }
    let project = bay_project::library::read_project(&path).expect("the real project loads");
    let scene = project.active_scene();
    let fps = project.settings.fps.as_f64() as f32;

    let audit = moves::audit(scene, fps);
    let off = moves::off_vocabulary(scene, fps);
    let geometric = audit.iter().filter(|c| c.geometric).count();
    let under_floor = audit
        .iter()
        .filter(|c| c.shortest_core_frames < MIN_CORE_FRAMES)
        .count();
    eprintln!(
        "wicks-v2: {} authored channels, {geometric} geometric, {} off-vocabulary, {under_floor} \
         with a segment under {MIN_CORE_FRAMES} core frames; histogram {:?}",
        audit.len(),
        off.len(),
        moves::histogram(scene)
    );

    // The state the registry exists to make unreachable: not one channel in it is a named move,
    // and the channel that carries most of it cannot lead one.
    assert!(
        audit.iter().all(|c| c.moves.is_empty()),
        "nothing in it came out of a vocabulary — there was not one"
    );
    assert!(
        moves::histogram(scene).is_empty(),
        "and so the histogram gate has nothing to count"
    );
    // The nine channels that are not *reported* are the ones where nothing changes at all: keys
    // stuffed onto flat segments, 121 of them, to satisfy a distinct-easing counter.
    assert!(
        off.len() * 10 >= audit.len() * 9,
        "{} of {} channels are hand-keyed motion",
        off.len(),
        audit.len()
    );
    let opacity = audit.iter().filter(|c| c.property == "opacity").count();
    assert!(
        opacity * 2 > audit.len(),
        "{opacity} of {} authored channels are opacity",
        audit.len()
    );
    assert!(
        under_floor > 0,
        "and some of them are over before the eye can arrive"
    );
}

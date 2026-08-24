//! A one-line text buffer driven by raw keystrokes.
//!
//! GPUI 0.2 has no text input widget, so bay's fields are buffers the view types into and draws
//! with a caret of its own. There were two hand-rolled copies of that loop before this module —
//! the new-project name and the text-clip editor — and the settings screen needs four more. One
//! definition, so a field that swallows spaces or ignores Cmd+V cannot exist in one place and
//! not another.
//!
//! Pure: [`TextField::key`] takes the parts of a keystroke it cares about, so every editing rule
//! is a unit test rather than something you verify by typing into a window.

/// What a keystroke did to the field.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edit {
    /// The buffer changed; redraw.
    Changed,
    /// Enter. The caller commits.
    Submit,
    /// Escape. The caller discards.
    Cancel,
    /// Cmd+V. The field cannot reach the clipboard from here — [`TextField::key`] is pure so
    /// that every editing rule is a unit test — so the caller reads it and calls
    /// [`TextField::paste`].
    Paste,
    /// Nothing this field handles — the caller may let it through to a shortcut.
    Ignored,
}

/// A single-line buffer, plus how it should be drawn.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TextField {
    value: String,
    /// Shown, greyed, when the buffer is empty.
    placeholder: String,
    /// A cap, for fields where an unbounded paste would be absurd. `None` is unlimited.
    limit: Option<usize>,
}

impl TextField {
    pub fn new(placeholder: impl Into<String>) -> Self {
        Self {
            value: String::new(),
            placeholder: placeholder.into(),
            limit: None,
        }
    }

    pub fn with_limit(mut self, limit: usize) -> Self {
        self.limit = Some(limit);
        self
    }

    /// Start from an existing value — editing a text clip, replacing a key.
    pub fn seeded(placeholder: impl Into<String>, value: impl Into<String>) -> Self {
        Self {
            value: value.into(),
            placeholder: placeholder.into(),
            limit: None,
        }
    }

    pub fn value(&self) -> &str {
        &self.value
    }

    pub fn trimmed(&self) -> &str {
        self.value.trim()
    }

    pub fn is_empty(&self) -> bool {
        self.value.is_empty()
    }

    pub fn clear(&mut self) {
        self.value.clear();
    }

    /// What to draw, with a caret while there is something to draw it after.
    ///
    /// A block caret rather than a blinking bar: bay has no timer driving this field, and a
    /// caret that never blinks looks broken while a solid block reads as a cursor.
    pub fn display(&self) -> String {
        if self.value.is_empty() {
            return self.placeholder.clone();
        }
        format!("{}▏", self.value)
    }

    /// Whether [`TextField::display`] is showing the placeholder, so the view can grey it.
    pub fn showing_placeholder(&self) -> bool {
        self.value.is_empty()
    }

    /// Apply one keystroke.
    ///
    /// Returns [`Edit::Paste`] for Cmd+V; the caller supplies the clipboard text.
    ///
    /// `key` is GPUI's key name ("a", "space", "backspace", "enter", "escape"); `key_char` is
    /// the character it produced, which is what actually gets inserted — the key name is
    /// layout-independent and would type the wrong letter on a non-US keyboard.
    pub fn key(&mut self, key: &str, key_char: Option<&str>, command: bool) -> Edit {
        match key {
            "enter" => Edit::Submit,
            "escape" => Edit::Cancel,
            "backspace" | "delete" => {
                if self.value.pop().is_some() {
                    Edit::Changed
                } else {
                    // An empty field still consumes backspace. Letting it through would fire
                    // whatever Delete is bound to — in the editor, that removes a clip.
                    Edit::Changed
                }
            }
            // Space arrives with a key name rather than a character on some layouts, so it is
            // handled by name as well; a field that cannot type a space is unusable.
            "space" => {
                self.push(' ');
                Edit::Changed
            }
            _ => {
                // Cmd+A, Cmd+S and friends belong to the app, not the field. Without this a
                // field would swallow every shortcut while it had focus. Cmd+V is the one
                // exception: it belongs to whatever is being typed into, and letting it through
                // sent it to the editor's PasteClip binding, which drops a *clip* on the
                // timeline while you are trying to fill in an API key.
                if command {
                    return if key == "v" {
                        Edit::Paste
                    } else {
                        Edit::Ignored
                    };
                }
                match key_char {
                    Some(text) if !text.is_empty() && !text.chars().any(char::is_control) => {
                        for character in text.chars() {
                            self.push(character);
                        }
                        Edit::Changed
                    }
                    _ => Edit::Ignored,
                }
            }
        }
    }

    /// Insert clipboard text at the caret.
    ///
    /// A single-line field, so a multi-line paste is flattened to spaces rather than truncated
    /// at the first newline — an API key never contains one, but a copied line from a terminal
    /// often carries a trailing one, and silently dropping everything after it would store a
    /// key that looks right and does not work. The limit still applies.
    pub fn paste(&mut self, text: &str) -> Edit {
        let mut inserted = false;
        for character in text.chars() {
            let character = if character.is_control() {
                ' '
            } else {
                character
            };
            let before = self.value.len();
            self.push(character);
            inserted |= self.value.len() != before;
        }
        if inserted {
            Edit::Changed
        } else {
            Edit::Ignored
        }
    }

    fn push(&mut self, character: char) {
        if self
            .limit
            .is_some_and(|limit| self.value.chars().count() >= limit)
        {
            return;
        }
        self.value.push(character);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn typed(field: &mut TextField, text: &str) {
        for character in text.chars() {
            let name = if character == ' ' {
                "space".to_string()
            } else {
                character.to_string()
            };
            field.key(&name, Some(&character.to_string()), false);
        }
    }

    #[test]
    fn typing_accumulates_and_backspace_removes() {
        let mut field = TextField::new("Untitled");
        typed(&mut field, "Reel");
        assert_eq!(field.value(), "Reel");
        assert_eq!(field.key("backspace", None, false), Edit::Changed);
        assert_eq!(field.value(), "Ree");
    }

    /// A field that cannot type a space is unusable, and space arrives by name.
    #[test]
    fn space_is_typed_by_name() {
        let mut field = TextField::new("");
        typed(&mut field, "Crash of 1929");
        assert_eq!(field.value(), "Crash of 1929");
    }

    /// The character, not the key name — otherwise a non-US layout types the wrong letter.
    #[test]
    fn the_character_is_what_gets_inserted() {
        let mut field = TextField::new("");
        field.key("a", Some("ä"), false);
        field.key("semicolon", Some("é"), false);
        assert_eq!(field.value(), "äé");
    }

    /// Without this a field would swallow Cmd+S while it had focus.
    #[test]
    fn a_command_chord_passes_through() {
        let mut field = TextField::new("");
        assert_eq!(field.key("s", Some("s"), true), Edit::Ignored);
        assert!(field.is_empty());
    }

    #[test]
    fn enter_and_escape_are_reported_and_leave_the_buffer_alone() {
        let mut field = TextField::new("");
        typed(&mut field, "hi");
        assert_eq!(field.key("enter", None, false), Edit::Submit);
        assert_eq!(field.key("escape", None, false), Edit::Cancel);
        assert_eq!(field.value(), "hi");
    }

    /// Backspace on an empty field must be consumed. Letting it through fires Delete, which in
    /// the editor removes the selected clip — a keystroke away from losing work.
    #[test]
    fn backspace_on_an_empty_field_is_still_consumed() {
        let mut field = TextField::new("");
        assert_eq!(field.key("backspace", None, false), Edit::Changed);
        assert_eq!(field.key("delete", None, false), Edit::Changed);
    }

    #[test]
    fn control_characters_are_not_inserted() {
        let mut field = TextField::new("");
        assert_eq!(field.key("tab", Some("\t"), false), Edit::Ignored);
        assert_eq!(field.key("f5", None, false), Edit::Ignored);
        assert!(field.is_empty());
    }

    /// Cmd+V reaches the field rather than the app.
    ///
    /// It used to fall through as `Ignored`, and the editor binds cmd-v to PasteClip — so
    /// pasting into the API-key field dropped a clip on the timeline and left the field empty.
    /// The field whose placeholder reads "paste key" was the one that could not be pasted into.
    #[test]
    fn cmd_v_asks_the_caller_for_the_clipboard() {
        let mut field = TextField::new("paste key");
        assert_eq!(field.key("v", Some("v"), true), Edit::Paste);
        assert!(
            field.is_empty(),
            "the keystroke alone must not insert anything"
        );

        assert_eq!(field.paste("sk-ant-api03-XYZ"), Edit::Changed);
        assert_eq!(field.value(), "sk-ant-api03-XYZ");

        // Every other chord still belongs to the app.
        assert_eq!(field.key("s", Some("s"), true), Edit::Ignored);
        assert_eq!(field.key("a", Some("a"), true), Edit::Ignored);
    }

    /// A key copied out of a terminal usually carries a trailing newline. Truncating there
    /// would store a key that looks right in the field and fails at the first request; this is
    /// a single-line field, so the newline becomes a space and `trimmed` takes it off.
    #[test]
    fn a_pasted_newline_does_not_truncate_the_value() {
        let mut field = TextField::new("");
        field.paste("sk-ant-api03-XYZ\n");
        assert_eq!(field.trimmed(), "sk-ant-api03-XYZ");

        let mut split = TextField::new("");
        split.paste("one\ntwo");
        assert_eq!(
            split.value(),
            "one two",
            "a multi-line paste is flattened, not cut short"
        );
    }

    #[test]
    fn a_paste_respects_the_limit() {
        let mut field = TextField::new("").with_limit(4);
        assert_eq!(field.paste("abcdefgh"), Edit::Changed);
        assert_eq!(field.value(), "abcd");
        assert_eq!(
            field.paste("z"),
            Edit::Ignored,
            "a full field reports nothing changed"
        );
    }

    #[test]
    fn the_placeholder_shows_only_while_empty() {
        let mut field = TextField::new("paste key");
        assert!(field.showing_placeholder());
        assert_eq!(field.display(), "paste key");

        typed(&mut field, "sk");
        assert!(!field.showing_placeholder());
        assert_eq!(field.display(), "sk▏");
    }

    #[test]
    fn a_limit_stops_the_field_growing() {
        let mut field = TextField::new("").with_limit(4);
        typed(&mut field, "abcdefgh");
        assert_eq!(field.value(), "abcd");
        assert_eq!(field.key("backspace", None, false), Edit::Changed);
        typed(&mut field, "z");
        assert_eq!(field.value(), "abcz", "room reopens after a delete");
    }

    #[test]
    fn a_seeded_field_starts_with_its_value() {
        let field = TextField::seeded("", "Hello, bay");
        assert_eq!(field.value(), "Hello, bay");
        assert!(!field.showing_placeholder());
    }

    #[test]
    fn trimmed_drops_the_whitespace_a_paste_brings() {
        let mut field = TextField::new("");
        typed(&mut field, "  Reel ");
        assert_eq!(field.trimmed(), "Reel");
        field.clear();
        assert!(field.is_empty());
    }
}

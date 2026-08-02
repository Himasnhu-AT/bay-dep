//! Timeline elements. One `Element` enum over the four concrete kinds, each sharing the
//! common `id / name / start / duration` fields plus its own payload.

use serde::{Deserialize, Serialize};
use time::MediaTime;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoElement {
    pub id: String,
    pub name: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    pub media_id: String,
    pub trim_start: MediaTime,
    pub trim_end: MediaTime,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageElement {
    pub id: String,
    pub name: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    pub media_id: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextElement {
    pub id: String,
    pub name: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    pub content: String,
    pub font_size: f32,
    pub color: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioElement {
    pub id: String,
    pub name: String,
    pub start: MediaTime,
    pub duration: MediaTime,
    pub media_id: String,
    pub muted: bool,
    pub volume: f32,
}

/// A timeline element. Serialized with an internal `type` tag matching the web format.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Element {
    Video(VideoElement),
    Image(ImageElement),
    Text(TextElement),
    Audio(AudioElement),
}

/// The discriminant of an [`Element`], for display and dispatch without matching payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ElementKind {
    Video,
    Image,
    Text,
    Audio,
}

impl ElementKind {
    pub fn label(self) -> &'static str {
        match self {
            ElementKind::Video => "Video",
            ElementKind::Image => "Image",
            ElementKind::Text => "Text",
            ElementKind::Audio => "Audio",
        }
    }
}

/// Run `$body` against the inner element struct of whichever variant `$self` is, binding it
/// to `$e`. Every variant shares the fields accessed in the common accessors below.
macro_rules! with_inner {
    ($self:expr, $e:ident => $body:expr) => {
        match $self {
            Element::Video($e) => $body,
            Element::Image($e) => $body,
            Element::Text($e) => $body,
            Element::Audio($e) => $body,
        }
    };
}

impl Element {
    pub fn id(&self) -> &str {
        with_inner!(self, e => &e.id)
    }

    pub fn name(&self) -> &str {
        with_inner!(self, e => &e.name)
    }

    pub fn start(&self) -> MediaTime {
        with_inner!(self, e => e.start)
    }

    pub fn duration(&self) -> MediaTime {
        with_inner!(self, e => e.duration)
    }

    /// End time = start + duration.
    pub fn end(&self) -> MediaTime {
        self.start() + self.duration()
    }

    pub fn kind(&self) -> ElementKind {
        match self {
            Element::Video(_) => ElementKind::Video,
            Element::Image(_) => ElementKind::Image,
            Element::Text(_) => ElementKind::Text,
            Element::Audio(_) => ElementKind::Audio,
        }
    }

    pub fn set_id(&mut self, id: String) {
        with_inner!(self, e => e.id = id);
    }

    pub fn set_name(&mut self, name: String) {
        with_inner!(self, e => e.name = name);
    }

    pub fn set_start(&mut self, start: MediaTime) {
        with_inner!(self, e => e.start = start);
    }
}

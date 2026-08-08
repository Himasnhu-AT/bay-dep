//! The on-disk project library — where bay keeps the projects a user has made.
//!
//! One JSON file per project under a single root directory (`~/Library/Application
//! Support/bay/projects` on macOS, overridable with `BAY_PROJECTS_DIR`). Both front ends go
//! through this: the desktop launcher lists and opens projects here, and `bay-mcp` saves
//! into the same place, so a project an agent builds over MCP shows up in the app's project
//! list without any extra plumbing.
//!
//! [`ProjectSummary`] exists so listing a library does not mean loading every project into an
//! editor — the launcher needs a name, a size and a duration, not a timeline.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::project::{Project, ProjectMetadata};
use crate::scene::Scene;
use crate::settings::{Background, CanvasSize, Fps, ProjectSettings};
use crate::track::{Track, TrackKind, Tracks};

/// Overrides the library root. Set by tests and by anyone keeping projects on another volume.
pub const LIBRARY_DIR_ENV: &str = "BAY_PROJECTS_DIR";

/// Anything that can go wrong reading or writing the library. Every variant names the path it
/// failed on — a launcher that just says "could not open project" is not debuggable.
#[derive(Debug)]
pub enum LibraryError {
    Io {
        path: PathBuf,
        source: std::io::Error,
    },
    Json {
        path: PathBuf,
        message: String,
    },
    NotFound {
        id: String,
    },
    NoHome,
}

impl std::fmt::Display for LibraryError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io { path, source } => write!(f, "{}: {source}", path.display()),
            Self::Json { path, message } => {
                write!(
                    f,
                    "{} is not a valid bay project: {message}",
                    path.display()
                )
            }
            Self::NotFound { id } => write!(f, "no project with id {id}"),
            Self::NoHome => {
                f.write_str("could not locate a home directory for the project library")
            }
        }
    }
}

impl std::error::Error for LibraryError {}

pub type Result<T> = std::result::Result<T, LibraryError>;

fn io(path: impl Into<PathBuf>) -> impl FnOnce(std::io::Error) -> LibraryError {
    let path = path.into();
    move |source| LibraryError::Io { path, source }
}

/// What the launcher shows for one project without loading it into an editor.
#[derive(Debug, Clone, PartialEq)]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    /// Last write time, or `None` when the filesystem does not report one.
    pub modified: Option<SystemTime>,
    pub canvas: CanvasSize,
    pub fps: f64,
    /// Timeline length: the furthest element end across every scene.
    pub duration_seconds: f64,
    pub scene_count: usize,
    pub element_count: usize,
}

impl ProjectSummary {
    fn of(project: &Project, path: PathBuf, modified: Option<SystemTime>) -> Self {
        let mut duration_ticks = 0i64;
        let mut element_count = 0usize;
        for scene in &project.scenes {
            for track in scene.tracks.iter() {
                element_count += track.elements.len();
                for element in &track.elements {
                    duration_ticks = duration_ticks.max(element.end().as_ticks());
                }
            }
        }
        Self {
            id: project.metadata.id.clone(),
            name: project.metadata.name.clone(),
            path,
            modified,
            canvas: project.settings.canvas,
            fps: project.settings.fps.as_f64(),
            duration_seconds: bay_time::MediaTime::from_ticks(duration_ticks).to_seconds_f64(),
            scene_count: project.scenes.len(),
            element_count,
        }
    }
}

/// A directory of bay projects.
#[derive(Debug, Clone)]
pub struct ProjectLibrary {
    root: PathBuf,
}

impl ProjectLibrary {
    /// Open (creating if needed) the library at the default location, or at `BAY_PROJECTS_DIR`.
    pub fn open_default() -> Result<Self> {
        Self::with_root(Self::default_root()?)
    }

    /// Open (creating if needed) a library rooted at `root`.
    pub fn with_root(root: impl Into<PathBuf>) -> Result<Self> {
        let root = root.into();
        std::fs::create_dir_all(&root).map_err(io(&root))?;
        Ok(Self { root })
    }

    /// Where projects live by default: `$BAY_PROJECTS_DIR`, else bay's per-user data directory.
    pub fn default_root() -> Result<PathBuf> {
        if let Some(dir) = std::env::var_os(LIBRARY_DIR_ENV).filter(|v| !v.is_empty()) {
            return Ok(PathBuf::from(dir));
        }
        bay_paths::data_dir()
            .map(|dir| dir.join("projects"))
            .ok_or(LibraryError::NoHome)
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The file a given project id maps to. The id is slugified, so an id arriving from an MCP
    /// client cannot escape the library directory.
    pub fn path_for(&self, id: &str) -> PathBuf {
        self.root.join(format!("{}.json", slug(id)))
    }

    /// Every project in the library, newest write first. A file that fails to parse is skipped
    /// rather than failing the whole listing — one bad project must not hide the other twenty.
    pub fn list(&self) -> Result<Vec<ProjectSummary>> {
        let entries = match std::fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => return Err(io(&self.root)(error)),
        };

        let mut summaries = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let modified = entry.metadata().ok().and_then(|m| m.modified().ok());
            if let Ok(project) = read_project(&path) {
                summaries.push(ProjectSummary::of(&project, path, modified));
            }
        }
        // Newest first; projects with no reported mtime sort last, then by name for stability.
        summaries.sort_by(|a, b| {
            b.modified
                .cmp(&a.modified)
                .then_with(|| a.name.cmp(&b.name))
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(summaries)
    }

    /// Create, save and return a new empty project. The id is unique within this library, so
    /// creating "Untitled" twice yields two projects rather than one overwriting the other.
    pub fn create(&self, name: &str, canvas: CanvasSize, fps: Fps) -> Result<Project> {
        let project = Project::empty(&self.fresh_id(), name, canvas, fps, "#000000");
        self.save(&project)?;
        Ok(project)
    }

    /// An id that no file in this library currently uses.
    fn fresh_id(&self) -> String {
        let stamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let mut id = format!("project-{stamp}");
        let mut suffix = 1;
        while self.path_for(&id).exists() {
            id = format!("project-{stamp}-{suffix}");
            suffix += 1;
        }
        id
    }

    pub fn load(&self, id: &str) -> Result<Project> {
        let path = self.path_for(id);
        if !path.exists() {
            return Err(LibraryError::NotFound { id: id.to_string() });
        }
        read_project(&path)
    }

    /// Write the project to its slot, returning the file it landed in.
    pub fn save(&self, project: &Project) -> Result<PathBuf> {
        let path = self.path_for(&project.metadata.id);
        write_project(&path, project)?;
        Ok(path)
    }

    /// Remove a project from the library. Removing something already gone is not an error.
    pub fn delete(&self, id: &str) -> Result<()> {
        let path = self.path_for(id);
        match std::fs::remove_file(&path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(io(path)(error)),
        }
    }

    /// Copy a loose project file into the library, keeping its id unless that slot is taken.
    /// This is how the single `~/bay-project.json` that predates the library gets adopted
    /// instead of quietly disappearing from the user's view.
    pub fn import(&self, path: &Path) -> Result<ProjectSummary> {
        let mut project = read_project(path)?;
        if project.metadata.id.trim().is_empty() || self.path_for(&project.metadata.id).exists() {
            project.metadata.id = self.fresh_id();
        }
        let saved = self.save(&project)?;
        let modified = std::fs::metadata(&saved)
            .ok()
            .and_then(|m| m.modified().ok());
        Ok(ProjectSummary::of(&project, saved, modified))
    }
}

/// Read a project from any path (library slot or a file the user picked).
pub fn read_project(path: &Path) -> Result<Project> {
    let text = std::fs::read_to_string(path).map_err(io(path))?;
    serde_json::from_str(&text).map_err(|e| LibraryError::Json {
        path: path.to_path_buf(),
        message: e.to_string(),
    })
}

/// Write a project to any path, atomically: serialize to a sibling temp file and rename over
/// the target, so an interrupted save cannot leave a half-written project behind.
pub fn write_project(path: &Path, project: &Project) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(io(parent))?;
    }
    let json = serde_json::to_string_pretty(project).map_err(|e| LibraryError::Json {
        path: path.to_path_buf(),
        message: e.to_string(),
    })?;
    let temp = path.with_extension("json.tmp");
    std::fs::write(&temp, json).map_err(io(&temp))?;
    std::fs::rename(&temp, path).map_err(io(path))
}

/// Reduce an arbitrary id to a safe single path segment.
fn slug(id: &str) -> String {
    let mut out: String = id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    out.truncate(80);
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "project".to_string()
    } else {
        trimmed
    }
}

impl Project {
    /// An empty project: one main scene with a single video track and nothing on it.
    pub fn empty(id: &str, name: &str, canvas: CanvasSize, fps: Fps, background: &str) -> Self {
        Self {
            metadata: ProjectMetadata {
                id: id.to_string(),
                name: name.to_string(),
            },
            settings: ProjectSettings {
                fps,
                canvas,
                background: Background::Color {
                    color: background.to_string(),
                },
            },
            scenes: vec![Scene {
                id: "scene-main".into(),
                name: "Main".into(),
                is_main: true,
                tracks: Tracks {
                    overlay: Vec::new(),
                    main: Track::new("track-main", "Main", TrackKind::Video),
                    audio: Vec::new(),
                },
            }],
            current_scene_id: "scene-main".into(),
            media: Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A private directory for one test, without pulling in a tempdir dependency.
    fn scratch(tag: &str) -> PathBuf {
        let stamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("bay-library-{tag}-{stamp}"));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn library(tag: &str) -> ProjectLibrary {
        ProjectLibrary::with_root(scratch(tag)).unwrap()
    }

    #[test]
    fn an_empty_library_lists_nothing() {
        assert!(library("empty").list().unwrap().is_empty());
    }

    #[test]
    fn created_projects_round_trip_through_the_library() {
        let library = library("create");
        let project = library
            .create(
                "My Reel",
                CanvasSize {
                    width: 1080,
                    height: 1920,
                },
                Fps::default(),
            )
            .unwrap();

        let listed = library.list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "My Reel");
        assert_eq!(listed[0].canvas.width, 1080);
        assert_eq!(listed[0].element_count, 0);
        assert_eq!(listed[0].scene_count, 1);

        let loaded = library.load(&project.metadata.id).unwrap();
        assert_eq!(loaded, project);
    }

    #[test]
    fn creating_the_same_name_twice_yields_two_projects() {
        let library = library("dup");
        let one = library
            .create("Untitled", CanvasSize::default(), Fps::default())
            .unwrap();
        let two = library
            .create("Untitled", CanvasSize::default(), Fps::default())
            .unwrap();
        assert_ne!(one.metadata.id, two.metadata.id);
        assert_eq!(library.list().unwrap().len(), 2);
    }

    #[test]
    fn saving_an_existing_project_updates_it_in_place() {
        let library = library("save");
        let mut project = library
            .create("Draft", CanvasSize::default(), Fps::default())
            .unwrap();
        project.metadata.name = "Final".into();
        library.save(&project).unwrap();

        let listed = library.list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Final");
    }

    #[test]
    fn summaries_report_the_timeline_duration() {
        let library = library("duration");
        let mut project = library
            .create("Timed", CanvasSize::default(), Fps::default())
            .unwrap();
        // The starter project's furthest element end is what a summary must report.
        project.scenes = Project::starter().scenes;
        library.save(&project).unwrap();

        let summary = &library.list().unwrap()[0];
        assert!(
            summary.duration_seconds >= 7.0,
            "got {}",
            summary.duration_seconds
        );
        assert!(summary.element_count >= 4);
    }

    #[test]
    fn delete_removes_the_project_and_is_idempotent() {
        let library = library("delete");
        let project = library
            .create("Doomed", CanvasSize::default(), Fps::default())
            .unwrap();
        library.delete(&project.metadata.id).unwrap();
        assert!(library.list().unwrap().is_empty());
        library.delete(&project.metadata.id).unwrap(); // second delete is a no-op
        assert!(matches!(
            library.load(&project.metadata.id),
            Err(LibraryError::NotFound { .. })
        ));
    }

    #[test]
    fn listing_skips_files_that_are_not_projects() {
        let library = library("junk");
        library
            .create("Good", CanvasSize::default(), Fps::default())
            .unwrap();
        std::fs::write(library.root().join("broken.json"), "{ not json").unwrap();
        std::fs::write(library.root().join("notes.txt"), "ignore me").unwrap();

        let listed = library.list().unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Good");
    }

    #[test]
    fn an_id_cannot_escape_the_library_directory() {
        let library = library("escape");
        let path = library.path_for("../../etc/passwd");
        assert_eq!(path.parent().unwrap(), library.root());
        assert_eq!(path.file_name().unwrap(), "etc-passwd.json");
        assert_eq!(library.path_for("").file_name().unwrap(), "project.json");
    }

    #[test]
    fn import_adopts_a_loose_project_file() {
        let library = library("import");
        let loose = scratch("import-src").join("bay-project.json");
        write_project(&loose, &Project::starter()).unwrap();

        let summary = library.import(&loose).unwrap();
        assert_eq!(summary.path.parent().unwrap(), library.root());
        assert_eq!(library.list().unwrap().len(), 1);

        // Importing the same file again keeps both rather than overwriting the first.
        library.import(&loose).unwrap();
        assert_eq!(library.list().unwrap().len(), 2);
    }
}

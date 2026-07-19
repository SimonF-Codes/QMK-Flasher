//! Multi-layout persistence under `%APPDATA%\qmk-flasher\`:
//!
//! ```text
//! layouts\<id>.json   one LayoutFile per saved layout, id = filename slug
//! state.json          { "activeLayoutId": "<id>" }
//! layout.json         legacy single-layout file — auto-migrated to
//!                     layouts\arrows-together.json on first access
//! ```
//!
//! Invariant: after `ensure_initialized()` there is always ≥1 layout on disk
//! and a valid active id (the checked-in seeded fixture is materialized as
//! `arrows-together` on a fresh install). `load`/`save` operate on the
//! active layout — their contract signatures predate multi-layout and stay.

use std::path::{Path, PathBuf};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::layout::LayoutFile;

pub const FIXTURE_LAYOUT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/fixtures/seeded_layout.json"
));

/// The id the legacy single layout (and the fresh-install fixture) gets.
pub const DEFAULT_LAYOUT_ID: &str = "arrows-together";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LayoutSummary {
    /// Filename slug, stable across renames.
    pub id: String,
    /// Display name (`meta.name`).
    pub name: String,
    /// Keyboard id (`meta.geometry`).
    pub keyboard: String,
    /// RFC 3339 file modification time.
    pub modified_at: String,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoreState {
    active_layout_id: String,
}

/// `%APPDATA%\qmk-flasher`.
pub fn data_dir() -> Result<PathBuf, AppError> {
    std::env::var("APPDATA")
        .map(|d| PathBuf::from(d).join("qmk-flasher"))
        .map_err(|_| AppError::InvalidLayout("APPDATA is not set".into()))
}

// ---------------------------------------------------------------------------
// All logic lives on `Store` (rooted at an explicit dir) so tests run against
// temp dirs; the public free functions below bind it to the real data dir.
// ---------------------------------------------------------------------------

pub struct Store {
    root: PathBuf,
}

fn io_err(path: &Path) -> impl Fn(std::io::Error) -> AppError + '_ {
    move |e| AppError::InvalidLayout(format!("{}: {e}", path.display()))
}

fn parse_and_validate(json: &str, what: &str) -> Result<LayoutFile, AppError> {
    let layout: LayoutFile = serde_json::from_str(json)
        .map_err(|e| AppError::InvalidLayout(format!("{what}: {e}")))?;
    layout.validate().map_err(AppError::InvalidLayout)?;
    Ok(layout)
}

/// Filename-safe slug: lowercase alnum runs joined by single dashes.
fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut dash_pending = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            if dash_pending && !out.is_empty() {
                out.push('-');
            }
            dash_pending = false;
            out.push(c.to_ascii_lowercase());
        } else {
            dash_pending = true;
        }
    }
    if out.is_empty() {
        "layout".into()
    } else {
        out
    }
}

fn atomic_write(path: &Path, contents: &str) -> Result<(), AppError> {
    // Unique temp name: concurrent writers (parallel tests, racing commands)
    // must never collide on the temp file.
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let io = io_err(path);
    std::fs::create_dir_all(path.parent().expect("path has a parent")).map_err(&io)?;
    let tmp = path.with_extension(format!(
        "tmp-{}-{}",
        std::process::id(),
        COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    std::fs::write(&tmp, contents).map_err(&io)?;
    std::fs::rename(&tmp, path).map_err(&io)?;
    Ok(())
}

impl Store {
    pub fn real() -> Result<Self, AppError> {
        Ok(Self { root: data_dir()? })
    }

    pub fn at(root: PathBuf) -> Self {
        Self { root }
    }

    fn layouts_dir(&self) -> PathBuf {
        self.root.join("layouts")
    }

    fn layout_path(&self, id: &str) -> PathBuf {
        self.layouts_dir().join(format!("{id}.json"))
    }

    fn state_path(&self) -> PathBuf {
        self.root.join("state.json")
    }

    fn legacy_path(&self) -> PathBuf {
        self.root.join("layout.json")
    }

    /// Migrate the legacy single-layout file and guarantee the invariant:
    /// ≥1 layout on disk, valid active id.
    pub fn ensure_initialized(&self) -> Result<(), AppError> {
        let layouts = self.layouts_dir();
        std::fs::create_dir_all(&layouts).map_err(io_err(&layouts))?;

        let legacy = self.legacy_path();
        let default = self.layout_path(DEFAULT_LAYOUT_ID);
        if legacy.exists() && !default.exists() {
            std::fs::rename(&legacy, &default).map_err(io_err(&legacy))?;
        }
        if self.ids()?.is_empty() {
            atomic_write(&default, FIXTURE_LAYOUT)?;
        }

        let active = self.read_state()?.active_layout_id;
        if active.is_empty() || !self.layout_path(&active).exists() {
            let fallback = if default.exists() {
                DEFAULT_LAYOUT_ID.to_string()
            } else {
                self.ids()?.first().cloned().expect("≥1 layout on disk")
            };
            self.write_state(&fallback)?;
        }
        Ok(())
    }

    fn ids(&self) -> Result<Vec<String>, AppError> {
        let dir = self.layouts_dir();
        let mut ids = Vec::new();
        for entry in std::fs::read_dir(&dir).map_err(io_err(&dir))? {
            let path = entry.map_err(io_err(&dir))?.path();
            if path.extension().is_some_and(|e| e == "json") {
                if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                    ids.push(stem.to_string());
                }
            }
        }
        ids.sort();
        Ok(ids)
    }

    fn read_state(&self) -> Result<StoreState, AppError> {
        let path = self.state_path();
        if !path.exists() {
            return Ok(StoreState::default());
        }
        let json = std::fs::read_to_string(&path).map_err(io_err(&path))?;
        serde_json::from_str(&json)
            .map_err(|e| AppError::InvalidLayout(format!("{}: {e}", path.display())))
    }

    fn write_state(&self, active: &str) -> Result<(), AppError> {
        let state = StoreState { active_layout_id: active.to_string() };
        atomic_write(
            &self.state_path(),
            &(serde_json::to_string_pretty(&state).expect("state serializes") + "\n"),
        )
    }

    pub fn active_layout_id(&self) -> Result<String, AppError> {
        self.ensure_initialized()?;
        Ok(self.read_state()?.active_layout_id)
    }

    fn read_layout(&self, id: &str) -> Result<LayoutFile, AppError> {
        let path = self.layout_path(id);
        if !path.exists() {
            return Err(AppError::InvalidLayout(format!("no layout with id {id:?}")));
        }
        let json = std::fs::read_to_string(&path).map_err(io_err(&path))?;
        parse_and_validate(&json, &format!("layout {id:?}"))
    }

    fn write_layout(&self, id: &str, layout: &LayoutFile) -> Result<(), AppError> {
        layout.validate().map_err(AppError::InvalidLayout)?;
        let json = serde_json::to_string_pretty(layout)
            .map_err(|e| AppError::InvalidLayout(e.to_string()))?
            + "\n";
        atomic_write(&self.layout_path(id), &json)
    }

    fn summary(&self, id: &str) -> Result<LayoutSummary, AppError> {
        let layout = self.read_layout(id)?;
        let path = self.layout_path(id);
        let modified_at = std::fs::metadata(&path)
            .and_then(|m| m.modified())
            .map(|t| {
                chrono::DateTime::<chrono::Utc>::from(t)
                    .to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
            })
            .unwrap_or_default();
        Ok(LayoutSummary {
            id: id.to_string(),
            name: layout.meta.name,
            keyboard: layout.meta.geometry,
            modified_at,
        })
    }

    /// A fresh unique id derived from a display name.
    fn new_id(&self, name: &str) -> Result<String, AppError> {
        let base = slug(name);
        let ids = self.ids()?;
        if !ids.contains(&base) {
            return Ok(base);
        }
        for n in 2.. {
            let candidate = format!("{base}-{n}");
            if !ids.contains(&candidate) {
                return Ok(candidate);
            }
        }
        unreachable!()
    }

    // -- the public verbs ---------------------------------------------------

    pub fn load(&self) -> Result<LayoutFile, AppError> {
        let active = self.active_layout_id()?;
        self.read_layout(&active)
    }

    pub fn save(&self, layout: &LayoutFile) -> Result<(), AppError> {
        let active = self.active_layout_id()?;
        self.write_layout(&active, layout)
    }

    pub fn list(&self) -> Result<Vec<LayoutSummary>, AppError> {
        self.ensure_initialized()?;
        self.ids()?.iter().map(|id| self.summary(id)).collect()
    }

    pub fn select(&self, id: &str) -> Result<LayoutFile, AppError> {
        self.ensure_initialized()?;
        let layout = self.read_layout(id)?;
        self.write_state(id)?;
        Ok(layout)
    }

    pub fn create(&self, name: &str, keyboard_id: &str) -> Result<LayoutSummary, AppError> {
        self.ensure_initialized()?;
        let kb = crate::keyboards::supported(keyboard_id)?;
        let id = self.new_id(name)?;
        let layout = blank_layout(name, kb);
        self.write_layout(&id, &layout)?;
        self.summary(&id)
    }

    pub fn duplicate(&self, id: &str, new_name: &str) -> Result<LayoutSummary, AppError> {
        self.ensure_initialized()?;
        let mut layout = self.read_layout(id)?;
        layout.meta.name = new_name.to_string();
        let new_id = self.new_id(new_name)?;
        self.write_layout(&new_id, &layout)?;
        self.summary(&new_id)
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<LayoutSummary, AppError> {
        self.ensure_initialized()?;
        let mut layout = self.read_layout(id)?;
        layout.meta.name = name.to_string();
        self.write_layout(id, &layout)?;
        self.summary(id)
    }

    pub fn delete(&self, id: &str) -> Result<(), AppError> {
        self.ensure_initialized()?;
        if self.active_layout_id()? == id {
            return Err(AppError::InvalidLayout(format!(
                "layout {id:?} is active — select another layout before deleting it"
            )));
        }
        let path = self.layout_path(id);
        if !path.exists() {
            return Err(AppError::InvalidLayout(format!("no layout with id {id:?}")));
        }
        std::fs::remove_file(&path).map_err(io_err(&path))
    }
}

/// A minimal valid layout for a fresh keyboard: one all-transparent layer.
fn blank_layout(name: &str, kb: &crate::keyboards::KeyboardInfo) -> LayoutFile {
    use crate::layout::schema::*;
    LayoutFile {
        schema_version: SCHEMA_VERSION,
        meta: Meta {
            name: name.to_string(),
            geometry: kb.id.clone(),
            seeded_from: SeededFrom {
                layout_id: "local".into(),
                revision_hash: "local".into(),
                qmk_version: "n/a".into(),
                seeded_at: chrono::Utc::now()
                    .to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
            },
        },
        layers: vec![Layer {
            title: "Layer".into(),
            color: "#000000".into(),
            keys: (0..kb.key_count)
                .map(|_| KeyAction::Transparent { glow: None })
                .collect(),
        }],
        combos: Vec::new(),
        settings: Settings {
            auto_shift: false,
            caps_word: false,
            tap_dance: false,
            combos: false,
            key_lock: true,
            oryx: true,
            rgb_matrix_custom: true,
            layer_state_8bit: true,
            serial_number: format!("qmk-flasher/{}", kb.id),
            rgb_startup_speed: 60,
        },
    }
}

// ---------------------------------------------------------------------------
// Contract-facing free functions (bound to the real data dir).
// ---------------------------------------------------------------------------

pub fn load() -> Result<LayoutFile, AppError> {
    Store::real()?.load()
}

pub fn save(layout: &LayoutFile) -> Result<(), AppError> {
    Store::real()?.save(layout)
}

/// The saved active layout if the store has been initialized, `None` on a
/// completely fresh install (used by the seeder's no-force short-circuit).
pub fn load_saved() -> Result<Option<LayoutFile>, AppError> {
    let store = Store::real()?;
    let state = store.read_state()?;
    if state.active_layout_id.is_empty()
        || !store.layout_path(&state.active_layout_id).exists()
    {
        // Legacy single-layout file counts as "saved" (pre-migration).
        if store.legacy_path().exists() {
            return store.load().map(Some);
        }
        return Ok(None);
    }
    store.read_layout(&state.active_layout_id).map(Some)
}

pub fn list_layouts() -> Result<Vec<LayoutSummary>, AppError> {
    Store::real()?.list()
}

pub fn select_layout(id: &str) -> Result<LayoutFile, AppError> {
    Store::real()?.select(id)
}

pub fn create_layout(name: &str, keyboard_id: &str) -> Result<LayoutSummary, AppError> {
    Store::real()?.create(name, keyboard_id)
}

pub fn duplicate_layout(id: &str, new_name: &str) -> Result<LayoutSummary, AppError> {
    Store::real()?.duplicate(id, new_name)
}

pub fn rename_layout(id: &str, name: &str) -> Result<LayoutSummary, AppError> {
    Store::real()?.rename(id, name)
}

pub fn delete_layout(id: &str) -> Result<(), AppError> {
    Store::real()?.delete(id)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempStore {
        store: Store,
        root: PathBuf,
    }

    impl TempStore {
        fn new(tag: &str) -> Self {
            let root = std::env::temp_dir().join(format!("qmk-flasher-store-{tag}"));
            let _ = std::fs::remove_dir_all(&root);
            Self { store: Store::at(root.clone()), root }
        }
    }

    impl Drop for TempStore {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn fresh_install_materializes_fixture_as_default_layout() {
        let t = TempStore::new("fresh");
        let layout = t.store.load().unwrap();
        assert_eq!(layout.meta.name, "Arrows Together");
        assert_eq!(t.store.active_layout_id().unwrap(), DEFAULT_LAYOUT_ID);
        let list = t.store.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, DEFAULT_LAYOUT_ID);
        assert_eq!(list[0].keyboard, "moonlander");
        assert!(!list[0].modified_at.is_empty());
    }

    #[test]
    fn legacy_layout_json_migrates_to_default_id() {
        let t = TempStore::new("legacy");
        std::fs::create_dir_all(&t.root).unwrap();
        let mut layout: LayoutFile = serde_json::from_str(FIXTURE_LAYOUT).unwrap();
        layout.meta.name = "Migrated".into();
        std::fs::write(
            t.root.join("layout.json"),
            serde_json::to_string_pretty(&layout).unwrap(),
        )
        .unwrap();

        let loaded = t.store.load().unwrap();
        assert_eq!(loaded.meta.name, "Migrated");
        assert!(!t.root.join("layout.json").exists(), "legacy file is moved");
        assert!(t.root.join("layouts").join("arrows-together.json").exists());
    }

    #[test]
    fn save_writes_the_active_layout() {
        let t = TempStore::new("save");
        let mut layout = t.store.load().unwrap();
        layout.meta.name = "Edited".into();
        t.store.save(&layout).unwrap();
        assert_eq!(t.store.load().unwrap().meta.name, "Edited");
    }

    #[test]
    fn create_select_and_delete_roundtrip() {
        let t = TempStore::new("crud");
        let created = t.store.create("Gaming Layout", "moonlander").unwrap();
        assert_eq!(created.id, "gaming-layout");
        assert_eq!(created.keyboard, "moonlander");

        // Creating does not switch the active layout.
        assert_eq!(t.store.active_layout_id().unwrap(), DEFAULT_LAYOUT_ID);

        let selected = t.store.select("gaming-layout").unwrap();
        assert_eq!(selected.meta.name, "Gaming Layout");
        assert_eq!(selected.layers.len(), 1);
        assert!(selected.validate().is_ok());
        assert_eq!(t.store.active_layout_id().unwrap(), "gaming-layout");

        // Active layouts cannot be deleted; inactive ones can.
        assert!(t.store.delete("gaming-layout").is_err());
        t.store.select(DEFAULT_LAYOUT_ID).unwrap();
        t.store.delete("gaming-layout").unwrap();
        assert_eq!(t.store.list().unwrap().len(), 1);
    }

    #[test]
    fn duplicate_and_rename_keep_ids_unique_and_stable() {
        let t = TempStore::new("dup");
        let dup = t.store.duplicate(DEFAULT_LAYOUT_ID, "Arrows Together").unwrap();
        assert_eq!(dup.id, "arrows-together-2", "slug collision gets a suffix");
        assert_eq!(dup.name, "Arrows Together");

        let renamed = t.store.rename("arrows-together-2", "Experiments").unwrap();
        assert_eq!(renamed.id, "arrows-together-2", "rename keeps the id");
        assert_eq!(renamed.name, "Experiments");
        assert_eq!(
            t.store.select("arrows-together-2").unwrap().meta.name,
            "Experiments"
        );
    }

    #[test]
    fn create_rejects_unknown_or_unsupported_keyboard() {
        let t = TempStore::new("badkb");
        assert!(t.store.create("Nope", "planck").is_err());
    }

    #[test]
    fn select_unknown_id_is_an_error() {
        let t = TempStore::new("badsel");
        assert!(t.store.select("does-not-exist").is_err());
    }

    #[test]
    fn slugs_are_filename_safe() {
        assert_eq!(slug("Gaming Layout"), "gaming-layout");
        assert_eq!(slug("  Ærgo / v2!  "), "rgo-v2");
        assert_eq!(slug("___"), "layout");
        assert_eq!(slug("ALL CAPS 99"), "all-caps-99");
    }

    #[test]
    fn save_rejects_invalid_layout() {
        let t = TempStore::new("invalid");
        let mut layout = t.store.load().unwrap();
        layout.settings.key_lock = false;
        assert_eq!(t.store.save(&layout).unwrap_err().code(), "InvalidLayout");
        assert_eq!(t.store.load().unwrap().settings.key_lock, true);
    }
}

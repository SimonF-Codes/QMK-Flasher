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
//! and a valid active id ([`DEFAULT_LAYOUT`] is materialized as
//! `arrows-together` on a fresh install). `load`/`save` operate on the
//! active layout — their contract signatures predate multi-layout and stay.

use std::path::{Path, PathBuf};

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::error::AppError;
use crate::layout::LayoutFile;

/// The frozen Oryx golden fixture. This is TEST MATERIAL, not the shipped
/// default: it exists so codegen and the seeder can be proved to reproduce
/// real Oryx output byte for byte, and nothing may be added to it that Oryx
/// itself cannot emit. What a new user gets is [`DEFAULT_LAYOUT`].
pub const FIXTURE_LAYOUT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/fixtures/seeded_layout.json"
));

/// The layout a fresh install materializes: the same Oryx-seeded content plus
/// the "Demo" layer, which carries a live, labelled example of every advanced
/// key kind (macro, osMacro, osMode, tap dance, dual-function, mod-tap,
/// layer-tap, all four layer-switch flavours, Key Lock, RGB) so the tutorial
/// has something real to point at. It is a SEPARATE asset from
/// [`FIXTURE_LAYOUT`] on purpose — see `docs/CONTRACT.md`.
pub const DEFAULT_LAYOUT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/default_layout.json"
));

/// The id the legacy single layout (and the fresh-install default) gets.
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

/// Why a layout version snapshot was taken.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum VersionReason {
    /// Auto-snapshot after a `save_layout`.
    Save,
    /// Auto-snapshot of the current layout before a reseed overwrites it.
    PreReseed,
    /// Auto-snapshot of the current layout before a restore overwrites it
    /// (makes the restore itself undoable).
    PreRestore,
    /// Explicit user-requested snapshot via `snapshot_layout`.
    Manual,
}

/// Metadata for one stored layout version. The full [`LayoutFile`] copy lives
/// in the same file under `layout`; listing reads only this header.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LayoutVersionSummary {
    /// Sortable id, e.g. `20260721-143000-123`.
    pub version_id: String,
    /// RFC 3339 (ISO 8601) creation time.
    pub created_at: String,
    pub reason: VersionReason,
    /// Optional human note (only ever set for `manual` snapshots today).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// On-disk version record: the summary header flattened alongside a full
/// [`LayoutFile`] copy. Listing deserializes only the header (the `layout`
/// field is ignored), keeping `list_layout_versions` cheap.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct VersionRecord {
    #[serde(flatten)]
    summary: LayoutVersionSummary,
    layout: LayoutFile,
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
    let mut layout: LayoutFile = serde_json::from_str(json)
        .map_err(|e| AppError::InvalidLayout(format!("{what}: {e}")))?;
    // Every read funnels through here, so this is the one place an older
    // on-disk layout gets brought up to the current schema before the
    // version check in `validate` sees it.
    layout.migrate();
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
            atomic_write(&default, DEFAULT_LAYOUT)?;
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

    // -- version history (additive, 2026-07-21) -----------------------------

    fn versions_dir(&self, id: &str) -> PathBuf {
        self.root.join("versions").join(id)
    }

    fn version_path(&self, id: &str, version_id: &str) -> PathBuf {
        self.versions_dir(id).join(format!("{version_id}.json"))
    }

    /// Version ids for `id`, ascending (== chronological, since ids sort by
    /// time). Empty when the layout has no history yet.
    fn version_ids(&self, id: &str) -> Result<Vec<String>, AppError> {
        let dir = self.versions_dir(id);
        if !dir.exists() {
            return Ok(Vec::new());
        }
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

    /// A unique, sortable version id: `YYYYMMDD-HHMMSS-mmm`, with a `-N`
    /// suffix appended only on same-millisecond collisions (still sorts
    /// after the bare id and before the next millisecond).
    fn new_version_id(&self, id: &str) -> String {
        let now = chrono::Utc::now();
        let base = format!(
            "{}-{:03}",
            now.format("%Y%m%d-%H%M%S"),
            now.timestamp_subsec_millis()
        );
        let mut candidate = base.clone();
        let mut n = 1;
        while self.version_path(id, &candidate).exists() {
            candidate = format!("{base}-{n}");
            n += 1;
        }
        candidate
    }

    fn write_version(
        &self,
        id: &str,
        layout: &LayoutFile,
        reason: VersionReason,
        label: Option<String>,
    ) -> Result<LayoutVersionSummary, AppError> {
        let version_id = self.new_version_id(id);
        let summary = LayoutVersionSummary {
            version_id: version_id.clone(),
            created_at: chrono::Utc::now()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            reason,
            label,
        };
        let record = VersionRecord { summary: summary.clone(), layout: layout.clone() };
        let json = serde_json::to_string_pretty(&record)
            .map_err(|e| AppError::InvalidLayout(e.to_string()))?
            + "\n";
        atomic_write(&self.version_path(id, &version_id), &json)?;
        Ok(summary)
    }

    /// The newest stored version's layout for `id`, if any (used for the
    /// save-snapshot dedup check).
    fn newest_version_layout(&self, id: &str) -> Result<Option<LayoutFile>, AppError> {
        match self.version_ids(id)?.last() {
            None => Ok(None),
            Some(vid) => {
                let path = self.version_path(id, vid);
                let json = std::fs::read_to_string(&path).map_err(io_err(&path))?;
                let record: VersionRecord = serde_json::from_str(&json).map_err(|e| {
                    AppError::InvalidLayout(format!("{}: {e}", path.display()))
                })?;
                Ok(Some(record.layout))
            }
        }
    }

    /// Snapshot the CURRENT on-disk content of layout `id`. When `dedup` is
    /// set, skip writing (returning `None`) if the content is identical to the
    /// newest existing version.
    fn snapshot_current(
        &self,
        id: &str,
        reason: VersionReason,
        label: Option<String>,
        dedup: bool,
    ) -> Result<Option<LayoutVersionSummary>, AppError> {
        let layout = self.read_layout(id)?;
        if dedup {
            if let Some(prev) = self.newest_version_layout(id)? {
                if prev == layout {
                    return Ok(None);
                }
            }
        }
        self.write_version(id, &layout, reason, label).map(Some)
    }

    /// Write the active layout, then auto-snapshot it (reason `save`, deduped
    /// against the newest existing version).
    pub fn save_with_history(&self, layout: &LayoutFile) -> Result<(), AppError> {
        let active = self.active_layout_id()?;
        self.write_layout(&active, layout)?;
        self.snapshot_current(&active, VersionReason::Save, None, true)?;
        Ok(())
    }

    /// Explicit snapshot of the current content of layout `id`. Never deduped
    /// (explicit user intent).
    pub fn snapshot(
        &self,
        id: &str,
        reason: VersionReason,
        label: Option<String>,
    ) -> Result<LayoutVersionSummary, AppError> {
        self.ensure_initialized()?;
        self.snapshot_current(id, reason, label, false)
            .map(|w| w.expect("non-dedup snapshot always writes"))
    }

    /// Snapshot the current active layout before a reseed overwrites it, so a
    /// reseed is recoverable. No-op contract-wise if there is no active
    /// layout, but `ensure_initialized` guarantees one exists.
    pub fn snapshot_active_pre_reseed(&self) -> Result<(), AppError> {
        let active = self.active_layout_id()?;
        self.snapshot_current(&active, VersionReason::PreReseed, None, false)?;
        Ok(())
    }

    /// Versions for `id`, newest first.
    pub fn list_versions(&self, id: &str) -> Result<Vec<LayoutVersionSummary>, AppError> {
        self.ensure_initialized()?;
        let mut ids = self.version_ids(id)?;
        ids.reverse();
        let mut out = Vec::with_capacity(ids.len());
        for vid in ids {
            let path = self.version_path(id, &vid);
            let json = std::fs::read_to_string(&path).map_err(io_err(&path))?;
            // Deserialize only the header; the `layout` field is ignored.
            let summary: LayoutVersionSummary = serde_json::from_str(&json)
                .map_err(|e| AppError::InvalidLayout(format!("{}: {e}", path.display())))?;
            out.push(summary);
        }
        Ok(out)
    }

    /// Restore `version_id`: snapshot the current as `preRestore` (so the
    /// revert is undoable), overwrite the current with the chosen version's
    /// content, and return it (now the active/current layout).
    pub fn restore_version(
        &self,
        id: &str,
        version_id: &str,
    ) -> Result<LayoutFile, AppError> {
        self.ensure_initialized()?;
        let path = self.version_path(id, version_id);
        if !path.exists() {
            return Err(AppError::InvalidLayout(format!(
                "no version {version_id:?} for layout {id:?}"
            )));
        }
        let json = std::fs::read_to_string(&path).map_err(io_err(&path))?;
        let record: VersionRecord = serde_json::from_str(&json)
            .map_err(|e| AppError::InvalidLayout(format!("{}: {e}", path.display())))?;
        // 1) snapshot the current so the restore can itself be undone.
        self.snapshot_current(id, VersionReason::PreRestore, None, false)?;
        // 2) overwrite the current with the chosen version's content.
        self.write_layout(id, &record.layout)?;
        // 3) return the restored layout.
        Ok(record.layout)
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
            os_detection: false,
            os_default: Default::default(),
            // A blank layout configures no RGB Matrix effect, exactly as a
            // seeded one does: the ledmap is the only thing lighting it.
            lighting: None,
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

// -- version history --------------------------------------------------------

/// `save_layout`'s history-aware save: write the active layout, then
/// auto-snapshot (reason `save`, deduped).
pub fn save_with_history(layout: &LayoutFile) -> Result<(), AppError> {
    Store::real()?.save_with_history(layout)
}

/// Snapshot the current active layout before a reseed overwrites it.
pub fn snapshot_active_pre_reseed() -> Result<(), AppError> {
    Store::real()?.snapshot_active_pre_reseed()
}

pub fn list_layout_versions(id: &str) -> Result<Vec<LayoutVersionSummary>, AppError> {
    Store::real()?.list_versions(id)
}

pub fn restore_layout_version(id: &str, version_id: &str) -> Result<LayoutFile, AppError> {
    Store::real()?.restore_version(id, version_id)
}

pub fn snapshot_layout(
    id: &str,
    reason: VersionReason,
    label: Option<String>,
) -> Result<LayoutVersionSummary, AppError> {
    Store::real()?.snapshot(id, reason, label)
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
    fn fresh_install_materializes_the_demo_layout_as_default() {
        let t = TempStore::new("fresh");
        let layout = t.store.load().unwrap();
        assert_eq!(layout.meta.name, "Arrows Together");
        assert_eq!(t.store.active_layout_id().unwrap(), DEFAULT_LAYOUT_ID);
        let list = t.store.list().unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, DEFAULT_LAYOUT_ID);
        assert_eq!(list[0].keyboard, "moonlander");
        assert!(!list[0].modified_at.is_empty());

        // What lands on disk is the demo asset, not the golden fixture: the
        // whole point of the split is that a new user gets the teaching layer.
        let demo: LayoutFile = serde_json::from_str(DEFAULT_LAYOUT).unwrap();
        assert_eq!(layout, demo);
        assert!(
            layout.layers.iter().any(|l| l.title == "Demo"),
            "the shipped default carries the Demo layer"
        );
    }

    /// The demo layout is the app's teaching material: the tutorial derives its
    /// steps from features it can actually find, so a kind missing here becomes
    /// a step that silently degrades to "your layout has none of these". Each
    /// entry below is one thing a new user is promised a live example of.
    #[test]
    fn the_demo_layout_has_a_live_example_of_every_advanced_kind() {
        use crate::layout::schema::{KeyAction as K, LayerSwitchAction as LS, OsModeAction as OM};

        let demo: LayoutFile = serde_json::from_str(DEFAULT_LAYOUT).unwrap();
        demo.validate().expect("the shipped default must be valid");

        let keys: Vec<&K> = demo
            .layers
            .iter()
            .flat_map(|l| &l.keys)
            .chain(demo.combos.iter().map(|c| &c.action))
            .collect();
        let has = |p: &dyn Fn(&K) -> bool| keys.iter().any(|k| p(k));

        let missing: Vec<&str> = [
            ("macro", &(|k: &K| matches!(k, K::Macro { .. })) as &dyn Fn(&K) -> bool),
            ("osMacro", &|k: &K| matches!(k, K::OsMacro { .. })),
            ("osMode", &|k: &K| matches!(k, K::OsMode { .. })),
            ("tapDance", &|k: &K| matches!(k, K::TapDance { .. })),
            ("dualFunc", &|k: &K| matches!(k, K::DualFunc { .. })),
            ("modTap", &|k: &K| matches!(k, K::ModTap { .. })),
            ("layerTap", &|k: &K| matches!(k, K::LayerTap { .. })),
            ("qkLock", &|k: &K| matches!(k, K::QkLock { .. })),
            ("rgb", &|k: &K| matches!(k, K::Rgb { .. })),
            ("rgbHsv", &|k: &K| matches!(k, K::RgbHsv { .. })),
            ("special", &|k: &K| matches!(k, K::Special { .. })),
            ("basic", &|k: &K| matches!(k, K::Basic { .. })),
            ("layerSwitch MO", &|k: &K| {
                matches!(k, K::LayerSwitch { action: LS::MO, .. })
            }),
            ("layerSwitch TG", &|k: &K| {
                matches!(k, K::LayerSwitch { action: LS::TG, .. })
            }),
            ("layerSwitch TO", &|k: &K| {
                matches!(k, K::LayerSwitch { action: LS::TO, .. })
            }),
            ("layerSwitch TT", &|k: &K| {
                matches!(k, K::LayerSwitch { action: LS::TT, .. })
            }),
            ("osMode toggle", &|k: &K| {
                matches!(k, K::OsMode { action: OM::Toggle, .. })
            }),
            ("osMode mac", &|k: &K| matches!(k, K::OsMode { action: OM::Mac, .. })),
            ("osMode windows", &|k: &K| {
                matches!(k, K::OsMode { action: OM::Windows, .. })
            }),
            ("osMode auto", &|k: &K| matches!(k, K::OsMode { action: OM::Auto, .. })),
        ]
        .into_iter()
        .filter(|(_, p)| !has(*p))
        .map(|(name, _)| name)
        .collect();
        assert!(missing.is_empty(), "the demo layout demonstrates no {missing:?}");

        // A per-key glow override, i.e. a key lit differently from its layer.
        assert!(
            demo.layers.iter().any(|l| l.keys.iter().any(|k| k.glow().is_some())),
            "the demo layout must show a per-key glow"
        );

        // Combos beyond the two Oryx mirror combos, and every one of them
        // labelled — an unnamed combo teaches nothing.
        assert!(
            demo.combos.len() > 2,
            "the demo layout adds at least one combo of its own"
        );
        for combo in &demo.combos {
            assert!(!combo.name.trim().is_empty(), "combo {combo:?} needs a name");
        }

        // Every macro and OS macro carries a label: they render as keycap text,
        // and the tutorial reads them aloud.
        for key in &keys {
            match key {
                K::Macro { label, .. } | K::OsMacro { label, .. } => {
                    assert!(!label.trim().is_empty(), "unlabelled macro in the demo layout")
                }
                _ => {}
            }
        }

        // RGB Matrix lighting, and specifically a *reactive* effect: a demo
        // that only picked an animation would teach the easy half.
        let lighting = demo
            .settings
            .lighting
            .as_ref()
            .expect("the demo layout configures RGB Matrix lighting");
        assert!(
            lighting.needs_keypresses(),
            "the demo layout must compile in a reactive effect — that is the half \
             of this feature a user cannot discover from the LED panel"
        );

        // Boots in ledmap mode, so the demo still looks like the layout it is
        // teaching, and TOGGLE_LAYER_COLOR is what reveals the effect
        // underneath. Without that key the reactive effect is compiled in and
        // permanently invisible, which teaches the opposite of the lesson.
        assert_eq!(
            lighting.mode,
            crate::layout::schema::LightingMode::Ledmap,
            "the demo must not hand the board to the effect at boot"
        );
        assert!(
            has(&|k: &K| matches!(k, K::Special { code, .. } if code == "TOGGLE_LAYER_COLOR")),
            "the demo layout needs a TOGGLE_LAYER_COLOR key to reveal the effect"
        );
    }

    /// The Demo layer has to be reachable, or none of the above is discoverable.
    #[test]
    fn the_demo_layer_is_reachable_from_the_base_layer() {
        use crate::layout::schema::KeyAction as K;

        let demo: LayoutFile = serde_json::from_str(DEFAULT_LAYOUT).unwrap();
        let demo_index = demo
            .layers
            .iter()
            .position(|l| l.title == "Demo")
            .expect("a layer titled Demo") as u8;

        let points_at_demo = |k: &K| match k {
            K::LayerSwitch { layer, .. } | K::LayerTap { layer, .. } => *layer == demo_index,
            _ => false,
        };
        let from_base = demo.layers[0].keys.iter().any(points_at_demo)
            || demo
                .combos
                .iter()
                .any(|c| c.layer == 0 && points_at_demo(&c.action));
        assert!(from_base, "no key or combo on layer 0 reaches the Demo layer");

        // And a way back out, or the demo layer is a trap.
        let leaves = demo.layers[demo_index as usize]
            .keys
            .iter()
            .any(|k| matches!(k, K::LayerSwitch { layer: 0, .. }));
        assert!(leaves, "the Demo layer has no key back to the base layer");
    }

    /// The golden fixture must stay what Oryx can actually produce. If someone
    /// enriches it in place instead of the demo asset, `reference_keymap.c`
    /// stops being third-party ground truth and the parity test in
    /// `codegen::tests` quietly becomes self-referential.
    #[test]
    fn the_golden_fixture_stays_free_of_kinds_oryx_cannot_emit() {
        let fixture: LayoutFile = serde_json::from_str(FIXTURE_LAYOUT).unwrap();
        let offenders: Vec<String> = fixture
            .layers
            .iter()
            .enumerate()
            .flat_map(|(li, l)| l.keys.iter().enumerate().map(move |(k, key)| (li, k, key)))
            .filter(|(_, _, key)| {
                matches!(
                    key,
                    crate::layout::schema::KeyAction::OsMacro { .. }
                        | crate::layout::schema::KeyAction::OsMode { .. }
                )
            })
            .map(|(li, k, _)| format!("layer {li} key {k}"))
            .collect();
        assert!(
            offenders.is_empty(),
            "shared/fixtures/seeded_layout.json must not contain osMacro/osMode \
             keys — Oryx cannot emit them, so reference_keymap.c could not \
             contain them either. Put demo content in shared/default_layout.json. \
             Offending keys: {offenders:?}"
        );
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

    // -- version history ----------------------------------------------------

    #[test]
    fn save_with_history_snapshots_and_dedups_identical_content() {
        let t = TempStore::new("history-save");
        let active = t.store.active_layout_id().unwrap();

        let mut layout = t.store.load().unwrap();
        layout.meta.name = "V1".into();
        t.store.save_with_history(&layout).unwrap();
        let versions = t.store.list_versions(&active).unwrap();
        assert_eq!(versions.len(), 1);
        assert_eq!(versions[0].reason, VersionReason::Save);
        assert!(versions[0].label.is_none());

        // A byte-identical re-save must not spam a second version.
        t.store.save_with_history(&layout).unwrap();
        assert_eq!(t.store.list_versions(&active).unwrap().len(), 1);

        // A changed save adds a version.
        layout.meta.name = "V2".into();
        t.store.save_with_history(&layout).unwrap();
        assert_eq!(t.store.list_versions(&active).unwrap().len(), 2);
    }

    #[test]
    fn list_versions_is_newest_first_and_ids_are_unique() {
        let t = TempStore::new("history-order");
        let active = t.store.active_layout_id().unwrap();

        // Three explicit snapshots in quick succession (same content, so this
        // also exercises unique-id disambiguation within a millisecond).
        let a = t.store.snapshot(&active, VersionReason::Manual, Some("a".into())).unwrap();
        let b = t.store.snapshot(&active, VersionReason::PreReseed, None).unwrap();
        let c = t.store.snapshot(&active, VersionReason::Manual, Some("c".into())).unwrap();
        assert_ne!(a.version_id, b.version_id);
        assert_ne!(b.version_id, c.version_id);

        let list = t.store.list_versions(&active).unwrap();
        assert_eq!(
            list.iter().map(|v| v.version_id.clone()).collect::<Vec<_>>(),
            vec![c.version_id, b.version_id, a.version_id],
            "newest first"
        );
        assert_eq!(list[1].reason, VersionReason::PreReseed);
        assert_eq!(list[0].label.as_deref(), Some("c"));
    }

    #[test]
    fn snapshot_active_pre_reseed_captures_current() {
        let t = TempStore::new("history-prereseed");
        let active = t.store.active_layout_id().unwrap();

        let mut layout = t.store.load().unwrap();
        layout.meta.name = "Before reseed".into();
        t.store.save(&layout).unwrap(); // plain save: no snapshot

        assert!(t.store.list_versions(&active).unwrap().is_empty());
        t.store.snapshot_active_pre_reseed().unwrap();

        let list = t.store.list_versions(&active).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].reason, VersionReason::PreReseed);
    }

    #[test]
    fn restore_snapshots_current_first_and_is_undoable() {
        let t = TempStore::new("history-restore");
        let active = t.store.active_layout_id().unwrap();

        let mut layout = t.store.load().unwrap();
        layout.meta.name = "V1".into();
        t.store.save_with_history(&layout).unwrap();
        let v1_id = t.store.list_versions(&active).unwrap()[0].version_id.clone();

        layout.meta.name = "V2".into();
        t.store.save_with_history(&layout).unwrap();
        assert_eq!(t.store.load().unwrap().meta.name, "V2");

        // Restore V1: current (V2) is snapshotted preRestore, current -> V1.
        let restored = t.store.restore_version(&active, &v1_id).unwrap();
        assert_eq!(restored.meta.name, "V1");
        assert_eq!(t.store.load().unwrap().meta.name, "V1");

        let list = t.store.list_versions(&active).unwrap();
        assert_eq!(list[0].reason, VersionReason::PreRestore, "newest is the undo point");

        // Restoring that preRestore snapshot brings V2 back — revert is undoable.
        let pre_restore_id = list[0].version_id.clone();
        let back = t.store.restore_version(&active, &pre_restore_id).unwrap();
        assert_eq!(back.meta.name, "V2");
        assert_eq!(t.store.load().unwrap().meta.name, "V2");
    }

    #[test]
    fn restore_unknown_version_is_an_error() {
        let t = TempStore::new("history-badrestore");
        let active = t.store.active_layout_id().unwrap();
        assert_eq!(
            t.store.restore_version(&active, "nope").unwrap_err().code(),
            "InvalidLayout"
        );
    }
}

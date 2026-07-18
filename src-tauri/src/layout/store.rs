//! Layout persistence (`%APPDATA%\qmk-flasher\layout.json`).
//!
//! `load` returns the layout on disk, falling back to the checked-in seeded
//! fixture when nothing has been saved yet (first run before a re-seed).
//! `save` validates and writes atomically (temp file + rename).

use std::path::{Path, PathBuf};

use crate::error::AppError;
use crate::layout::LayoutFile;

pub const FIXTURE_LAYOUT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/fixtures/seeded_layout.json"
));

/// `%APPDATA%\qmk-flasher`.
pub fn data_dir() -> Result<PathBuf, AppError> {
    std::env::var("APPDATA")
        .map(|d| PathBuf::from(d).join("qmk-flasher"))
        .map_err(|_| AppError::InvalidLayout("APPDATA is not set".into()))
}

pub fn layout_path() -> Result<PathBuf, AppError> {
    Ok(data_dir()?.join("layout.json"))
}

fn parse_and_validate(json: &str, what: &str) -> Result<LayoutFile, AppError> {
    let layout: LayoutFile = serde_json::from_str(json)
        .map_err(|e| AppError::InvalidLayout(format!("{what}: {e}")))?;
    layout.validate().map_err(AppError::InvalidLayout)?;
    Ok(layout)
}

fn load_saved_from(path: &Path) -> Result<Option<LayoutFile>, AppError> {
    if !path.exists() {
        return Ok(None);
    }
    let json = std::fs::read_to_string(path)
        .map_err(|e| AppError::InvalidLayout(format!("reading {}: {e}", path.display())))?;
    parse_and_validate(&json, "saved layout").map(Some)
}

fn save_to(layout: &LayoutFile, path: &Path) -> Result<(), AppError> {
    layout.validate().map_err(AppError::InvalidLayout)?;
    let io = |e: std::io::Error| {
        AppError::InvalidLayout(format!("saving {}: {e}", path.display()))
    };
    std::fs::create_dir_all(path.parent().expect("layout path has a parent")).map_err(io)?;
    let json = serde_json::to_string_pretty(layout)
        .map_err(|e| AppError::InvalidLayout(e.to_string()))?
        + "\n";
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(io)?;
    std::fs::rename(&tmp, path).map_err(io)?;
    Ok(())
}

/// The saved layout if one exists on disk, `None` on a fresh install.
pub fn load_saved() -> Result<Option<LayoutFile>, AppError> {
    load_saved_from(&layout_path()?)
}

pub fn load() -> Result<LayoutFile, AppError> {
    match load_saved()? {
        Some(layout) => Ok(layout),
        None => parse_and_validate(FIXTURE_LAYOUT, "fixture layout"),
    }
}

pub fn save(layout: &LayoutFile) -> Result<(), AppError> {
    save_to(layout, &layout_path()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("qmk-flasher-store-{tag}"));
            let _ = std::fs::remove_dir_all(&dir);
            Self(dir)
        }

        fn layout_path(&self) -> PathBuf {
            self.0.join("layout.json")
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn fixture() -> LayoutFile {
        parse_and_validate(FIXTURE_LAYOUT, "fixture").unwrap()
    }

    #[test]
    fn load_falls_back_to_valid_fixture() {
        let tmp = TempDir::new("fresh");
        assert!(load_saved_from(&tmp.layout_path()).unwrap().is_none());
        // The public load() must always produce something valid.
        let layout = load().expect("load");
        assert_eq!(layout.meta.geometry, "moonlander");
    }

    #[test]
    fn save_then_load_round_trips() {
        let tmp = TempDir::new("roundtrip");
        let mut layout = fixture();
        layout.meta.name = "Round Trip".into();
        save_to(&layout, &tmp.layout_path()).expect("save");
        let loaded = load_saved_from(&tmp.layout_path()).expect("load").expect("saved");
        assert_eq!(loaded, layout);
    }

    #[test]
    fn save_rejects_invalid_layout() {
        let tmp = TempDir::new("invalid");
        let mut layout = fixture();
        layout.settings.key_lock = false;
        let err = save_to(&layout, &tmp.layout_path()).unwrap_err();
        assert_eq!(err.code(), "InvalidLayout");
        assert!(!tmp.layout_path().exists(), "invalid layout must not be written");
    }

    #[test]
    fn corrupt_saved_layout_is_an_error_not_a_fallback() {
        let tmp = TempDir::new("corrupt");
        std::fs::create_dir_all(&tmp.0).unwrap();
        std::fs::write(tmp.layout_path(), "{not json").unwrap();
        assert!(load_saved_from(&tmp.layout_path()).is_err());
    }
}

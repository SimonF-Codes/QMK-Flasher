//! Layout persistence (`%APPDATA%\qmk-flasher\layout.json`).
//! STUB: `load` returns the checked-in fixture; `save` validates and
//! discards. Real disk persistence lands with Worker A's seeder merge.

use crate::error::AppError;
use crate::layout::LayoutFile;

pub const FIXTURE_LAYOUT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../shared/fixtures/seeded_layout.json"
));

pub fn load() -> Result<LayoutFile, AppError> {
    let layout: LayoutFile = serde_json::from_str(FIXTURE_LAYOUT)
        .map_err(|e| AppError::InvalidLayout(e.to_string()))?;
    layout.validate().map_err(AppError::InvalidLayout)?;
    Ok(layout)
}

pub fn save(layout: &LayoutFile) -> Result<(), AppError> {
    layout.validate().map_err(AppError::InvalidLayout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_returns_valid_fixture() {
        let layout = load().expect("stub must return the fixture");
        assert_eq!(layout.meta.geometry, "moonlander");
    }

    #[test]
    fn save_rejects_invalid_layout() {
        let mut layout = load().unwrap();
        layout.settings.key_lock = false;
        let err = save(&layout).unwrap_err();
        assert_eq!(err.code(), "InvalidLayout");
    }
}

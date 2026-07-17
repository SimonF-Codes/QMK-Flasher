//! Oryx seeding — owned by Worker A. See `docs/CONTRACT.md`.
//!
//! Responsible for producing a [`SeededLayout`] from the user's ZSA Oryx
//! layout / QMK sources. STUB: returns the checked-in fixture.

use crate::layout::SeededLayout;

const FIXTURE_LAYOUT: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/ws_together/seeded_layout.json"
));

/// Seed the current layout.
/// STUB: parses the fixture instead of talking to Oryx or parsing QMK sources.
pub fn seed_layout() -> Result<SeededLayout, String> {
    let layout: SeededLayout =
        serde_json::from_str(FIXTURE_LAYOUT).map_err(|e| e.to_string())?;
    layout.validate()?;
    Ok(layout)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_layout_returns_valid_fixture() {
        let layout = seed_layout().expect("stub must return the fixture");
        assert_eq!(layout.keyboard, "ws_together");
        assert!(layout.validate().is_ok());
    }
}

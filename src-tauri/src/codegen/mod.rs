//! Keymap codegen — owned by Worker A. See `docs/CONTRACT.md`.
//!
//! Responsible for rendering a [`SeededLayout`] back into QMK sources
//! (`keymap.c`). STUB: validates the layout and returns the fixture
//! `keymap.c` verbatim.

use crate::layout::SeededLayout;

const FIXTURE_KEYMAP: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../fixtures/ws_together/keymap.c"
));

/// Render `layout` as the contents of a `keymap.c`.
/// STUB: returns the fixture file instead of generating from the layout.
pub fn generate_keymap(layout: &SeededLayout) -> Result<String, String> {
    layout.validate()?;
    Ok(FIXTURE_KEYMAP.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::oryx::seed_layout;

    #[test]
    fn generate_keymap_accepts_fixture() {
        let layout = seed_layout().unwrap();
        let keymap = generate_keymap(&layout).expect("stub must render");
        assert!(keymap.contains(&layout.layout_macro));
        assert!(keymap.contains("keymaps"));
    }

    #[test]
    fn generate_keymap_rejects_invalid_layout() {
        let mut layout = seed_layout().unwrap();
        layout.key_count = 3;
        assert!(generate_keymap(&layout).is_err());
    }
}

//! Oryx seeding — owned by Worker A. See `docs/CONTRACT.md`.
//!
//! Real implementation: GraphQL fetch (client.rs) → KeyAction mapping +
//! Oryx→LAYOUT permutation (permute.rs, seed.rs) → KC_MEH→qkLock transform →
//! cross-check against the Oryx source zip via the keymap.c parser
//! (parse_keymap_c.rs). STUB: returns the checked-in fixture.

pub mod parse_keymap_c;
pub mod permute;
pub mod seed;

use crate::error::AppError;
use crate::layout::{store, LayoutFile};

/// Seed a fresh layout from Oryx.
/// STUB: ignores `layout_id`/`force` and returns the fixture.
pub fn seed_from_oryx(_layout_id: &str, _force: bool) -> Result<LayoutFile, AppError> {
    store::load()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_returns_valid_fixture() {
        let layout = seed_from_oryx("rddD7", false).unwrap();
        assert!(layout.validate().is_ok());
        assert_eq!(layout.meta.seeded_from.layout_id, "rddD7");
    }
}

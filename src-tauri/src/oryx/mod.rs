//! Oryx seeding — owned by Worker A. See `docs/CONTRACT.md`.
//!
//! GraphQL fetch (client.rs) → KeyAction mapping + Oryx→LAYOUT permutation
//! (permute.rs, seed.rs) → KC_MEH→qkLock transform → mandatory cross-check
//! against the Oryx source zip via the keymap.c parser (parse_keymap_c.rs)
//! → persist. The parser doubles as a fallback seeder if GraphQL changes.

pub mod client;
pub mod parse_keymap_c;
pub mod permute;
pub mod seed;

use crate::error::AppError;
use crate::layout::{store, LayoutFile};

/// Seed a fresh layout from Oryx.
///
/// With `force == false` an already-saved layout is returned untouched (the
/// app seeds once; local edits are the source of truth afterwards). With
/// `force == true` the layout is re-fetched, cross-checked against the
/// revision's generated source, saved, and returned — discarding local edits.
pub fn seed_from_oryx(layout_id: &str, force: bool) -> Result<LayoutFile, AppError> {
    if !force {
        if let Some(existing) = store::load_saved()? {
            return Ok(existing);
        }
    }

    // Seeding replaces the ACTIVE layout; its keyboard decides the Oryx
    // geometry (and must be one the seeder's permutation supports).
    let keyboard = crate::keyboards::supported(&store::load()?.meta.geometry)?;
    let snapshot = client::fetch_layout_snapshot(layout_id, &keyboard.oryx_geometry)?;
    let seeded_at = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let layout = seed::layout_from_snapshot(&snapshot, layout_id, &seeded_at)?;

    // Mandatory cross-check: our rendering of the seeded layout must agree
    // with the keymap.c Oryx generated for this exact revision.
    let zip = client::download_source_zip(&layout.meta.seeded_from.revision_hash)?;
    let keymap_c = client::keymap_c_from_zip(&zip)?;
    seed::cross_check(&layout, &keymap_c)?;

    // Snapshot the current active layout before overwriting it, so a reseed is
    // recoverable (and backs the UI's override warning). Done only after all
    // fallible fetch/build/cross-check steps pass — no snapshot on a failed
    // reseed that never overwrites.
    store::snapshot_active_pre_reseed()?;
    store::save(&layout)?;
    Ok(layout)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Offline behavior: seeding without `force` never touches the network
    /// once a layout exists (here: whatever `load` provides is not refetched —
    /// the function must not error even with no connectivity).
    #[test]
    fn seed_without_force_returns_saved_layout_untouched() {
        // On a dev machine with no saved layout this would hit the network,
        // so only exercise the short-circuit when a saved layout exists.
        if let Ok(Some(saved)) = store::load_saved() {
            let layout = seed_from_oryx("rddD7", false).unwrap();
            assert_eq!(layout, saved);
        }
    }
}

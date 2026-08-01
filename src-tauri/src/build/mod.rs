//! MSYS firmware build — owned by Worker A. See `docs/CONTRACT.md`.
//!
//! `build_firmware` builds the **saved** layout: it loads it from the store,
//! writes generated sources into `keymaps/<keymapName>/` (never
//! `arrows_together`), then runs the MSYS make (msys.rs), streaming every
//! output line through `on_log` (forwarded to the webview as `build-log`
//! events). Returns the path of the .bin copy under
//! `%APPDATA%\qmk-flasher\builds\`.

pub mod msys;

use crate::error::AppError;
use crate::{appcfg, codegen, layout};

pub fn build_firmware<F: FnMut(String)>(mut on_log: F) -> Result<String, AppError> {
    let layout = layout::store::load()?;
    let keyboard = crate::keyboards::supported(&layout.meta.geometry)?;
    let cfg = appcfg::get();
    let dir = codegen::write_sources(&layout, &cfg)?;
    on_log(format!("Sources written to {}", dir.display()));
    msys::build(&cfg, keyboard, &mut on_log)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Real MSYS build of a layout that DOES use tap dance (the seeded fixture,
    /// 2 dances), into a throwaway keymap dir so it never touches the user's
    /// `qmk_flasher` sources. Proves the tap-dance path — `TAP_DANCE_ENABLE=yes`
    /// in rules.mk together with the emitted `tap_dance_actions[]` in keymap.c —
    /// compiles green under the oryx module + introspection. Companion to
    /// `real_msys_build_produces_reference_sized_bin`, which covers the
    /// no-tap-dance active layout (the desync-fix regression).
    #[test]
    #[ignore = "invokes the real MSYS toolchain (minutes); run manually"]
    fn real_msys_build_of_a_tap_dance_layout_is_green() {
        use crate::layout::LayoutFile;
        let layout: LayoutFile =
            serde_json::from_str(crate::layout::store::FIXTURE_LAYOUT).unwrap();
        assert!(
            layout
                .layers
                .iter()
                .flat_map(|l| &l.keys)
                .any(|k| matches!(k, crate::layout::schema::KeyAction::TapDance { .. })),
            "fixture must have tap dances for this to be a meaningful check"
        );
        let mut cfg = appcfg::get();
        cfg.keymap_name = "qmk_flasher_td_check".into();
        let keyboard = crate::keyboards::supported(&layout.meta.geometry).unwrap();
        let dir = codegen::write_sources(&layout, &cfg).expect("write sources");
        // Sanity: the two coupled emissions agree, both ON.
        let rules = std::fs::read_to_string(dir.join("rules.mk")).unwrap();
        let keymap = std::fs::read_to_string(dir.join("keymap.c")).unwrap();
        assert!(rules.contains("TAP_DANCE_ENABLE = yes"));
        assert!(keymap.contains("tap_dance_actions"));
        let result = msys::build(&cfg, keyboard, &mut |l| println!("{l}"));
        // Clean up the throwaway keymap dir regardless of outcome.
        let _ = std::fs::remove_dir_all(&dir);
        let path = result.expect("tap-dance build must succeed");
        assert!(path.ends_with(".bin"));
    }

    /// A3 acceptance: the real MSYS build. Ignored by default — run manually
    /// once with `cargo test real_msys_build -- --ignored --nocapture`.
    /// Produces a .bin whose size is within ~1% of the known-good
    /// arrows_together image (golden source parity ⇒ near-identical binary).
    #[test]
    #[ignore = "invokes the real MSYS toolchain (minutes); run manually for A3"]
    fn real_msys_build_produces_reference_sized_bin() {
        let mut lines = Vec::new();
        let path = build_firmware(|l| {
            println!("{l}");
            lines.push(l);
        })
        .expect("real build must succeed");
        assert!(path.ends_with(".bin"));
        let built = std::fs::metadata(&path).expect("built bin exists").len() as f64;
        let reference = std::fs::metadata(
            r"C:\Users\fridl\qmk_firmware\zsa_moonlander_revb_arrows_together.bin",
        )
        .expect("reference arrows_together bin exists")
        .len() as f64;
        let deviation = (built - reference).abs() / reference;
        assert!(
            deviation < 0.01,
            "built {built} bytes vs reference {reference} bytes ({:.2}% off)",
            deviation * 100.0
        );
    }
}

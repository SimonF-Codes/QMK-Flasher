//! MSYS firmware build — owned by Worker A. See `docs/CONTRACT.md`.
//!
//! `build_firmware` builds the **saved** layout: it loads it from the store,
//! writes generated sources into `keymaps/<keymapName>/` (never
//! `arrows_together`), then runs the MSYS make (msys.rs), streaming every
//! output line through `on_log` (forwarded to the webview as `build-log`
//! events). Returns the path of the .bin copy under
//! `%APPDATA%\qmk-flasher\builds\`.
//!
//! The make is **skipped** when stamp.rs says the generated sources are
//! byte-identical to the last successful build and that build's .bin is still
//! there; the previous path is returned instead. Read stamp.rs for what that
//! check can and cannot see — notably it is blind to changes inside
//! `qmk_firmware` itself — and for how to force a build anyway.

pub mod msys;
pub mod stamp;

use std::path::Path;

use crate::error::AppError;
use crate::{appcfg, codegen, layout};

pub fn build_firmware<F: FnMut(String)>(mut on_log: F) -> Result<String, AppError> {
    let layout = layout::store::load()?;
    let keyboard = crate::keyboards::supported(&layout.meta.geometry)?;
    let cfg = appcfg::get();
    let dir = codegen::write_sources(&layout, &cfg)?;
    on_log(format!("Sources written to {}", dir.display()));

    let inputs = stamp::BuildInputs::of(&dir, &cfg, keyboard)?;
    match decide(&inputs) {
        stamp::Decision::Reuse { bin_path, built_at } => {
            // A skip has to be legible in the log: a `building` phase that
            // completes in a blink and says nothing makes a stale binary
            // impossible to diagnose.
            on_log(format!(
                "Skipping the QMK build — the generated sources are unchanged since the build of {built_at}."
            ));
            on_log(format!("Reusing the previous firmware {bin_path} (not rebuilt)."));
            on_log(format!(
                "That check only covers this app's generated sources, not the qmk_firmware checkout — set {}=1 to build anyway.",
                stamp::FORCE_REBUILD_ENV
            ));
            Ok(bin_path)
        }
        stamp::Decision::Rebuild { why } => {
            on_log(format!("Running the QMK build — {why}."));
            let bin_path = msys::build(&cfg, keyboard, &mut on_log)?;
            if let Err(e) = stamp::record(inputs, &bin_path) {
                // Never fail a good build over its own bookkeeping; the only
                // cost of a missing stamp is that the next run rebuilds.
                on_log(format!(
                    "Could not record the build stamp ({e}) — the next build will not be skipped."
                ));
            }
            Ok(bin_path)
        }
    }
}

/// Reuse or rebuild, given the sources we just wrote. Reads the recorded stamp
/// and the force-rebuild opt-out; the comparison itself is pure (stamp.rs).
fn decide(inputs: &stamp::BuildInputs) -> stamp::Decision {
    if stamp::force_rebuild_requested() {
        return stamp::Decision::Rebuild {
            why: format!("{} is set", stamp::FORCE_REBUILD_ENV),
        };
    }
    let previous = stamp::load();
    let bin_exists = previous
        .as_ref()
        .is_some_and(|p| Path::new(&p.bin_path).exists());
    stamp::decide(previous.as_ref(), inputs, bin_exists)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Restores `APPDATA` however the test ends.
    struct AppDataGuard(String);

    impl Drop for AppDataGuard {
        fn drop(&mut self) {
            std::env::set_var("APPDATA", &self.0);
        }
    }

    /// End-to-end proof of the skip, against the real toolchain: build, build
    /// again with nothing changed (must reuse), change one key, build again
    /// (must run make). Prints the three timings — the point of the change.
    ///
    /// Runs inside a temp `%APPDATA%` so the user's layouts, config, builds
    /// and stamp are untouched; the qmk_firmware checkout and MSYS are the
    /// real ones. `set_var` is process-global, so run this test alone (it is
    /// `#[ignore]`d, and selecting it by name is enough).
    #[test]
    #[ignore = "invokes the real MSYS toolchain (minutes); run manually"]
    fn unchanged_sources_skip_the_make_and_a_changed_key_rebuilds() {
        let sandbox = std::env::temp_dir().join("qmk-flasher-stamp-e2e");
        let _ = std::fs::remove_dir_all(&sandbox);
        std::fs::create_dir_all(&sandbox).unwrap();
        let _guard = AppDataGuard(std::env::var("APPDATA").expect("APPDATA is set"));
        std::env::set_var("APPDATA", &sandbox);

        let run = || {
            let mut lines = Vec::new();
            let started = std::time::Instant::now();
            let path = build_firmware(|l| {
                println!("{l}");
                lines.push(l);
            })
            .expect("build must succeed");
            (path, lines, started.elapsed())
        };
        let said = |lines: &[String], needle: &str| {
            lines.iter().any(|l| l.contains(needle))
        };
        // The command echo msys.rs logs before spawning bash: the ground truth
        // for "make actually ran".
        let make_ran = |lines: &[String]| said(lines, "$ bash -lc \"cd ");

        // 1. Cold: no stamp yet, so the full build.
        let (cold_bin, cold_log, cold) = run();
        assert!(said(&cold_log, "no previous build recorded"));
        assert!(make_ran(&cold_log));

        // 2. Nothing changed: reuse the same image, no make at all.
        let (reused_bin, reused_log, reuse) = run();
        assert_eq!(reused_bin, cold_bin, "the previous image is handed back");
        assert!(said(&reused_log, "Skipping the QMK build"));
        assert!(said(&reused_log, &cold_bin), "the log names the reused image");
        assert!(!make_ran(&reused_log), "make must not run for an unchanged build");

        // 3. One key changed: keymap.c differs, so make runs and a new image
        //    comes out.
        let mut layout = layout::store::load().unwrap();
        layout.layers[0].keys[0] = crate::layout::schema::KeyAction::Basic {
            code: "KC_F13".into(),
            mods: None,
            glow: None,
        };
        layout::store::save(&layout).unwrap();
        let (changed_bin, changed_log, changed) = run();
        assert!(said(&changed_log, "keymap.c changed"));
        assert!(make_ran(&changed_log));
        assert_ne!(changed_bin, cold_bin, "a rebuild produces a new image");

        println!(
            "\n  cold build      {cold:.1?}\
             \n  unchanged       {reuse:.1?}  (skipped)\
             \n  one key changed {changed:.1?}\n"
        );
        let _ = std::fs::remove_dir_all(&sandbox);
    }

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

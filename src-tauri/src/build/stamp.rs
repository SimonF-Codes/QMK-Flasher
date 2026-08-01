//! The build stamp: don't invoke `make` at all when nothing we generate has
//! changed.
//!
//! `codegen::write_if_changed` already avoids touching files whose content is
//! identical, because make keys off mtime and a byte-identical rewrite of
//! `config.h` costs a ~240s full rebuild. This is the next step in the same
//! idea: after every successful build we record a **stamp** — the SHA-256 of
//! each generated source, the QMK keyboard target, the keymap name and the
//! `.bin` that came out. The next build hashes the sources it just wrote and
//! compares. If everything matches and that `.bin` is still on disk, the
//! previous image is reused and `make` never runs (~30s saved on a no-op,
//! ~240s on a cold tree).
//!
//! # What the stamp cannot see
//!
//! It covers **this app's four generated files and nothing else**. If the user
//! pulls their `qmk_firmware` checkout, edits something under the keyboard's
//! own directory, or changes their toolchain, our hashes are unchanged while
//! the firmware `make` would produce is not — and the stale binary gets
//! flashed. Two escape hatches, both of which leave `build_firmware`'s frozen
//! `() -> String` contract signature alone:
//!
//! - set `QMK_FLASHER_FORCE_REBUILD` to any non-empty value, or
//! - delete `%APPDATA%\qmk-flasher\builds\last-build.json`.
//!
//! A reuse is never silent: `build_firmware` says so on `on_log` (and so in
//! the `build-log` events), naming the image and the escape hatch, so "built"
//! and "reused" are distinguishable in the UI.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::appcfg::AppConfig;
use crate::error::AppError;
use crate::keyboards::KeyboardInfo;
use crate::layout::store;

/// Set to any non-empty value to run `make` even when the stamp matches.
pub const FORCE_REBUILD_ENV: &str = "QMK_FLASHER_FORCE_REBUILD";

/// The generated files whose contents decide the firmware image — the four
/// `codegen::write_sources` writes.
const SOURCE_FILES: [&str; 4] = ["keymap.c", "rules.mk", "config.h", "keymap.json"];

/// Everything under this app's control that determines what `make` produces.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInputs {
    /// SHA-256 (hex) of each generated source, by file name. A `BTreeMap` so
    /// the serialized form is stable and equality is order-independent; a file
    /// that is missing is simply absent, which never equals a recorded hash.
    pub sources: BTreeMap<String, String>,
    /// `KeyboardInfo.qmk_keyboard` — the keyboard half of the make target.
    pub qmk_keyboard: String,
    /// `AppConfig.keymap_name` — its keymap half, and the directory codegen
    /// wrote into.
    pub keymap_name: String,
}

impl BuildInputs {
    /// Hash the generated sources in `dir` (the keymap directory codegen just
    /// wrote). Contents, not mtimes — `write_if_changed` deliberately leaves
    /// mtimes alone, so they say nothing about the content.
    pub fn of(dir: &Path, cfg: &AppConfig, kb: &KeyboardInfo) -> Result<Self, AppError> {
        let mut sources = BTreeMap::new();
        for name in SOURCE_FILES {
            let path = dir.join(name);
            match std::fs::read(&path) {
                Ok(bytes) => {
                    sources.insert(name.to_string(), hex(&Sha256::digest(&bytes)));
                }
                // A source that is not there is recorded as absent rather than
                // as an error: a half-written keymap dir must rebuild, not fail.
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(e) => {
                    return Err(AppError::BuildFailed(format!(
                        "hashing {}: {e}",
                        path.display()
                    )))
                }
            }
        }
        Ok(Self {
            sources,
            qmk_keyboard: kb.qmk_keyboard.clone(),
            keymap_name: cfg.keymap_name.clone(),
        })
    }
}

/// One successful build: its inputs and the image they produced.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildStamp {
    #[serde(flatten)]
    pub inputs: BuildInputs,
    /// The image that build produced — the copy under `builds\`.
    pub bin_path: String,
    /// RFC 3339 build time. Shown in the skip log line so the user can tell
    /// how old the binary they are about to flash is.
    pub built_at: String,
}

/// What to do about `make`, and **why** — the `why` is what the user reads in
/// the build log, so neither a skip nor a rebuild is unexplained.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Reuse { bin_path: String, built_at: String },
    Rebuild { why: String },
}

/// Whether the caller asked for a rebuild regardless of the stamp.
pub fn force_rebuild_requested() -> bool {
    std::env::var(FORCE_REBUILD_ENV).is_ok_and(|v| !v.trim().is_empty())
}

/// Compare `inputs` against the recorded stamp. Pure: `bin_exists` (whether
/// `previous.bin_path` is still on disk) is passed in, so the whole decision
/// is testable without a filesystem, MSYS or hardware.
pub fn decide(
    previous: Option<&BuildStamp>,
    inputs: &BuildInputs,
    bin_exists: bool,
) -> Decision {
    let rebuild = |why: String| Decision::Rebuild { why };
    let Some(prev) = previous else {
        return rebuild("no previous build recorded".into());
    };
    if prev.inputs.keymap_name != inputs.keymap_name {
        return rebuild(format!(
            "keymap name changed ({} -> {})",
            prev.inputs.keymap_name, inputs.keymap_name
        ));
    }
    if prev.inputs.qmk_keyboard != inputs.qmk_keyboard {
        return rebuild(format!(
            "keyboard target changed ({} -> {})",
            prev.inputs.qmk_keyboard, inputs.qmk_keyboard
        ));
    }
    let changed = changed_sources(&prev.inputs.sources, &inputs.sources);
    if !changed.is_empty() {
        return rebuild(format!("{} changed", changed.join(", ")));
    }
    // Sources match, but the image we would hand back has to still exist —
    // deleted or moved binaries rebuild rather than failing downstream.
    if !bin_exists {
        return rebuild(format!("previous firmware {} is gone", prev.bin_path));
    }
    Decision::Reuse {
        bin_path: prev.bin_path.clone(),
        built_at: prev.built_at.clone(),
    }
}

/// Names present in either map with differing hashes (so an added or removed
/// source counts as changed), sorted for a stable log line.
fn changed_sources(
    prev: &BTreeMap<String, String>,
    now: &BTreeMap<String, String>,
) -> Vec<String> {
    let mut names: Vec<&String> = prev.keys().chain(now.keys()).collect();
    names.sort();
    names.dedup();
    names
        .into_iter()
        .filter(|n| prev.get(*n) != now.get(*n))
        .cloned()
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `%APPDATA%\qmk-flasher\builds\last-build.json` — next to the `.bin` copies
/// it points at.
fn stamp_path() -> Result<PathBuf, AppError> {
    Ok(store::data_dir()?.join("builds").join("last-build.json"))
}

/// The recorded stamp, or `None` when there is none or it cannot be read.
/// Deliberately total: an unreadable or outdated-shape stamp means "rebuild",
/// never an error — refusing to build over bookkeeping would be worse than
/// paying for one build.
pub fn load() -> Option<BuildStamp> {
    let json = std::fs::read_to_string(stamp_path().ok()?).ok()?;
    serde_json::from_str(&json).ok()
}

/// Record a successful build. Same temp-write + rename as
/// `layout::store::atomic_write`, so a crash mid-write cannot leave a
/// half-parsed stamp behind.
pub fn record(inputs: BuildInputs, bin_path: &str) -> Result<(), AppError> {
    let stamp = BuildStamp {
        inputs,
        bin_path: bin_path.to_string(),
        built_at: chrono::Local::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    };
    write(&stamp_path()?, &stamp)
}

fn write(path: &Path, stamp: &BuildStamp) -> Result<(), AppError> {
    let io = |e: std::io::Error| {
        AppError::BuildFailed(format!("writing {}: {e}", path.display()))
    };
    let json = serde_json::to_string_pretty(stamp)
        .map_err(|e| AppError::BuildFailed(e.to_string()))?
        + "\n";
    std::fs::create_dir_all(path.parent().expect("stamp path has a parent")).map_err(io)?;
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    std::fs::write(&tmp, json).map_err(io)?;
    std::fs::rename(&tmp, path).map_err(io)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn moonlander() -> &'static KeyboardInfo {
        crate::keyboards::get("moonlander").unwrap()
    }

    /// A temp keymap dir holding the four generated sources.
    struct TempSources {
        dir: PathBuf,
    }

    impl TempSources {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("qmk-flasher-stamp-{tag}"));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            for name in SOURCE_FILES {
                std::fs::write(dir.join(name), format!("// {name}\n")).unwrap();
            }
            Self { dir }
        }

        fn inputs(&self) -> BuildInputs {
            let cfg = AppConfig::default();
            BuildInputs::of(&self.dir, &cfg, moonlander()).unwrap()
        }

        fn write(&self, name: &str, contents: &str) {
            std::fs::write(self.dir.join(name), contents).unwrap();
        }
    }

    impl Drop for TempSources {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn stamp_of(inputs: &BuildInputs) -> BuildStamp {
        BuildStamp {
            inputs: inputs.clone(),
            bin_path: r"C:\builds\20260801-120000.bin".into(),
            built_at: "2026-08-01T12:00:00+00:00".into(),
        }
    }

    fn why(decision: &Decision) -> &str {
        match decision {
            Decision::Rebuild { why } => why,
            Decision::Reuse { .. } => panic!("expected a rebuild, got {decision:?}"),
        }
    }

    #[test]
    fn identical_sources_reuse_the_previous_bin() {
        let t = TempSources::new("same");
        let before = t.inputs();
        let prev = stamp_of(&before);
        // Rehashing the untouched dir must produce exactly the same inputs.
        let after = t.inputs();
        assert_eq!(before, after);
        assert_eq!(
            decide(Some(&prev), &after, true),
            Decision::Reuse {
                bin_path: prev.bin_path.clone(),
                built_at: prev.built_at.clone(),
            }
        );
    }

    #[test]
    fn a_changed_keymap_c_rebuilds_and_names_the_file() {
        let t = TempSources::new("keymapc");
        let prev = stamp_of(&t.inputs());
        t.write("keymap.c", "// edited\n");
        let decision = decide(Some(&prev), &t.inputs(), true);
        assert_eq!(why(&decision), "keymap.c changed");
    }

    #[test]
    fn a_changed_rules_mk_rebuilds() {
        let t = TempSources::new("rulesmk");
        let prev = stamp_of(&t.inputs());
        t.write("rules.mk", "TAP_DANCE_ENABLE = yes\n");
        assert_eq!(why(&decide(Some(&prev), &t.inputs(), true)), "rules.mk changed");
    }

    #[test]
    fn a_deleted_source_rebuilds() {
        let t = TempSources::new("deleted");
        let prev = stamp_of(&t.inputs());
        std::fs::remove_file(t.dir.join("config.h")).unwrap();
        let now = t.inputs();
        assert!(!now.sources.contains_key("config.h"));
        assert_eq!(why(&decide(Some(&prev), &now, true)), "config.h changed");
    }

    #[test]
    fn a_missing_bin_rebuilds_even_though_the_sources_match() {
        let t = TempSources::new("nobin");
        let prev = stamp_of(&t.inputs());
        let decision = decide(Some(&prev), &t.inputs(), false);
        assert!(why(&decision).starts_with("previous firmware "));
        assert!(why(&decision).ends_with(" is gone"));
    }

    #[test]
    fn a_changed_keymap_name_rebuilds() {
        let t = TempSources::new("keymapname");
        let prev = stamp_of(&t.inputs());
        let mut now = t.inputs();
        now.keymap_name = "qmk_flasher_experiment".into();
        assert_eq!(
            why(&decide(Some(&prev), &now, true)),
            "keymap name changed (qmk_flasher -> qmk_flasher_experiment)"
        );
    }

    #[test]
    fn a_changed_keyboard_target_rebuilds() {
        let t = TempSources::new("kbtarget");
        let prev = stamp_of(&t.inputs());
        let mut now = t.inputs();
        now.qmk_keyboard = "zsa/moonlander/revb".into();
        assert_eq!(
            why(&decide(Some(&prev), &now, true)),
            "keyboard target changed (zsa/moonlander/reva -> zsa/moonlander/revb)"
        );
    }

    #[test]
    fn no_previous_stamp_rebuilds() {
        let t = TempSources::new("nostamp");
        assert_eq!(why(&decide(None, &t.inputs(), true)), "no previous build recorded");
    }

    #[test]
    fn inputs_hash_contents_not_mtimes() {
        let t = TempSources::new("mtime");
        let before = t.inputs();
        // Rewrite byte-identical content: a fresh mtime, the same hash.
        t.write("keymap.c", "// keymap.c\n");
        assert_eq!(t.inputs(), before);
        assert_eq!(before.sources.len(), SOURCE_FILES.len());
        // Real SHA-256 hex, not a placeholder.
        for digest in before.sources.values() {
            assert_eq!(digest.len(), 64);
            assert!(digest.chars().all(|c| c.is_ascii_hexdigit()));
        }
    }

    #[test]
    fn stamp_roundtrips_through_json() {
        let t = TempSources::new("json");
        let stamp = stamp_of(&t.inputs());
        let json = serde_json::to_string_pretty(&stamp).unwrap();
        let back: BuildStamp = serde_json::from_str(&json).unwrap();
        assert_eq!(back, stamp);
        // `flatten` keeps the inputs at the top level, camelCased.
        assert!(json.contains("\"qmkKeyboard\""));
        assert!(json.contains("\"binPath\""));
    }

    #[test]
    fn an_unparseable_stamp_is_treated_as_no_stamp() {
        let stamp: Option<BuildStamp> = serde_json::from_str("{ not json").ok();
        assert!(stamp.is_none());
    }

    #[test]
    fn write_then_read_back_a_stamp() {
        let t = TempSources::new("write");
        let path = t.dir.join("last-build.json");
        let stamp = stamp_of(&t.inputs());
        write(&path, &stamp).unwrap();
        let json = std::fs::read_to_string(&path).unwrap();
        assert_eq!(serde_json::from_str::<BuildStamp>(&json).unwrap(), stamp);
        // The temp file is renamed away, never left behind.
        let leftovers: Vec<_> = std::fs::read_dir(&t.dir)
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
            .filter(|n| n.contains("tmp-"))
            .collect();
        assert!(leftovers.is_empty(), "left behind {leftovers:?}");
    }
}
